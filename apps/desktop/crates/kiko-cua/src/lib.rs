use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use kiko_driver::{
    Desktop, DesktopInfo, DesktopTool, Display, DriverError, ErrorCode, Grant, Permissions,
};
use serde_json::{Value, json};

const MIN_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_millis(100);
#[cfg(target_os = "macos")]
const START_TIMEOUT: Duration = Duration::from_secs(30);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const LIST_TIMEOUT: Duration = Duration::from_secs(30);
const PERMISSION_TIMEOUT: Duration = Duration::from_secs(15);
const PROTOCOL_VERSION: &str = "2025-06-18";
const NEVER_EXPOSE: &[&str] = &["install_extension"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    Down(String),
    Timeout(String),
    Failed(String),
}

impl Error {
    pub fn code(&self) -> ErrorCode {
        match self {
            Error::Down(_) => ErrorCode::Failed,
            Error::Timeout(_) => ErrorCode::Timeout,
            Error::Failed(_) => ErrorCode::Failed,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            Error::Down(message) | Error::Timeout(message) | Error::Failed(message) => message,
        }
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for Error {}

pub type Log = Arc<dyn Fn(String) + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Starting,
    Ready,
    Down,
}

struct Inner {
    phase: Phase,
    reason: String,
    version: String,
    tools: Vec<DesktopTool>,
    permissions: Permissions,
    screens: Vec<Display>,
    connection: Option<Arc<Connection>>,
}

struct Connection {
    inner: Mutex<ConnectionInner>,
}

struct ConnectionInner {
    stdin: ChildStdin,
    next_id: u64,
    pending: HashMap<u64, Sender<Result<Value, String>>>,
}

struct Shared {
    inner: Mutex<Inner>,
    changed: Condvar,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }

    fn publish(&self, next: Phase, reason: &str) {
        {
            let mut inner = self.lock();
            inner.phase = next;
            inner.reason = reason.to_string();
        }
        self.changed.notify_all();
    }

    fn ready(
        &self,
        version: String,
        tools: Vec<DesktopTool>,
        permissions: Permissions,
        screens: Vec<Display>,
    ) {
        {
            let mut inner = self.lock();
            inner.phase = Phase::Ready;
            inner.reason.clear();
            inner.version = version;
            inner.tools = tools;
            inner.permissions = permissions;
            inner.screens = screens;
        }
        self.changed.notify_all();
    }
}

fn unknown() -> Permissions {
    Permissions {
        accessibility: Grant::Unknown,
        screen: Grant::Unknown,
        automation: Grant::NotNeeded,
    }
}

pub struct Cua {
    shared: Arc<Shared>,
    stop: Arc<AtomicBool>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl Cua {
    pub fn start(binary: PathBuf, socket: PathBuf, env: Vec<(String, String)>, log: Log) -> Self {
        let shared = Arc::new(Shared {
            inner: Mutex::new(Inner {
                phase: Phase::Starting,
                reason: "the desktop driver is starting".into(),
                version: String::new(),
                tools: Vec::new(),
                permissions: unknown(),
                screens: Vec::new(),
                connection: None,
            }),
            changed: Condvar::new(),
        });
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let state = Arc::clone(&shared);
        let thread_log = Arc::clone(&log);
        let thread_binary = binary.clone();
        let thread_socket = socket.clone();
        let thread_env = env.clone();
        let worker = thread::spawn(move || {
            supervise(
                &state,
                &flag,
                &thread_binary,
                &thread_socket,
                &thread_env,
                &thread_log,
            )
        });
        Self {
            shared,
            stop,
            worker: Mutex::new(Some(worker)),
        }
    }

    pub fn info(&self) -> DesktopInfo {
        let inner = self.shared.lock();
        DesktopInfo {
            version: inner.version.clone(),
            tools: inner.tools.clone(),
        }
    }

    pub fn permissions(&self) -> Permissions {
        self.shared.lock().permissions.clone()
    }

    pub fn screens(&self) -> Vec<Display> {
        self.shared.lock().screens.clone()
    }

    pub fn refresh(&self) {
        let (tools, connection) = {
            let inner = self.shared.lock();
            if inner.phase != Phase::Ready {
                return;
            }
            (inner.tools.clone(), inner.connection.clone())
        };
        let Some(connection) = connection else {
            return;
        };
        let permissions = load_permissions(&connection, &tools);
        let screens = load_screens(&connection, &tools);
        let mut inner = self.shared.lock();
        inner.permissions = permissions;
        inner.screens = screens;
    }

    pub fn call(&self, name: &str, args: Value) -> Result<Value, Error> {
        let connection = {
            let inner = self.shared.lock();
            if inner.phase != Phase::Ready {
                return Err(Error::Down(format!(
                    "the desktop driver is not running: {}",
                    inner.reason
                )));
            }
            inner
                .connection
                .clone()
                .ok_or_else(|| Error::Down("the desktop driver is not running".into()))?
        };
        request(
            &connection,
            "tools/call",
            json!({ "name": name, "arguments": args }),
            REQUEST_TIMEOUT,
        )
        .map_err(|message| classify(&message))
    }

    pub fn wait_ready(&self, timeout: Duration) -> bool {
        self.wait_for(Phase::Ready, timeout)
    }

    pub fn wait_down(&self, timeout: Duration) -> bool {
        self.wait_for(Phase::Down, timeout)
    }

    fn wait_for(&self, phase: Phase, timeout: Duration) -> bool {
        let until = Instant::now() + timeout;
        let mut inner = self.shared.lock();
        loop {
            if inner.phase == phase {
                return true;
            }
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return false;
            }
            let (guard, _) = self
                .shared
                .changed
                .wait_timeout(inner, left)
                .unwrap_or_else(|error| error.into_inner());
            inner = guard;
        }
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        self.shared.changed.notify_all();
        if let Some(worker) = self.worker.lock().ok().and_then(|mut worker| worker.take()) {
            let _ = worker.join();
        }
    }
}

impl Drop for Cua {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.shared.changed.notify_all();
    }
}

impl Desktop for Cua {
    fn info(&self) -> DesktopInfo {
        Cua::info(self)
    }

    fn call(&mut self, name: &str, args: Value) -> kiko_driver::Result<Value> {
        Cua::call(self, name, args).map_err(|error| DriverError::new(error.code(), error.message()))
    }

    fn permissions(&self) -> Permissions {
        Cua::permissions(self)
    }

    fn screens(&self) -> Vec<Display> {
        Cua::screens(self)
    }

    fn refresh(&mut self) {
        Cua::refresh(self)
    }
}

fn classify(message: &str) -> Error {
    if message.starts_with("the desktop driver") {
        Error::Down(message.to_string())
    } else if message.ends_with("timed out") {
        Error::Timeout(message.to_string())
    } else {
        Error::Failed(message.to_string())
    }
}

fn supervise(
    shared: &Arc<Shared>,
    stop: &AtomicBool,
    binary: &Path,
    socket: &Path,
    env: &[(String, String)],
    log: &Log,
) {
    let mut backoff = MIN_BACKOFF;
    while !stop.load(Ordering::SeqCst) {
        let reason = session(shared, stop, binary, socket, env, log);
        if stop.load(Ordering::SeqCst) {
            break;
        }
        shared.publish(Phase::Down, &reason);
        wait(stop, backoff);
        backoff = grow(backoff);
    }
}

fn session(
    shared: &Arc<Shared>,
    stop: &AtomicBool,
    binary: &Path,
    socket: &Path,
    env: &[(String, String)],
    log: &Log,
) -> String {
    shared.publish(Phase::Starting, "the desktop driver is starting");
    let version = version_of(binary, env).unwrap_or_default();
    let backend = match embedded_backend(binary, socket, stop, log) {
        Ok(backend) => backend,
        Err(reason) => return reason,
    };
    let mut child = match spawn_mcp(binary, socket, env, log) {
        Ok(child) => child,
        Err(reason) => return reason,
    };
    let stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => return "cua-driver gave no stdin".into(),
    };
    let connection = Arc::new(Connection {
        inner: Mutex::new(ConnectionInner {
            stdin,
            next_id: 1,
            pending: HashMap::new(),
        }),
    });
    {
        let mut inner = shared.lock();
        inner.connection = Some(Arc::clone(&connection));
        inner.tools.clear();
    }
    let reader = child.stdout.take().map(|stdout| {
        let connection = Arc::clone(&connection);
        let log = Arc::clone(log);
        thread::spawn(move || read_lines(stdout, &connection, &log))
    });
    log_stderr(child.stderr.take(), log);
    let init = initialize(&connection, log);
    match init {
        Ok((tools, permissions, screens)) => shared.ready(version, tools, permissions, screens),
        Err(reason) => {
            let _ = child.kill();
            let _ = child.wait();
            if let Some(reader) = reader {
                let _ = reader.join();
            }
            shared.lock().connection = None;
            return reason;
        }
    }
    let outcome = wait_for_exit(&mut child, stop);
    shared.lock().connection = None;
    if let Some(reader) = reader {
        let _ = reader.join();
    }
    drop(backend);
    outcome
}

fn grow(backoff: Duration) -> Duration {
    (backoff * 2).min(MAX_BACKOFF)
}

fn wait(stop: &AtomicBool, duration: Duration) {
    let until = Instant::now() + duration;
    while Instant::now() < until && !stop.load(Ordering::SeqCst) {
        thread::sleep(POLL);
    }
}

fn wait_for_exit(child: &mut Child, stop: &AtomicBool) -> String {
    loop {
        if stop.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return "the desktop driver is stopping".into();
        }
        match child.try_wait() {
            Ok(Some(status)) => return format!("the desktop driver exited: {status}"),
            Ok(None) => thread::sleep(POLL),
            Err(error) => return format!("the desktop driver could not be watched: {error}"),
        }
    }
}

fn version_of(binary: &Path, env: &[(String, String)]) -> Option<String> {
    let output = Command::new(binary)
        .arg("--version")
        .envs(env.iter().map(|(key, value)| (key, value)))
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.split_whitespace().last().map(str::to_string)
}

#[cfg(target_os = "macos")]
struct Backend {
    child: Child,
}

#[cfg(target_os = "macos")]
impl Drop for Backend {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(target_os = "macos")]
fn embedded_backend(
    binary: &Path,
    socket: &Path,
    stop: &AtomicBool,
    log: &Log,
) -> Result<Backend, String> {
    let _ = std::fs::remove_file(socket);
    let mut child = Command::new(binary)
        .args(["serve", "--embedded", "--socket", &socket.to_string_lossy()])
        .env("CUA_DRIVER_EMBEDDED", "1")
        .env("CUA_DRIVER_PERMISSION_MODE", "standard")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("cua-driver serve did not start: {error}"))?;
    log_stderr(child.stderr.take(), log);
    let backend = Backend { child };
    wait_for_socket(socket, stop)?;
    Ok(backend)
}

#[cfg(target_os = "macos")]
fn wait_for_socket(socket: &Path, stop: &AtomicBool) -> Result<(), String> {
    let until = Instant::now() + START_TIMEOUT;
    loop {
        if stop.load(Ordering::SeqCst) {
            return Err("the desktop driver is stopping".into());
        }
        if std::os::unix::net::UnixStream::connect(socket).is_ok() {
            return Ok(());
        }
        if Instant::now() >= until {
            return Err(format!(
                "cua-driver did not open {} within {}s",
                socket.display(),
                START_TIMEOUT.as_secs()
            ));
        }
        thread::sleep(POLL);
    }
}

#[cfg(not(target_os = "macos"))]
struct Backend;

#[cfg(not(target_os = "macos"))]
fn embedded_backend(_: &Path, _: &Path, _: &AtomicBool, _: &Log) -> Result<Backend, String> {
    Ok(Backend)
}

fn spawn_mcp(
    binary: &Path,
    socket: &Path,
    env: &[(String, String)],
    log: &Log,
) -> Result<Child, String> {
    let mut command = Command::new(binary);
    command
        .arg("mcp")
        .envs(env.iter().map(|(key, value)| (key, value)));
    #[cfg(target_os = "macos")]
    command
        .arg("--embedded")
        .arg("--socket")
        .arg(socket)
        .env("CUA_DRIVER_EMBEDDED", "1");
    #[cfg(not(target_os = "macos"))]
    let _ = socket;
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = command
        .spawn()
        .map_err(|error| format!("cua-driver mcp did not start: {error}"))?;
    let _ = log;
    Ok(child)
}

fn log_stderr(stream: Option<std::process::ChildStderr>, log: &Log) {
    let Some(stream) = stream else { return };
    let log = Arc::clone(log);
    thread::spawn(move || {
        for line in BufReader::new(stream).lines() {
            match line {
                Ok(line) => log(format!("cua-driver: {line}")),
                Err(_) => break,
            }
        }
    });
}

fn initialize(
    connection: &Arc<Connection>,
    log: &Log,
) -> Result<(Vec<DesktopTool>, Permissions, Vec<Display>), String> {
    request(
        connection,
        "initialize",
        json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "kiko", "version": env!("CARGO_PKG_VERSION") },
        }),
        LIST_TIMEOUT,
    )?;
    notify(connection, "notifications/initialized")?;
    let tools = load_tools(connection)?;
    log(format!("cua-driver lists {} tools", tools.len()));
    let permissions = load_permissions(connection, &tools);
    let screens = load_screens(connection, &tools);
    Ok((tools, permissions, screens))
}

fn load_screens(connection: &Arc<Connection>, tools: &[DesktopTool]) -> Vec<Display> {
    if !tools.iter().any(|tool| tool.name == "get_screen_size") {
        return Vec::new();
    }
    let result = request(
        connection,
        "tools/call",
        json!({ "name": "get_screen_size", "arguments": {} }),
        PERMISSION_TIMEOUT,
    );
    let Ok(result) = result else {
        return Vec::new();
    };
    let Some(report) = report_of(&result) else {
        return Vec::new();
    };
    screens_of(&report)
}

fn screens_of(report: &Value) -> Vec<Display> {
    if let Some(list) = report.get("screens").and_then(Value::as_array) {
        return list
            .iter()
            .enumerate()
            .filter_map(|(index, screen)| screen_of(screen, &index.to_string()))
            .collect();
    }
    screen_of(report, "primary").into_iter().collect()
}

fn screen_of(value: &Value, id: &str) -> Option<Display> {
    let width = value.get("width").and_then(Value::as_f64)?;
    let height = value.get("height").and_then(Value::as_f64)?;
    if width < 1.0 || height < 1.0 {
        return None;
    }
    let scale = value.get("scale").and_then(Value::as_f64).unwrap_or(1.0);
    Some(Display {
        id: id.to_string(),
        width: width.round() as u32,
        height: height.round() as u32,
        scale,
    })
}

fn load_tools(connection: &Arc<Connection>) -> Result<Vec<DesktopTool>, String> {
    let mut tools = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let params = cursor
            .as_ref()
            .map_or_else(|| json!({}), |cursor| json!({ "cursor": cursor }));
        let result = request(connection, "tools/list", params, LIST_TIMEOUT)?;
        let listed = result
            .get("tools")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for tool in listed {
            if let Ok(tool) = serde_json::from_value::<DesktopTool>(tool)
                && !NEVER_EXPOSE.contains(&tool.name.as_str())
            {
                tools.push(tool);
            }
        }
        cursor = result
            .get("nextCursor")
            .and_then(Value::as_str)
            .map(str::to_string);
        if cursor.is_none() {
            return Ok(tools);
        }
    }
}

fn load_permissions(connection: &Arc<Connection>, tools: &[DesktopTool]) -> Permissions {
    if !tools.iter().any(|tool| tool.name == "check_permissions") {
        return unknown();
    }
    let result = request(
        connection,
        "tools/call",
        json!({ "name": "check_permissions", "arguments": {} }),
        PERMISSION_TIMEOUT,
    );
    let Ok(result) = result else {
        return unknown();
    };
    let Some(value) = report_of(&result) else {
        return unknown();
    };
    Permissions {
        accessibility: grant(value.get("accessibility").and_then(Value::as_bool)),
        screen: grant(
            value
                .get("screen_recording")
                .and_then(Value::as_bool)
                .or_else(|| value.get("screen").and_then(Value::as_bool)),
        ),
        automation: Grant::NotNeeded,
    }
}

fn report_of(result: &Value) -> Option<Value> {
    if let Some(report) = result
        .get("structuredContent")
        .filter(|value| value.is_object())
    {
        return Some(report.clone());
    }
    result
        .get("content")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .find_map(|text| serde_json::from_str::<Value>(text).ok())
}

fn grant(value: Option<bool>) -> Grant {
    match value {
        Some(true) => Grant::Granted,
        Some(false) => Grant::Denied,
        None => Grant::Unknown,
    }
}

fn notify(connection: &Arc<Connection>, method: &str) -> Result<(), String> {
    let mut inner = connection.lock();
    let line = json!({ "jsonrpc": "2.0", "method": method });
    writeln!(inner.stdin, "{line}").map_err(|error| format!("{method} could not be sent: {error}"))
}

fn request(
    connection: &Arc<Connection>,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let (sender, receiver) = mpsc::channel();
    let id = {
        let mut inner = connection.lock();
        let id = inner.next_id;
        inner.next_id += 1;
        let line = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        writeln!(inner.stdin, "{line}")
            .map_err(|error| format!("{method} could not be sent: {error}"))?;
        inner
            .stdin
            .flush()
            .map_err(|error| format!("{method} could not be sent: {error}"))?;
        inner.pending.insert(id, sender);
        id
    };
    match receiver.recv_timeout(timeout) {
        Ok(reply) => reply,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            connection.lock().pending.remove(&id);
            Err(format!("{method} timed out"))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(format!("{method} was dropped")),
    }
}

fn read_lines(stream: impl std::io::Read, connection: &Arc<Connection>, log: &Log) {
    for line in BufReader::new(stream).lines() {
        let Ok(line) = line else { break };
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(id) = message.get("id").and_then(Value::as_u64) else {
            continue;
        };
        let reply = match message.get("error") {
            Some(error) => Err(error_message(error)),
            None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
        };
        deliver(connection, id, reply);
    }
    let pending = drain(connection, "the desktop driver stopped");
    if pending > 0 {
        log(format!("cua-driver stopped with {pending} calls waiting"));
    }
}

fn error_message(error: &Value) -> String {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("the desktop driver failed")
        .to_string();
    match error.get("code").and_then(Value::as_i64) {
        Some(code) => format!("{message} ({code})"),
        None => message,
    }
}

fn deliver(connection: &Arc<Connection>, id: u64, reply: Result<Value, String>) {
    let sender = connection.lock().pending.remove(&id);
    if let Some(sender) = sender {
        let _ = sender.send(reply);
    }
}

fn drain(connection: &Arc<Connection>, reason: &str) -> usize {
    let mut inner = connection.lock();
    let waiting: Vec<_> = inner.pending.drain().map(|(_, sender)| sender).collect();
    let count = waiting.len();
    drop(inner);
    for sender in waiting {
        let _ = sender.send(Err(reason.to_string()));
    }
    count
}

impl Connection {
    fn lock(&self) -> MutexGuard<'_, ConnectionInner> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }
}
