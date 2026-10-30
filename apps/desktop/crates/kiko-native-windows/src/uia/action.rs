use std::collections::HashMap;

use kiko_driver::Result;
use kiko_driver::api::{Action, Mode, Point, Route};
use windows::Win32::UI::Accessibility::{
    IUIAutomationElement, IUIAutomationExpandCollapsePattern, IUIAutomationInvokePattern,
    IUIAutomationLegacyIAccessiblePattern, IUIAutomationScrollItemPattern,
    IUIAutomationScrollPattern, IUIAutomationSelectionItemPattern, IUIAutomationTogglePattern,
    IUIAutomationValuePattern, ScrollAmount, ScrollAmount_LargeDecrement,
    ScrollAmount_LargeIncrement, ScrollAmount_NoAmount, UIA_ExpandCollapsePatternId,
    UIA_InvokePatternId, UIA_LegacyIAccessiblePatternId, UIA_ScrollItemPatternId,
    UIA_ScrollPatternId, UIA_SelectionItemPatternId, UIA_TogglePatternId, UIA_ValuePatternId,
};
use windows::core::{BSTR, Interface};

use super::{
    OwnedAct, Table, center, failed, native_handle, pointer, route, target, unavailable,
    unsupported,
};

pub enum Outcome {
    Route(Route),
    Native { hwnd: isize, screen: Point },
    Text { hwnd: isize, text: String },
    Pointer { hwnd: isize, screen: Point },
}

pub fn perform(tables: &HashMap<isize, Table>, request: &OwnedAct) -> Result<Outcome> {
    let element = target(tables, request)?;
    match request.mode {
        Mode::Background => background(element, request),
        Mode::Foreground => foreground(element, request),
    }
}

fn background(element: &IUIAutomationElement, request: &OwnedAct) -> Result<Outcome> {
    match request.action {
        Action::Press | Action::Toggle | Action::Select | Action::Expand | Action::Collapse
            if legacy(element) =>
        {
            native(element, request.window)
        }
        Action::Press => press(element, request.window),
        Action::Toggle => toggle(element),
        Action::SetValue if legacy(element) => {
            text_outcome(element, request.text.as_deref().unwrap_or_default())
        }
        Action::SetValue => set_value(element, request.text.as_deref()),
        Action::Type if legacy(element) => text_outcome(element, &legacy_text(element, request)),
        Action::Type => type_text(element, request),
        Action::Key => native(element, request.window),
        Action::Scroll => scroll(element, request.dx, request.dy),
        Action::Select => select(element),
        Action::Expand => expand(element, true),
        Action::Collapse => expand(element, false),
        Action::ShowMenu => Err(unavailable(
            "show_menu needs the screen; retry with mode foreground",
        )),
        Action::Focus => Err(unavailable(
            "focus moves the owner's keyboard focus; retry with mode foreground",
        )),
        Action::Raise => Err(unavailable(
            "raise would move the window; retry with mode foreground",
        )),
    }
}

fn foreground(element: &IUIAutomationElement, request: &OwnedAct) -> Result<Outcome> {
    match request.action {
        Action::SetValue | Action::Type => match set_value(element, request.text.as_deref()) {
            Ok(outcome) => Ok(outcome),
            Err(_) => pointer(element, request.window),
        },
        Action::Focus => {
            unsafe {
                element
                    .SetFocus()
                    .map_err(|error| failed("SetFocus", error))?
            };
            route(Route::Accessibility)
        }
        Action::Key | Action::ShowMenu | Action::Scroll => pointer(element, request.window),
        _ => primary(element, request),
    }
}

fn primary(element: &IUIAutomationElement, request: &OwnedAct) -> Result<Outcome> {
    let outcome = match request.action {
        Action::Press => press(element, request.window),
        Action::Toggle => toggle(element),
        Action::Select => select(element),
        Action::Expand => expand(element, true),
        Action::Collapse => expand(element, false),
        _ => return pointer(element, request.window),
    };
    match outcome {
        Ok(Outcome::Route(route)) => Ok(Outcome::Route(route)),
        _ => pointer(element, request.window),
    }
}

fn legacy(element: &IUIAutomationElement) -> bool {
    unsafe { element.CurrentFrameworkId() }
        .map(|framework| framework.to_string().eq_ignore_ascii_case("Win32"))
        .unwrap_or(false)
}

fn legacy_text(element: &IUIAutomationElement, request: &OwnedAct) -> String {
    let current =
        unsafe { element.GetCachedPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) }
            .ok()
            .and_then(|pattern| unsafe { pattern.CachedValue() }.ok())
            .map(|value| value.to_string())
            .unwrap_or_default();
    format!("{current}{}", request.text.as_deref().unwrap_or_default())
}

fn text_outcome(element: &IUIAutomationElement, text: &str) -> Result<Outcome> {
    let hwnd = native_handle(element)
        .ok_or_else(|| unsupported("this element has no window that accepts posted text"))?;
    Ok(Outcome::Text {
        hwnd,
        text: text.to_string(),
    })
}

fn native(element: &IUIAutomationElement, window: isize) -> Result<Outcome> {
    let screen = center(element).unwrap_or(Point { x: 0.0, y: 0.0 });
    Ok(Outcome::Native {
        hwnd: native_handle(element).unwrap_or(window),
        screen,
    })
}

fn press(element: &IUIAutomationElement, window: isize) -> Result<Outcome> {
    unsafe {
        if let Ok(pattern) = element.GetCurrentPattern(UIA_InvokePatternId)
            && let Ok(invoke) = pattern.cast::<IUIAutomationInvokePattern>()
        {
            invoke.Invoke().map_err(|error| failed("Invoke", error))?;
            return route(Route::Accessibility);
        }
        if let Ok(pattern) = element.GetCurrentPattern(UIA_LegacyIAccessiblePatternId)
            && let Ok(legacy) = pattern.cast::<IUIAutomationLegacyIAccessiblePattern>()
            && legacy
                .CurrentDefaultAction()
                .map(|value| !value.is_empty())
                .unwrap_or(false)
        {
            legacy
                .DoDefaultAction()
                .map_err(|error| failed("DoDefaultAction", error))?;
            return route(Route::Accessibility);
        }
    }
    let Some(screen) = center(element) else {
        return Err(unsupported("this element has no press action"));
    };
    Ok(Outcome::Native {
        hwnd: native_handle(element).unwrap_or(window),
        screen,
    })
}

fn toggle(element: &IUIAutomationElement) -> Result<Outcome> {
    let pattern =
        unsafe { element.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId) }
            .map_err(|_| unsupported("this element has no toggle action"))?;
    unsafe { pattern.Toggle().map_err(|error| failed("Toggle", error))? };
    route(Route::Accessibility)
}

fn select(element: &IUIAutomationElement) -> Result<Outcome> {
    let pattern = unsafe {
        element.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
    }
    .map_err(|_| unsupported("this element has no select action"))?;
    unsafe { pattern.Select().map_err(|error| failed("Select", error))? };
    route(Route::Accessibility)
}

fn expand(element: &IUIAutomationElement, open: bool) -> Result<Outcome> {
    let pattern = unsafe {
        element
            .GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId)
    }
    .map_err(|_| unsupported("this element cannot expand or collapse"))?;
    unsafe {
        let result = if open {
            pattern.Expand()
        } else {
            pattern.Collapse()
        };
        result.map_err(|error| failed("ExpandCollapse", error))?;
    }
    route(Route::Accessibility)
}

fn set_value(element: &IUIAutomationElement, text: Option<&str>) -> Result<Outcome> {
    let text = text.unwrap_or_default();
    let pattern =
        unsafe { element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) }
            .map_err(|_| unsupported("this element has no value to set"))?;
    let read_only = unsafe { pattern.CurrentIsReadOnly() }
        .map(|value| value.as_bool())
        .unwrap_or(false);
    if read_only {
        return Err(unsupported("this element's value is read-only"));
    }
    unsafe {
        pattern
            .SetValue(&BSTR::from(text))
            .map_err(|error| failed("SetValue", error))?
    };
    route(Route::Accessibility)
}

fn type_text(element: &IUIAutomationElement, request: &OwnedAct) -> Result<Outcome> {
    let text = request.text.as_deref().unwrap_or_default();
    let pattern =
        unsafe { element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) };
    if let Ok(pattern) = pattern {
        let read_only = unsafe { pattern.CurrentIsReadOnly() }
            .map(|value| value.as_bool())
            .unwrap_or(false);
        if !read_only {
            let current = unsafe { pattern.CurrentValue() }
                .map(|value| value.to_string())
                .unwrap_or_default();
            unsafe {
                pattern
                    .SetValue(&BSTR::from(format!("{current}{text}")))
                    .map_err(|error| failed("SetValue", error))?;
            }
            return route(Route::Accessibility);
        }
    }
    native(element, request.window)
}

fn amount(delta: f64) -> ScrollAmount {
    if delta > 0.0 {
        ScrollAmount_LargeIncrement
    } else if delta < 0.0 {
        ScrollAmount_LargeDecrement
    } else {
        ScrollAmount_NoAmount
    }
}

fn scroll(element: &IUIAutomationElement, dx: f64, dy: f64) -> Result<Outcome> {
    if (dx != 0.0 || dy != 0.0)
        && let Ok(pattern) = unsafe {
            element.GetCurrentPatternAs::<IUIAutomationScrollPattern>(UIA_ScrollPatternId)
        }
    {
        unsafe {
            pattern
                .Scroll(amount(dx), amount(dy))
                .map_err(|error| failed("Scroll", error))?
        };
        return route(Route::Accessibility);
    }
    if let Ok(pattern) = unsafe {
        element.GetCurrentPatternAs::<IUIAutomationScrollItemPattern>(UIA_ScrollItemPatternId)
    } {
        unsafe {
            pattern
                .ScrollIntoView()
                .map_err(|error| failed("ScrollIntoView", error))?
        };
        return route(Route::Accessibility);
    }
    Err(unavailable(
        "this element cannot scroll; retry with mode foreground",
    ))
}
