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
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, HWND_TOP, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    SetCursorPos, SetForegroundWindow, SetWindowPos,
};

const TARGET_COLOR: (u8, u8, u8) = (0x33, 0x66, 0xcc);
const WAIT: Duration = Duration::from_secs(30);

struct Scene {
    child: Child,
    hwnd: isize,
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
        let log_file = directory.join(format!("{name}.log"));
        let _ = fs::remove_file(&hwnd_file);
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
        Self { child, hwnd }
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

fn look(driver: &mut Box<dyn Native>, id: &str) -> Look {
    driver
        .look(&LookParams {
            window: id.to_string(),
            tree: true,
            image: true,
            max_width: Some(1280),
        })
        .expect("look at the window")
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
    assert_eq!(pressed.route, Route::Accessibility);
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

fn wait_for_edge(driver: &mut Box<dyn Native>, browser: &mut Child) -> Window {
    let browser_pid = browser.id();
    let deadline = Instant::now() + Duration::from_secs(240);
    loop {
        if let Ok(listed) = driver.windows()
            && let Some(window) = listed
                .into_iter()
                .find(|window| window.title == "kiko-page")
        {
            return window;
        }
        if Instant::now() >= deadline {
            let listed = driver.windows().unwrap_or_default();
            let titles: Vec<String> = listed
                .iter()
                .map(|window| format!("{:?} [pid {} {}]", window.title, window.pid, window.app))
                .collect();
            panic!(
                "timed out waiting for the Edge window (browser pid {browser_pid}, status {:?}); visible windows: {}",
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

#[test]
#[ignore = "needs an interactive Windows desktop with Microsoft Edge"]
fn edge_page_content_is_readable_and_pressable_in_the_background() {
    let Some(edge) = edge_path() else {
        eprintln!("Microsoft Edge is not installed; skipping");
        return;
    };
    let directory = scratch("edge");
    let page = directory.join("page.html");
    fs::write(
        &page,
        r#"<!doctype html><html><head><title>kiko-page</title></head>
<body style="background:#2a7f3f;font:20px sans-serif">
<h1>kiko edge fixture</h1>
<button onclick="document.title='fired-'+(window.__n=(window.__n||0)+1)">Fire</button>
</body></html>"#,
    )
    .expect("write the page");
    let url = format!("file:///{}", page.to_string_lossy().replace('\\', "/"));
    let profile = directory.join("profile");
    let profile_argument = format!("--user-data-dir={}", profile.display());
    let mut browser = Command::new(edge)
        .args([
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-features=msEdgeFirstRunExperience",
            &profile_argument,
            &url,
        ])
        .spawn()
        .expect("start Edge");
    let mut driver = kiko_native_windows::driver().expect("create the driver");
    let window = wait_for_edge(&mut driver, &mut browser);

    let first = wait_for("the Edge page tree", || {
        let found = look(&mut driver, &window.id);
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
    let _ = browser.kill();
    let _ = browser.wait();
}
