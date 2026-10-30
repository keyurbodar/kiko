use kiko_driver::{DriverError, ErrorCode, Route};
use objc2_application_services::{AXError, AXUIElement};

use crate::ax;

const MENU_BAR: &str = "AXMenuBar";
const CMD_CHAR: &str = "AXMenuItemCmdChar";
const CMD_MODIFIERS: &str = "AXMenuItemCmdModifiers";
const MOD_SHIFT: i64 = 1 << 0;
const MOD_OPTION: i64 = 1 << 1;
const MOD_CONTROL: i64 = 1 << 2;
const MOD_NO_COMMAND: i64 = 1 << 3;
const MAX_ITEMS: usize = 2000;
const MAX_DEPTH: usize = 3;

pub struct Combo {
    shift: bool,
    option: bool,
    control: bool,
    character: String,
}

impl Combo {
    pub fn parse(key: &str, modifiers: &[String]) -> Option<Self> {
        let mut command = false;
        let mut combo = Self {
            shift: false,
            option: false,
            control: false,
            character: String::new(),
        };
        for modifier in modifiers {
            match modifier.as_str() {
                "cmd" | "command" | "meta" | "super" => command = true,
                "shift" => combo.shift = true,
                "alt" | "option" | "opt" => combo.option = true,
                "ctrl" | "control" => combo.control = true,
                _ => return None,
            }
        }
        let mut characters = key.chars();
        let (Some(character), None) = (characters.next(), characters.next()) else {
            return None;
        };
        if !command || character.is_whitespace() || character.is_control() {
            return None;
        }
        combo.character = character.to_uppercase().collect();
        Some(combo)
    }

    fn matches(&self, cmd_char: &str, modifiers: i64) -> bool {
        modifiers & MOD_NO_COMMAND == 0
            && cmd_char.to_uppercase() == self.character
            && (modifiers & MOD_SHIFT != 0) == self.shift
            && (modifiers & MOD_OPTION != 0) == self.option
            && (modifiers & MOD_CONTROL != 0) == self.control
    }
}

pub fn invoke(pid: i32, combo: &Combo) -> Option<kiko_driver::Result<Route>> {
    let application = ax::application(pid);
    let menu_bar = ax::element_attribute(&application, MENU_BAR)?;
    let mut budget = MAX_ITEMS;
    let item = find(&menu_bar, combo, 0, &mut budget)?;
    if ax::flag(&ax::attribute(&item, ax::ENABLED)) == Some(false) {
        return Some(Err(DriverError::new(
            ErrorCode::BackgroundUnavailable,
            "macOS keeps that menu item disabled while the app is in the background; use foreground mode",
        )));
    }
    if ax::perform(&item, "AXPress") == AXError::Success {
        return Some(Ok(Route::Accessibility));
    }
    Some(Err(DriverError::new(
        ErrorCode::BackgroundUnavailable,
        "the menu item would not run in the background; use foreground mode",
    )))
}

fn find(
    parent: &AXUIElement,
    combo: &Combo,
    depth: usize,
    budget: &mut usize,
) -> Option<ax::Element> {
    let mut disabled = None;
    for child in ax::children(parent) {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        let values = ax::attributes(&child, &[CMD_CHAR, CMD_MODIFIERS, ax::ENABLED]);
        let cmd_char = ax::text(&values[0]).unwrap_or_default();
        if !cmd_char.is_empty() {
            let modifiers = ax::number(&values[1]).unwrap_or(0);
            if combo.matches(&cmd_char, modifiers) {
                if ax::flag(&values[2]) != Some(false) {
                    return Some(child);
                }
                disabled.get_or_insert(child);
            }
            continue;
        }
        if depth < MAX_DEPTH
            && let Some(found) = find(&child, combo, depth + 1, budget)
        {
            return Some(found);
        }
    }
    disabled
}

#[cfg(test)]
mod tests {
    use super::*;

    fn combo(modifiers: &[&str], key: &str) -> Option<Combo> {
        let modifiers: Vec<String> = modifiers.iter().map(|m| m.to_string()).collect();
        Combo::parse(key, &modifiers)
    }

    #[test]
    fn only_command_combos_with_one_printable_key_are_menu_candidates() {
        assert!(combo(&["cmd"], "a").is_some());
        assert!(combo(&["command", "shift"], "T").is_some());
        assert!(combo(&["ctrl"], "a").is_none());
        assert!(combo(&["cmd"], "return").is_none());
        assert!(combo(&["cmd"], "down").is_none());
    }

    #[test]
    fn modifiers_must_match_exactly() {
        let select_all = combo(&["cmd"], "a").expect("cmd+a");
        assert!(select_all.matches("A", 0));
        assert!(select_all.matches("a", 0));
        assert!(!select_all.matches("A", MOD_SHIFT));
        assert!(!select_all.matches("A", MOD_NO_COMMAND));
        assert!(!select_all.matches("S", 0));
    }
}
