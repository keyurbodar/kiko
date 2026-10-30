use std::ffi::c_void;

use kiko_driver::api::{Rect, Window};
use kiko_driver::{DriverError, ErrorCode, Result};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{
    DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute,
};
use windows::Win32::Graphics::Gdi::{MONITOR_DEFAULTTONULL, MonitorFromWindow};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, EnumWindows, GWL_EXSTYLE, GetClassNameW, GetForegroundWindow,
    GetWindowLongPtrW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow,
    IsWindowVisible, WS_EX_TOOLWINDOW,
};
use windows::core::PWSTR;

pub fn handle(raw: isize) -> HWND {
    HWND(raw as *mut c_void)
}

pub fn claim_per_monitor_v2() {
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
}

pub fn parse_id(id: &str) -> Result<isize> {
    id.parse::<isize>()
        .map_err(|_| DriverError::new(ErrorCode::NotFound, format!("{id} is not a window id")))
}

pub fn exists(raw: isize) -> bool {
    unsafe { IsWindow(Some(handle(raw))).as_bool() }
}

pub fn foreground() -> isize {
    unsafe { GetForegroundWindow().0 as isize }
}

pub fn class_name(raw: isize) -> String {
    let mut buffer = [0u16; 256];
    let length = unsafe { GetClassNameW(handle(raw), &mut buffer) };
    if length <= 0 {
        String::new()
    } else {
        String::from_utf16_lossy(&buffer[..length as usize])
    }
}

pub fn title(raw: isize) -> String {
    let mut buffer = [0u16; 512];
    let length = unsafe { GetWindowTextW(handle(raw), &mut buffer) };
    if length <= 0 {
        String::new()
    } else {
        String::from_utf16_lossy(&buffer[..length as usize])
    }
}

pub fn pid(raw: isize) -> u32 {
    let mut pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(handle(raw), Some(&mut pid));
    }
    pid
}

fn is_cloaked(raw: isize) -> bool {
    let mut cloaked = 0u32;
    let result = unsafe {
        DwmGetWindowAttribute(
            handle(raw),
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut c_void,
            size_of::<u32>() as u32,
        )
    };
    result.is_ok() && cloaked != 0
}

fn window_rect(raw: isize) -> Option<RECT> {
    let mut rect = RECT::default();
    unsafe { GetWindowRect(handle(raw), &mut rect) }.ok()?;
    (rect.right > rect.left && rect.bottom > rect.top).then_some(rect)
}

fn to_rect(rect: RECT) -> Rect {
    Rect {
        x: rect.left as f64,
        y: rect.top as f64,
        w: (rect.right - rect.left) as f64,
        h: (rect.bottom - rect.top) as f64,
    }
}

pub fn frame(raw: isize) -> Option<Rect> {
    let mut rect = RECT::default();
    let result = unsafe {
        DwmGetWindowAttribute(
            handle(raw),
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut RECT as *mut c_void,
            size_of::<RECT>() as u32,
        )
    };
    if result.is_ok() && rect.right > rect.left && rect.bottom > rect.top {
        return Some(to_rect(rect));
    }
    window_rect(raw).map(to_rect)
}

pub fn minimized(raw: isize) -> bool {
    unsafe { IsIconic(handle(raw)).as_bool() }
}

fn on_screen(raw: isize) -> bool {
    unsafe { !MonitorFromWindow(handle(raw), MONITOR_DEFAULTTONULL).is_invalid() }
}

fn is_tool(raw: isize) -> bool {
    let style = unsafe { GetWindowLongPtrW(handle(raw), GWL_EXSTYLE) } as u32;
    style & WS_EX_TOOLWINDOW.0 != 0
}

fn exe_name(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut length = buffer.len() as u32;
        let queried = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        );
        let _ = CloseHandle(process);
        queried.ok()?;
        let path = String::from_utf16_lossy(&buffer[..length as usize]);
        path.rsplit('\\')
            .next()
            .filter(|name| !name.is_empty())
            .map(str::to_string)
    }
}

pub fn info(raw: isize) -> Option<Window> {
    if !exists(raw) || is_cloaked(raw) {
        return None;
    }
    let pid = pid(raw);
    Some(Window {
        id: raw.to_string(),
        pid,
        app: exe_name(pid).unwrap_or_default(),
        bundle: None,
        title: title(raw),
        frame: frame(raw)?,
        focused: foreground() == raw,
        minimized: minimized(raw),
        on_screen: on_screen(raw),
    })
}

pub fn list() -> Vec<Window> {
    unsafe extern "system" fn visit(window: HWND, data: LPARAM) -> windows::core::BOOL {
        let windows = unsafe { &mut *(data.0 as *mut Vec<isize>) };
        windows.push(window.0 as isize);
        true.into()
    }
    let mut handles: Vec<isize> = Vec::new();
    unsafe {
        let _ = EnumWindows(
            Some(visit),
            LPARAM(&mut handles as *mut Vec<isize> as isize),
        );
    }
    handles
        .into_iter()
        .filter(|raw| {
            let visible = unsafe { IsWindowVisible(handle(*raw)).as_bool() };
            visible && !is_tool(*raw) && !is_cloaked(*raw) && !title(*raw).is_empty()
        })
        .filter_map(info)
        .collect()
}

pub fn children(raw: isize) -> Vec<isize> {
    unsafe extern "system" fn visit(window: HWND, data: LPARAM) -> windows::core::BOOL {
        let windows = unsafe { &mut *(data.0 as *mut Vec<isize>) };
        windows.push(window.0 as isize);
        true.into()
    }
    let mut handles: Vec<isize> = Vec::new();
    unsafe {
        let _ = EnumChildWindows(
            Some(handle(raw)),
            Some(visit),
            LPARAM(&mut handles as *mut Vec<isize> as isize),
        );
    }
    handles
}

pub fn find_child(raw: isize, class: &str) -> Option<isize> {
    children(raw)
        .into_iter()
        .find(|child| class_name(*child).eq_ignore_ascii_case(class))
}

pub fn has_class(raw: isize, prefix: &str) -> bool {
    class_name(raw).starts_with(prefix)
}
