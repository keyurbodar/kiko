#![cfg(all(windows, feature = "testapp"))]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use image::ImageFormat;
use kiko_driver::Native;
use kiko_driver::api::{
    ActParams, ActResult, Action, Look, LookParams, Mode, Node, Point, Route, Window,
};
use windows::Win32::Foundation::{HWND, LPARAM, POINT, WPARAM};
use windows::Win32::UI::Controls::EM_SETSEL;
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, HWND_TOP, PostMessageW, SWP_NOMOVE, SWP_NOSIZE,
    SWP_SHOWWINDOW, SendMessageW, SetCursorPos, SetForegroundWindow, SetWindowPos, WM_CLOSE,
};

const TARGET_COLOR: (u8, u8, u8) = (0x33, 0x66, 0xcc);
const WAIT: Duration = Duration::from_secs(30);

struct Scene {
    child: Child,
    hwnd: isize,
    edit: isize,
}

impl Scene {
    fn start(
        app: &Path,
        directory: &Path,
        name: &str,
        title: &str,
        color: &str,
        x: i32,
        y: i32,
    ) -> Self {
        let hwnd_file = directory.join(format!("{name}.hwnd"));
        let edit_file = directory.join(format!("{name}.edit"));
        let log_file = directory.join(format!("{name}.log"));
        let _ = fs::remove_file(&hwnd_file);
        let _ = fs::remove_file(&edit_file);
        let _ = fs::remove_file(&log_file);
        let child = Command::new(app)
            .args([
                "--title",
                title,
                "--color",
                color,
                "--file",
                log_file.to_string_lossy().as_ref(),
                "--hwnd-file",
                hwnd_file.to_string_lossy().as_ref(),
                "--edit-hwnd-file",
                edit_file.to_string_lossy().as_ref(),
                "--pos",
                &format!("{x},{y}"),
                "--size",
                "600,400",
            ])
            .spawn()
            .expect("start the test app");
        let hwnd = wait_for_text(&hwnd_file)
            .parse::<isize>()
            .expect("hwnd file holds a number");
        let edit = wait_for_text(&edit_file)
            .parse::<isize>()
            .expect("edit hwnd file holds a number");
        Self { child, hwnd, edit }
    }

    fn id(&self) -> String {
        self.hwnd.to_string()
    }
}

impl Drop for Scene {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn wait_for_text(path: &Path) -> String {
    let deadline = Instant::now() + WAIT;
    while Instant::now() < deadline {
        if let Ok(text) = fs::read_to_string(path)
            && !text.trim().is_empty()
        {
            return text.trim().to_string();
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("{} never appeared", path.display());
}

fn wait_for<T>(what: &str, mut probe: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + WAIT;
    while Instant::now() < deadline {
        if let Some(value) = probe() {
            return value;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("timed out waiting for {what}");
}

fn window_of(driver: &mut Box<dyn Native>, pid: u32) -> Option<Window> {
    driver
        .windows()
        .ok()?
        .into_iter()
        .find(|window| window.pid == pid)
}

fn try_look(driver: &mut Box<dyn Native>, id: &str) -> kiko_driver::Result<Look> {
    driver.look(&LookParams {
        window: id.to_string(),
        tree: true,
        image: true,
        max_width: Some(1280),
    })
}

fn look(driver: &mut Box<dyn Native>, id: &str) -> Look {
    try_look(driver, id).expect("look at the window")
}

fn find_optional<'a>(nodes: &'a [Node], role: &str, name: Option<&str>) -> Option<&'a Node> {
    nodes.iter().find(|node| {
        node.role == role && name.is_none_or(|wanted| node.name.eq_ignore_ascii_case(wanted))
    })
}

fn find<'a>(nodes: &'a [Node], role: &str, name: Option<&str>) -> &'a Node {
    find_optional(nodes, role, name)
        .unwrap_or_else(|| panic!("no {role} node named {name:?} in {}", outline(nodes)))
}

fn outline(nodes: &[Node]) -> String {
    nodes
        .iter()
        .map(|node| format!("{} {:?}", node.role, node.name))
        .collect::<Vec<_>>()
        .join(", ")
}

fn act(driver: &mut Box<dyn Native>, params: ActParams) -> ActResult {
    driver.act(&params).expect("act on the window")
}

fn background(window: &str, reference: Option<u32>, action: Action) -> ActParams {
    ActParams {
        window: window.to_string(),
        reference,
        point: None,
        action,
        text: None,
        keys: None,
        dx: 0.0,
        dy: 0.0,
        mode: Mode::Background,
    }
}

fn foreground_act(window: &str, reference: Option<u32>, action: Action) -> ActParams {
    ActParams {
        mode: Mode::Foreground,
        ..background(window, reference, action)
    }
}

fn set_caret(edit: isize, position: i32) {
    unsafe {
        SendMessageW(
            HWND(edit as *mut _),
            EM_SETSEL,
            Some(WPARAM(position as usize)),
            Some(LPARAM(position as isize)),
        );
    }
}

fn close_window(window: isize) {
    unsafe {
        let _ = PostMessageW(Some(HWND(window as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0));
    }
}

fn notepad() -> PathBuf {
    let path = PathBuf::from(r"C:\Windows\System32\notepad.exe");
    assert!(path.exists(), "Notepad is not installed on this runner");
    path
}

struct ForcedPrintWindow;

impl ForcedPrintWindow {
    fn on() -> Self {
        unsafe { std::env::set_var("KIKO_FORCE_PRINT_WINDOW", "1") };
        Self
    }
}

impl Drop for ForcedPrintWindow {
    fn drop(&mut self) {
        unsafe { std::env::remove_var("KIKO_FORCE_PRINT_WINDOW") };
    }
}

fn cursor() -> POINT {
    let mut point = POINT::default();
    unsafe {
        let _ = GetCursorPos(&mut point);
    }
    point
}

fn foreground() -> isize {
    unsafe { GetForegroundWindow().0 as isize }
}

fn cover(cover: isize) {
    unsafe {
        let _ = SetWindowPos(
            HWND(cover as *mut _),
            Some(HWND_TOP),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        );
        let _ = SetForegroundWindow(HWND(cover as *mut _));
    }
    wait_for("the cover window to take focus", || {
        (foreground() == cover).then_some(())
    });
}

fn window_title(window: isize) -> String {
    let mut buffer = [0u16; 256];
    let length = unsafe {
        windows::Win32::UI::WindowsAndMessaging::GetWindowTextW(HWND(window as *mut _), &mut buffer)
    };
    if length <= 0 {
        String::new()
    } else {
        String::from_utf16_lossy(&buffer[..length as usize])
    }
}

fn checkpoint(step: &str, foreground_before: isize) {
    let current = foreground();
    eprintln!(
        "checkpoint {step}: foreground {current} {:?} (expected {foreground_before})",
        window_title(current)
    );
}

fn assert_untouched(foreground_before: isize, cursor_before: POINT) {
    assert_eq!(
        foreground(),
        foreground_before,
        "the driver changed the owner's foreground window"
    );
    let after = cursor();
    assert_eq!(
        (after.x, after.y),
        (cursor_before.x, cursor_before.y),
        "the driver moved the owner's pointer"
    );
}

fn app_path() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_kiko-native-testapp"))
}

fn scratch(name: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!("kiko-native-windows-{name}"));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).expect("create the scratch directory");
    directory
}

#[test]
#[ignore = "needs an interactive Windows desktop"]
fn background_actions_reach_a_covered_window_without_stealing_focus() {
    let directory = scratch("covered");
    let mut driver = kiko_native_windows::driver().expect("create the driver");
    let app = app_path();
    let target = Scene::start(
        &app,
        &directory,
        "target",
        "kiko-target",
        "3366cc",
        100,
        100,
    );
    let cover_window = Scene::start(&app, &directory, "cover", "kiko-cover", "cc3333", 160, 140);
    cover(cover_window.hwnd);
    unsafe {
        let _ = SetCursorPos(5, 5);
    }
    let foreground_before = foreground();
    let cursor_before = cursor();

    checkpoint("start", foreground_before);
    let listed = wait_for("the target window to be listed", || {
        window_of(&mut driver, target.child.id())
    });
    checkpoint("listed", foreground_before);
    assert_eq!(listed.id, target.id());
    assert_eq!(listed.title, "kiko-target");
    assert!(!listed.focused, "the covered window must not be focused");
    assert!(!listed.minimized);

    let first = look(&mut driver, &target.id());
    checkpoint("look", foreground_before);
    let edit = find(&first.nodes, "edit", None);
    let button = find(&first.nodes, "button", Some("Fire"));
    assert!(
        edit.actions.contains(&Action::SetValue),
        "the edit offers set_value"
    );
    assert!(
        button.actions.contains(&Action::Press),
        "the button offers press"
    );

    let image = first
        .image
        .as_ref()
        .expect("the covered window still has pixels");
    artifact(&directory, "covered-look.jpg", image);
    assert_eq!(image.mime, "image/jpeg");
    assert_eq!(
        image.covers, listed.frame,
        "the image maps to the window frame"
    );
    let decoded = image::load_from_memory_with_format(
        &BASE64.decode(&image.data).unwrap(),
        ImageFormat::Jpeg,
    )
    .expect("decode the look image");
    let rgb = decoded.to_rgb8();
    let sample = rgb.get_pixel(rgb.width() - 40, rgb.height() - 40);
    assert!(
        close(sample.0, TARGET_COLOR),
        "the look image shows the covered window's own pixels, not the cover window's: got {:?}",
        sample.0
    );

    let mut set_value = background(&target.id(), Some(edit.reference), Action::SetValue);
    set_value.text = Some("hello from kiko".into());
    assert_eq!(act(&mut driver, set_value).route, Route::WindowEvent);
    checkpoint("set_value", foreground_before);
    let after_value = look(&mut driver, &target.id());
    let edit = find(&after_value.nodes, "edit", None);
    assert_eq!(
        edit.value.as_deref(),
        Some("hello from kiko"),
        "set_value wrote the edit"
    );

    let mut type_more = background(&target.id(), Some(edit.reference), Action::Type);
    type_more.text = Some(" and more".into());
    set_caret(target.edit, "hello from kiko".encode_utf16().count() as i32);
    assert_eq!(act(&mut driver, type_more).route, Route::WindowEvent);
    checkpoint("type", foreground_before);
    let after_type = look(&mut driver, &target.id());
    let edit = find(&after_type.nodes, "edit", None);
    assert_eq!(
        edit.value.as_deref(),
        Some("hello from kiko and more"),
        "type appended to the edit"
    );

    let button = find(&after_type.nodes, "button", Some("Fire")).clone();
    let pressed = act(
        &mut driver,
        background(&target.id(), Some(button.reference), Action::Press),
    );
    assert_eq!(
        pressed.route,
        Route::WindowEvent,
        "classic controls take a posted click"
    );
    checkpoint("press", foreground_before);
    let log = directory.join("target.log");
    wait_for("the button press to reach the app", || {
        fs::read_to_string(&log)
            .ok()
            .filter(|text| text.contains("fire"))
    });

    let frame = button.frame.expect("the button has a window-local frame");
    let mut click = background(&target.id(), None, Action::Press);
    click.point = Some(Point {
        x: frame.x + frame.w / 2.0,
        y: frame.y + frame.h / 2.0,
    });
    assert_eq!(
        act(&mut driver, click).route,
        Route::WindowEvent,
        "a classic control takes a posted click"
    );
    checkpoint("point click", foreground_before);
    wait_for("the posted click to reach the app", || {
        let text = fs::read_to_string(&log).ok()?;
        (text.lines().count() >= 2).then_some(text)
    });

    assert_untouched(foreground_before, cursor_before);
}

fn close(actual: [u8; 3], expected: (u8, u8, u8)) -> bool {
    let difference = |left: u8, right: u8| i32::from(left).abs_diff(i32::from(right)) as i32;
    difference(actual[0], expected.0) <= 24
        && difference(actual[1], expected.1) <= 24
        && difference(actual[2], expected.2) <= 24
}

fn edge_path() -> Option<PathBuf> {
    [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|path| path.exists())
}

fn wait_for_edge(driver: &mut Box<dyn Native>, browser: &mut Child, title: &str) -> Window {
    let browser_pid = browser.id();
    let started = Instant::now();
    let deadline = started + Duration::from_secs(240);
    let mut last_report = started;
    loop {
        if let Ok(listed) = driver.windows() {
            if let Some(window) = listed.iter().find(|window| window.title.contains(title)) {
                return window.clone();
            }
            if last_report.elapsed() >= Duration::from_secs(15) {
                last_report = Instant::now();
                let titles: Vec<String> = listed
                    .iter()
                    .map(|window| format!("{:?} [pid {} {}]", window.title, window.pid, window.app))
                    .collect();
                eprintln!(
                    "waiting for Edge {title:?} ({:?} in): {}",
                    started.elapsed(),
                    titles.join(", ")
                );
            }
        }
        if Instant::now() >= deadline {
            let listed = driver.windows().unwrap_or_default();
            let titles: Vec<String> = listed
                .iter()
                .map(|window| format!("{:?} [pid {} {}]", window.title, window.pid, window.app))
                .collect();
            panic!(
                "timed out waiting for the Edge window {title:?} (browser pid {browser_pid}, status {:?}); visible windows: {}",
                browser.try_wait(),
                titles.join(", ")
            );
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn artifact(directory: &Path, name: &str, image: &kiko_driver::api::Image) {
    if let Some(target) = std::env::var_os("KIKO_ARTIFACT_DIR") {
        let target = PathBuf::from(target);
        let _ = fs::create_dir_all(&target);
        let _ = fs::write(
            target.join(name),
            BASE64.decode(&image.data).unwrap_or_default(),
        );
    }
    let _ = fs::write(
        directory.join(name),
        BASE64.decode(&image.data).unwrap_or_default(),
    );
}

const EDGE_PAGE: &str = r#"<!doctype html><html><head><title>kiko-page</title></head>
<body style="background:#2a7f3f;font:20px sans-serif">
<h1>kiko edge fixture</h1>
<button onclick="document.title='fired-'+(window.__n=(window.__n||0)+1)">Fire</button>
<textarea aria-label="kiko note"></textarea>
</body></html>"#;

struct Browser {
    child: Child,
}

impl Drop for Browser {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn start_edge(
    driver: &mut Box<dyn Native>,
    directory: &Path,
    edge: &Path,
    title: &str,
) -> (Browser, Window) {
    let page = directory.join("page.html");
    fs::write(&page, EDGE_PAGE.replace("kiko-page", title)).expect("write the page");
    let url = format!("file:///{}", page.to_string_lossy().replace('\\', "/"));
    let profile = directory.join("profile");
    let profile_argument = format!("--user-data-dir={}", profile.display());
    let mut child = Command::new(edge)
        .args([
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-sync",
            "--disable-extensions",
            "--disable-default-apps",
            "--disable-component-update",
            "--disable-background-networking",
            "--disable-client-side-phishing-detection",
            "--metrics-recording-only",
            "--no-service-autorun",
            "--password-store=basic",
            "--disable-features=msEdgeFirstRunExperience,msImplicitSignin",
            &profile_argument,
            &url,
        ])
        .spawn()
        .expect("start Edge");
    let window = wait_for_edge(driver, &mut child, title);
    (Browser { child }, window)
}

#[test]
#[ignore = "needs an interactive Windows desktop with Microsoft Edge"]
fn edge_page_content_is_readable_and_pressable_in_the_background() {
    let Some(edge) = edge_path() else {
        eprintln!("Microsoft Edge is not installed; skipping");
        return;
    };
    let directory = scratch("edge");
    let mut driver = kiko_native_windows::driver().expect("create the driver");
    let (_browser, window) = start_edge(&mut driver, &directory, &edge, "kiko-page");

    let first = wait_for("the Edge page tree", || {
        let found = try_look(&mut driver, &window.id).ok()?;
        let ready = find_optional(&found.nodes, "button", Some("Fire")).is_some();
        ready.then_some(found)
    });
    artifact(
        &directory,
        "edge-look.jpg",
        first.image.as_ref().expect("Edge renders pixels"),
    );
    let button = find(&first.nodes, "button", Some("Fire")).clone();
    assert!(
        button.actions.contains(&Action::Press),
        "the page button offers press"
    );
    let foreground_before = foreground();
    let cursor_before = cursor();
    checkpoint("edge look", foreground_before);

    let pressed = act(
        &mut driver,
        background(&window.id, Some(button.reference), Action::Press),
    );
    assert_eq!(pressed.route, Route::Accessibility);
    checkpoint("edge press", foreground_before);
    wait_for("the page button to fire", || {
        driver
            .windows()
            .ok()?
            .into_iter()
            .find(|candidate| candidate.title.contains("fired-"))
    });

    assert_untouched(foreground_before, cursor_before);
}

#[test]
#[ignore = "needs an interactive Windows desktop with Microsoft Edge"]
fn background_typing_splices_at_the_caret_in_a_page_field() {
    let Some(edge) = edge_path() else {
        eprintln!("Microsoft Edge is not installed; skipping");
        return;
    };
    let directory = scratch("edge-type");
    let mut driver = kiko_native_windows::driver().expect("create the driver");
    let (_browser, window) = start_edge(&mut driver, &directory, &edge, "kiko-page-type");
    let foreground_before = foreground();
    let cursor_before = cursor();

    let field = wait_for("the page textarea", || {
        let found = try_look(&mut driver, &window.id).ok()?;
        find_optional(&found.nodes, "edit", Some("kiko note")).cloned()
    });
    let mut first = background(&window.id, Some(field.reference), Action::Type);
    first.text = Some("alpha".into());
    assert_eq!(act(&mut driver, first).route, Route::Accessibility);
    let mut second = background(&window.id, Some(field.reference), Action::Type);
    second.text = Some("beta".into());
    assert_eq!(act(&mut driver, second).route, Route::Accessibility);

    let value = wait_for("the page field to hold both words", || {
        let found = try_look(&mut driver, &window.id).ok()?;
        let field = find_optional(&found.nodes, "edit", Some("kiko note"))?;
        let value = field.value.clone().unwrap_or_default();
        (value.contains("alpha") && value.contains("beta")).then_some(value)
    });
    assert_eq!(
        value.chars().count(),
        9,
        "background typing inserted at the caret instead of replacing the field: {value:?}"
    );
    checkpoint("edge type", foreground_before);
    assert_untouched(foreground_before, cursor_before);
}

#[test]
#[ignore = "needs an interactive Windows desktop"]
fn background_typing_inserts_at_the_caret_and_concatenates() {
    let directory = scratch("caret");
    let mut driver = kiko_native_windows::driver().expect("create the driver");
    let app = app_path();
    let target = Scene::start(&app, &directory, "target", "kiko-caret", "3366cc", 100, 100);
    let cover_window = Scene::start(&app, &directory, "cover", "kiko-cover", "cc3333", 160, 140);
    cover(cover_window.hwnd);
    unsafe {
        let _ = SetCursorPos(5, 5);
    }
    let foreground_before = foreground();
    let cursor_before = cursor();

    let first = look(&mut driver, &target.id());
    let edit = find(&first.nodes, "edit", None).clone();
    assert_eq!(edit.value.as_deref(), Some("seed"));
    set_caret(target.edit, 2);

    let mut first_type = background(&target.id(), Some(edit.reference), Action::Type);
    first_type.text = Some("AAA".into());
    assert_eq!(act(&mut driver, first_type).route, Route::WindowEvent);
    let mut second_type = background(&target.id(), Some(edit.reference), Action::Type);
    second_type.text = Some("BBB".into());
    assert_eq!(act(&mut driver, second_type).route, Route::WindowEvent);
    checkpoint("typed twice", foreground_before);

    let after = look(&mut driver, &target.id());
    let edit = find(&after.nodes, "edit", None);
    assert_eq!(
        edit.value.as_deref(),
        Some("seAAABBBed"),
        "background typing inserts at the caret and keeps the surrounding text"
    );
    assert_untouched(foreground_before, cursor_before);
}

#[test]
#[ignore = "needs an interactive Windows desktop"]
fn foreground_input_reaches_the_testapp_and_raises_it() {
    let directory = scratch("foreground");
    let mut driver = kiko_native_windows::driver().expect("create the driver");
    let app = app_path();
    let target = Scene::start(
        &app,
        &directory,
        "target",
        "kiko-foreground",
        "3366cc",
        100,
        100,
    );
    let cover_window = Scene::start(&app, &directory, "cover", "kiko-cover", "cc3333", 160, 140);
    cover(cover_window.hwnd);
    unsafe {
        let _ = SetCursorPos(5, 5);
    }
    assert_eq!(foreground(), cover_window.hwnd);

    let first = look(&mut driver, &target.id());
    let edit = find(&first.nodes, "edit", None).clone();
    let frame = edit.frame.expect("the edit has a window-local frame");

    let mut typed = foreground_act(&target.id(), Some(edit.reference), Action::Type);
    typed.text = Some("kiko foreground".into());
    assert_eq!(act(&mut driver, typed).route, Route::Foreground);
    assert_eq!(
        foreground(),
        target.hwnd,
        "foreground mode raised the target window"
    );
    assert_ne!(
        cursor(),
        POINT { x: 5, y: 5 },
        "foreground mode moved the real pointer"
    );

    let after = wait_for("the unicode text to arrive in the edit", || {
        let found = try_look(&mut driver, &target.id()).ok()?;
        let edit = find_optional(&found.nodes, "edit", None)?;
        edit.value
            .as_deref()
            .unwrap_or_default()
            .contains("kiko foreground")
            .then_some(found)
    });
    let edit = find(&after.nodes, "edit", None).clone();
    assert!(
        edit.states.iter().any(|state| state == "focused"),
        "the foreground click gave the edit keyboard focus"
    );

    let mut select_all = foreground_act(&target.id(), Some(edit.reference), Action::Key);
    select_all.keys = Some("ctrl+a".into());
    assert_eq!(act(&mut driver, select_all).route, Route::Foreground);
    let selected = look(&mut driver, &target.id());
    let edit = find(&selected.nodes, "edit", None).clone();
    eprintln!(
        "after ctrl+a: value {:?} states {:?}",
        edit.value, edit.states
    );
    let mut delete = foreground_act(&target.id(), Some(edit.reference), Action::Key);
    delete.keys = Some("delete".into());
    assert_eq!(act(&mut driver, delete).route, Route::Foreground);
    let mut last: Option<Option<String>> = None;
    let cleared = wait_for("ctrl+a then delete to clear the edit", || {
        let found = try_look(&mut driver, &target.id()).ok()?;
        let edit = find_optional(&found.nodes, "edit", None)?;
        if last.as_ref() != Some(&edit.value) {
            eprintln!(
                "clear probe: value {:?} states {:?}",
                edit.value, edit.states
            );
            last = Some(edit.value.clone());
        }
        edit.value.is_none().then_some(found)
    });
    let edit = find(&cleared.nodes, "edit", None).clone();

    let mut scroll = foreground_act(&target.id(), None, Action::Scroll);
    scroll.point = Some(Point {
        x: frame.x + frame.w / 2.0,
        y: frame.y + frame.h / 2.0,
    });
    scroll.dy = 1.0;
    assert_eq!(act(&mut driver, scroll).route, Route::Foreground);

    let mut again = foreground_act(&target.id(), Some(edit.reference), Action::Type);
    again.text = Some("second".into());
    assert_eq!(act(&mut driver, again).route, Route::Foreground);
    let after = wait_for("the second typed text to arrive", || {
        let found = try_look(&mut driver, &target.id()).ok()?;
        let edit = find_optional(&found.nodes, "edit", None)?;
        (edit.value.as_deref() == Some("second")).then_some(found)
    });
    assert_eq!(
        find(&after.nodes, "edit", None).value.as_deref(),
        Some("second"),
        "foreground typing reached the cleared edit"
    );
    assert_eq!(foreground(), target.hwnd);
}

#[test]
#[ignore = "needs an interactive Windows desktop with Notepad"]
fn foreground_typing_lands_in_notepad_and_saves() {
    let directory = scratch("notepad");
    let note = directory.join("kiko-note.txt");
    fs::write(&note, "").expect("create the note");
    let mut notepad = Command::new(notepad())
        .arg(&note)
        .spawn()
        .expect("start Notepad");
    let mut driver = kiko_native_windows::driver().expect("create the driver");
    let window = wait_for("the Notepad window", || {
        driver
            .windows()
            .ok()?
            .into_iter()
            .find(|window| window.title.contains("kiko-note"))
    });
    let document = wait_for("the Notepad document", || {
        let found = try_look(&mut driver, &window.id).ok()?;
        let node = find_optional(&found.nodes, "document", None)
            .or_else(|| find_optional(&found.nodes, "edit", None));
        match node {
            Some(node) => Some(node.clone()),
            None => {
                eprintln!("Notepad tree: {}", outline(&found.nodes));
                None
            }
        }
    });

    let mut typed = foreground_act(&window.id, Some(document.reference), Action::Type);
    typed.text = Some("hello from notepad".into());
    assert_eq!(act(&mut driver, typed).route, Route::Foreground);
    assert_eq!(
        foreground(),
        window
            .id
            .parse::<isize>()
            .expect("the window id is a handle"),
        "foreground mode raised Notepad"
    );

    let mut save = foreground_act(&window.id, Some(document.reference), Action::Key);
    save.keys = Some("ctrl+s".into());
    assert_eq!(act(&mut driver, save).route, Route::Foreground);
    let saved = wait_for("Notepad to save the note", || {
        fs::read_to_string(&note)
            .ok()
            .filter(|text| text.contains("hello from notepad"))
    });
    assert_eq!(
        saved.trim_start_matches('\u{feff}').trim(),
        "hello from notepad",
        "Notepad saved exactly the typed text"
    );

    close_window(
        window
            .id
            .parse::<isize>()
            .expect("the window id is a handle"),
    );
    let _ = notepad.kill();
    let _ = notepad.wait();
}

#[test]
#[ignore = "needs an interactive Windows desktop"]
fn print_window_capture_returns_a_full_size_image() {
    let directory = scratch("print-window");
    let mut driver = kiko_native_windows::driver().expect("create the driver");
    let app = app_path();
    let target = Scene::start(&app, &directory, "target", "kiko-print", "3366cc", 100, 100);
    let _forced = ForcedPrintWindow::on();
    let first = look(&mut driver, &target.id());
    let image = first
        .image
        .as_ref()
        .expect("the PrintWindow path produced an image");
    artifact(&directory, "print-window.jpg", image);
    let frame = first.window.frame;
    assert_eq!(image.covers, frame, "the image maps to the window frame");
    assert_eq!(
        image.width, frame.w as u32,
        "the image is the window's width"
    );
    assert_eq!(
        image.height, frame.h as u32,
        "the image is the window's height"
    );
    let decoded = image::load_from_memory_with_format(
        &BASE64.decode(&image.data).unwrap(),
        ImageFormat::Jpeg,
    )
    .expect("decode the PrintWindow image");
    let rgb = decoded.to_rgb8();
    assert_eq!((rgb.width(), rgb.height()), (image.width, image.height));
    let sample = rgb.get_pixel(rgb.width() / 2, rgb.height() - 40);
    assert!(
        close(sample.0, TARGET_COLOR),
        "the PrintWindow image shows the target's own pixels: got {:?}",
        sample.0
    );
    let colors: std::collections::HashSet<[u8; 3]> =
        rgb.pixels().take(5000).map(|pixel| pixel.0).collect();
    assert!(colors.len() > 1, "the PrintWindow image is blank");
}
