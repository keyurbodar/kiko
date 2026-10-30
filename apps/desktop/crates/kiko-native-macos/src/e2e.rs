use std::fs;
use std::path::PathBuf;
use std::ptr::NonNull;
use std::time::{Duration, Instant};

use kiko_driver::{
    ActParams, Action, Grant, Image, LookParams, Mode, Native, OpenParams, OpenTarget, Point, Rect,
    Ref, Window,
};
use objc2_application_services::{AXValue, AXValueType};
use objc2_core_foundation::{CGPoint, CGSize};

use crate::{apps, ax, driver::MacDriver, input, window};

const LAUNCH: Duration = Duration::from_secs(30);
const SETTLE: Duration = Duration::from_secs(5);
const POINTER_SLACK: f64 = 1.0;
const SAFARI: &str = "/Applications/Safari.app";

struct DocumentApp {
    name: &'static str,
    path: &'static str,
}

const DOCUMENT_APPS: [DocumentApp; 2] = [
    DocumentApp {
        name: "TextEdit",
        path: "/System/Applications/TextEdit.app",
    },
    DocumentApp {
        name: "Script Editor",
        path: "/System/Applications/Utilities/Script Editor.app",
    },
];

#[test]
#[ignore = "needs a mac with Accessibility and Screen Recording granted to this binary"]
fn permissions_are_granted() {
    let driver = MacDriver::new().expect("driver");
    println!("private symbols: {:?}", crate::private_symbols());
    let permissions = driver.permissions();
    assert_eq!(
        permissions.accessibility,
        Grant::Granted,
        "grant kTCCServiceAccessibility to this binary"
    );
    assert_eq!(
        permissions.screen,
        Grant::Granted,
        "grant kTCCServiceScreenCapture to this binary"
    );
}

#[test]
#[ignore = "needs a mac with Accessibility and Screen Recording granted to this binary"]
fn both_apps_answer_in_the_background_while_finder_covers_them() {
    let mut driver = MacDriver::new().expect("driver");
    let document = start_document_app(&mut driver);
    let page = write_page("before");
    let url = format!("file://{}", page.display());
    let safari = launch_safari(&mut driver, &url);
    let frame = Rect {
        x: 160.0,
        y: 160.0,
        w: 640.0,
        h: 420.0,
    };
    set_window_frame(&document, frame);
    set_window_frame(&safari, frame);
    let finder = cover_with_finder(&mut driver, frame);
    let owner = Owner::capture();

    check_document(&mut driver, &document, &finder, frame);
    check_safari(&mut driver, &safari, frame);
    owner.assert_unchanged();
}

fn check_document(driver: &mut MacDriver, document: &Window, finder: &Window, frame: Rect) {
    let listed = driver
        .windows()
        .expect("windows")
        .into_iter()
        .find(|window| window.id == document.id)
        .expect("the document window is listed");
    assert!(!listed.focused, "the document must not own the screen");
    assert!(listed.on_screen);

    let look = driver
        .look(&LookParams {
            window: document.id.clone(),
            tree: true,
            image: true,
            max_width: Some(800),
        })
        .expect("look at the document");
    let image = look.image.as_ref().expect("the document's pixels");
    save_artifact("document", image);
    assert_image_matches(image, frame);
    assert!(
        look.outline.contains("textarea"),
        "outline:\n{}",
        look.outline
    );

    let covered = driver
        .look(&LookParams {
            window: finder.id.clone(),
            tree: false,
            image: true,
            max_width: Some(800),
        })
        .expect("look at Finder");
    assert_ne!(
        covered.image.expect("Finder pixels").data,
        image.data,
        "the capture shows the covering window instead of the document"
    );

    let area = look
        .nodes
        .iter()
        .find(|node| node.role == "textarea")
        .expect("a text area node")
        .clone();
    act(
        driver,
        document,
        area.reference,
        Action::SetValue,
        Some("kiko wrote this"),
    );

    let after = driver
        .look(&LookParams {
            window: document.id.clone(),
            tree: true,
            image: false,
            max_width: None,
        })
        .expect("look after typing");
    let text = after
        .nodes
        .iter()
        .find(|node| node.role == "textarea")
        .and_then(|node| node.value.clone())
        .unwrap_or_default();
    assert!(
        text.contains("kiko wrote this"),
        "document text is {text:?}"
    );

    let minimize = after
        .nodes
        .iter()
        .find(|node| {
            node.role == "button"
                && node.actions.contains(&Action::Press)
                && node.name.to_lowercase().contains("minimize")
        })
        .unwrap_or_else(|| panic!("no minimize button; nodes are {:?}", after.nodes))
        .clone();
    act(driver, document, minimize.reference, Action::Press, None);

    let minimized = wait_for(SETTLE, || {
        let id = document.id.parse().ok()?;
        window::ax_windows(document.pid as i32)
            .into_iter()
            .find(|window| window.id == Some(id))
            .map(|window| window.minimized)
            .filter(|minimized| *minimized)
    });
    assert_eq!(
        minimized,
        Some(true),
        "pressing minimize did not minimize the window"
    );
}

fn check_safari(driver: &mut MacDriver, safari: &Window, frame: Rect) {
    let look = driver
        .look(&LookParams {
            window: safari.id.clone(),
            tree: true,
            image: true,
            max_width: Some(900),
        })
        .expect("look at Safari");
    let image = look.image.as_ref().expect("Safari pixels");
    save_artifact("safari", image);
    assert_image_matches(image, frame);
    assert!(
        look.outline.contains("webarea"),
        "outline:\n{}",
        look.outline
    );

    let button = look
        .nodes
        .iter()
        .find(|node| node.name.contains("Push kiko") && node.actions.contains(&Action::Press))
        .unwrap_or_else(|| panic!("no pressable page button; nodes are {:?}", look.nodes))
        .clone();
    act(driver, safari, button.reference, Action::Press, None);

    let title = wait_for(SETTLE, || {
        driver
            .windows()
            .ok()?
            .into_iter()
            .find(|window| window.id == safari.id)
            .map(|window| window.title)
            .filter(|title| title == "after")
    });
    assert_eq!(
        title.as_deref(),
        Some("after"),
        "the button did not run its onclick"
    );
}

fn act(
    driver: &mut MacDriver,
    window: &Window,
    reference: Ref,
    action: Action,
    text: Option<&str>,
) {
    driver
        .act(&ActParams {
            window: window.id.clone(),
            reference: Some(reference),
            point: None,
            action,
            text: text.map(str::to_string),
            keys: None,
            dx: 0.0,
            dy: 0.0,
            mode: Mode::Background,
        })
        .unwrap_or_else(|error| panic!("{action:?} on {} failed: {error}", window.app));
}

fn assert_image_matches(image: &Image, frame: Rect) {
    assert!(image.width > 0 && image.height > 0);
    let captured = image.width as f64 / image.height as f64;
    let window = frame.w / frame.h;
    assert!(
        (captured - window).abs() < 0.02,
        "the image is {captured} wide per unit tall but the window is {window}"
    );
}

fn wait_for<T>(timeout: Duration, mut check: impl FnMut() -> Option<T>) -> Option<T> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Some(value) = check() {
            return Some(value);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    check()
}

fn window_summary(driver: &mut MacDriver) -> Vec<(String, String, u32)> {
    driver
        .windows()
        .unwrap_or_default()
        .into_iter()
        .map(|window| (window.app, window.title, window.pid))
        .collect()
}

fn window_named(driver: &mut MacDriver, app: &str) -> Option<Window> {
    driver
        .windows()
        .ok()?
        .into_iter()
        .find(|window| window.app == app && !window.title.is_empty())
}

fn window_titled(driver: &mut MacDriver, app: &str, title: &str) -> Option<Window> {
    driver
        .windows()
        .ok()?
        .into_iter()
        .find(|window| window.app == app && window.title == title)
}

fn start_document_app(driver: &mut MacDriver) -> Window {
    let mut notes = Vec::new();
    for app in &DOCUMENT_APPS {
        if let Some(window) = window_named(driver, app.name) {
            println!("the document app is already running: {}", app.name);
            return window;
        }
        for background in [true, false] {
            notes.push(run_open(app, background));
            if let Some(window) = wait_for(LAUNCH, || window_named(driver, app.name)) {
                println!("the document app is {}; {notes:?}", app.name);
                return window;
            }
        }
    }
    panic!(
        "no document window; {notes:?}; running: {:?}; windows: {:?}",
        running_apps(),
        window_summary(driver)
    )
}

fn launch_safari(driver: &mut MacDriver, url: &str) -> Window {
    let mut notes = Vec::new();
    let mut running = window_named(driver, "Safari");
    if running.is_none() {
        for background in [true, false] {
            notes.push(open_app(SAFARI, None, background));
            running = wait_for(LAUNCH, || window_named(driver, "Safari"));
            if running.is_some() {
                break;
            }
        }
    }
    if running.is_some() {
        notes.push(open_app(SAFARI, Some(url), true));
        if let Some(window) = wait_for(LAUNCH, || window_titled(driver, "Safari", "before")) {
            println!("Safari answered; {notes:?}");
            return window;
        }
    }
    panic!(
        "no Safari window; {notes:?}; running: {:?}; windows: {:?}",
        running_apps(),
        window_summary(driver)
    )
}

fn run_open(app: &DocumentApp, background: bool) -> String {
    open_app(app.path, None, background)
}

fn open_app(path: &str, argument: Option<&str>, background: bool) -> String {
    let mut command = std::process::Command::new("open");
    if background {
        command.arg("-g");
    }
    command.args(["-a", path]);
    if let Some(argument) = argument {
        command.arg(argument);
    }
    match command.output() {
        Ok(output) => format!(
            "open {path} background={background} {:?} {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ),
        Err(error) => format!("open {path} background={background} failed: {error}"),
    }
}

fn running_apps() -> Vec<String> {
    objc2_app_kit::NSWorkspace::sharedWorkspace()
        .runningApplications()
        .iter()
        .map(|app| {
            format!(
                "{:?}:{:?}",
                app.localizedName().map(|name| name.to_string()),
                app.activationPolicy()
            )
        })
        .collect()
}

fn set_window_frame(window: &Window, frame: Rect) {
    let id = window.id.parse().expect("a numeric window id");
    let element =
        window::ax_element_for(id, window.pid as i32).expect("the window's accessibility element");
    let mut origin = CGPoint::new(frame.x, frame.y);
    let position = unsafe { AXValue::new(AXValueType::CGPoint, NonNull::from(&mut origin).cast()) }
        .expect("a position value");
    ax::set(&element, ax::POSITION, &position);
    let mut size = CGSize::new(frame.w, frame.h);
    let dimensions = unsafe { AXValue::new(AXValueType::CGSize, NonNull::from(&mut size).cast()) }
        .expect("a size value");
    ax::set(&element, ax::SIZE, &dimensions);
}

fn cover_with_finder(driver: &mut MacDriver, target: Rect) -> Window {
    driver
        .open(&OpenParams {
            target: OpenTarget::Path("/tmp".to_string()),
            mode: Mode::Foreground,
        })
        .expect("open a Finder window");
    let finder = wait_for(LAUNCH, || window_named(driver, "Finder")).expect("a Finder window");
    let cover = Rect {
        x: target.x - 90.0,
        y: target.y - 70.0,
        w: target.w + 240.0,
        h: target.h + 200.0,
    };
    set_window_frame(&finder, cover);
    let front = wait_for(SETTLE, || {
        apps::activate(finder.pid as i32);
        apps::frontmost()
            .map(|app| app.pid)
            .filter(|pid| *pid == finder.pid as i32)
    });
    assert_eq!(
        front,
        Some(finder.pid as i32),
        "Finder should own the screen for this test; frontmost is {:?}",
        apps::frontmost().map(|app| (app.name, app.pid))
    );
    finder
}

struct Owner {
    front: Option<i32>,
    pointer: Point,
}

impl Owner {
    fn capture() -> Self {
        Self {
            front: apps::frontmost().map(|app| app.pid),
            pointer: input::pointer(),
        }
    }

    fn assert_unchanged(&self) {
        assert_eq!(
            apps::frontmost().map(|app| app.pid),
            self.front,
            "the frontmost app changed"
        );
        let now = input::pointer();
        assert!(
            (now.x - self.pointer.x).abs() < POINTER_SLACK
                && (now.y - self.pointer.y).abs() < POINTER_SLACK,
            "the pointer moved from {:?} to {:?}",
            self.pointer,
            now
        );
    }
}

fn write_page(title: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("kiko-e2e-{}.html", std::process::id()));
    let html = format!(
        "<!doctype html><html><head><title>{title}</title></head><body><h1>kiko</h1><button onclick=\"document.title='after'\">Push kiko</button></body></html>"
    );
    fs::write(&path, html).expect("write the page");
    path
}

fn save_artifact(name: &str, image: &Image) {
    let directory = std::env::var("E2E_ARTIFACT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = fs::create_dir_all(&directory);
    if let Ok(bytes) =
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &image.data)
    {
        let _ = fs::write(directory.join(format!("{name}.jpg")), bytes);
    }
}
