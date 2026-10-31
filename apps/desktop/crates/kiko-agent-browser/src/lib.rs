use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use kiko_driver::{
    ActResult, Browser, BrowserActParams, BrowserEvalParams, BrowserOpenParams, BrowserReadParams,
    BrowserState, BrowserStatus, DriverError, ErrorCode, Image, Page, PageAction, Route, Tab,
    TabParams,
};
use serde_json::{Value, json};

mod image;
mod snapshot;

const MIN_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_millis(100);
const START_TIMEOUT: Duration = Duration::from_secs(30);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const LIST_TIMEOUT: Duration = Duration::from_secs(30);
const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);
const PROTOCOL_VERSION: &str = "2025-06-18";
const ENGINE: &str = "agent-browser";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    Down(String),
    Timeout(String),
    Stale(String),
    NotFound(String),
    Failed(String),
}

impl Error {
    pub fn code(&self) -> ErrorCode {
        match self {
            Error::Down(_) | Error::Failed(_) => ErrorCode::Failed,
            Error::Timeout(_) => ErrorCode::Timeout,
            Error::Stale(_) => ErrorCode::Stale,
            Error::NotFound(_) => ErrorCode::NotFound,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            Error::Down(message)
            | Error::Timeout(message)
            | Error::Stale(message)
            | Error::NotFound(message)
            | Error::Failed(message) => message,
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
type Outcome<T> = std::result::Result<T, Error>;

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

impl Connection {
    fn lock(&self) -> MutexGuard<'_, ConnectionInner> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }
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

    fn ready(&self, version: String) {
        {
            let mut inner = self.lock();
            inner.phase = Phase::Ready;
            inner.reason.clear();
            inner.version = version;
        }
        self.changed.notify_all();
    }
}

pub struct Engine {
    shared: Arc<Shared>,
    stop: Arc<AtomicBool>,
    worker: Mutex<Option<JoinHandle<()>>>,
    shot: PathBuf,
    refs: HashMap<String, HashSet<u32>>,
}

impl Engine {
    pub fn start(binary: PathBuf, env: Vec<(String, String)>, shot: PathBuf, log: Log) -> Self {
        let shared = Arc::new(Shared {
            inner: Mutex::new(Inner {
                phase: Phase::Starting,
                reason: "the browser engine is starting".into(),
                version: String::new(),
                connection: None,
            }),
            changed: Condvar::new(),
        });
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let state = Arc::clone(&shared);
        let thread_log = Arc::clone(&log);
        let worker = thread::spawn(move || supervise(&state, &flag, &binary, &env, &thread_log));
        Self {
            shared,
            stop,
            worker: Mutex::new(Some(worker)),
            shot,
            refs: HashMap::new(),
        }
    }

    pub fn wait_ready(&self, timeout: Duration) -> bool {
        self.wait_for(Phase::Ready, timeout)
    }

    pub fn wait_down(&self, timeout: Duration) -> bool {
        self.wait_for(Phase::Down, timeout)
    }

    pub fn version(&self) -> String {
        self.shared.lock().version.clone()
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
        if self.shared.lock().phase == Phase::Ready {
            let _ = self.request("agent_browser_close", json!({}), CLOSE_TIMEOUT);
        }
        self.stop.store(true, Ordering::SeqCst);
        self.shared.changed.notify_all();
        if let Some(worker) = self.worker.lock().ok().and_then(|mut worker| worker.take()) {
            let _ = worker.join();
        }
    }

    fn connection(&self) -> Outcome<Arc<Connection>> {
        let inner = self.shared.lock();
        if inner.phase != Phase::Ready {
            return Err(Error::Down(format!(
                "the browser engine is not running: {}",
                inner.reason
            )));
        }
        inner
            .connection
            .clone()
            .ok_or_else(|| Error::Down("the browser engine is not running".into()))
    }

    fn tool(&self, name: &str, args: Value) -> Outcome<Value> {
        let result = self.request(name, args, REQUEST_TIMEOUT)?;
        payload(&result)
    }

    fn request(&self, tool: &str, args: Value, timeout: Duration) -> Outcome<Value> {
        let connection = self.connection()?;
        let params = json!({ "name": tool, "arguments": args });
        let answer = request(&connection, "tools/call", params, timeout)
            .map_err(|message| classify(&message))?;
        Ok(answer)
    }

    fn list(&self) -> Outcome<Vec<Tab>> {
        let data = self.tool("agent_browser_tab_list", json!({}))?;
        Ok(tabs_of(&data))
    }

    fn tabs_or_empty(&mut self) -> Outcome<Vec<Tab>> {
        match self.list() {
            Ok(tabs) => Ok(tabs),
            Err(Error::Failed(message)) if message.contains("Browser not launched") => {
                Ok(Vec::new())
            }
            Err(error) => Err(error),
        }
    }

    fn bind(&self, tab: &str) -> Outcome<()> {
        self.tool("agent_browser_tab_switch", json!({ "tab": tab }))?;
        Ok(())
    }

    fn one(&self, tab: &str) -> Outcome<Tab> {
        self.list()?
            .into_iter()
            .find(|known| known.id == tab)
            .ok_or_else(|| Error::NotFound(format!("the browser has no tab {tab}")))
    }

    fn open(&mut self, params: &BrowserOpenParams) -> Outcome<Tab> {
        let started = match self.list() {
            Ok(_) => true,
            Err(Error::Failed(message)) if message.contains("Browser not launched") => false,
            Err(error) => return Err(error),
        };
        if started {
            self.tool("agent_browser_tab_new", json!({ "url": params.url }))?;
        } else {
            self.tool(
                "agent_browser_open",
                json!({ "url": params.url, "headed": false }),
            )?;
        }
        let tabs = self.list()?;
        tabs.iter()
            .find(|tab| tab.active)
            .or_else(|| tabs.last())
            .cloned()
            .ok_or_else(|| Error::Failed("the browser did not open a tab".into()))
    }

    fn close(&mut self, params: &TabParams) -> Outcome<()> {
        self.tool("agent_browser_tab_close", json!({ "tab": params.tab }))?;
        self.refs.remove(&params.tab);
        Ok(())
    }

    fn show(&mut self, params: &TabParams) -> Outcome<()> {
        self.bind(&params.tab)?;
        Ok(())
    }

    fn read(&mut self, params: &BrowserReadParams) -> Outcome<Page> {
        let tab = self.one(&params.tab)?;
        self.bind(&params.tab)?;
        let data = self.tool(
            "agent_browser_snapshot",
            json!({ "interactive": false, "compact": true }),
        )?;
        let tree = data
            .get("snapshot")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::Failed("the browser engine sent no page snapshot".into()))?;
        let built = snapshot::build(&snapshot::parse(tree), kiko_driver::MAX_NODES);
        self.refs.insert(params.tab.clone(), built.refs);
        let page = Page {
            tab,
            outline: kiko_driver::outline(&built.nodes),
            nodes: built.nodes,
            image: None,
        };
        if params.image {
            let image = self.capture()?;
            return Ok(Page {
                image: Some(image),
                ..page
            });
        }
        Ok(page)
    }

    fn capture(&self) -> Outcome<Image> {
        let path = self.shot.to_string_lossy().into_owned();
        self.tool(
            "agent_browser_screenshot",
            json!({ "path": path, "format": "jpeg", "quality": 80 }),
        )?;
        let bytes = std::fs::read(&self.shot).map_err(|error| {
            Error::Failed(format!("the browser engine sent no picture: {error}"))
        })?;
        image::from_jpeg(&bytes).map_err(|error| Error::Failed(error.message))
    }

    fn act(&mut self, params: &BrowserActParams) -> Outcome<ActResult> {
        if !self
            .refs
            .get(&params.tab)
            .is_some_and(|refs| refs.contains(&params.reference))
        {
            return Err(Error::Stale(
                "that ref is stale; read the page again".into(),
            ));
        }
        self.bind(&params.tab)?;
        let selector = format!("@e{}", params.reference);
        let text = params.text.as_deref().unwrap_or_default();
        let route = match params.action {
            PageAction::Click => {
                self.tool("agent_browser_click", json!({ "selector": selector }))?;
                Route::Trusted
            }
            PageAction::Type => {
                require_text(params.action, text)?;
                self.tool(
                    "agent_browser_type",
                    json!({ "selector": selector, "text": text }),
                )?;
                Route::Trusted
            }
            PageAction::SetValue => {
                require_text(params.action, text)?;
                self.tool(
                    "agent_browser_fill",
                    json!({ "selector": selector, "text": text }),
                )?;
                Route::Dom
            }
            PageAction::Select => {
                require_text(params.action, text)?;
                self.tool(
                    "agent_browser_select",
                    json!({ "selector": selector, "values": [text] }),
                )?;
                Route::Dom
            }
            PageAction::PressKey => {
                self.tool("agent_browser_focus", json!({ "selector": selector }))?;
                self.tool("agent_browser_press", json!({ "key": text }))?;
                Route::Trusted
            }
            PageAction::Scroll => {
                self.tool(
                    "agent_browser_scroll_into_view",
                    json!({ "selector": selector }),
                )?;
                Route::Dom
            }
            PageAction::Focus => {
                self.tool("agent_browser_focus", json!({ "selector": selector }))?;
                Route::Dom
            }
        };
        Ok(ActResult { route })
    }

    fn eval(&mut self, params: &BrowserEvalParams) -> Outcome<Value> {
        self.bind(&params.tab)?;
        let data = self.tool("agent_browser_eval", json!({ "script": params.expression }))?;
        Ok(data.get("result").cloned().unwrap_or(Value::Null))
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.shared.changed.notify_all();
    }
}

impl Browser for Engine {
    fn status(&mut self) -> Vec<BrowserStatus> {
        if self.shared.lock().phase == Phase::Ready {
            return vec![BrowserStatus {
                name: ENGINE.into(),
                state: BrowserState::Connected,
            }];
        }
        Vec::new()
    }

    fn tabs(&mut self) -> kiko_driver::Result<Vec<Tab>> {
        self.tabs_or_empty().map_err(Into::into)
    }

    fn open(&mut self, params: &BrowserOpenParams) -> kiko_driver::Result<Tab> {
        Engine::open(self, params).map_err(Into::into)
    }

    fn close(&mut self, params: &TabParams) -> kiko_driver::Result<()> {
        Engine::close(self, params).map_err(Into::into)
    }

    fn show(&mut self, params: &TabParams) -> kiko_driver::Result<()> {
        Engine::show(self, params).map_err(Into::into)
    }

    fn read(&mut self, params: &BrowserReadParams) -> kiko_driver::Result<Page> {
        Engine::read(self, params).map_err(Into::into)
    }

    fn act(&mut self, params: &BrowserActParams) -> kiko_driver::Result<ActResult> {
        Engine::act(self, params).map_err(Into::into)
    }

    fn eval(&mut self, params: &BrowserEvalParams) -> kiko_driver::Result<Value> {
        Engine::eval(self, params).map_err(Into::into)
    }
}

impl From<Error> for DriverError {
    fn from(error: Error) -> Self {
        DriverError::new(error.code(), error.message())
    }
}

fn require_text(action: PageAction, text: &str) -> Outcome<()> {
    if text.is_empty() {
        return Err(Error::Failed(format!("{action:?} needs text")));
    }
    Ok(())
}

fn tabs_of(data: &Value) -> Vec<Tab> {
    let Some(list) = data.get("tabs").and_then(Value::as_array) else {
        return Vec::new();
    };
    list.iter()
        .enumerate()
        .filter_map(|(index, tab)| {
            let id = tab
                .get("targetId")
                .and_then(Value::as_str)
                .or_else(|| tab.get("tabId").and_then(Value::as_str))?;
            Some(Tab {
                id: id.to_string(),
                browser: ENGINE.into(),
                window_id: 0,
                index: index as u32,
                active: tab.get("active").and_then(Value::as_bool).unwrap_or(false),
                title: tab
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                url: tab
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            })
        })
        .collect()
}

fn payload(result: &Value) -> Outcome<Value> {
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        return Err(classify(&text_of(result)));
    }
    let Some(response) = result.pointer("/structuredContent/response") else {
        return Err(Error::Failed("the browser engine sent no answer".into()));
    };
    if response.get("success").and_then(Value::as_bool) == Some(false) {
        let message = response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("the browser engine failed");
        return Err(classify(message));
    }
    Ok(response.get("data").cloned().unwrap_or(Value::Null))
}

fn text_of(result: &Value) -> String {
    result
        .get("content")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn classify(message: &str) -> Error {
    let message = message.trim();
    let text = if message.is_empty() {
        "the browser engine failed"
    } else {
        message
    };
    if text.contains("is stale") {
        Error::Stale(text.to_string())
    } else if text.contains("timed out") || text.contains("timeout") {
        Error::Timeout(text.to_string())
    } else if text.contains("No tab")
        || text.contains("not found")
        || text.contains("tab_gone")
        || text.contains("did not match")
    {
        Error::NotFound(text.to_string())
    } else {
        Error::Failed(text.to_string())
    }
}

fn supervise(
    shared: &Arc<Shared>,
    stop: &AtomicBool,
    binary: &Path,
    env: &[(String, String)],
    log: &Log,
) {
    let mut backoff = MIN_BACKOFF;
    while !stop.load(Ordering::SeqCst) {
        let reason = session(shared, stop, binary, env, log);
        if stop.load(Ordering::SeqCst) {
            break;
        }
        shared.publish(Phase::Down, &reason);
        wait(stop, backoff);
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

fn session(
    shared: &Arc<Shared>,
    stop: &AtomicBool,
    binary: &Path,
    env: &[(String, String)],
    log: &Log,
) -> String {
    shared.publish(Phase::Starting, "the browser engine is starting");
    let version = version_of(binary, env).unwrap_or_default();
    let mut child = match spawn(binary, env) {
        Ok(child) => child,
        Err(reason) => return reason,
    };
    let Some(stdin) = child.stdin.take() else {
        return "agent-browser gave no stdin".into();
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
    }
    let reader = child.stdout.take().map(|stdout| {
        let connection = Arc::clone(&connection);
        let log = Arc::clone(log);
        thread::spawn(move || read_lines(stdout, &connection, &log))
    });
    log_stderr(child.stderr.take(), log);
    match initialize(&connection, log) {
        Ok(()) => shared.ready(version),
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
    outcome
}

fn spawn(binary: &Path, env: &[(String, String)]) -> Result<Child, String> {
    Command::new(binary)
        .args(["mcp", "--tools", "all"])
        .envs(env.iter().cloned())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("agent-browser mcp did not start: {error}"))
}

fn version_of(binary: &Path, env: &[(String, String)]) -> Option<String> {
    let output = Command::new(binary)
        .arg("--version")
        .envs(env.iter().cloned())
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.split_whitespace().last().map(str::to_string)
}

fn log_stderr(stream: Option<std::process::ChildStderr>, log: &Log) {
    let Some(stream) = stream else { return };
    let log = Arc::clone(log);
    thread::spawn(move || {
        for line in BufReader::new(stream).lines() {
            match line {
                Ok(line) => log(format!("agent-browser: {line}")),
                Err(_) => break,
            }
        }
    });
}

fn initialize(connection: &Arc<Connection>, log: &Log) -> Result<(), String> {
    request(
        connection,
        "initialize",
        json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "kiko", "version": env!("CARGO_PKG_VERSION") },
        }),
        START_TIMEOUT,
    )?;
    notify(connection, "notifications/initialized")?;
    let tools = request(connection, "tools/list", json!({}), LIST_TIMEOUT)?;
    let count = tools
        .get("tools")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    log(format!("agent-browser lists {count} tools"));
    if count == 0 {
        return Err("agent-browser listed no tools".into());
    }
    Ok(())
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
    let pending = drain(connection, "the browser engine stopped");
    if pending > 0 {
        log(format!(
            "agent-browser stopped with {pending} calls waiting"
        ));
    }
}

fn error_message(error: &Value) -> String {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("the browser engine failed")
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
            return "the browser engine is stopping".into();
        }
        match child.try_wait() {
            Ok(Some(status)) => return format!("the browser engine exited: {status}"),
            Ok(None) => thread::sleep(POLL),
            Err(error) => return format!("the browser engine could not be watched: {error}"),
        }
    }
}
