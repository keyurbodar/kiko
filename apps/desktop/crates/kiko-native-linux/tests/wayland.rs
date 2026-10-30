#![cfg(target_os = "linux")]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use kiko_driver::{ActParams, Action, ErrorCode, Look, LookParams, Mode, Native, Window};
use kiko_native_linux::driver;

const TARGET: &str = "Kiko Target";

struct App {
    child: Child,
}

impl Drop for App {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/gtk_app.py")
}

fn output_dir() -> PathBuf {
    std::env::var_os("KIKO_E2E_OUT")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("kiko-wayland-e2e"))
}

fn python() -> String {
    if Path::new("/usr/bin/python3").exists() {
        "/usr/bin/python3".to_string()
    } else {
        "python3".to_string()
    }
}

fn spawn_gtk(out: &Path) -> App {
    let child = Command::new(python())
        .arg(fixture())
        .arg(out)
        .env("GDK_BACKEND", "wayland")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("could not start the GTK test app");
    App { child }
}

fn start(name: &str) -> (App, PathBuf) {
    let out = output_dir().join(name);
    let _ = std::fs::remove_dir_all(&out);
    std::fs::create_dir_all(&out).expect("output dir");
    let app = spawn_gtk(&out);
    wait_file(&out.join("ready"));
    (app, out)
}

fn wait_for<T>(what: &str, mut probe: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if let Some(value) = probe() {
            return value;
        }
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn wait_file(path: &Path) -> String {
    wait_for(&path.display().to_string(), || {
        std::fs::read_to_string(path).ok()
    })
}

fn wait_file_text(path: &Path, expected: &str) {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let text = std::fs::read_to_string(path).unwrap_or_default();
        if text == expected {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "{} says {text:?}, not {expected:?}",
            path.display()
        );
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn windows_with(native: &mut Box<dyn Native>, title: &str) -> Option<Window> {
    native
        .windows()
        .ok()?
        .into_iter()
        .find(|window| window.title.contains(title))
}

fn wait_window(native: &mut Box<dyn Native>, title: &str) -> Window {
    wait_for(title, || windows_with(native, title))
}

fn node(look: &Look, roles: &[&str], name: &str) -> kiko_driver::Node {
    for role in roles {
        if let Some(node) = look
            .nodes
            .iter()
            .find(|node| node.role == *role && node.name.contains(name))
        {
            return node.clone();
        }
    }
    panic!("no {roles:?} named {name:?} in\n{}", look.outline);
}

fn look(native: &mut Box<dyn Native>, window: &Window, image: bool) -> Look {
    native
        .look(&LookParams {
            window: window.id.clone(),
            tree: true,
            image,
            max_width: Some(2000),
        })
        .expect("look failed")
}

fn act(
    native: &mut Box<dyn Native>,
    window: &Window,
    reference: Option<u32>,
    action: Action,
    text: Option<&str>,
    mode: Mode,
) -> Result<kiko_driver::ActResult, kiko_driver::DriverError> {
    native.act(&ActParams {
        window: window.id.clone(),
        reference,
        point: None,
        action,
        text: text.map(str::to_string),
        keys: None,
        dx: 0.0,
        dy: 0.0,
        mode,
    })
}

#[test]
#[ignore]
fn wayland_lists_windows_and_runs_background_actions_without_a_pointer() {
    let (_app, out) = start("background-actions");
    let mut native = driver().expect("driver");
    let target = wait_window(&mut native, TARGET);
    wait_window(&mut native, "Kiko Cover");

    let first = look(&mut native, &target, false);
    assert!(
        first.nodes.iter().any(|node| node.name == "Press me"),
        "the button is missing from\n{}",
        first.outline
    );

    let button = node(&first, &["push button", "button"], "Press me");
    act(
        &mut native,
        &target,
        Some(button.reference),
        Action::Press,
        None,
        Mode::Background,
    )
    .expect("pressing the button failed");
    wait_file(&out.join("clicked"));

    let entry = node(&first, &["entry", "text"], "");
    act(
        &mut native,
        &target,
        Some(entry.reference),
        Action::SetValue,
        Some("typed by kiko"),
        Mode::Background,
    )
    .expect("setting the entry failed");
    wait_file_text(&out.join("entry"), "typed by kiko");
}

#[test]
#[ignore]
fn wayland_look_without_a_grant_returns_the_tree_and_no_image() {
    let (_app, _out) = start("tree-without-grant");
    let mut native = driver().expect("driver");
    let target = wait_window(&mut native, TARGET);
    wait_window(&mut native, "Kiko Cover");

    let first = native
        .look(&LookParams {
            window: target.id.clone(),
            tree: true,
            image: true,
            max_width: Some(2000),
        })
        .expect("a look that asked for a tree failed without a screen capture grant");
    assert!(
        first.image.is_none(),
        "look returned an image without a screen capture grant"
    );
    assert!(
        first.nodes.iter().any(|node| node.name == "Press me"),
        "the button is missing from\n{}",
        first.outline
    );
}

#[test]
#[ignore]
fn wayland_image_only_look_without_a_grant_is_denied() {
    let (_app, _out) = start("image-without-grant");
    let mut native = driver().expect("driver");
    let target = wait_window(&mut native, TARGET);
    wait_window(&mut native, "Kiko Cover");

    let error = native
        .look(&LookParams {
            window: target.id.clone(),
            tree: false,
            image: true,
            max_width: Some(2000),
        })
        .expect_err("look returned an image without a screen capture grant");
    assert_eq!(error.code, ErrorCode::Denied);
    assert!(error.message.contains("kiko menu"), "{}", error.message);
}

#[test]
#[ignore]
fn wayland_foreground_typing_into_an_unfocused_window_is_unavailable() {
    let (_app, _out) = start("unfocused-typing");
    let mut native = driver().expect("driver");
    let target = wait_window(&mut native, TARGET);
    wait_window(&mut native, "Kiko Cover");

    let first = look(&mut native, &target, false);
    let entry = node(&first, &["entry", "text"], "");
    let error = act(
        &mut native,
        &target,
        Some(entry.reference),
        Action::Type,
        Some("hello wayland"),
        Mode::Foreground,
    )
    .expect_err("typing into an unfocused window was allowed");
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(
        error.message.contains("click the window first"),
        "{}",
        error.message
    );
}
