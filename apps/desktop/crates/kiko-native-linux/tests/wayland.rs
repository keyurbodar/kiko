#![cfg(target_os = "linux")]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use base64::Engine as _;
use kiko_driver::{ActParams, Action, Look, LookParams, Mode, Native, Window};
use kiko_native_linux::driver;

const TARGET: &str = "Kiko Target";
const TARGET_BLUE: (u8, u8, u8) = (0x33, 0x66, 0xcc);

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

fn decoded(look: &Look) -> image::RgbImage {
    let image = look.image.as_ref().expect("look returned no image");
    assert_eq!(image.mime, "image/jpeg");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&image.data)
        .expect("image is not base64");
    image::load_from_memory(&bytes)
        .expect("image is not a picture")
        .to_rgb8()
}

#[test]
#[ignore]
fn wayland_lists_windows_and_runs_background_actions_without_a_pointer() {
    let out = output_dir();
    std::fs::create_dir_all(&out).expect("output dir");
    let _app = spawn_gtk(&out);
    wait_file(&out.join("ready"));
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
fn wayland_look_captures_the_window_and_foreground_typing_lands_in_it() {
    let out = output_dir();
    std::fs::create_dir_all(&out).expect("output dir");
    let _app = spawn_gtk(&out);
    wait_file(&out.join("ready"));
    let mut native = driver().expect("driver");
    let target = wait_window(&mut native, TARGET);
    wait_window(&mut native, "Kiko Cover");

    let first = look(&mut native, &target, true);
    let picture = decoded(&first);
    let (width, height) = picture.dimensions();
    assert!(
        width >= 400 && height >= 300,
        "the captured window is {width}x{height}"
    );
    let blue = picture
        .pixels()
        .filter(|pixel| {
            let close = |a: u8, b: u8| i16::from(a).abs_diff(i16::from(b)) <= 24;
            close(pixel[0], TARGET_BLUE.0)
                && close(pixel[1], TARGET_BLUE.1)
                && close(pixel[2], TARGET_BLUE.2)
        })
        .count();
    let total = (width * height) as usize;
    assert!(
        blue * 10 > total,
        "only {blue} of {total} pixels are the window's blue background"
    );

    let entry = node(&first, &["entry", "text"], "");
    act(
        &mut native,
        &target,
        Some(entry.reference),
        Action::SetValue,
        Some(""),
        Mode::Background,
    )
    .expect("clearing the entry failed");
    wait_file_text(&out.join("entry"), "");

    let typed = act(
        &mut native,
        &target,
        Some(entry.reference),
        Action::Type,
        Some("hello wayland"),
        Mode::Foreground,
    )
    .expect("foreground typing failed");
    assert_eq!(typed.route, kiko_driver::Route::Foreground);
    wait_file_text(&out.join("entry"), "hello wayland");
}
