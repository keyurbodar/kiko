use std::ffi::c_void;
use std::time::Duration;

use kiko_driver::{DriverError, ErrorCode, Point, Route};
use objc2::runtime::{AnyClass, AnyObject, Sel};
use objc2_core_foundation::{CFRetained, CGPoint};
use objc2_core_graphics::{
    CGEvent, CGEventField, CGEventFlags, CGEventSource, CGEventSourceStateID, CGEventTapLocation,
    CGEventType, CGMouseButton,
};

use crate::private;

const CLICK_STATE: u32 = 1;
const BUTTON_NUMBER: u32 = 3;
const SUBTYPE: u32 = 7;
const TARGET_PID: u32 = 40;
const WINDOW_NUMBER: u32 = 51;
const WINDOW_UNDER_POINTER: u32 = 91;
const WINDOW_THAT_HANDLES: u32 = 92;
const TOUCH_SUBTYPE: i64 = 3;

pub fn click(
    pid: i32,
    window: u32,
    screen: Point,
    local: Point,
    foreground: bool,
) -> kiko_driver::Result<Route> {
    let position = CGPoint::new(screen.x, screen.y);
    if foreground {
        let down = mouse_event(CGEventType::LeftMouseDown, position)?;
        CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&down));
        let up = mouse_event(CGEventType::LeftMouseUp, position)?;
        CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&up));
        return Ok(Route::Foreground);
    }

    let primer = mouse_event(CGEventType::MouseMoved, position)?;
    stamp(&primer, pid, window, 0, local);
    post(pid, &primer);
    std::thread::sleep(Duration::from_millis(10));

    for event_type in [CGEventType::LeftMouseDown, CGEventType::LeftMouseUp] {
        let event = mouse_event(event_type, position)?;
        stamp(&event, pid, window, 1, local);
        post(pid, &event);
    }
    Ok(if private::post_to_pid().is_some() {
        Route::Private
    } else {
        Route::WindowEvent
    })
}

pub fn keys(pid: i32, keys: &str, foreground: bool) -> kiko_driver::Result<Route> {
    let (key, modifiers) = split(keys)?;
    let code = key_code(key).ok_or_else(|| {
        DriverError::new(
            ErrorCode::Unsupported,
            format!("{key} is not a key this driver knows"),
        )
    })?;
    let flags = modifier_flags(&modifiers);

    for down in [true, false] {
        let Some(event) = CGEvent::new_keyboard_event(
            CGEventSource::new(CGEventSourceStateID::HIDSystemState).as_deref(),
            code,
            down,
        ) else {
            return Err(DriverError::new(
                ErrorCode::Failed,
                "could not build a key event",
            ));
        };
        CGEvent::set_flags(Some(&event), flags);
        if foreground {
            CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&event));
        } else {
            post_key(pid, &event);
        }
    }
    Ok(if foreground {
        Route::Foreground
    } else if private::post_to_pid().is_some() {
        Route::Private
    } else {
        Route::WindowEvent
    })
}

#[cfg(test)]
pub fn pointer() -> Point {
    let Some(event) = CGEvent::new(None) else {
        return Point { x: 0.0, y: 0.0 };
    };
    let location = CGEvent::location(Some(&event));
    Point {
        x: location.x,
        y: location.y,
    }
}

fn mouse_event(
    event_type: CGEventType,
    position: CGPoint,
) -> kiko_driver::Result<CFRetained<CGEvent>> {
    CGEvent::new_mouse_event(
        CGEventSource::new(CGEventSourceStateID::HIDSystemState).as_deref(),
        event_type,
        position,
        CGMouseButton::Left,
    )
    .ok_or_else(|| DriverError::new(ErrorCode::Failed, "could not build a mouse event"))
}

fn stamp(event: &CGEvent, pid: i32, window: u32, click_state: i64, local: Point) {
    if let Some(set) = private::set_window_location() {
        unsafe { set(event as *const CGEvent as *mut c_void, local.x, local.y) };
    }
    field(event, CLICK_STATE, click_state);
    field(event, BUTTON_NUMBER, 0);
    field(event, SUBTYPE, TOUCH_SUBTYPE);
    field(event, WINDOW_NUMBER, window as i64);
    field(event, WINDOW_UNDER_POINTER, window as i64);
    field(event, WINDOW_THAT_HANDLES, window as i64);
    field(event, TARGET_PID, pid as i64);
}

fn field(event: &CGEvent, index: u32, value: i64) {
    match private::set_integer_field() {
        Some(set) => unsafe { set(event as *const CGEvent as *mut c_void, index, value) },
        None => CGEvent::set_integer_value_field(Some(event), CGEventField(index), value),
    }
}

fn post(pid: i32, event: &CGEvent) {
    match private::post_to_pid() {
        Some(post) => unsafe { post(pid, event as *const CGEvent as *mut c_void) },
        None => CGEvent::post_to_pid(pid, Some(event)),
    }
}

fn post_key(pid: i32, event: &CGEvent) {
    if let Some(post) = private::post_to_pid() {
        authenticate(pid, event);
        unsafe { post(pid, event as *const CGEvent as *mut c_void) };
    } else {
        CGEvent::post_to_pid(pid, Some(event));
    }
}

fn authenticate(pid: i32, event: &CGEvent) {
    let Some(class) = AnyClass::get(c"SLSEventAuthenticationMessage") else {
        return;
    };
    let selector = Sel::register(c"messageWithEventRecord:pid:version:");
    if !class.responds_to(selector) {
        return;
    }
    let Some(set) = private::set_authentication_message() else {
        return;
    };
    let record = event_record(event);
    if record.is_null() {
        return;
    }
    let message: *mut AnyObject =
        unsafe { objc2::msg_send![class, messageWithEventRecord: record, pid: pid, version: 0u32] };
    if message.is_null() {
        return;
    }
    unsafe { set(event as *const CGEvent as *mut c_void, message.cast()) };
}

fn event_record(event: &CGEvent) -> *mut c_void {
    for offset in [24usize, 32, 16] {
        let slot = unsafe {
            (event as *const CGEvent as *const u8)
                .add(offset)
                .cast::<*mut c_void>()
        };
        let record = unsafe { std::ptr::read_unaligned(slot) };
        if !record.is_null() {
            return record;
        }
    }
    std::ptr::null_mut()
}

fn split(keys: &str) -> kiko_driver::Result<(&str, Vec<String>)> {
    let parts: Vec<&str> = keys
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();
    let Some((key, modifiers)) = parts.split_last() else {
        return Err(DriverError::new(ErrorCode::Unsupported, "no key was named"));
    };
    Ok((
        key,
        modifiers.iter().map(|part| part.to_lowercase()).collect(),
    ))
}

fn modifier_flags(modifiers: &[String]) -> CGEventFlags {
    let mut flags = CGEventFlags::empty();
    for modifier in modifiers {
        flags |= match modifier.as_str() {
            "cmd" | "command" | "meta" | "super" => CGEventFlags::MaskCommand,
            "shift" => CGEventFlags::MaskShift,
            "alt" | "option" | "opt" => CGEventFlags::MaskAlternate,
            "ctrl" | "control" => CGEventFlags::MaskControl,
            "fn" => CGEventFlags::MaskSecondaryFn,
            _ => CGEventFlags::empty(),
        };
    }
    flags
}

fn key_code(key: &str) -> Option<u16> {
    let lower = key.to_lowercase();
    let named = match lower.as_str() {
        "return" | "enter" => 0x24,
        "tab" => 0x30,
        "space" => 0x31,
        "delete" | "backspace" => 0x33,
        "escape" | "esc" => 0x35,
        "home" => 0x73,
        "end" => 0x77,
        "pageup" | "page_up" => 0x74,
        "pagedown" | "page_down" => 0x79,
        "forwarddelete" | "forward_delete" => 0x75,
        "left" | "arrowleft" | "arrow_left" => 0x7B,
        "right" | "arrowright" | "arrow_right" => 0x7C,
        "down" | "arrowdown" | "arrow_down" => 0x7D,
        "up" | "arrowup" | "arrow_up" => 0x7E,
        "f1" => 0x7A,
        "f2" => 0x78,
        "f3" => 0x63,
        "f4" => 0x76,
        "f5" => 0x60,
        "f6" => 0x61,
        "f7" => 0x62,
        "f8" => 0x64,
        "f9" => 0x65,
        "f10" => 0x6D,
        "f11" => 0x67,
        "f12" => 0x6F,
        _ => letter_or_digit(&lower)?,
    };
    Some(named)
}

fn letter_or_digit(key: &str) -> Option<u16> {
    let mut characters = key.chars();
    let character = characters.next()?;
    if characters.next().is_some() {
        return None;
    }
    Some(match character {
        'a' => 0x00,
        's' => 0x01,
        'd' => 0x02,
        'f' => 0x03,
        'h' => 0x04,
        'g' => 0x05,
        'z' => 0x06,
        'x' => 0x07,
        'c' => 0x08,
        'v' => 0x09,
        'b' => 0x0B,
        'q' => 0x0C,
        'w' => 0x0D,
        'e' => 0x0E,
        'r' => 0x0F,
        'y' => 0x10,
        't' => 0x11,
        '1' => 0x12,
        '2' => 0x13,
        '3' => 0x14,
        '4' => 0x15,
        '6' => 0x16,
        '5' => 0x17,
        '9' => 0x19,
        '7' => 0x1A,
        '8' => 0x1C,
        '0' => 0x1D,
        'o' => 0x1F,
        'u' => 0x20,
        'i' => 0x22,
        'p' => 0x23,
        'l' => 0x25,
        'j' => 0x26,
        'k' => 0x28,
        'n' => 0x2D,
        'm' => 0x2E,
        ',' => 0x2B,
        '.' => 0x2F,
        '/' => 0x2C,
        ';' => 0x29,
        '\'' => 0x27,
        '[' => 0x21,
        ']' => 0x1E,
        '\\' => 0x2A,
        '-' => 0x1B,
        '=' => 0x18,
        '`' => 0x32,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_letters_digits_and_editing_keys() {
        assert_eq!(key_code("a"), Some(0x00));
        assert_eq!(key_code("Z"), Some(0x06));
        assert_eq!(key_code("1"), Some(0x12));
        assert_eq!(key_code("return"), Some(0x24));
        assert_eq!(key_code("ArrowDown"), Some(0x7D));
        assert_eq!(key_code("f12"), Some(0x6F));
        assert_eq!(key_code("nonesuch"), None);
        assert_eq!(key_code("ab"), None);
    }

    #[test]
    fn splits_a_chord_into_key_and_modifiers() {
        let (key, modifiers) = split("cmd+shift+t").expect("a chord");
        assert_eq!(key, "t");
        assert_eq!(modifiers, vec!["cmd".to_string(), "shift".to_string()]);
        assert!(modifier_flags(&modifiers).contains(CGEventFlags::MaskCommand));
        assert!(modifier_flags(&modifiers).contains(CGEventFlags::MaskShift));
    }
}
