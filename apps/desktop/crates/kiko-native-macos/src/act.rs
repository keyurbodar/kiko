use kiko_driver::{Action, DriverError, ErrorCode, Route};
use objc2_application_services::{AXError, AXUIElement};
use objc2_core_foundation::{CFBoolean, CFNumber};

use crate::ax;

const VERTICAL_SCROLL_BAR: &str = "AXVerticalScrollBar";
const HORIZONTAL_SCROLL_BAR: &str = "AXHorizontalScrollBar";

pub fn apply(
    element: &AXUIElement,
    action: Action,
    text: Option<&str>,
    dx: f64,
    dy: f64,
) -> kiko_driver::Result<Route> {
    match action {
        Action::Press => perform(element, "AXPress"),
        Action::ShowMenu => perform(element, "AXShowMenu"),
        Action::SetValue => set_value(element, text.unwrap_or_default()),
        Action::Type => type_text(element, text.unwrap_or_default()),
        Action::Select => select(element),
        Action::Toggle => toggle(element),
        Action::Expand => set_flag(element, ax::EXPANDED, true, "expand"),
        Action::Collapse => set_flag(element, ax::EXPANDED, false, "collapse"),
        Action::Focus => set_flag(element, ax::FOCUSED, true, "focus"),
        Action::Scroll => scroll(element, dx, dy),
        Action::Raise | Action::Key => Err(needs_screen(action)),
    }
}

fn perform(element: &AXUIElement, name: &str) -> kiko_driver::Result<Route> {
    if ax::perform(element, name) == AXError::Success {
        return Ok(Route::Accessibility);
    }
    Err(DriverError::new(
        ErrorCode::BackgroundUnavailable,
        format!("this element does not answer {name} in the background; use foreground mode"),
    ))
}

fn set_value(element: &AXUIElement, text: &str) -> kiko_driver::Result<Route> {
    if ax::set_text(element, ax::VALUE, text) == AXError::Success {
        return Ok(Route::Accessibility);
    }
    if let Ok(number) = text.parse::<f64>()
        && ax::set(element, ax::VALUE, &CFNumber::new_f64(number)) == AXError::Success
    {
        return Ok(Route::Accessibility);
    }
    Err(DriverError::new(
        ErrorCode::BackgroundUnavailable,
        "this element will not take a value in the background; use foreground mode",
    ))
}

fn type_text(element: &AXUIElement, text: &str) -> kiko_driver::Result<Route> {
    if ax::set_text(element, ax::SELECTED_TEXT, text) == AXError::Success {
        return Ok(Route::Accessibility);
    }
    let current = ax::text(&ax::attribute(element, ax::VALUE)).unwrap_or_default();
    if ax::set_text(element, ax::VALUE, &format!("{current}{text}")) == AXError::Success {
        return Ok(Route::Accessibility);
    }
    Err(DriverError::new(
        ErrorCode::BackgroundUnavailable,
        "this element will not take typed text in the background; use foreground mode",
    ))
}

fn select(element: &AXUIElement) -> kiko_driver::Result<Route> {
    if ax::set_flag(element, ax::SELECTED, true) == AXError::Success {
        return Ok(Route::Accessibility);
    }
    perform(element, "AXPress")
}

fn toggle(element: &AXUIElement) -> kiko_driver::Result<Route> {
    if let Some(current) = ax::flag(&ax::attribute(element, ax::VALUE))
        && ax::set(element, ax::VALUE, CFBoolean::new(!current)) == AXError::Success
    {
        return Ok(Route::Accessibility);
    }
    perform(element, "AXPress")
}

fn set_flag(
    element: &AXUIElement,
    name: &str,
    value: bool,
    verb: &str,
) -> kiko_driver::Result<Route> {
    if ax::set_flag(element, name, value) == AXError::Success {
        return Ok(Route::Accessibility);
    }
    Err(DriverError::new(
        ErrorCode::BackgroundUnavailable,
        format!("this element cannot {verb} in the background; use foreground mode"),
    ))
}

fn scroll(element: &AXUIElement, dx: f64, dy: f64) -> kiko_driver::Result<Route> {
    if ax::perform(element, "AXScrollToVisible") == AXError::Success {
        return Ok(Route::Accessibility);
    }
    let bars = if dy.abs() >= dx.abs() {
        [VERTICAL_SCROLL_BAR, HORIZONTAL_SCROLL_BAR]
    } else {
        [HORIZONTAL_SCROLL_BAR, VERTICAL_SCROLL_BAR]
    };
    let delta = if dy.abs() >= dx.abs() { dy } else { dx };
    for name in bars {
        let Some(bar) = ax::attribute(element, name).and_then(|value| {
            let bar = value.downcast_ref::<AXUIElement>()?;
            Some(unsafe { objc2_core_foundation::CFRetained::retain(std::ptr::NonNull::from(bar)) })
        }) else {
            continue;
        };
        if nudge(&bar, delta) {
            return Ok(Route::Accessibility);
        }
    }
    Err(DriverError::new(
        ErrorCode::BackgroundUnavailable,
        "this window has no scrollbar the background can move; use foreground mode",
    ))
}

fn nudge(bar: &AXUIElement, delta: f64) -> bool {
    let Some(current) = ax::attribute(bar, ax::VALUE)
        .and_then(|value| value.downcast_ref::<CFNumber>().and_then(CFNumber::as_f64))
    else {
        return false;
    };
    let target = (current + delta / 1000.0).clamp(0.0, 1.0);
    ax::set(bar, ax::VALUE, &CFNumber::new_f64(target)) == AXError::Success
}

fn needs_screen(action: Action) -> DriverError {
    let what = match action {
        Action::Raise => "raising a window",
        _ => "sending keys",
    };
    DriverError::new(
        ErrorCode::BackgroundUnavailable,
        format!("{what} needs the screen; use foreground mode"),
    )
}
