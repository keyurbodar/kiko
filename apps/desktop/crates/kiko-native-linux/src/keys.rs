pub(crate) const SHIFT: u32 = 0xffe1;

const MODIFIERS: &[(&str, u32)] = &[
    ("ctrl", 0xffe3),
    ("control", 0xffe3),
    ("shift", 0xffe1),
    ("alt", 0xffe9),
    ("super", 0xffeb),
    ("meta", 0xffeb),
    ("win", 0xffeb),
    ("cmd", 0xffeb),
];

const NAMED: &[(&str, u32)] = &[
    ("Return", 0xff0d),
    ("Enter", 0xff8d),
    ("Tab", 0xff09),
    ("ISO_Left_Tab", 0xfe20),
    ("Escape", 0xff1b),
    ("Esc", 0xff1b),
    ("BackSpace", 0xff08),
    ("Delete", 0xffff),
    ("Insert", 0xff63),
    ("Home", 0xff50),
    ("End", 0xff57),
    ("Page_Up", 0xff55),
    ("Page_Down", 0xff56),
    ("Prior", 0xff55),
    ("Next", 0xff56),
    ("Left", 0xff51),
    ("Up", 0xff52),
    ("Right", 0xff53),
    ("Down", 0xff54),
    ("Space", 0x0020),
    ("Menu", 0xff67),
    ("F1", 0xffbe),
    ("F2", 0xffbf),
    ("F3", 0xffc0),
    ("F4", 0xffc1),
    ("F5", 0xffc2),
    ("F6", 0xffc3),
    ("F7", 0xffc4),
    ("F8", 0xffc5),
    ("F9", 0xffc6),
    ("F10", 0xffc7),
    ("F11", 0xffc8),
    ("F12", 0xffc9),
];

pub(crate) fn modifier(token: &str) -> Option<u32> {
    let token = token.to_lowercase();
    MODIFIERS
        .iter()
        .find(|(name, _)| *name == token)
        .map(|(_, keysym)| *keysym)
}

pub(crate) fn named(token: &str) -> Option<u32> {
    NAMED
        .iter()
        .find(|(name, _)| *name == token)
        .map(|(_, keysym)| *keysym)
}

pub(crate) fn character(character: char) -> u32 {
    match character {
        '\n' | '\r' => 0xff0d,
        '\t' => 0xff09,
        '\u{8}' => 0xff08,
        '\u{1b}' => 0xff1b,
        character if (character as u32) <= 0xff => character as u32,
        character => 0x0100_0000 + character as u32,
    }
}

pub(crate) struct Chord {
    pub modifiers: Vec<u32>,
    pub key: u32,
}

pub(crate) fn chords(spec: &str) -> Result<Vec<Chord>, String> {
    let mut chords = Vec::new();
    for combo in spec.split_whitespace() {
        let mut modifiers = Vec::new();
        let mut key = None;
        for token in combo.split('+').filter(|token| !token.is_empty()) {
            match modifier(token) {
                Some(keysym) => modifiers.push(keysym),
                None => key = Some(key_keysym(token)?),
            }
        }
        chords.push(Chord {
            modifiers,
            key: key.ok_or_else(|| format!("{combo:?} names no key"))?,
        });
    }
    if chords.is_empty() {
        return Err("no keys were given".to_string());
    }
    Ok(chords)
}

fn key_keysym(token: &str) -> Result<u32, String> {
    if let Some(keysym) = named(token) {
        return Ok(keysym);
    }
    let mut characters = token.chars();
    let letter = characters
        .next()
        .ok_or_else(|| "empty key name".to_string())?;
    if characters.next().is_some() {
        return Err(format!("{token:?} is not a key name"));
    }
    Ok(character(letter))
}

#[cfg(test)]
mod tests {
    use super::{character, chords, named};

    #[test]
    fn parses_chords_with_modifiers() {
        let parsed = chords("ctrl+shift+t").expect("chord");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].modifiers, vec![0xffe3, 0xffe1]);
        assert_eq!(parsed[0].key, u32::from(b't'));
    }

    #[test]
    fn parses_named_keys_and_several_chords() {
        let parsed = chords("Return ctrl+a").expect("chords");
        assert_eq!(parsed[0].key, 0xff0d);
        assert!(parsed[0].modifiers.is_empty());
        assert_eq!(parsed[1].modifiers, vec![0xffe3]);
    }

    #[test]
    fn rejects_multi_character_key_names() {
        assert!(chords("ctrl+hello").is_err());
    }

    #[test]
    fn maps_characters_to_keysyms() {
        assert_eq!(character('a'), u32::from(b'a'));
        assert_eq!(character('é'), 0xe9);
        assert_eq!(character('→'), 0x0100_2192);
        assert_eq!(character('\n'), named("Return").unwrap());
    }
}
