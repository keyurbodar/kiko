use std::collections::HashMap;

use kiko_driver::Result;
use kiko_driver::api::{Action, Mode, Point, Route};
use windows::Win32::UI::Accessibility::{
    IUIAutomationElement, IUIAutomationExpandCollapsePattern, IUIAutomationInvokePattern,
    IUIAutomationLegacyIAccessiblePattern, IUIAutomationScrollItemPattern,
    IUIAutomationScrollPattern, IUIAutomationSelectionItemPattern, IUIAutomationTextPattern,
    IUIAutomationTextPattern2, IUIAutomationTextRange, IUIAutomationTogglePattern,
    IUIAutomationValuePattern, ScrollAmount, ScrollAmount_LargeDecrement,
    ScrollAmount_LargeIncrement, ScrollAmount_NoAmount, TextPatternRangeEndpoint_End,
    TextPatternRangeEndpoint_Start, UIA_ExpandCollapsePatternId, UIA_InvokePatternId,
    UIA_LegacyIAccessiblePatternId, UIA_ScrollItemPatternId, UIA_ScrollPatternId,
    UIA_SelectionItemPatternId, UIA_TextPattern2Id, UIA_TextPatternId, UIA_TogglePatternId,
    UIA_ValuePatternId,
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
    Pointer { screen: Point },
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
        Action::Type => type_at_caret(element, request),
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
        Action::SetValue => {
            set_value(element, request.text.as_deref()).or_else(|_| pointer(element))
        }
        Action::Focus => match unsafe { element.SetFocus() } {
            Ok(()) => route(Route::Accessibility),
            Err(_) => pointer(element),
        },
        _ => pointer(element).or_else(|_| primary(element, request)),
    }
}

fn primary(element: &IUIAutomationElement, request: &OwnedAct) -> Result<Outcome> {
    let outcome = match request.action {
        Action::Press => press(element, request.window),
        Action::Toggle => toggle(element),
        Action::Select => select(element),
        Action::Expand => expand(element, true),
        Action::Collapse => expand(element, false),
        _ => return pointer(element),
    };
    match outcome {
        Ok(Outcome::Route(route)) => Ok(Outcome::Route(route)),
        _ => pointer(element),
    }
}

fn legacy(element: &IUIAutomationElement) -> bool {
    unsafe { element.CurrentFrameworkId() }
        .map(|framework| framework.to_string().eq_ignore_ascii_case("Win32"))
        .unwrap_or(false)
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

fn type_at_caret(element: &IUIAutomationElement, request: &OwnedAct) -> Result<Outcome> {
    let text = request.text.as_deref().unwrap_or_default();
    if let Some(hwnd) = native_handle(element).filter(|hwnd| edit_class(*hwnd)) {
        return Ok(Outcome::Route(crate::input::post_insert_text(hwnd, text)?));
    }
    splice_at_selection(element, text)
}

fn edit_class(window: isize) -> bool {
    let class = crate::hwnd::class_name(window);
    class.starts_with("Edit") || class.starts_with("RichEdit") || class.starts_with("RICHEDIT")
}

fn splice_at_selection(element: &IUIAutomationElement, text: &str) -> Result<Outcome> {
    let value = writable_value(element).ok_or_else(no_value)?;
    let document = document_range(element).ok_or_else(no_text_pattern)?;
    let selection = selection_range(element).ok_or_else(no_selection)?;
    let current = unsafe { value.CurrentValue() }
        .map(|value| value.to_string())
        .unwrap_or_default();
    let document_text = unsafe { document.GetText(-1) }
        .map(|value| value.to_string())
        .unwrap_or_default();
    let base = if current.encode_utf16().count() == document_text.encode_utf16().count() {
        current
    } else {
        document_text
    };
    let prefix = prefix_text(&document, &selection)?;
    let selected = unsafe { selection.GetText(-1) }
        .map(|value| value.to_string())
        .unwrap_or_default();
    let spliced = splice(&base, &prefix, &selected, text);
    unsafe {
        value
            .SetValue(&BSTR::from(spliced))
            .map_err(|error| failed("SetValue", error))?
    };
    route(Route::Accessibility)
}

fn no_value() -> kiko_driver::DriverError {
    unavailable(
        "this control has no writable value to type into in the background; use set_value to replace the text, or retry with mode foreground",
    )
}

fn no_text_pattern() -> kiko_driver::DriverError {
    unavailable(
        "this control does not expose a text pattern, so its caret is unknown; use set_value to replace the text, or retry with mode foreground",
    )
}

fn no_selection() -> kiko_driver::DriverError {
    unavailable(
        "this control reports no text selection to type at in the background; use set_value to replace the text, or retry with mode foreground",
    )
}

fn writable_value(element: &IUIAutomationElement) -> Option<IUIAutomationValuePattern> {
    let pattern =
        unsafe { element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) }
            .ok()?;
    let read_only = unsafe { pattern.CurrentIsReadOnly() }
        .map(|value| value.as_bool())
        .unwrap_or(true);
    (!read_only).then_some(pattern)
}

fn document_range(element: &IUIAutomationElement) -> Option<IUIAutomationTextRange> {
    unsafe {
        if let Ok(pattern) =
            element.GetCurrentPatternAs::<IUIAutomationTextPattern2>(UIA_TextPattern2Id)
        {
            return pattern.DocumentRange().ok();
        }
        element
            .GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
            .ok()?
            .DocumentRange()
            .ok()
    }
}

fn selection_range(element: &IUIAutomationElement) -> Option<IUIAutomationTextRange> {
    unsafe {
        if let Ok(pattern) =
            element.GetCurrentPatternAs::<IUIAutomationTextPattern2>(UIA_TextPattern2Id)
        {
            if let Some(range) = first_selection(&pattern) {
                return Some(range);
            }
            let mut active = windows::core::BOOL::default();
            if let Ok(range) = pattern.GetCaretRange(&mut active) {
                return Some(range);
            }
        }
        let pattern = element
            .GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
            .ok()?;
        first_selection(&pattern)
    }
}

fn first_selection(pattern: &IUIAutomationTextPattern) -> Option<IUIAutomationTextRange> {
    let ranges = unsafe { pattern.GetSelection() }.ok()?;
    let length = unsafe { ranges.Length() }.ok()?;
    if length < 1 {
        return None;
    }
    unsafe { ranges.GetElement(0) }.ok()
}

fn prefix_text(
    document: &IUIAutomationTextRange,
    selection: &IUIAutomationTextRange,
) -> Result<String> {
    let prefix = unsafe { document.Clone() }.map_err(|error| failed("Clone", error))?;
    unsafe {
        prefix.MoveEndpointByRange(
            TextPatternRangeEndpoint_End,
            selection,
            TextPatternRangeEndpoint_Start,
        )
    }
    .map_err(|error| failed("MoveEndpointByRange", error))?;
    unsafe { prefix.GetText(-1) }
        .map(|value| value.to_string())
        .map_err(|error| failed("GetText", error))
}

fn splice(base: &str, prefix: &str, selected: &str, text: &str) -> String {
    let units: Vec<u16> = base.encode_utf16().collect();
    let start = prefix.encode_utf16().count().min(units.len());
    let end = (start + selected.encode_utf16().count()).min(units.len());
    let mut spliced = Vec::with_capacity(units.len() + text.len());
    spliced.extend_from_slice(&units[..start]);
    spliced.extend(text.encode_utf16());
    spliced.extend_from_slice(&units[end..]);
    String::from_utf16_lossy(&spliced)
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
