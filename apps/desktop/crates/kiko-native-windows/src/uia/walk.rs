use std::collections::HashMap;

use kiko_driver::api::{Action, Node, Rect};
use kiko_driver::{DriverError, ErrorCode, MAX_NODES, Result};
use windows::Win32::UI::Accessibility::{
    ExpandCollapseState_Collapsed, ExpandCollapseState_Expanded, IUIAutomation,
    IUIAutomationCacheRequest, IUIAutomationElement, IUIAutomationExpandCollapsePattern,
    IUIAutomationLegacyIAccessiblePattern, IUIAutomationScrollPattern,
    IUIAutomationSelectionItemPattern, IUIAutomationTogglePattern, IUIAutomationValuePattern,
    ToggleState_Off, ToggleState_On, TreeScope_Subtree, UIA_BoundingRectanglePropertyId,
    UIA_ControlTypePropertyId, UIA_ExpandCollapseExpandCollapseStatePropertyId,
    UIA_ExpandCollapsePatternId, UIA_HasKeyboardFocusPropertyId, UIA_InvokePatternId,
    UIA_IsEnabledPropertyId, UIA_IsOffscreenPropertyId, UIA_LegacyIAccessiblePatternId,
    UIA_NamePropertyId, UIA_NativeWindowHandlePropertyId, UIA_ScrollItemPatternId,
    UIA_ScrollPatternId, UIA_SelectionItemIsSelectedPropertyId, UIA_SelectionItemPatternId,
    UIA_TextPatternId, UIA_TogglePatternId, UIA_ToggleToggleStatePropertyId,
    UIA_ValueIsReadOnlyPropertyId, UIA_ValuePatternId, UIA_ValueValuePropertyId,
};

use super::Table;
use crate::hwnd;

const MAX_DEPTH: usize = 40;

pub fn look(
    automation: &IUIAutomation,
    window: isize,
    frame: Rect,
    tables: &mut HashMap<isize, Table>,
) -> Result<Vec<Node>> {
    unsafe {
        wake_chromium(automation, window);
        let root = automation
            .ElementFromHandle(hwnd::handle(window))
            .map_err(|error| {
                DriverError::new(
                    ErrorCode::Failed,
                    format!("UIA could not read the window: {error}"),
                )
            })?;
        let cache = cache_request(automation)?;
        let cached = root.BuildUpdatedCache(&cache).map_err(|error| {
            DriverError::new(
                ErrorCode::Failed,
                format!("UIA could not read the window tree: {error}"),
            )
        })?;
        let table = tables.entry(window).or_default();
        table.elements.clear();
        let mut nodes = Vec::new();
        walk_cached(&cached, frame, table, &mut nodes);
        Ok(nodes)
    }
}

fn wake_chromium(automation: &IUIAutomation, window: isize) {
    unsafe {
        if !hwnd::has_class(window, "Chrome_WidgetWin_") {
            return;
        }
        let Some(render) = hwnd::find_child(window, "Chrome_RenderWidgetHostHWND") else {
            return;
        };
        let target = hwnd::children(render).first().copied().unwrap_or(render);
        if let Ok(element) = automation.ElementFromHandle(hwnd::handle(target)) {
            let _ = element.CurrentName();
        }
    }
}

fn cache_request(automation: &IUIAutomation) -> Result<IUIAutomationCacheRequest> {
    unsafe {
        let cache = automation.CreateCacheRequest().map_err(|error| {
            DriverError::new(
                ErrorCode::Failed,
                format!("UIA cache request failed: {error}"),
            )
        })?;
        for property in [
            UIA_NamePropertyId,
            UIA_ControlTypePropertyId,
            UIA_BoundingRectanglePropertyId,
            UIA_IsEnabledPropertyId,
            UIA_HasKeyboardFocusPropertyId,
            UIA_IsOffscreenPropertyId,
            UIA_NativeWindowHandlePropertyId,
            UIA_ValueValuePropertyId,
            UIA_ValueIsReadOnlyPropertyId,
            UIA_ToggleToggleStatePropertyId,
            UIA_SelectionItemIsSelectedPropertyId,
            UIA_ExpandCollapseExpandCollapseStatePropertyId,
        ] {
            let _ = cache.AddProperty(property);
        }
        for pattern in [
            UIA_InvokePatternId,
            UIA_TogglePatternId,
            UIA_ValuePatternId,
            UIA_ExpandCollapsePatternId,
            UIA_SelectionItemPatternId,
            UIA_ScrollItemPatternId,
            UIA_ScrollPatternId,
            UIA_LegacyIAccessiblePatternId,
            UIA_TextPatternId,
        ] {
            let _ = cache.AddPattern(pattern);
        }
        let _ = cache.SetTreeScope(TreeScope_Subtree);
        let condition = automation.ControlViewCondition().map_err(|error| {
            DriverError::new(
                ErrorCode::Failed,
                format!("UIA control view failed: {error}"),
            )
        })?;
        let _ = cache.SetTreeFilter(&condition);
        Ok(cache)
    }
}

fn walk_cached(root: &IUIAutomationElement, frame: Rect, table: &mut Table, nodes: &mut Vec<Node>) {
    let mut stack = vec![(root.clone(), 0usize, None::<usize>)];
    while let Some((element, depth, parent)) = stack.pop() {
        if nodes.len() >= MAX_NODES {
            break;
        }
        let node = node_of(&element, frame, table);
        let index = nodes.len();
        if let Some(parent) = parent {
            nodes[parent].children.push(node.reference);
        }
        nodes.push(node);
        if depth + 1 >= MAX_DEPTH {
            continue;
        }
        let children = unsafe { element.GetCachedChildren() };
        let Ok(children) = children else { continue };
        let Ok(length) = (unsafe { children.Length() }) else {
            continue;
        };
        for position in (0..length).rev() {
            if let Ok(child) = unsafe { children.GetElement(position) } {
                stack.push((child, depth + 1, Some(index)));
            }
        }
    }
}

fn node_of(element: &IUIAutomationElement, frame: Rect, table: &mut Table) -> Node {
    let reference = table.next;
    table.next += 1;
    table.elements.insert(reference, element.clone());
    Node {
        reference,
        role: role(element),
        name: text(unsafe { element.CachedName() }),
        value: value(element),
        frame: bounds(element, frame),
        states: states(element),
        actions: actions(element),
        children: Vec::new(),
    }
}

fn text(value: windows::core::Result<windows::core::BSTR>) -> String {
    value.map(|value| value.to_string()).unwrap_or_default()
}

fn role(element: &IUIAutomationElement) -> String {
    let localized = text(unsafe { element.CachedLocalizedControlType() });
    if !localized.trim().is_empty() {
        return localized.trim().to_ascii_lowercase();
    }
    let control_type = unsafe { element.CachedControlType() }
        .map(|value| value.0)
        .unwrap_or_default();
    control_type_name(control_type).to_ascii_lowercase()
}

fn value(element: &IUIAutomationElement) -> Option<String> {
    let pattern =
        unsafe { element.GetCachedPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) }
            .ok()?;
    let value = unsafe { pattern.CachedValue() }
        .map(|value| value.to_string())
        .unwrap_or_default();
    (!value.trim().is_empty()).then_some(value)
}

fn bounds(element: &IUIAutomationElement, frame: Rect) -> Option<Rect> {
    let rect = unsafe { element.CachedBoundingRectangle() }.ok()?;
    (rect.right > rect.left && rect.bottom > rect.top).then(|| Rect {
        x: f64::from(rect.left) - frame.x,
        y: f64::from(rect.top) - frame.y,
        w: f64::from(rect.right - rect.left),
        h: f64::from(rect.bottom - rect.top),
    })
}

fn states(element: &IUIAutomationElement) -> Vec<String> {
    let mut states = Vec::new();
    let focused = unsafe { element.CachedHasKeyboardFocus() }
        .map(|value| value.as_bool())
        .unwrap_or(false);
    if focused {
        states.push("focused".to_string());
    }
    let offscreen = unsafe { element.CachedIsOffscreen() }
        .map(|value| value.as_bool())
        .unwrap_or(false);
    if offscreen {
        states.push("offscreen".to_string());
    }
    let disabled = unsafe { element.CachedIsEnabled() }
        .map(|value| !value.as_bool())
        .unwrap_or(false);
    if disabled {
        states.push("disabled".to_string());
    }
    if let Ok(pattern) =
        unsafe { element.GetCachedPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId) }
    {
        match unsafe { pattern.CachedToggleState() } {
            Ok(state) if state == ToggleState_On => states.push("checked".into()),
            Ok(state) if state == ToggleState_Off => states.push("unchecked".into()),
            Ok(_) => states.push("mixed".into()),
            Err(_) => {}
        }
    } else if let Ok(pattern) = unsafe {
        element.GetCachedPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
    } && unsafe { pattern.CachedIsSelected() }
        .map(|value| value.as_bool())
        .unwrap_or(false)
    {
        states.push("selected".to_string());
    }
    if let Ok(pattern) = unsafe {
        element
            .GetCachedPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId)
    } {
        match unsafe { pattern.CachedExpandCollapseState() } {
            Ok(state) if state == ExpandCollapseState_Expanded => states.push("expanded".into()),
            Ok(state) if state == ExpandCollapseState_Collapsed => states.push("collapsed".into()),
            _ => {}
        }
    }
    states
}

fn actions(element: &IUIAutomationElement) -> Vec<Action> {
    let mut actions = Vec::new();
    let mut add = |action: Action| {
        if !actions.contains(&action) {
            actions.push(action);
        }
    };
    if unsafe { element.GetCachedPattern(UIA_InvokePatternId) }.is_ok() {
        add(Action::Press);
    }
    if let Ok(pattern) = unsafe {
        element.GetCachedPatternAs::<IUIAutomationLegacyIAccessiblePattern>(
            UIA_LegacyIAccessiblePatternId,
        )
    } && unsafe { pattern.CachedDefaultAction() }
        .map(|value| !value.is_empty())
        .unwrap_or(false)
    {
        add(Action::Press);
    }
    if unsafe { element.GetCachedPattern(UIA_TogglePatternId) }.is_ok() {
        add(Action::Toggle);
    }
    if let Ok(pattern) =
        unsafe { element.GetCachedPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) }
        && unsafe { pattern.CachedIsReadOnly() }
            .map(|value| !value.as_bool())
            .unwrap_or(true)
    {
        add(Action::SetValue);
        add(Action::Type);
    }
    if unsafe { element.GetCachedPattern(UIA_ExpandCollapsePatternId) }.is_ok() {
        add(Action::Expand);
        add(Action::Collapse);
    }
    if unsafe { element.GetCachedPattern(UIA_SelectionItemPatternId) }.is_ok() {
        add(Action::Select);
    }
    if unsafe { element.GetCachedPattern(UIA_ScrollItemPatternId) }.is_ok() {
        add(Action::Scroll);
    }
    if unsafe { element.GetCachedPatternAs::<IUIAutomationScrollPattern>(UIA_ScrollPatternId) }
        .is_ok()
    {
        add(Action::Scroll);
    }
    actions
}

fn control_type_name(id: i32) -> &'static str {
    match id {
        50000 => "Button",
        50001 => "Calendar",
        50002 => "CheckBox",
        50003 => "ComboBox",
        50004 => "Edit",
        50005 => "Hyperlink",
        50006 => "Image",
        50007 => "ListItem",
        50008 => "List",
        50009 => "Menu",
        50010 => "MenuBar",
        50011 => "MenuItem",
        50012 => "ProgressBar",
        50013 => "RadioButton",
        50014 => "ScrollBar",
        50015 => "Slider",
        50016 => "Spinner",
        50017 => "StatusBar",
        50018 => "Tab",
        50019 => "TabItem",
        50020 => "Text",
        50021 => "ToolBar",
        50022 => "ToolTip",
        50023 => "Tree",
        50024 => "TreeItem",
        50025 => "Custom",
        50026 => "Group",
        50027 => "Thumb",
        50028 => "DataGrid",
        50029 => "DataItem",
        50030 => "Document",
        50031 => "SplitButton",
        50032 => "Window",
        50033 => "Pane",
        50034 => "Header",
        50035 => "HeaderItem",
        50036 => "Table",
        50037 => "TitleBar",
        50038 => "Separator",
        50039 => "SemanticZoom",
        50040 => "AppBar",
        _ => "Unknown",
    }
}
