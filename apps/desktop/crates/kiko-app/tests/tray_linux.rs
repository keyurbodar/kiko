#![cfg(target_os = "linux")]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::OwnedValue;

const WAIT: Duration = Duration::from_secs(20);
const PAUSE_ITEM: i32 = 4;

struct Watcher {
    items: Arc<Mutex<Vec<String>>>,
}

#[zbus::interface(name = "org.kde.StatusNotifierWatcher")]
impl Watcher {
    fn register_status_notifier_item(&self, service: &str) {
        self.items
            .lock()
            .expect("watcher lock")
            .push(service.to_string());
    }

    fn register_status_notifier_host(&self, _service: &str) {}

    #[zbus(property)]
    fn registered_status_notifier_items(&self) -> Vec<String> {
        self.items.lock().expect("watcher lock").clone()
    }

    #[zbus(property)]
    fn is_status_notifier_host_registered(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn protocol_version(&self) -> i32 {
        0
    }
}

struct App {
    dir: PathBuf,
    child: Child,
}

impl App {
    fn start(dir: &Path) -> Self {
        let child = Command::new(env!("CARGO_BIN_EXE_kiko"))
            .env("KIKO_APP_DIR", dir)
            .env("KIKO_COMPUTER_DIR", dir.join("computer"))
            .env("KIKO_CORE", dir.join("kiko-core"))
            .env("KIKO_CORE_STUB_LOG", dir.join("starts.log"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("start kiko");
        Self {
            dir: dir.to_path_buf(),
            child,
        }
    }
}

impl Drop for App {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
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

#[test]
fn the_tray_registers_and_the_menu_pauses_the_agent() {
    let dir = std::env::temp_dir().join(format!("kiko-tray-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create the fixture");
    std::fs::copy(env!("CARGO_BIN_EXE_kiko"), dir.join("kiko-core")).expect("copy the stub core");

    let items = Arc::new(Mutex::new(Vec::new()));
    let connection = Connection::session().expect("run this test under a session bus");
    connection
        .request_name("org.kde.StatusNotifierWatcher")
        .expect("own the watcher name");
    connection
        .object_server()
        .at(
            "/StatusNotifierWatcher",
            Watcher {
                items: Arc::clone(&items),
            },
        )
        .expect("export the watcher");

    let _app = App::start(&dir);
    wait_for("the status notifier item to register", || {
        !items.lock().expect("watcher lock").is_empty()
    });
    let item = items.lock().expect("watcher lock")[0].clone();

    let menu = Proxy::new(
        &connection,
        item.as_str(),
        "/MenuBar",
        "com.canonical.dbusmenu",
    )
    .expect("menu proxy");
    let layout = menu
        .call_method("GetLayout", &(0i32, 2i32, Vec::<String>::new()))
        .expect("menu layout");
    let body = layout.body();
    body.deserialize::<(u32, (i32, HashMap<String, OwnedValue>, Vec<OwnedValue>))>()
        .expect("layout shape");

    menu.call_method(
        "Event",
        &(PAUSE_ITEM, "clicked", zbus::zvariant::Value::from(""), 0u32),
    )
    .expect("click pause");
    wait_for("the pause flag", || dir.join("paused").exists());
}
