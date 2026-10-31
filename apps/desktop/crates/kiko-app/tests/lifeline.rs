#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const WAIT: Duration = Duration::from_secs(20);
const POLL: Duration = Duration::from_millis(50);

fn binary() -> &'static Path {
    Path::new(env!("CARGO_BIN_EXE_kiko"))
}

fn fixture(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kiko-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create the fixture");
    dir
}

fn script(dir: &Path) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let file = dir.join("kiko-core");
    std::fs::write(
        &file,
        "#!/bin/sh\necho $$ > \"$KIKO_TEST_PID\"\ncat > /dev/null\necho gone > \"$KIKO_TEST_GONE\"\n",
    )
    .expect("write the fake core");
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755))
        .expect("make the fake core runnable");
    file
}

fn wait_for(what: &str, mut ready: impl FnMut() -> bool) {
    let until = Instant::now() + WAIT;
    while Instant::now() < until {
        if ready() {
            return;
        }
        std::thread::sleep(POLL);
    }
    panic!("timed out waiting for {what}");
}

fn read_pid(file: &Path) -> Option<i32> {
    std::fs::read_to_string(file)
        .ok()?
        .trim()
        .parse::<i32>()
        .ok()
}

struct App {
    child: Child,
}

impl App {
    fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for App {
    fn drop(&mut self) {
        self.kill();
    }
}

#[test]
fn the_daemon_exits_when_the_app_dies() {
    let dir = fixture("lifeline");
    let core = script(&dir);
    let pid_file = dir.join("core.pid");
    let gone_file = dir.join("core.gone");
    let child = Command::new(binary())
        .env("KIKO_APP_DIR", &dir)
        .env("KIKO_COMPUTER_DIR", dir.join("computer"))
        .env("KIKO_CORE", &core)
        .env("KIKO_TEST_PID", &pid_file)
        .env("KIKO_TEST_GONE", &gone_file)
        .env_remove("KIKO_CORE_STUB_LOG")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("start kiko");
    let mut app = App { child };

    wait_for("the daemon to start", || read_pid(&pid_file).is_some());
    let core_pid = read_pid(&pid_file).expect("the daemon's pid");
    assert_eq!(
        unsafe { libc::kill(core_pid, 0) },
        0,
        "the daemon exited before the app did"
    );
    assert!(!gone_file.exists(), "the daemon thought the app was gone");

    app.kill();

    wait_for("the daemon to notice the app died", || gone_file.exists());
    assert_eq!(
        std::fs::read_to_string(&gone_file)
            .unwrap_or_default()
            .trim(),
        "gone"
    );
    drop(app);
    let _ = std::fs::remove_dir_all(&dir);
}
