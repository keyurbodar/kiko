use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use interprocess::local_socket::prelude::*;

const WAIT: Duration = Duration::from_secs(20);

fn binary() -> &'static Path {
    Path::new(env!("CARGO_BIN_EXE_kiko"))
}

fn core_name() -> &'static str {
    if cfg!(windows) {
        "kiko-core.exe"
    } else {
        "kiko-core"
    }
}

struct App {
    dir: PathBuf,
    child: Child,
}

impl App {
    fn launch(dir: &Path) -> Command {
        let mut command = Command::new(binary());
        command
            .env("KIKO_APP_DIR", dir)
            .env("KIKO_COMPUTER_DIR", dir.join("computer"))
            .env("KIKO_CORE", dir.join(core_name()))
            .env("KIKO_CORE_STUB_LOG", dir.join("starts.log"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command
    }

    fn start(dir: &Path) -> Self {
        let child = Self::launch(dir).spawn().expect("start kiko");
        Self {
            dir: dir.to_path_buf(),
            child,
        }
    }

    fn socket(&self) -> String {
        if cfg!(windows) {
            "kiko-driver".to_string()
        } else {
            self.dir.join("driver.sock").to_string_lossy().into_owned()
        }
    }

    fn starts(&self) -> usize {
        std::fs::read_to_string(self.dir.join("starts.log"))
            .map(|body| body.lines().filter(|line| !line.trim().is_empty()).count())
            .unwrap_or(0)
    }

    fn wait_for<F: Fn() -> bool>(what: &str, ready: F) {
        let until = Instant::now() + WAIT;
        while Instant::now() < until {
            if ready() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        panic!("timed out waiting for {what}");
    }
}

impl Drop for App {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn fixture(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kiko-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create the fixture");
    std::fs::copy(binary(), dir.join(core_name())).expect("copy the stub core");
    dir
}

fn connect(name: &str) -> LocalSocketStream {
    let target = name.to_string();
    let mut last = None;
    for _ in 0..200 {
        let parsed = if cfg!(windows) {
            target
                .clone()
                .to_ns_name::<interprocess::local_socket::GenericNamespaced>()
        } else {
            target
                .clone()
                .to_fs_name::<interprocess::local_socket::GenericFilePath>()
        };
        match parsed
            .map_err(std::io::Error::other)
            .and_then(LocalSocketStream::connect)
        {
            Ok(stream) => return stream,
            Err(error) => last = Some(error),
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("could not connect to the driver socket: {last:?}");
}

fn ask(stream: &LocalSocketStream, request: &str) -> serde_json::Value {
    let mut writer = stream;
    writer
        .write_all(request.as_bytes())
        .expect("write the request");
    writer.write_all(b"\n").expect("end the request");
    writer.flush().expect("flush the request");
    let mut line = String::new();
    BufReader::new(stream)
        .read_line(&mut line)
        .expect("read the answer");
    serde_json::from_str(&line).expect("the answer is json")
}

#[test]
fn serves_the_driver_and_supervises_the_daemon() {
    let dir = fixture("smoke");
    let app = App::start(&dir);

    App::wait_for("the daemon to start", || app.starts() >= 1);
    let stream = connect(&app.socket());

    let status = ask(&stream, r#"{"id":1,"method":"status"}"#);
    assert_eq!(status["ok"], true, "{status}");
    assert_eq!(status["value"]["os"], std::env::consts::OS);
    assert_eq!(status["value"]["permissions"]["accessibility"], "unknown");

    let unsupported = ask(&stream, r#"{"id":2,"method":"windows"}"#);
    assert_eq!(unsupported["ok"], false, "{unsupported}");
    assert_eq!(unsupported["error"]["code"], "unsupported");

    App::wait_for("the supervisor to restart the daemon", || app.starts() >= 2);

    let second = App::launch(&dir).status().expect("start a second kiko");
    assert!(
        second.success(),
        "a second launch should exit cleanly: {second}"
    );

    let quit = App::launch(&dir)
        .arg("--quit")
        .status()
        .expect("ask kiko to quit");
    assert!(quit.success(), "{quit}");
    App::wait_for("kiko to exit", || {
        std::process::Command::new(binary())
            .arg("--quit")
            .env("KIKO_APP_DIR", &dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| !status.success())
            .unwrap_or(true)
    });
}

#[test]
fn reports_the_version() {
    let output = Command::new(binary())
        .arg("--version")
        .output()
        .expect("run kiko --version");
    assert!(output.status.success());
    let text = String::from_utf8_lossy(&output.stdout);
    assert!(text.starts_with("kiko "), "{text}");
}
