use kiko_driver::{DriverError, ErrorCode, Result};
use serde_json::json;

use crate::cdp::Link;

const ALT: u32 = 1;
const CTRL: u32 = 2;
const META: u32 = 4;
const SHIFT: u32 = 8;

pub struct Stroke {
    pub key: String,
    pub code: String,
    pub key_code: u32,
    pub text: Option<String>,
    pub modifiers: u32,
}

fn named(name: &str) -> Option<(&'static str, &'static str, u32, Option<&'static str>)> {
    let stroke = match name {
        "enter" | "return" => ("Enter", "Enter", 13, Some("\r")),
        "tab" => ("Tab", "Tab", 9, None),
        "escape" | "esc" => ("Escape", "Escape", 27, None),
        "backspace" => ("Backspace", "Backspace", 8, None),
        "delete" | "del" => ("Delete", "Delete", 46, None),
        "insert" => ("Insert", "Insert", 45, None),
        "space" | "spacebar" => (" ", "Space", 32, Some(" ")),
        "up" | "arrowup" => ("ArrowUp", "ArrowUp", 38, None),
        "down" | "arrowdown" => ("ArrowDown", "ArrowDown", 40, None),
        "left" | "arrowleft" => ("ArrowLeft", "ArrowLeft", 37, None),
        "right" | "arrowright" => ("ArrowRight", "ArrowRight", 39, None),
        "home" => ("Home", "Home", 36, None),
        "end" => ("End", "End", 35, None),
        "pageup" | "pgup" => ("PageUp", "PageUp", 33, None),
        "pagedown" | "pgdn" => ("PageDown", "PageDown", 34, None),
        "f1" => ("F1", "F1", 112, None),
        "f2" => ("F2", "F2", 113, None),
        "f3" => ("F3", "F3", 114, None),
        "f4" => ("F4", "F4", 115, None),
        "f5" => ("F5", "F5", 116, None),
        "f6" => ("F6", "F6", 117, None),
        "f7" => ("F7", "F7", 118, None),
        "f8" => ("F8", "F8", 119, None),
        "f9" => ("F9", "F9", 120, None),
        "f10" => ("F10", "F10", 121, None),
        "f11" => ("F11", "F11", 122, None),
        "f12" => ("F12", "F12", 123, None),
        _ => return None,
    };
    Some(stroke)
}

fn typed(character: char) -> (String, u32) {
    if character.is_ascii_alphabetic() {
        (
            format!("Key{}", character.to_ascii_uppercase()),
            u32::from(character.to_ascii_uppercase()),
        )
    } else if character.is_ascii_digit() {
        (format!("Digit{character}"), u32::from(character))
    } else {
        (String::new(), u32::from(character))
    }
}

pub fn parse(spec: &str) -> Result<Stroke> {
    let spec = spec.trim();
    if spec.is_empty() {
        return Err(DriverError::new(
            ErrorCode::Failed,
            "press_key needs a key such as Enter or ctrl+a",
        ));
    }
    let parts: Vec<&str> = spec.split('+').map(str::trim).collect();
    let mut modifiers = 0;
    let mut index = 0;
    while index + 1 < parts.len() {
        match parts[index].to_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= CTRL,
            "alt" | "option" => modifiers |= ALT,
            "shift" => modifiers |= SHIFT,
            "cmd" | "command" | "meta" | "super" | "win" => modifiers |= META,
            _ => break,
        }
        index += 1;
    }
    let key = parts[index..].join("+").to_lowercase();
    let typing = modifiers & (CTRL | ALT | META) == 0;
    if let Some((key, code, key_code, text)) = named(&key) {
        let text = text.filter(|_| typing).map(str::to_string);
        return Ok(Stroke {
            key: key.into(),
            code: code.into(),
            key_code,
            text,
            modifiers,
        });
    }
    let mut characters = key.chars();
    if let (Some(character), None) = (characters.next(), characters.next()) {
        let (code, key_code) = typed(character);
        let text = typing.then(|| character.to_string());
        let key = if modifiers & SHIFT != 0 {
            character.to_ascii_uppercase().to_string()
        } else {
            character.to_string()
        };
        return Ok(Stroke {
            key,
            code,
            key_code,
            text,
            modifiers,
        });
    }
    Err(DriverError::new(
        ErrorCode::Failed,
        format!("{spec} is not a key"),
    ))
}

pub async fn press(link: &Link, session: &str, spec: &str) -> Result<()> {
    let stroke = parse(spec)?;
    let mut down = json!({
        "type": "keyDown",
        "key": stroke.key,
        "code": stroke.code,
        "windowsVirtualKeyCode": stroke.key_code,
        "nativeVirtualKeyCode": stroke.key_code,
        "modifiers": stroke.modifiers,
    });
    if let Some(text) = stroke.text.as_ref() {
        down["text"] = json!(text);
        down["unmodifiedText"] = json!(text);
    }
    link.send_to(session, "Input.dispatchKeyEvent", down)
        .await?;
    let up = json!({
        "type": "keyUp",
        "key": stroke.key,
        "code": stroke.code,
        "windowsVirtualKeyCode": stroke.key_code,
        "nativeVirtualKeyCode": stroke.key_code,
        "modifiers": stroke.modifiers,
    });
    link.send_to(session, "Input.dispatchKeyEvent", up).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_plain_key() {
        let stroke = parse("Enter").unwrap();
        assert_eq!(stroke.key, "Enter");
        assert_eq!(stroke.code, "Enter");
        assert_eq!(stroke.key_code, 13);
        assert_eq!(stroke.text.as_deref(), Some("\r"));
        assert_eq!(stroke.modifiers, 0);
    }

    #[test]
    fn reads_a_chord_without_text() {
        let stroke = parse("ctrl+a").unwrap();
        assert_eq!(stroke.key, "a");
        assert_eq!(stroke.code, "KeyA");
        assert_eq!(stroke.modifiers, CTRL);
        assert!(stroke.text.is_none());
    }

    #[test]
    fn reads_shift_tab() {
        let stroke = parse("shift+Tab").unwrap();
        assert_eq!(stroke.key, "Tab");
        assert_eq!(stroke.modifiers, SHIFT);
    }

    #[test]
    fn refuses_a_key_it_does_not_know() {
        assert!(parse("hyper+banana").is_err());
        assert!(parse("").is_err());
    }
}
