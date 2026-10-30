use std::fs;
use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::time::{Duration, Instant};

use kiko_driver::{
    ActParams, Action, Grant, Image, Look, LookParams, Mode, Native, Node, OpenParams, OpenTarget,
    Point, Rect, Ref, Route, Window,
};
use objc2_application_services::{AXUIElement, AXValue, AXValueType};
use objc2_core_foundation::{CFRange, CGPoint, CGSize};

use crate::{apps, ax, driver::MacDriver, input, look, window};

const LAUNCH: Duration = Duration::from_secs(30);
const SETTLE: Duration = Duration::from_secs(5);
const POINTER_SLACK: f64 = 1.0;
const SAFARI: &str = "/Applications/Safari.app";
const CHROME: &str = "/Applications/Google Chrome.app";
const FRAME: Rect = Rect {
    x: 160.0,
    y: 160.0,
    w: 640.0,
    h: 420.0,
};
const LONG_LINES: usize = 400;
const SCROLL_DELTA: f64 = 600.0;
const MENU_TEXT: &str = "kiko menu test";
const PASTE_TEXT: &str = "kiko pasted";
const OPEN_WAIT: Duration = Duration::from_secs(20);
const OPEN_POLL: Duration = Duration::from_millis(100);
const CHROME_FLAGS: [&str; 4] = [
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    "--use-mock-keychain",
];
const ELECTRON_MAIN: &str = r#"
const fs = require('fs');
const { app, BrowserWindow } = require('electron');
const page = process.argv[2] || process.env.KIKO_E2E_PAGE;
const log = process.argv[3] || process.env.KIKO_E2E_LOG;
const note = (text) => fs.appendFileSync(log, text + '\n');
process.on('uncaughtException', (error) => note('uncaught: ' + (error.stack || error)));
app.whenReady().then(() => {
  app.setAccessibilitySupportEnabled(true);
  note('ready page=' + page);
  const window = new BrowserWindow({ width: 640, height: 420, x: 160, y: 160 });
  note('window created');
  window.loadFile(page).then(
    () => note('loaded'),
    (error) => note('load failed: ' + error),
  );
});
"#;

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

#[test]
#[ignore = "needs a mac with Accessibility and Screen Recording granted to this binary"]
fn background_keys_clear_the_document() {
    let mut driver = MacDriver::new().expect("driver");
    let document = start_document_app(&mut driver);
    set_window_frame(&document, FRAME);
    let finder = cover_with_finder(&mut driver, FRAME);
    set_document_text(&mut driver, &document, "kiko typed this");
    focus_text_area(&mut driver, &document);
    let owner = Owner::capture();

    let route = press_keys(&mut driver, &document, "cmd+a");
    assert_eq!(
        route,
        Route::Accessibility,
        "cmd+a should run Edit > Select All through accessibility in the background"
    );
    let route = press_keys(&mut driver, &document, "delete");
    assert!(
        matches!(route, Route::Private | Route::WindowEvent),
        "delete took the foreground route {route:?}"
    );

    let text = wait_for(SETTLE, || {
        document_text(&mut driver, &document).filter(String::is_empty)
    });
    assert_eq!(
        text.as_deref(),
        Some(""),
        "the document still holds {:?}",
        document_text(&mut driver, &document)
    );
    assert_covered(&finder, &document);
    owner.assert_unchanged();
}

#[test]
#[ignore = "needs a mac with Accessibility and Screen Recording granted to this binary"]
fn background_scroll_moves_the_visible_range() {
    let mut driver = MacDriver::new().expect("driver");
    let document = start_document_app(&mut driver);
    set_window_frame(&document, FRAME);
    let finder = cover_with_finder(&mut driver, FRAME);
    set_document_text(&mut driver, &document, &long_document());
    focus_text_area(&mut driver, &document);
    let area = text_area(&document);
    let before = visible_range(&area).expect("TextEdit reports a visible character range");
    let owner = Owner::capture();

    let look = look_at(&mut driver, &document);
    let reference = node(&look, "textarea").reference;
    let route = act_with(
        &mut driver,
        &document,
        reference,
        Action::Scroll,
        None,
        0.0,
        SCROLL_DELTA,
    );
    assert_eq!(route, Route::Accessibility);

    let after = wait_for(SETTLE, || {
        visible_range(&area).filter(|range| range.location != before.location)
    });
    let after = after.unwrap_or_else(|| panic!("the visible range stayed at {before:?}"));
    assert!(
        after.location > before.location,
        "the document scrolled backwards: {before:?} to {after:?}"
    );
    assert_covered(&finder, &document);
    owner.assert_unchanged();
}

#[test]
#[ignore = "needs a mac with Accessibility and Screen Recording granted to this binary"]
fn background_menu_item_pastes_into_the_document() {
    let mut driver = MacDriver::new().expect("driver");
    let document = start_document_app(&mut driver);
    set_window_frame(&document, FRAME);
    let finder = cover_with_finder(&mut driver, FRAME);
    set_clipboard(PASTE_TEXT);
    set_document_text(&mut driver, &document, MENU_TEXT);
    focus_text_area(&mut driver, &document);
    let owner = Owner::capture();

    let look = look_at(&mut driver, &document);
    let reference = node(&look, "textarea").reference;
    let route = act_with(
        &mut driver,
        &document,
        reference,
        Action::ShowMenu,
        None,
        0.0,
        0.0,
    );
    assert_eq!(route, Route::Accessibility);

    let item = wait_for(SETTLE, || {
        let look = look_at(&mut driver, &document);
        look.nodes
            .iter()
            .find(|node| node.role == "menuitem" && usable_menu_item(node))
            .cloned()
    });
    let Some(item) = item else {
        let look = look_at(&mut driver, &document);
        cancel_menus(&document);
        panic!("no usable menu item; outline:\n{}", look.outline);
    };
    act_with(
        &mut driver,
        &document,
        item.reference,
        Action::Press,
        None,
        0.0,
        0.0,
    );

    if item.name == "Paste" {
        let text = wait_for(SETTLE, || {
            document_text(&mut driver, &document).filter(|text| text.contains(PASTE_TEXT))
        });
        assert!(
            text.is_some(),
            "the menu item did not paste; document is {:?}",
            document_text(&mut driver, &document)
        );
    } else {
        let fonts = wait_for(SETTLE, || window_titled(&mut driver, "TextEdit", "Fonts"));
        assert!(
            fonts.is_some(),
            "Show Fonts opened no Fonts window; windows: {:?}",
            window_summary(&mut driver)
        );
    }
    assert_covered(&finder, &document);
    owner.assert_unchanged();
}

fn usable_menu_item(node: &Node) -> bool {
    !node.states.iter().any(|state| state == "disabled")
        && matches!(node.name.as_str(), "Paste" | "Show Fonts")
}

#[test]
#[ignore = "needs a mac with Accessibility and Screen Recording granted to this binary"]
fn chrome_web_area_answers_in_the_background() {
    let mut driver = MacDriver::new().expect("driver");
    let page = write_page("before");
    let url = format!("file://{}", page.display());
    println!("Chrome: page at {url}");
    let chrome = launch_chrome(&mut driver, &url);
    set_window_frame(&chrome, FRAME);
    let finder = cover_with_finder(&mut driver, FRAME);
    let owner = Owner::capture();

    let look = wait_for(SETTLE, || {
        let look = look_at(&mut driver, &chrome);
        look.outline.contains("webarea").then_some(look)
    });
    let Some(look) = look else {
        let look = look_at(&mut driver, &chrome);
        panic!(
            "Chrome exposed no web area; nodes are {:?}",
            roles(&look.nodes)
        );
    };

    press_page_button(&mut driver, &chrome, &look);
    let title = wait_for(SETTLE, || {
        ax_title(&chrome).filter(|title| title == "after")
    });
    assert_eq!(
        title.as_deref(),
        Some("after"),
        "the page button did not run its onclick; title is {:?}",
        ax_title(&chrome)
    );
    assert_covered(&finder, &chrome);
    owner.assert_unchanged();
}

#[test]
#[ignore = "needs a mac with Accessibility and Screen Recording granted to this binary"]
fn electron_web_area_answers_in_the_background() {
    let electron = std::env::var("KIKO_E2E_ELECTRON")
        .expect("set KIKO_E2E_ELECTRON to an Electron binary for this test");
    let mut driver = MacDriver::new().expect("driver");
    let page = write_page("before");
    let app = write_electron_app();
    let bundle = electron_bundle(&electron);
    let log = std::env::temp_dir().join(format!("kiko-electron-{}.log", std::process::id()));
    let _ = fs::remove_file(&log);
    let note = launch_electron(&bundle, &app, &page, &log);

    let window = wait_for(Duration::from_secs(60), || {
        window_named(&mut driver, "Electron")
    });
    let Some(window) = window else {
        panic!(
            "no Electron window; {note}; log: {:?}; running: {:?}; windows: {:?}",
            fs::read_to_string(&log),
            running_apps(),
            window_summary(&mut driver)
        );
    };
    set_window_frame(&window, FRAME);
    let finder = cover_with_finder(&mut driver, FRAME);
    let owner = Owner::capture();

    let look = wait_for(SETTLE, || {
        let look = look_at(&mut driver, &window);
        look.outline.contains("webarea").then_some(look)
    });
    let Some(look) = look else {
        let look = look_at(&mut driver, &window);
        panic!("Electron exposed no web area; outline:\n{}", look.outline);
    };

    press_page_button(&mut driver, &window, &look);
    let title = wait_for(SETTLE, || {
        ax_title(&window).filter(|title| title == "after")
    });
    assert_eq!(
        title.as_deref(),
        Some("after"),
        "the page button did not run its onclick; title is {:?}",
        ax_title(&window)
    );
    assert_covered(&finder, &window);
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
    let look = wait_for(SETTLE, || {
        let look = driver
            .look(&LookParams {
                window: safari.id.clone(),
                tree: true,
                image: true,
                max_width: Some(900),
            })
            .ok()?;
        look.outline.contains("webarea").then_some(look)
    });
    let Some(look) = look else {
        let look = driver
            .look(&LookParams {
                window: safari.id.clone(),
                tree: true,
                image: false,
                max_width: None,
            })
            .expect("look at Safari");
        panic!("Safari exposed no web area; outline:\n{}", look.outline);
    };
    let image = look.image.as_ref().expect("Safari pixels");
    save_artifact("safari", image);
    assert_image_matches(image, frame);

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
    act_with(driver, window, reference, action, text, 0.0, 0.0);
}

fn act_with(
    driver: &mut MacDriver,
    window: &Window,
    reference: Ref,
    action: Action,
    text: Option<&str>,
    dx: f64,
    dy: f64,
) -> Route {
    driver
        .act(&ActParams {
            window: window.id.clone(),
            reference: Some(reference),
            point: None,
            action,
            text: text.map(str::to_string),
            keys: None,
            dx,
            dy,
            mode: Mode::Background,
        })
        .unwrap_or_else(|error| panic!("{action:?} on {} failed: {error}", window.app))
        .route
}

fn press_keys(driver: &mut MacDriver, window: &Window, keys: &str) -> Route {
    driver
        .act(&ActParams {
            window: window.id.clone(),
            reference: None,
            point: None,
            action: Action::Key,
            text: None,
            keys: Some(keys.to_string()),
            dx: 0.0,
            dy: 0.0,
            mode: Mode::Background,
        })
        .unwrap_or_else(|error| panic!("{keys} on {} failed: {error}", window.app))
        .route
}

fn look_at(driver: &mut MacDriver, window: &Window) -> Look {
    driver
        .look(&LookParams {
            window: window.id.clone(),
            tree: true,
            image: false,
            max_width: None,
        })
        .unwrap_or_else(|error| panic!("look at {} failed: {error}", window.app))
}

fn node<'a>(look: &'a Look, role: &str) -> &'a Node {
    look.nodes
        .iter()
        .find(|node| node.role == role)
        .unwrap_or_else(|| panic!("no {role} node; roles are {:?}", roles(&look.nodes)))
}

fn roles(nodes: &[Node]) -> Vec<String> {
    let mut roles: Vec<String> = nodes.iter().map(|node| node.role.clone()).collect();
    roles.sort();
    roles.dedup();
    roles
}

fn set_document_text(driver: &mut MacDriver, window: &Window, text: &str) {
    let look = look_at(driver, window);
    let reference = node(&look, "textarea").reference;
    act_with(
        driver,
        window,
        reference,
        Action::SetValue,
        Some(text),
        0.0,
        0.0,
    );
}

fn focus_text_area(driver: &mut MacDriver, window: &Window) {
    let look = look_at(driver, window);
    let reference = node(&look, "textarea").reference;
    act_with(driver, window, reference, Action::Focus, None, 0.0, 0.0);
}

fn document_text(driver: &mut MacDriver, window: &Window) -> Option<String> {
    look_at(driver, window)
        .nodes
        .into_iter()
        .find(|node| node.role == "textarea")
        .and_then(|node| node.value)
}

fn long_document() -> String {
    (1..=LONG_LINES)
        .map(|line| format!("line {line} of the kiko scroll test"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn press_page_button(driver: &mut MacDriver, window: &Window, look: &Look) {
    let button = look
        .nodes
        .iter()
        .find(|node| node.name.contains("Push kiko") && node.actions.contains(&Action::Press))
        .unwrap_or_else(|| panic!("no pressable page button; nodes are {:?}", look.nodes))
        .clone();
    act_with(
        driver,
        window,
        button.reference,
        Action::Press,
        None,
        0.0,
        0.0,
    );
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
            return restore(window);
        }
        for background in [true, false] {
            notes.push(run_open(app, background));
            if let Some(window) = wait_for(LAUNCH, || window_named(driver, app.name)) {
                println!("the document app is {}; {notes:?}", app.name);
                return restore(window);
            }
        }
    }
    panic!(
        "no document window; {notes:?}; running: {:?}; windows: {:?}",
        running_apps(),
        window_summary(driver)
    )
}

fn restore(window: Window) -> Window {
    if !window.minimized {
        return window;
    }
    let id = window.id.parse().expect("a numeric window id");
    if let Some(element) = window::ax_element_for(id, window.pid as i32) {
        ax::set_flag(&element, ax::MINIMIZED, false);
    }
    Window {
        minimized: false,
        ..window
    }
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
    finish_open(path, background, command)
}

fn finish_open(path: &str, background: bool, mut command: std::process::Command) -> String {
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return format!("open {path} background={background} failed: {error}"),
    };
    let deadline = Instant::now() + OPEN_WAIT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return format!("open {path} background={background} {:?}", status.code());
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(OPEN_POLL),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return format!(
                    "open {path} background={background} did not return in {}s",
                    OPEN_WAIT.as_secs()
                );
            }
        }
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
        window::front_pid().filter(|pid| *pid == finder.pid as i32)
    });
    assert_eq!(
        front,
        Some(finder.pid as i32),
        "Finder should own the screen for this test; the front window belongs to pid {:?}",
        window::front_pid()
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
            front: window::front_pid(),
            pointer: input::pointer(),
        }
    }

    fn assert_unchanged(&self) {
        assert_eq!(window::front_pid(), self.front, "the frontmost app changed");
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

fn assert_covered(cover: &Window, target: &Window) {
    assert!(
        window::front_window_above(cover.pid as i32, target.pid as i32),
        "{} came above {}",
        target.app,
        cover.app
    );
}

fn text_area(window: &Window) -> ax::Element {
    let id = window.id.parse().expect("a numeric window id");
    let element =
        window::ax_element_for(id, window.pid as i32).expect("the window's accessibility element");
    descendant(&element, "AXTextArea").unwrap_or_else(|| panic!("no text area in {}", window.app))
}

fn descendant(element: &AXUIElement, role: &str) -> Option<ax::Element> {
    let mut stack = vec![ax::retain(element)];
    while let Some(current) = stack.pop() {
        if ax::text(&ax::attribute(&current, ax::ROLE)).as_deref() == Some(role) {
            return Some(current);
        }
        stack.extend(ax::children(&current));
    }
    None
}

fn visible_range(element: &AXUIElement) -> Option<CFRange> {
    ax::range(&ax::attribute(element, ax::VISIBLE_CHARACTER_RANGE))
}

fn set_clipboard(text: &str) {
    let mut child = std::process::Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .expect("start pbcopy");
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin
            .write_all(text.as_bytes())
            .expect("write the clipboard");
    }
    child.wait().expect("pbcopy");
}

fn ax_title(window: &Window) -> Option<String> {
    let id = window.id.parse().ok()?;
    let element = window::ax_element_for(id, window.pid as i32)?;
    ax::text(&ax::attribute(&element, ax::TITLE))
}

fn cancel_menus(window: &Window) {
    let application = ax::application(window.pid as i32);
    for menu in look::open_menus(&application) {
        ax::perform(&menu, "AXCancel");
    }
}

fn launch_chrome(driver: &mut MacDriver, url: &str) -> Window {
    let mut notes = Vec::new();
    if window_named(driver, "Google Chrome").is_none() {
        notes.push(start_chrome());
        wait_for(LAUNCH, || window_named(driver, "Google Chrome"));
    }
    notes.push(open_app(CHROME, Some(url), true));
    let mut window = wait_for(LAUNCH, || chrome_page(driver));
    if window.is_none() {
        notes.push(open_app(CHROME, Some(url), false));
        window = wait_for(LAUNCH, || chrome_page(driver));
    }
    match window {
        Some(window) => {
            println!("Chrome answered; {notes:?}");
            window
        }
        None => panic!(
            "no Chrome window; {notes:?}; windows: {:?}; chrome windows: {:?}; all: {:?}",
            window_summary(driver),
            window::debug_entries("Google Chrome"),
            window::debug_all()
        ),
    }
}

fn chrome_page(driver: &mut MacDriver) -> Option<Window> {
    window_titled(driver, "Google Chrome", "before")
        .or_else(|| window_named(driver, "Google Chrome"))
}

fn start_chrome() -> String {
    let profile = std::env::temp_dir().join(format!("kiko-chrome-{}", std::process::id()));
    let mut command = std::process::Command::new("open");
    command
        .arg("-g")
        .args(["-a", CHROME])
        .arg("--args")
        .args(CHROME_FLAGS)
        .arg(format!("--user-data-dir={}", profile.display()));
    finish_open(CHROME, true, command)
}

fn write_electron_app() -> PathBuf {
    let directory = std::env::temp_dir().join(format!("kiko-electron-{}", std::process::id()));
    fs::create_dir_all(&directory).expect("create the Electron app directory");
    fs::write(
        directory.join("package.json"),
        r#"{"name":"kiko-electron-e2e","version":"1.0.0","main":"main.js"}"#,
    )
    .expect("write the Electron package.json");
    fs::write(directory.join("main.js"), ELECTRON_MAIN).expect("write the Electron main.js");
    directory
}

fn electron_bundle(electron: &str) -> PathBuf {
    Path::new(electron)
        .parent()
        .and_then(Path::parent)
        .map(|dir| dir.join("electron/dist/Electron.app"))
        .unwrap_or_else(|| PathBuf::from(electron))
}

fn launch_electron(bundle: &Path, app: &Path, page: &Path, log: &Path) -> String {
    let mut command = std::process::Command::new("open");
    command
        .arg("-g")
        .arg("-a")
        .arg(bundle)
        .arg("--args")
        .arg(app)
        .arg(page)
        .arg(log);
    finish_open(&bundle.display().to_string(), true, command)
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
