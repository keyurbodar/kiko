use kiko_driver::{DriverError, ErrorCode, Result};

const MODIFIERS: &[(&str, &str)] = &[
    ("cmd", "MetaLeft"),
    ("command", "MetaLeft"),
    ("meta", "MetaLeft"),
    ("super", "MetaLeft"),
    ("win", "MetaLeft"),
    ("ctrl", "ControlLeft"),
    ("control", "ControlLeft"),
    ("alt", "AltLeft"),
    ("option", "AltLeft"),
    ("opt", "AltLeft"),
    ("shift", "ShiftLeft"),
];

const PUNCTUATION: &[(&str, &str)] = &[
    ("-", "Minus"),
    ("=", "Equal"),
    ("[", "BracketLeft"),
    ("]", "BracketRight"),
    ("\\", "Backslash"),
    (";", "Semicolon"),
    ("'", "Quote"),
    ("`", "Backquote"),
    (",", "Comma"),
    (".", "Period"),
    ("/", "Slash"),
];

const NAMED: &[(&str, &str)] = &[
    ("enter", "Enter"),
    ("return", "Enter"),
    ("esc", "Escape"),
    ("escape", "Escape"),
    ("tab", "Tab"),
    ("space", "Space"),
    ("backspace", "Backspace"),
    ("delete", "Delete"),
    ("del", "Delete"),
    ("up", "ArrowUp"),
    ("arrowup", "ArrowUp"),
    ("down", "ArrowDown"),
    ("arrowdown", "ArrowDown"),
    ("left", "ArrowLeft"),
    ("arrowleft", "ArrowLeft"),
    ("right", "ArrowRight"),
    ("arrowright", "ArrowRight"),
    ("home", "Home"),
    ("end", "End"),
    ("pageup", "PageUp"),
    ("pagedown", "PageDown"),
    ("insert", "Insert"),
];

const SCAN: &[(&str, u16)] = &[
    ("Escape", 0x01),
    ("Digit1", 0x02),
    ("Digit2", 0x03),
    ("Digit3", 0x04),
    ("Digit4", 0x05),
    ("Digit5", 0x06),
    ("Digit6", 0x07),
    ("Digit7", 0x08),
    ("Digit8", 0x09),
    ("Digit9", 0x0a),
    ("Digit0", 0x0b),
    ("Minus", 0x0c),
    ("Equal", 0x0d),
    ("Backspace", 0x0e),
    ("Tab", 0x0f),
    ("KeyQ", 0x10),
    ("KeyW", 0x11),
    ("KeyE", 0x12),
    ("KeyR", 0x13),
    ("KeyT", 0x14),
    ("KeyY", 0x15),
    ("KeyU", 0x16),
    ("KeyI", 0x17),
    ("KeyO", 0x18),
    ("KeyP", 0x19),
    ("BracketLeft", 0x1a),
    ("BracketRight", 0x1b),
    ("Enter", 0x1c),
    ("ControlLeft", 0x1d),
    ("KeyA", 0x1e),
    ("KeyS", 0x1f),
    ("KeyD", 0x20),
    ("KeyF", 0x21),
    ("KeyG", 0x22),
    ("KeyH", 0x23),
    ("KeyJ", 0x24),
    ("KeyK", 0x25),
    ("KeyL", 0x26),
    ("Semicolon", 0x27),
    ("Quote", 0x28),
    ("Backquote", 0x29),
    ("ShiftLeft", 0x2a),
    ("Backslash", 0x2b),
    ("KeyZ", 0x2c),
    ("KeyX", 0x2d),
    ("KeyC", 0x2e),
    ("KeyV", 0x2f),
    ("KeyB", 0x30),
    ("KeyN", 0x31),
    ("KeyM", 0x32),
    ("Comma", 0x33),
    ("Period", 0x34),
    ("Slash", 0x35),
    ("ShiftRight", 0x36),
    ("NumpadMultiply", 0x37),
    ("AltLeft", 0x38),
    ("Space", 0x39),
    ("CapsLock", 0x3a),
    ("F1", 0x3b),
    ("F2", 0x3c),
    ("F3", 0x3d),
    ("F4", 0x3e),
    ("F5", 0x3f),
    ("F6", 0x40),
    ("F7", 0x41),
    ("F8", 0x42),
    ("F9", 0x43),
    ("F10", 0x44),
    ("NumLock", 0x45),
    ("ScrollLock", 0x46),
    ("Numpad7", 0x47),
    ("Numpad8", 0x48),
    ("Numpad9", 0x49),
    ("NumpadSubtract", 0x4a),
    ("Numpad4", 0x4b),
    ("Numpad5", 0x4c),
    ("Numpad6", 0x4d),
    ("NumpadAdd", 0x4e),
    ("Numpad1", 0x4f),
    ("Numpad2", 0x50),
    ("Numpad3", 0x51),
    ("Numpad0", 0x52),
    ("NumpadDecimal", 0x53),
    ("IntlBackslash", 0x56),
    ("F11", 0x57),
    ("F12", 0x58),
    ("NumpadEnter", 0x9c),
    ("ControlRight", 0x9d),
    ("NumpadDivide", 0xb5),
    ("PrintScreen", 0xb7),
    ("AltRight", 0xb8),
    ("Home", 0xc7),
    ("ArrowUp", 0xc8),
    ("PageUp", 0xc9),
    ("ArrowLeft", 0xcb),
    ("ArrowRight", 0xcd),
    ("End", 0xcf),
    ("ArrowDown", 0xd0),
    ("PageDown", 0xd1),
    ("Insert", 0xd2),
    ("Delete", 0xd3),
    ("MetaLeft", 0xdb),
    ("MetaRight", 0xdc),
    ("ContextMenu", 0xdd),
];

const VIRTUAL_KEYS: &[(&str, u16)] = &[
    ("Escape", 0x1b),
    ("Backspace", 0x08),
    ("Tab", 0x09),
    ("Enter", 0x0d),
    ("Space", 0x20),
    ("CapsLock", 0x14),
    ("PageUp", 0x21),
    ("PageDown", 0x22),
    ("End", 0x23),
    ("Home", 0x24),
    ("ArrowLeft", 0x25),
    ("ArrowUp", 0x26),
    ("ArrowRight", 0x27),
    ("ArrowDown", 0x28),
    ("PrintScreen", 0x2c),
    ("Insert", 0x2d),
    ("Delete", 0x2e),
    ("MetaLeft", 0x5b),
    ("MetaRight", 0x5c),
    ("ContextMenu", 0x5d),
    ("ShiftLeft", 0x10),
    ("ShiftRight", 0x10),
    ("ControlLeft", 0x11),
    ("ControlRight", 0x11),
    ("AltLeft", 0x12),
    ("AltRight", 0x12),
    ("NumLock", 0x90),
    ("ScrollLock", 0x91),
    ("NumpadMultiply", 0x6a),
    ("NumpadAdd", 0x6b),
    ("NumpadSubtract", 0x6d),
    ("NumpadDecimal", 0x6e),
    ("NumpadDivide", 0x6f),
    ("Numpad0", 0x60),
    ("Numpad1", 0x61),
    ("Numpad2", 0x62),
    ("Numpad3", 0x63),
    ("Numpad4", 0x64),
    ("Numpad5", 0x65),
    ("Numpad6", 0x66),
    ("Numpad7", 0x67),
    ("Numpad8", 0x68),
    ("Numpad9", 0x69),
    ("Semicolon", 0xba),
    ("Equal", 0xbb),
    ("Comma", 0xbc),
    ("Minus", 0xbd),
    ("Period", 0xbe),
    ("Slash", 0xbf),
    ("Backquote", 0xc0),
    ("BracketLeft", 0xdb),
    ("Backslash", 0xdc),
    ("BracketRight", 0xdd),
    ("Quote", 0xde),
];

const EXTENDED: &[&str] = &[
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Insert",
    "Delete",
    "NumpadDivide",
    "NumpadEnter",
    "NumLock",
    "PrintScreen",
    "ControlRight",
    "AltRight",
    "MetaLeft",
    "MetaRight",
    "ContextMenu",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chord {
    pub mods: Vec<String>,
    pub code: String,
    pub key: String,
}

fn lookup(table: &'static [(&'static str, &'static str)], name: &str) -> Option<&'static str> {
    table
        .iter()
        .find(|(key, _)| *key == name)
        .map(|(_, value)| *value)
}

fn named(name: &str) -> Option<String> {
    if let Some(found) = lookup(NAMED, name) {
        return Some(found.to_string());
    }
    let digits = name.strip_prefix('f')?;
    let number: u8 = digits.parse().ok()?;
    (1..=24).contains(&number).then(|| format!("F{number}"))
}

fn key_code(name: &str) -> Option<String> {
    if let Some(found) = named(name) {
        return Some(found);
    }
    let mut chars = name.chars();
    if let (Some(ch), None) = (chars.next(), chars.next()) {
        if ch.is_ascii_lowercase() {
            return Some(format!("Key{}", ch.to_ascii_uppercase()));
        }
        if ch.is_ascii_digit() {
            return Some(format!("Digit{ch}"));
        }
    }
    lookup(PUNCTUATION, name).map(str::to_string)
}

fn unknown(name: &str) -> DriverError {
    DriverError::new(
        ErrorCode::Failed,
        format!("unknown key {name}; use names like cmd+l, ctrl+shift+t, enter, pagedown"),
    )
}

fn plus(mods: &[String]) -> Chord {
    let mut mods = mods.to_vec();
    if !mods.iter().any(|modifier| modifier == "ShiftLeft") {
        mods.push("ShiftLeft".into());
    }
    Chord {
        mods,
        code: "Equal".into(),
        key: "+".into(),
    }
}

fn parse_chord(token: &str) -> Result<Chord> {
    if token == "+" || token.eq_ignore_ascii_case("plus") {
        return Ok(plus(&[]));
    }
    let parts: Vec<String> = token
        .split('+')
        .map(|part| part.trim().to_ascii_lowercase())
        .filter(|part| !part.is_empty())
        .collect();
    let Some(last) = parts.last() else {
        return Err(unknown(token));
    };
    let mut mods = Vec::new();
    for part in &parts[..parts.len() - 1] {
        let Some(modifier) = lookup(MODIFIERS, part) else {
            return Err(unknown(part));
        };
        mods.push(modifier.to_string());
    }
    if last == "plus" {
        return Ok(plus(&mods));
    }
    let Some(code) = key_code(last) else {
        return Err(unknown(last));
    };
    Ok(Chord {
        mods,
        code,
        key: last.clone(),
    })
}

pub fn parse(keys: Option<&str>) -> Result<Vec<Chord>> {
    let input = keys.unwrap_or_default().trim();
    let tokens: Vec<&str> = input
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .collect();
    if tokens.is_empty() {
        return Err(unknown(""));
    }
    tokens.into_iter().map(parse_chord).collect()
}

pub fn virtual_key(code: &str, key: &str) -> u16 {
    if let Some(letter) = code.strip_prefix("Key")
        && let Some(ch) = letter.chars().next()
    {
        return ch as u16;
    }
    if let Some(digit) = code.strip_prefix("Digit")
        && let Some(ch) = digit.chars().next()
    {
        return ch as u16;
    }
    if let Some(number) = code.strip_prefix('F')
        && let Ok(value) = number.parse::<u16>()
        && (1..=24).contains(&value)
    {
        return 0x70 + value - 1;
    }
    if let Some((_, value)) = VIRTUAL_KEYS.iter().find(|(name, _)| *name == code) {
        return *value;
    }
    let mut chars = key.chars();
    if let (Some(ch), None) = (chars.next(), chars.next()) {
        let upper = ch.to_ascii_uppercase() as u32;
        if (0x20..=0x7e).contains(&upper) {
            return upper as u16;
        }
    }
    0
}

pub fn scan_code(code: &str) -> u16 {
    SCAN.iter()
        .find(|(name, _)| *name == code)
        .map(|(_, value)| *value)
        .unwrap_or(0)
}

pub fn extended(code: &str) -> bool {
    EXTENDED.contains(&code)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chord(mods: &[&str], code: &str, key: &str) -> Chord {
        Chord {
            mods: mods.iter().map(|value| value.to_string()).collect(),
            code: code.into(),
            key: key.into(),
        }
    }

    #[test]
    fn parses_modifier_chords() {
        assert_eq!(
            parse(Some("cmd+l")).unwrap(),
            vec![chord(&["MetaLeft"], "KeyL", "l")]
        );
        assert_eq!(
            parse(Some("CTRL+SHIFT+t")).unwrap(),
            vec![chord(&["ControlLeft", "ShiftLeft"], "KeyT", "t")]
        );
    }

    #[test]
    fn parses_sequences_and_named_keys() {
        assert_eq!(
            parse(Some("a z enter")).unwrap(),
            vec![
                chord(&[], "KeyA", "a"),
                chord(&[], "KeyZ", "z"),
                chord(&[], "Enter", "enter")
            ]
        );
    }

    #[test]
    fn plus_always_holds_shift() {
        assert_eq!(
            parse(Some("plus")).unwrap(),
            vec![chord(&["ShiftLeft"], "Equal", "+")]
        );
        assert_eq!(
            parse(Some("cmd+plus")).unwrap(),
            vec![chord(&["MetaLeft", "ShiftLeft"], "Equal", "+")]
        );
    }

    #[test]
    fn rejects_unknown_keys() {
        let error = parse(Some("cmd+nope")).unwrap_err();
        assert_eq!(error.code, ErrorCode::Failed);
        assert!(error.message.contains("unknown key"));
    }

    #[test]
    fn maps_codes_to_windows_key_data() {
        assert_eq!(virtual_key("KeyA", "a"), 0x41);
        assert_eq!(virtual_key("Digit7", "7"), 0x37);
        assert_eq!(virtual_key("F5", "F5"), 0x74);
        assert_eq!(virtual_key("ArrowLeft", "ArrowLeft"), 0x25);
        assert_eq!(scan_code("KeyA"), 0x1e);
        assert!(extended("ArrowLeft"));
        assert!(!extended("KeyA"));
    }
}
