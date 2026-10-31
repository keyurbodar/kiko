use std::ffi::c_void;
use std::fs;
use std::io::Write;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::time::Duration;

use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{CreateSolidBrush, HBRUSH};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, SetFocus, VK_CONTROL};
use windows::Win32::UI::WindowsAndMessaging::{
    CS_HREDRAW, CS_VREDRAW, CallWindowProcW, CreateWindowExW, DefWindowProcW, DispatchMessageW,
    ES_MULTILINE, GWLP_USERDATA, GWLP_WNDPROC, GetDlgItem, GetMessageW, GetParent,
    GetWindowLongPtrW, HMENU, MSG, PostQuitMessage, RegisterClassW, SW_SHOWNORMAL,
    SetWindowLongPtrW, ShowWindow, TranslateMessage, WINDOW_EX_STYLE, WINDOW_STYLE, WM_COMMAND,
    WM_CREATE, WM_DESTROY, WM_KEYDOWN, WM_KEYUP, WNDCLASSW, WNDPROC, WS_BORDER, WS_CHILD,
    WS_OVERLAPPEDWINDOW, WS_VISIBLE,
};
use windows::core::{HSTRING, w};

const EDIT_ID: usize = 100;
const BUTTON_ID: usize = 101;

static ORIGINAL_EDIT_PROC: AtomicIsize = AtomicIsize::new(0);

struct App {
    log: String,
}

struct Options {
    title: String,
    color: u32,
    log: String,
    hwnd_file: String,
    edit_hwnd_file: String,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    hang: bool,
}

impl Options {
    fn parse() -> Self {
        let mut options = Self {
            title: "kiko test app".into(),
            color: 0x3366cc,
            log: String::new(),
            hwnd_file: String::new(),
            edit_hwnd_file: String::new(),
            x: 100,
            y: 100,
            width: 600,
            height: 400,
            hang: false,
        };
        let mut args = std::env::args().skip(1);
        while let Some(flag) = args.next() {
            if flag == "--hang" {
                options.hang = true;
                continue;
            }
            let Some(value) = args.next() else { break };
            match flag.as_str() {
                "--title" => options.title = value,
                "--color" => {
                    options.color =
                        u32::from_str_radix(value.trim_start_matches('#'), 16).unwrap_or(0x3366cc)
                }
                "--file" => options.log = value,
                "--hwnd-file" => options.hwnd_file = value,
                "--edit-hwnd-file" => options.edit_hwnd_file = value,
                "--pos" => {
                    let mut parts = value.split(',');
                    options.x = parts
                        .next()
                        .and_then(|part| part.parse().ok())
                        .unwrap_or(100);
                    options.y = parts
                        .next()
                        .and_then(|part| part.parse().ok())
                        .unwrap_or(100);
                }
                "--size" => {
                    let mut parts = value.split(',');
                    options.width = parts
                        .next()
                        .and_then(|part| part.parse().ok())
                        .unwrap_or(600);
                    options.height = parts
                        .next()
                        .and_then(|part| part.parse().ok())
                        .unwrap_or(400);
                }
                _ => {}
            }
        }
        options
    }
}

fn color_ref(rgb: u32) -> COLORREF {
    let red = rgb >> 16 & 0xff;
    let green = rgb >> 8 & 0xff;
    let blue = rgb & 0xff;
    COLORREF(red | green << 8 | blue << 16)
}

unsafe fn append_log(window: HWND, line: &str) {
    let parent = unsafe { GetParent(window) }.unwrap_or(window);
    let state = unsafe { GetWindowLongPtrW(parent, GWLP_USERDATA) } as *const App;
    let Some(app) = (unsafe { state.as_ref() }) else {
        return;
    };
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&app.log)
    {
        let _ = writeln!(file, "{line}");
    }
}

fn control_down() -> i32 {
    if unsafe { GetKeyState(VK_CONTROL.0 as i32) } < 0 {
        1
    } else {
        0
    }
}

unsafe extern "system" fn edit_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_KEYDOWN || message == WM_KEYUP {
        let key = wparam.0 & 0xffff;
        let label = if message == WM_KEYDOWN { "down" } else { "up" };
        unsafe { append_log(window, &format!("{label} {key} control={}", control_down())) };
    }
    let original: WNDPROC =
        unsafe { std::mem::transmute(ORIGINAL_EDIT_PROC.load(Ordering::Acquire)) };
    unsafe { CallWindowProcW(original, window, message, wparam, lparam) }
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_CREATE => {
            let instance = unsafe { GetModuleHandleW(None) }.unwrap_or_default();
            if let Ok(edit) = unsafe {
                CreateWindowExW(
                    WINDOW_EX_STYLE::default(),
                    w!("EDIT"),
                    w!("seed"),
                    WS_CHILD | WS_VISIBLE | WS_BORDER | WINDOW_STYLE(ES_MULTILINE as u32),
                    20,
                    20,
                    540,
                    120,
                    Some(window),
                    Some(HMENU(EDIT_ID as *mut c_void)),
                    Some(HINSTANCE(instance.0)),
                    None,
                )
            } {
                let replacement: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT =
                    edit_proc;
                let original =
                    unsafe { SetWindowLongPtrW(edit, GWLP_WNDPROC, replacement as usize as isize) };
                ORIGINAL_EDIT_PROC.store(original, Ordering::Release);
                unsafe {
                    let _ = SetFocus(Some(edit));
                }
            }
            unsafe {
                let _ = CreateWindowExW(
                    WINDOW_EX_STYLE::default(),
                    w!("BUTTON"),
                    w!("Fire"),
                    WS_CHILD | WS_VISIBLE,
                    20,
                    160,
                    120,
                    40,
                    Some(window),
                    Some(HMENU(BUTTON_ID as *mut c_void)),
                    Some(HINSTANCE(instance.0)),
                    None,
                );
            }
            LRESULT(0)
        }
        WM_COMMAND => {
            if (wparam.0 & 0xffff) == BUTTON_ID {
                unsafe { append_log(window, "fire") };
            }
            LRESULT(0)
        }
        WM_DESTROY => {
            unsafe { PostQuitMessage(0) };
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(window, message, wparam, lparam) },
    }
}

fn main() {
    let options = Options::parse();
    let brush: HBRUSH = unsafe { CreateSolidBrush(color_ref(options.color)) };
    let instance = unsafe { GetModuleHandleW(None) }.unwrap_or_default();
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(window_proc),
        hInstance: HINSTANCE(instance.0),
        hbrBackground: brush,
        lpszClassName: w!("KikoTestApp"),
        ..Default::default()
    };
    if unsafe { RegisterClassW(&class) } == 0 {
        std::process::exit(2);
    }
    let title = HSTRING::from(options.title.clone());
    let window = match unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            w!("KikoTestApp"),
            &title,
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            options.x,
            options.y,
            options.width,
            options.height,
            None,
            None,
            Some(HINSTANCE(instance.0)),
            None,
        )
    } {
        Ok(window) => window,
        Err(_) => std::process::exit(3),
    };
    let app = Box::new(App { log: options.log });
    unsafe {
        SetWindowLongPtrW(window, GWLP_USERDATA, Box::into_raw(app) as isize);
        let _ = ShowWindow(window, SW_SHOWNORMAL);
    }
    if !options.hwnd_file.is_empty()
        && let Ok(mut file) = fs::File::create(&options.hwnd_file)
    {
        let _ = write!(file, "{}", window.0 as isize);
    }
    if !options.edit_hwnd_file.is_empty()
        && let Ok(edit) = unsafe { GetDlgItem(Some(window), EDIT_ID as i32) }
        && let Ok(mut file) = fs::File::create(&options.edit_hwnd_file)
    {
        let _ = write!(file, "{}", edit.0 as isize);
    }
    if options.hang {
        loop {
            std::thread::sleep(Duration::from_secs(3600));
        }
    }
    let mut message = MSG::default();
    while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {
        unsafe {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}
