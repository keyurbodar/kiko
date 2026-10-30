#![cfg(target_os = "linux")]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use base64::Engine as _;
use kiko_driver::{
    ActParams, Action, ErrorCode, Grant, Look, LookParams, Mode, Native, Node, Route, Window,
};
use kiko_native_linux::driver;
use x11rb::connection::Connection as _;
use x11rb::protocol::xproto::{Atom, AtomEnum, ConnectionExt as _, ImageFormat, Window as XWindow};
use x11rb::rust_connection::RustConnection;

const TARGET: &str = "Kiko Target";
const COVER: &str = "Kiko Cover";
const TARGET_BLUE: (u8, u8, u8) = (0x33, 0x66, 0xcc);
const COVER_RED: (u8, u8, u8) = (0xcc, 0x33, 0x33);

struct App {
    child: Child,
}

impl Drop for App {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
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
        .arg(fixture("gtk_app.py"))
        .arg(out)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("could not start the GTK test app");
    App { child }
}

fn chromium() -> Option<PathBuf> {
    let candidates = [
        std::env::var_os("KIKO_CHROMIUM").map(PathBuf::from),
        Some(PathBuf::from("/usr/bin/chromium")),
        Some(PathBuf::from("/usr/bin/chromium-browser")),
        Some(PathBuf::from("/usr/bin/google-chrome")),
        Some(PathBuf::from("/usr/bin/google-chrome-stable")),
    ];
    candidates.into_iter().flatten().find(|path| path.exists())
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

fn node(look: &Look, roles: &[&str], name: &str) -> Node {
    for role in roles {
        if let Some(node) = look
            .nodes
            .iter()
            .find(|node| node.role == *role && node.name.contains(name))
        {
            return node.clone();
        }
    }
    panic!("no {roles:?} named {name:?} in\n{}", look.outline)
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
    reference: u32,
    action: Action,
    text: Option<&str>,
    mode: Mode,
) -> Result<kiko_driver::ActResult, kiko_driver::DriverError> {
    native.act(&ActParams {
        window: window.id.clone(),
        reference: Some(reference),
        point: None,
        action,
        text: text.map(str::to_string),
        keys: None,
        dx: 0.0,
        dy: 0.0,
        mode,
    })
}

fn close(pixel: image::Rgb<u8>, expected: (u8, u8, u8)) -> bool {
    let (r, g, b) = (pixel[0], pixel[1], pixel[2]);
    let distance = |a: u8, b: u8| i16::from(a).abs_diff(i16::from(b));
    distance(r, expected.0) <= 24 && distance(g, expected.1) <= 24 && distance(b, expected.2) <= 24
}

fn key(
    native: &mut Box<dyn Native>,
    window: &Window,
    keys: &str,
    mode: Mode,
) -> Result<kiko_driver::ActResult, kiko_driver::DriverError> {
    native.act(&ActParams {
        window: window.id.clone(),
        reference: None,
        point: None,
        action: Action::Key,
        text: None,
        keys: Some(keys.to_string()),
        dx: 0.0,
        dy: 0.0,
        mode,
    })
}

fn scroll(
    native: &mut Box<dyn Native>,
    window: &Window,
    reference: u32,
    dx: f64,
    dy: f64,
    mode: Mode,
) -> Result<kiko_driver::ActResult, kiko_driver::DriverError> {
    native.act(&ActParams {
        window: window.id.clone(),
        reference: Some(reference),
        point: None,
        action: Action::Scroll,
        text: None,
        keys: None,
        dx,
        dy,
        mode,
    })
}

fn press_point(
    native: &mut Box<dyn Native>,
    window: &Window,
    x: f64,
    y: f64,
    mode: Mode,
) -> Result<kiko_driver::ActResult, kiko_driver::DriverError> {
    native.act(&ActParams {
        window: window.id.clone(),
        reference: None,
        point: Some(kiko_driver::Point { x, y }),
        action: Action::Press,
        text: None,
        keys: None,
        dx: 0.0,
        dy: 0.0,
        mode,
    })
}

struct X {
    conn: RustConnection,
    root: XWindow,
    client_list: Atom,
    active: Atom,
}

impl X {
    fn new() -> Self {
        let (conn, screen) = x11rb::connect(None).expect("could not open the X display");
        let root = conn.setup().roots[screen].root;
        let client_list = intern(&conn, "_NET_CLIENT_LIST");
        let active = intern(&conn, "_NET_ACTIVE_WINDOW");
        Self {
            conn,
            root,
            client_list,
            active,
        }
    }

    fn active_window(&self) -> Option<u32> {
        self.words(self.root, self.active).first().copied()
    }

    fn pointer(&self) -> (i16, i16) {
        let reply = self
            .conn
            .query_pointer(self.root)
            .expect("query pointer")
            .reply()
            .expect("query pointer reply");
        (reply.root_x, reply.root_y)
    }

    fn window_by_title(&self, title: &str) -> Option<u32> {
        self.words(self.root, self.client_list)
            .into_iter()
            .find(|xid| self.title(*xid).contains(title))
    }

    fn title(&self, xid: u32) -> String {
        let reply = self
            .conn
            .get_property(false, xid, AtomEnum::WM_NAME, AtomEnum::ANY, 0, 1024)
            .ok()
            .and_then(|cookie| cookie.reply().ok());
        reply
            .map(|reply| {
                String::from_utf8_lossy(&reply.value)
                    .trim_end_matches('\0')
                    .to_string()
            })
            .unwrap_or_default()
    }

    fn words(&self, window: XWindow, property: Atom) -> Vec<u32> {
        let reply = self
            .conn
            .get_property(false, window, property, AtomEnum::WINDOW, 0, 1024)
            .ok()
            .and_then(|cookie| cookie.reply().ok());
        reply
            .and_then(|reply| reply.value32().map(|values| values.collect()))
            .unwrap_or_default()
    }

    fn root_pixel(&self, x: u16, y: u16) -> image::Rgb<u8> {
        let reply = self
            .conn
            .get_image(
                ImageFormat::Z_PIXMAP,
                self.root,
                x as i16,
                y as i16,
                1,
                1,
                !0,
            )
            .expect("get image")
            .reply()
            .expect("get image reply");
        image::Rgb([reply.data[2], reply.data[1], reply.data[0]])
    }
}

fn intern(conn: &RustConnection, name: &str) -> Atom {
    conn.intern_atom(false, name.as_bytes())
        .expect("intern atom")
        .reply()
        .expect("intern atom reply")
        .atom
}

fn keyboard_map(conn: &RustConnection) -> Vec<u32> {
    let setup = conn.setup();
    let first = setup.min_keycode;
    let count = setup.max_keycode.saturating_sub(first).saturating_add(1);
    conn.get_keyboard_mapping(first, count)
        .expect("get keyboard mapping")
        .reply()
        .expect("get keyboard mapping reply")
        .keysyms
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

fn assert_permissions(native: &mut Box<dyn Native>) {
    let permissions = native.permissions();
    assert_eq!(
        permissions.accessibility,
        Grant::Granted,
        "the accessibility bus is not reachable"
    );
    assert_eq!(
        permissions.screen,
        Grant::Granted,
        "the X display is not reachable"
    );
    assert_eq!(permissions.automation, Grant::NotNeeded);
}

#[test]
#[ignore]
fn gtk_background_actions_leave_the_owner_screen_alone() {
    let out = tempfile::tempdir().expect("temp dir");
    let mut native = driver().expect("driver");
    assert_permissions(&mut native);
    let app = spawn_gtk(out.path());
    let app_pid = app.child.id();
    let ready = out.path().join("ready");
    wait_file(&ready);

    let cover = wait_for("the covering window to be focused", || {
        let windows = native.windows().ok()?;
        windows
            .into_iter()
            .find(|window| window.title.contains(COVER) && window.focused)
    });
    let target = wait_window(&mut native, TARGET);
    assert_eq!(
        target.pid, app_pid,
        "the window pid should come from _NET_WM_PID"
    );
    assert_eq!(cover.pid, app_pid);
    assert!(cover.focused, "the covering window should be focused");
    assert!(!target.focused, "the target window should not be focused");

    let first = look(&mut native, &target, true);
    assert!(!first.nodes.is_empty(), "look returned no nodes");
    let button = node(&first, &["button"], "Press me");
    let entry = node(&first, &["entry", "text"], "");
    let check = node(&first, &["check box"], "Enable");
    assert!(
        button.actions.contains(&Action::Press),
        "the button has no press action: {:?}",
        button.actions
    );
    assert!(
        entry.actions.contains(&Action::SetValue),
        "the entry takes no text: {:?}",
        entry.actions
    );
    assert!(
        check.actions.contains(&Action::Toggle),
        "the check box has no toggle action: {:?}",
        check.actions
    );

    let picture = decoded(&first);
    let (width, height) = picture.dimensions();
    assert_eq!(first.window.frame.w as u32, width);
    let corner = picture.get_pixel(width - 20, height - 20);
    assert!(
        close(*corner, TARGET_BLUE),
        "the covered window's own pixels are {corner:?}, not {TARGET_BLUE:?}"
    );

    let x = X::new();
    let cover_xid = x.window_by_title(COVER).expect("the cover has no X window");
    assert_eq!(
        x.active_window(),
        Some(cover_xid),
        "the cover should be the active window"
    );
    let center_x = (target.frame.x + target.frame.w / 2.0) as u16;
    let center_y = (target.frame.y + target.frame.h / 2.0) as u16;
    let on_screen = x.root_pixel(center_x, center_y);
    assert!(
        close(on_screen, COVER_RED),
        "the target is not covered on screen: {on_screen:?}"
    );
    let active_before = x.active_window();
    let pointer_before = x.pointer();

    let pressed = act(
        &mut native,
        &target,
        button.reference,
        Action::Press,
        None,
        Mode::Background,
    )
    .expect("press failed");
    assert_eq!(pressed.route, Route::Accessibility);
    wait_file(&out.path().join("clicked"));

    let typed = act(
        &mut native,
        &target,
        entry.reference,
        Action::SetValue,
        Some("hello"),
        Mode::Background,
    )
    .expect("set_value failed");
    assert_eq!(typed.route, Route::Accessibility);
    wait_file_text(&out.path().join("entry"), "hello");
    let second = look(&mut native, &target, false);
    let entry = node(&second, &["entry", "text"], "");
    assert_eq!(
        entry.value.as_deref(),
        Some("hello"),
        "the entry did not take the text\n{}",
        second.outline
    );

    let toggled = act(
        &mut native,
        &target,
        node(&second, &["check box"], "Enable").reference,
        Action::Toggle,
        None,
        Mode::Background,
    )
    .expect("toggle failed");
    assert_eq!(toggled.route, Route::Accessibility);
    wait_file_text(&out.path().join("toggled"), "1");
    let third = look(&mut native, &target, false);
    let check = node(&third, &["check box"], "Enable");
    assert!(
        check.states.iter().any(|state| state == "checked"),
        "the check box is not checked: {:?}\n{}",
        check.states,
        third.outline
    );

    assert_eq!(
        x.active_window(),
        active_before,
        "a background action changed the active window"
    );
    assert_eq!(
        x.pointer(),
        pointer_before,
        "a background action moved the pointer"
    );

    let stale = act(
        &mut native,
        &target,
        999_999,
        Action::Press,
        None,
        Mode::Background,
    )
    .expect_err("an unknown ref should fail");
    assert_eq!(stale.code, ErrorCode::Stale);

    let focus = act(
        &mut native,
        &target,
        node(&third, &["button"], "Press me").reference,
        Action::Focus,
        None,
        Mode::Background,
    )
    .expect_err("background focus should fail");
    assert_eq!(focus.code, ErrorCode::BackgroundUnavailable);
}

#[test]
#[ignore]
fn gtk_foreground_click_uses_the_pointer() {
    let out = tempfile::tempdir().expect("temp dir");
    let mut native = driver().expect("driver");
    assert_permissions(&mut native);
    let _app = spawn_gtk(out.path());
    wait_file(&out.path().join("ready"));
    let target = wait_window(&mut native, TARGET);
    wait_window(&mut native, COVER);

    let first = look(&mut native, &target, false);
    let button = node(&first, &["button"], "Press me");
    let pressed = act(
        &mut native,
        &target,
        button.reference,
        Action::Press,
        None,
        Mode::Foreground,
    )
    .expect("foreground press failed");
    assert_eq!(pressed.route, Route::Foreground);
    wait_file(&out.path().join("clicked"));

    let x = X::new();
    let target_xid = x
        .window_by_title(TARGET)
        .expect("the target has no X window");
    assert_eq!(
        x.active_window(),
        Some(target_xid),
        "foreground mode should activate the window"
    );
    let (pointer_x, pointer_y) = x.pointer();
    let inside = f64::from(pointer_x) >= target.frame.x
        && f64::from(pointer_x) <= target.frame.x + target.frame.w
        && f64::from(pointer_y) >= target.frame.y
        && f64::from(pointer_y) <= target.frame.y + target.frame.h;
    assert!(
        inside,
        "the pointer is at ({pointer_x}, {pointer_y}), outside {:?}",
        target.frame
    );
}

#[test]
#[ignore]
fn gtk_foreground_typing_keys_scroll_and_point_click_reach_the_window() {
    let out = tempfile::tempdir().expect("temp dir");
    let mut native = driver().expect("driver");
    assert_permissions(&mut native);
    let _app = spawn_gtk(out.path());
    wait_file(&out.path().join("ready"));
    let target = wait_window(&mut native, TARGET);

    let first = look(&mut native, &target, false);
    let entry = node(&first, &["entry", "text"], "");
    act(
        &mut native,
        &target,
        entry.reference,
        Action::SetValue,
        Some(""),
        Mode::Background,
    )
    .expect("clearing the entry failed");
    wait_file_text(&out.path().join("entry"), "");

    let typed = act(
        &mut native,
        &target,
        entry.reference,
        Action::Type,
        Some("hello world"),
        Mode::Foreground,
    )
    .expect("foreground typing failed");
    assert_eq!(typed.route, Route::Foreground);
    wait_file_text(&out.path().join("entry"), "hello world");

    let x = X::new();
    let target_xid = x
        .window_by_title(TARGET)
        .expect("the target has no X window");
    assert_eq!(
        x.active_window(),
        Some(target_xid),
        "foreground typing should activate the window"
    );

    key(&mut native, &target, "ctrl+a", Mode::Foreground).expect("ctrl+a failed");
    key(&mut native, &target, "BackSpace", Mode::Foreground).expect("BackSpace failed");
    wait_file_text(&out.path().join("entry"), "");

    let map_before = keyboard_map(&x.conn);
    act(
        &mut native,
        &target,
        entry.reference,
        Action::Type,
        Some("héllo→"),
        Mode::Foreground,
    )
    .expect("typing characters outside the keymap failed");
    wait_file_text(&out.path().join("entry"), "héllo→");
    assert_eq!(
        keyboard_map(&x.conn),
        map_before,
        "typing restored the spare keycodes to a different keyboard map"
    );

    let button = node(&look(&mut native, &target, false), &["button"], "Press me");
    let point = button.frame.expect("the button has no frame");
    press_point(
        &mut native,
        &target,
        point.x + point.w / 2.0,
        point.y + point.h / 2.0,
        Mode::Foreground,
    )
    .expect("point click failed");
    wait_file(&out.path().join("clicked"));

    let pane = node(&look(&mut native, &target, false), &["scroll pane"], "");
    let scroll_file = out.path().join("scroll");
    let before = scroll_value(&scroll_file);
    let scrolled = scroll(
        &mut native,
        &target,
        pane.reference,
        0.0,
        200.0,
        Mode::Foreground,
    )
    .expect("foreground scroll failed");
    assert_eq!(scrolled.route, Route::Foreground);
    wait_for("the scroll pane to move", || {
        (scroll_value(&scroll_file) > before).then_some(())
    });
}

fn scroll_value(path: &Path) -> i64 {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| text.trim().parse().ok())
        .unwrap_or(0)
}

#[test]
#[ignore]
fn chromium_background_press_runs_onclick() {
    let Some(browser) = chromium() else {
        eprintln!("no chromium found; skipping");
        return;
    };
    let out = tempfile::tempdir().expect("temp dir");
    let page = out.path().join("page.html");
    std::fs::write(
        &page,
        "<!doctype html><html><head><title>Kiko Page</title></head><body>\
         <h1>Kiko Test Page</h1>\
         <button onclick=\"document.title='Kiko Clicked'\">Click me</button>\
         </body></html>",
    )
    .expect("write page");
    let mut native = driver().expect("driver");
    assert_permissions(&mut native);
    let profile = out.path().join("profile");
    let mut command = Command::new(&browser);
    command
        .arg("--force-renderer-accessibility")
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-gpu")
        .arg("--disable-dev-shm-usage")
        .arg("--window-size=900,700")
        .arg("--window-position=0,0");
    if std::env::var("USER").as_deref() == Ok("root") || std::env::var_os("CI").is_some() {
        command.arg("--no-sandbox");
    }
    let child = command
        .arg(format!("file://{}", page.display()))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("could not start chromium");
    let _browser = App { child };

    let window = wait_for("the chromium window", || {
        let windows = native.windows().ok()?;
        windows
            .into_iter()
            .find(|window| window.title.contains("Kiko Page"))
    });
    let first = look(&mut native, &window, false);
    assert!(
        first
            .nodes
            .iter()
            .any(|node| node.role == "page tab" && node.name.contains("Kiko Page")),
        "no tab strip in\n{}",
        first.outline
    );
    assert!(
        first.nodes.iter().any(|node| matches!(
            node.role.as_str(),
            "document web" | "html container" | "document frame"
        )),
        "no page document in\n{}",
        first.outline
    );
    let button = first
        .nodes
        .iter()
        .find(|node| node.role == "button" && node.name.contains("Click me"))
        .cloned()
        .unwrap_or_else(|| panic!("no page button in\n{}", first.outline));
    let pressed = act(
        &mut native,
        &window,
        button.reference,
        Action::Press,
        None,
        Mode::Background,
    )
    .expect("chromium press failed");
    assert_eq!(pressed.route, Route::Accessibility);
    wait_for("the page title to change", || {
        let windows = native.windows().ok()?;
        windows
            .into_iter()
            .find(|window| window.title.contains("Kiko Clicked"))
    });
}
