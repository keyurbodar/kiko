use std::ffi::c_void;

use kiko_driver::api::{Point, Rect, Route};
use kiko_driver::{DriverError, ErrorCode, Result};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::Security::{
    GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TOKEN_MANDATORY_LABEL,
    TOKEN_QUERY, TokenIntegrityLevel,
};
use windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentProcess, GetCurrentThreadId, OpenProcess, OpenProcessToken,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBD_EVENT_FLAGS, KEYBDINPUT,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE, KEYEVENTF_UNICODE,
    MOUSE_EVENT_FLAGS, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL, MOUSEINPUT, SendInput, SetFocus, VIRTUAL_KEY,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    CWP_SKIPDISABLED, CWP_SKIPINVISIBLE, CWP_SKIPTRANSPARENT, ChildWindowFromPointEx, GA_ROOT,
    GUITHREADINFO, GetAncestor, GetForegroundWindow, GetGUIThreadInfo, GetParent, GetSystemMetrics,
    GetWindowThreadProcessId, PostMessageW, SHOW_WINDOW_CMD, SM_CXVIRTUALSCREEN,
    SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SW_SHOWNOACTIVATE, SW_SHOWNORMAL,
    SetForegroundWindow, WM_CHAR, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE,
};
use windows::core::{HSTRING, PCWSTR};

use crate::hwnd;
use crate::keys::{Chord, extended, scan_code, virtual_key};

pub const SW_SHOW_NO_ACTIVATE: SHOW_WINDOW_CMD = SW_SHOWNOACTIVATE;
pub const SW_SHOW_NORMAL: SHOW_WINDOW_CMD = SW_SHOWNORMAL;

const WHEEL_DELTA: f64 = 120.0;
const WHEEL_PIXELS: f64 = 100.0;
const MAX_CHILD_DEPTH: usize = 16;
const VK_RETURN: u16 = 0x0d;
const VK_CONTROL: u16 = 0x11;
const MK_LBUTTON_BIT: usize = 0x0001;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Click,
    Text,
    Key,
}

fn to_hwnd(raw: isize) -> HWND {
    HWND(raw as *mut c_void)
}

fn background_unavailable(message: String) -> DriverError {
    DriverError::new(ErrorCode::BackgroundUnavailable, message)
}

fn post_failed(error: windows::core::Error) -> DriverError {
    DriverError::new(ErrorCode::Failed, format!("PostMessage failed: {error}"))
}

fn parent(raw: isize) -> Option<isize> {
    let parent = unsafe { GetParent(to_hwnd(raw)) }.ok()?;
    (!parent.0.is_null()).then_some(parent.0 as isize)
}

fn ancestry(root: isize, target: isize) -> Vec<isize> {
    let mut chain = vec![target];
    let mut current = target;
    for _ in 0..MAX_CHILD_DEPTH {
        let Some(up) = parent(current) else { break };
        chain.push(up);
        current = up;
        if current == root {
            break;
        }
    }
    chain.reverse();
    chain
}

fn drops_posted_input(class: &str, kind: Kind) -> bool {
    if class.starts_with("Chrome_WidgetWin_")
        || class.starts_with("Chrome_RenderWidgetHostHWND")
        || class.starts_with("CefBrowser")
        || class.contains("WebView")
    {
        return true;
    }
    if class.starts_with("HwndWrapper")
        || class.starts_with("WinUIDesktopWin32WindowClass")
        || class.starts_with("Microsoft.UI.Content.DesktopChildSiteBridge")
        || class.starts_with("ApplicationFrameWindow")
        || class.starts_with("Windows.UI.Core.CoreWindow")
    {
        return true;
    }
    if class.starts_with("gdkWindow") || class.starts_with("gdkSurface") {
        return kind == Kind::Click;
    }
    if class == "TkTopLevel" || class.starts_with("TkTopLevel.") {
        return true;
    }
    class.starts_with("SAL") && kind == Kind::Key
}

fn ensure_postable(root: isize, target: isize, kind: Kind) -> Result<()> {
    for window in ancestry(root, target) {
        let class = hwnd::class_name(window);
        if drops_posted_input(&class, kind) {
            return Err(background_unavailable(format!(
                "window class '{class}' drops posted input; retry this action with mode foreground"
            )));
        }
    }
    if let Some(message) = blocked_by_uipi(target) {
        return Err(background_unavailable(message));
    }
    Ok(())
}

fn integrity_level(process: HANDLE) -> Option<u32> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(process, TOKEN_QUERY, &mut token).ok()?;
        let mut needed = 0u32;
        let _ = GetTokenInformation(token, TokenIntegrityLevel, None, 0, &mut needed);
        if needed == 0 {
            let _ = CloseHandle(token);
            return None;
        }
        let mut buffer = vec![0u8; needed as usize];
        let read = GetTokenInformation(
            token,
            TokenIntegrityLevel,
            Some(buffer.as_mut_ptr() as *mut c_void),
            needed,
            &mut needed,
        )
        .is_ok();
        let _ = CloseHandle(token);
        if !read {
            return None;
        }
        let label = &*(buffer.as_ptr() as *const TOKEN_MANDATORY_LABEL);
        let count = GetSidSubAuthorityCount(label.Label.Sid);
        if count.is_null() || *count == 0 {
            return None;
        }
        let authority = GetSidSubAuthority(label.Label.Sid, *count as u32 - 1);
        (!authority.is_null()).then(|| *authority)
    }
}

fn blocked_by_uipi(target: isize) -> Option<String> {
    let pid = hwnd::pid(target);
    if pid == 0 {
        return None;
    }
    let own = unsafe { integrity_level(GetCurrentProcess()) }?;
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let theirs = integrity_level(process);
    let _ = unsafe { CloseHandle(process) };
    (theirs? > own).then(|| {
        "the target runs at a higher integrity level than kiko, so posted input is silently dropped; retry with mode foreground or run kiko elevated".to_string()
    })
}

fn lparam(x: i32, y: i32) -> LPARAM {
    LPARAM((((y as u32) & 0xffff) << 16 | ((x as u32) & 0xffff)) as isize)
}

fn to_client(window: isize, screen: Point) -> Point {
    let mut point = POINT {
        x: screen.x as i32,
        y: screen.y as i32,
    };
    unsafe {
        let _ = ScreenToClient(to_hwnd(window), &mut point);
    }
    Point {
        x: point.x as f64,
        y: point.y as f64,
    }
}

fn deepest_child(root: isize, screen: Point) -> isize {
    let mut current = root;
    for _ in 0..MAX_CHILD_DEPTH {
        let client = to_client(current, screen);
        let child = unsafe {
            ChildWindowFromPointEx(
                to_hwnd(current),
                POINT {
                    x: client.x as i32,
                    y: client.y as i32,
                },
                CWP_SKIPINVISIBLE | CWP_SKIPDISABLED | CWP_SKIPTRANSPARENT,
            )
        };
        let raw = child.0 as isize;
        if raw == 0 || raw == current {
            break;
        }
        current = raw;
    }
    current
}

pub fn post_click(root: isize, frame: Rect, point: Point) -> Result<Route> {
    post_click_screen(
        root,
        Point {
            x: frame.x + point.x,
            y: frame.y + point.y,
        },
    )
}

pub fn post_click_screen(root: isize, screen: Point) -> Result<Route> {
    let target = deepest_child(root, screen);
    ensure_postable(root, target, Kind::Click)?;
    let client = to_client(target, screen);
    let position = lparam(client.x as i32, client.y as i32);
    unsafe {
        PostMessageW(Some(to_hwnd(target)), WM_MOUSEMOVE, WPARAM(0), position)
            .and_then(|()| {
                PostMessageW(
                    Some(to_hwnd(target)),
                    WM_LBUTTONDOWN,
                    WPARAM(MK_LBUTTON_BIT),
                    position,
                )
            })
            .and_then(|()| PostMessageW(Some(to_hwnd(target)), WM_LBUTTONUP, WPARAM(0), position))
            .map_err(post_failed)?;
    }
    Ok(Route::WindowEvent)
}

fn focused_descendant(root: isize) -> Option<isize> {
    let mut threads = vec![unsafe { GetWindowThreadProcessId(to_hwnd(root), None) }];
    for child in hwnd::children(root) {
        let thread = unsafe { GetWindowThreadProcessId(to_hwnd(child), None) };
        if thread != 0 && !threads.contains(&thread) {
            threads.push(thread);
        }
    }
    let mut best: Option<(usize, isize)> = None;
    for thread in threads {
        let mut info = GUITHREADINFO {
            cbSize: size_of::<GUITHREADINFO>() as u32,
            ..Default::default()
        };
        if unsafe { GetGUIThreadInfo(thread, &mut info) }.is_err() {
            continue;
        }
        let focus = info.hwndFocus.0 as isize;
        if focus == 0 || focus == root {
            continue;
        }
        let chain = ancestry(root, focus);
        if chain.first() != Some(&root) {
            continue;
        }
        if best.is_none_or(|(depth, _)| chain.len() > depth) {
            best = Some((chain.len(), focus));
        }
    }
    best.map(|(_, focus)| focus)
}

fn post_target(window: isize) -> Result<isize> {
    if let Some(focus) = focused_descendant(window) {
        return Ok(focus);
    }
    if parent(window).is_some() {
        return Ok(window);
    }
    Err(background_unavailable(
        "no control in this window holds focus while it is in the background; retry with mode foreground".to_string(),
    ))
}

fn key_lparam(scan: u16, extended_key: bool, up: bool) -> LPARAM {
    let mut value = 1u32 | ((scan as u32) << 16);
    if extended_key {
        value |= 1 << 24;
    }
    if up {
        value |= 1 << 30 | 1 << 31;
    }
    LPARAM(value as isize)
}

fn post_key(window: isize, key: u16, scan: u16, extended_key: bool) -> Result<()> {
    unsafe {
        PostMessageW(
            Some(to_hwnd(window)),
            WM_KEYDOWN,
            WPARAM(key as usize),
            key_lparam(scan, extended_key, false),
        )
        .and_then(|()| {
            PostMessageW(
                Some(to_hwnd(window)),
                WM_KEYUP,
                WPARAM(key as usize),
                key_lparam(scan, extended_key, true),
            )
        })
        .map_err(post_failed)
    }
}

pub fn post_text(window: isize, text: &str) -> Result<Route> {
    let target = post_target(window)?;
    ensure_postable(window, target, Kind::Text)?;
    let mut first = true;
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if !first {
            post_key(target, VK_RETURN, scan_code("Enter"), false)?;
        }
        first = false;
        for unit in line.encode_utf16() {
            unsafe {
                PostMessageW(
                    Some(to_hwnd(target)),
                    WM_CHAR,
                    WPARAM(unit as usize),
                    LPARAM(1),
                )
            }
            .map_err(post_failed)?;
        }
    }
    Ok(Route::WindowEvent)
}

pub fn post_keys(window: isize, chords: &[Chord]) -> Result<Route> {
    let target = post_target(window)?;
    ensure_postable(window, target, Kind::Key)?;
    for chord in chords {
        for modifier in &chord.mods {
            post_key(
                target,
                virtual_key(modifier, modifier),
                scan_code(modifier),
                extended(modifier),
            )?;
        }
        post_key(
            target,
            virtual_key(&chord.code, &chord.key),
            scan_code(&chord.code),
            extended(&chord.code),
        )?;
        for modifier in chord.mods.iter().rev() {
            post_key(
                target,
                virtual_key(modifier, modifier),
                scan_code(modifier),
                extended(modifier),
            )?;
        }
    }
    Ok(Route::WindowEvent)
}

pub fn foreground_window(window: isize) -> Result<()> {
    let root = unsafe { GetAncestor(to_hwnd(window), GA_ROOT) };
    let target = if root.0.is_null() {
        to_hwnd(window)
    } else {
        root
    };
    let current = unsafe { GetCurrentThreadId() };
    let target_thread = unsafe { GetWindowThreadProcessId(target, None) };
    let foreground = unsafe { GetForegroundWindow() };
    let foreground_thread = unsafe { GetWindowThreadProcessId(foreground, None) };
    unsafe {
        if foreground_thread != 0 && foreground_thread != current {
            let _ = AttachThreadInput(current, foreground_thread, true);
        }
        if target_thread != 0 && target_thread != current {
            let _ = AttachThreadInput(current, target_thread, true);
        }
        let _ = SetForegroundWindow(target);
        if target_thread != 0 && target_thread != current {
            let _ = AttachThreadInput(current, target_thread, false);
        }
        if foreground_thread != 0 && foreground_thread != current {
            let _ = AttachThreadInput(current, foreground_thread, false);
        }
    }
    Ok(())
}

fn virtual_desk(screen: Point) -> (i32, i32) {
    let (left, top, width, height) = unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1),
            GetSystemMetrics(SM_CYVIRTUALSCREEN).max(1),
        )
    };
    let x = ((screen.x - left as f64) / (width - 1) as f64 * 65535.0).round() as i32;
    let y = ((screen.y - top as f64) / (height - 1) as f64 * 65535.0).round() as i32;
    (x, y)
}

fn mouse_input(dx: i32, dy: i32, data: u32, flags: MOUSE_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: data,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn send(inputs: &[INPUT]) {
    unsafe {
        let _ = SendInput(inputs, size_of::<INPUT>() as i32);
    }
}

fn move_to(screen: Point) {
    let (x, y) = virtual_desk(screen);
    send(&[mouse_input(
        x,
        y,
        0,
        MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
    )]);
}

fn click_at(screen: Point, down: MOUSE_EVENT_FLAGS, up: MOUSE_EVENT_FLAGS) {
    let (x, y) = virtual_desk(screen);
    let flags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
    send(&[
        mouse_input(x, y, 0, flags | down),
        mouse_input(x, y, 0, flags | up),
    ]);
}

pub fn foreground_click(screen: Point) -> Result<()> {
    click_at(screen, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP);
    Ok(())
}

pub fn foreground_right_click(screen: Point) -> Result<()> {
    click_at(screen, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP);
    Ok(())
}

pub fn foreground_wheel(screen: Point, dx: f64, dy: f64) -> Result<()> {
    move_to(screen);
    let vertical = (dy * WHEEL_DELTA / WHEEL_PIXELS).round() as i32;
    let horizontal = (dx * WHEEL_DELTA / WHEEL_PIXELS).round() as i32;
    if vertical != 0 {
        send(&[mouse_input(0, 0, (-vertical) as u32, MOUSEEVENTF_WHEEL)]);
    }
    if horizontal != 0 {
        send(&[mouse_input(0, 0, horizontal as u32, MOUSEEVENTF_HWHEEL)]);
    }
    Ok(())
}

fn keyboard_input(scan: u16, key: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(key),
                wScan: scan,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn key_flags(code: &str, up: bool) -> KEYBD_EVENT_FLAGS {
    let mut flags = KEYBD_EVENT_FLAGS(KEYEVENTF_SCANCODE.0);
    if extended(code) {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    if up {
        flags |= KEYEVENTF_KEYUP;
    }
    flags
}

fn key_event(code: &str, key: &str, up: bool) -> INPUT {
    keyboard_input(scan_code(code), virtual_key(code, key), key_flags(code, up))
}

pub fn foreground_keys(chords: &[Chord]) -> Result<()> {
    for chord in chords {
        for modifier in &chord.mods {
            send(&[key_event(modifier, modifier, false)]);
        }
        send(&[
            key_event(&chord.code, &chord.key, false),
            key_event(&chord.code, &chord.key, true),
        ]);
        for modifier in chord.mods.iter().rev() {
            send(&[key_event(modifier, modifier, true)]);
        }
    }
    Ok(())
}

pub fn foreground_text(text: &str) -> Result<()> {
    for unit in text.encode_utf16() {
        send(&[
            keyboard_input(unit, 0, KEYEVENTF_UNICODE),
            keyboard_input(unit, 0, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP),
        ]);
    }
    Ok(())
}

pub fn foreground_focus(window: isize) -> Result<()> {
    let thread = unsafe { GetWindowThreadProcessId(to_hwnd(window), None) };
    let current = unsafe { GetCurrentThreadId() };
    unsafe {
        if thread != 0 && thread != current {
            let _ = AttachThreadInput(current, thread, true);
        }
        let _ = SetFocus(Some(to_hwnd(window)));
        if thread != 0 && thread != current {
            let _ = AttachThreadInput(current, thread, false);
        }
    }
    Ok(())
}

pub fn foreground_select_all() -> Result<()> {
    send(&[keyboard_input(
        scan_code("ControlLeft"),
        VK_CONTROL,
        KEYEVENTF_SCANCODE,
    )]);
    send(&[key_event("KeyA", "a", false), key_event("KeyA", "a", true)]);
    send(&[keyboard_input(
        scan_code("ControlLeft"),
        VK_CONTROL,
        KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP,
    )]);
    Ok(())
}

pub fn shell_open(target: &str, show: SHOW_WINDOW_CMD) -> Result<()> {
    let operation = HSTRING::from("open");
    let file = HSTRING::from(target);
    let result = unsafe {
        ShellExecuteW(
            None,
            &operation,
            &file,
            PCWSTR::null(),
            PCWSTR::null(),
            show,
        )
    };
    if result.0 as isize <= 32 {
        return Err(DriverError::new(
            ErrorCode::Failed,
            format!(
                "could not open {target} (ShellExecute returned {})",
                result.0 as isize
            ),
        ));
    }
    Ok(())
}
