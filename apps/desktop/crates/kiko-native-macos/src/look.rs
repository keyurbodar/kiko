use std::time::{Duration, Instant};

use kiko_driver::{Action, Node, Rect, Ref};
use objc2_application_services::AXUIElement;
use objc2_core_foundation::CFType;

use crate::ax::{self, Element};

pub const MAX_DEPTH: usize = 40;
pub const DEADLINE: Duration = Duration::from_millis(3000);
const VALUE_LIMIT: usize = 500;
const WEB_PROBE_DEPTH: usize = 10;
const WEB_PROBE_NODES: usize = 400;

const ATTRIBUTES: [&str; 12] = [
    ax::ROLE,
    ax::TITLE,
    ax::DESCRIPTION,
    ax::LABEL,
    ax::VALUE,
    ax::POSITION,
    ax::SIZE,
    ax::ENABLED,
    ax::FOCUSED,
    ax::SELECTED,
    ax::EXPANDED,
    ax::CHILDREN,
];

const CHROMIUM: [&str; 5] = [
    "com.google.Chrome",
    "com.microsoft.edgemac",
    "com.brave.Browser",
    "org.chromium.Chromium",
    "company.thebrowser.Browser",
];

const WEBKIT: [&str; 1] = ["com.apple.Safari"];

const ENHANCED: &str = "AXEnhancedUserInterface";
const MANUAL: &str = "AXManualAccessibility";
const WEB_AREA: &str = "AXWebArea";

#[derive(Default)]
pub struct Refs {
    elements: Vec<Element>,
}

impl Refs {
    pub fn get(&self, reference: Ref) -> Option<&Element> {
        self.elements.get(reference.checked_sub(1)? as usize)
    }
}

pub struct Walk {
    pub nodes: Vec<Node>,
    pub refs: Refs,
}

struct Pending {
    element: Element,
    depth: usize,
    parent: Option<usize>,
}

pub fn walk(window: &AXUIElement, origin: Rect) -> Walk {
    let deadline = Instant::now() + DEADLINE;
    let mut nodes: Vec<Node> = Vec::new();
    let mut elements: Vec<Element> = Vec::new();
    let mut stack = vec![Pending {
        element: unsafe { retain(window) },
        depth: 0,
        parent: None,
    }];

    while let Some(pending) = stack.pop() {
        if Instant::now() >= deadline || nodes.len() >= kiko_driver::MAX_NODES {
            break;
        }
        let index = nodes.len();
        let (node, children) = describe(&pending.element, origin);
        let Some(mut node) = node else { continue };
        node.reference = (index + 1) as Ref;
        if let Some(parent) = pending.parent {
            nodes[parent].children.push(node.reference);
        }
        elements.push(pending.element.clone());
        nodes.push(node);

        if pending.depth < MAX_DEPTH {
            for child in children.into_iter().rev() {
                stack.push(Pending {
                    element: child,
                    depth: pending.depth + 1,
                    parent: Some(index),
                });
            }
        }
    }

    Walk {
        nodes,
        refs: Refs { elements },
    }
}

fn describe(element: &AXUIElement, origin: Rect) -> (Option<Node>, Vec<Element>) {
    ax::timeout(element, ax::MESSAGING_TIMEOUT);
    let values = ax::attributes(element, &ATTRIBUTES);
    let children = ax::elements(&values[11]);
    let Some(role) = ax::text(&values[0]) else {
        return (None, children);
    };
    let role = role.trim_start_matches("AX").to_lowercase();
    let name = first_name(&values[1], &values[2], &values[3]);
    let value = ax::text(&values[4]).map(|value| truncate(value, VALUE_LIMIT));
    let frame = frame(&values, origin);
    let states = states(&values);
    let actions = actions_for(&role, element);
    let node = Node {
        reference: 0,
        role,
        name,
        value,
        frame,
        states,
        actions,
        children: Vec::new(),
    };
    (Some(node), children)
}

fn first_name(
    title: &Option<objc2_core_foundation::CFRetained<CFType>>,
    description: &Option<objc2_core_foundation::CFRetained<CFType>>,
    label: &Option<objc2_core_foundation::CFRetained<CFType>>,
) -> String {
    for value in [title, description, label] {
        if let Some(text) = ax::text(value).filter(|text| !text.is_empty()) {
            return text;
        }
    }
    String::new()
}

fn frame(
    values: &[Option<objc2_core_foundation::CFRetained<CFType>>],
    origin: Rect,
) -> Option<Rect> {
    let point = ax::point(&values[5])?;
    let size = ax::size(&values[6])?;
    Some(Rect {
        x: point.x - origin.x,
        y: point.y - origin.y,
        w: size.width,
        h: size.height,
    })
}

fn states(values: &[Option<objc2_core_foundation::CFRetained<CFType>>]) -> Vec<String> {
    let mut states = Vec::new();
    if ax::flag(&values[7]) == Some(false) {
        states.push("disabled".to_string());
    }
    if ax::flag(&values[8]) == Some(true) {
        states.push("focused".to_string());
    }
    if ax::flag(&values[9]) == Some(true) {
        states.push("selected".to_string());
    }
    match ax::flag(&values[10]) {
        Some(true) => states.push("expanded".to_string()),
        Some(false) => states.push("collapsed".to_string()),
        None => {}
    }
    states
}

fn truncate(value: String, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value;
    }
    value.chars().take(limit).collect()
}

fn text_role(role: &str) -> bool {
    matches!(
        role,
        "text field" | "text area" | "combo box" | "search field" | "textfield" | "textarea"
    )
}

fn range_role(role: &str) -> bool {
    matches!(role, "slider" | "stepper" | "incrementor")
}

fn select_role(role: &str) -> bool {
    matches!(
        role,
        "radio button" | "menu item" | "tab" | "row" | "cell" | "list item" | "check box"
    )
}

fn expand_role(role: &str) -> bool {
    matches!(
        role,
        "disclosure triangle" | "pop up button" | "outline row"
    )
}

fn scroll_role(role: &str) -> bool {
    matches!(
        role,
        "scroll area" | "web area" | "table" | "outline" | "list" | "browser"
    )
}

fn actions_for(role: &str, element: &AXUIElement) -> Vec<Action> {
    let mut actions = Vec::new();
    for name in ax::action_names(element) {
        match name.as_str() {
            "AXPress" => push(&mut actions, Action::Press),
            "AXShowMenu" => push(&mut actions, Action::ShowMenu),
            "AXPick" => push(&mut actions, Action::Select),
            "AXScrollToVisible" => push(&mut actions, Action::Scroll),
            _ => {}
        }
    }
    if text_role(role) {
        push(&mut actions, Action::SetValue);
        push(&mut actions, Action::Type);
        push(&mut actions, Action::Focus);
    }
    if range_role(role) {
        push(&mut actions, Action::SetValue);
    }
    if select_role(role) {
        push(&mut actions, Action::Select);
    }
    if role == "check box" {
        push(&mut actions, Action::Toggle);
    }
    if expand_role(role) {
        push(&mut actions, Action::Expand);
        push(&mut actions, Action::Collapse);
    }
    if scroll_role(role) {
        push(&mut actions, Action::Scroll);
    }
    actions
}

fn push(actions: &mut Vec<Action>, action: Action) {
    if !actions.contains(&action) {
        actions.push(action);
    }
}

unsafe fn retain(element: &AXUIElement) -> Element {
    let pointer = std::ptr::NonNull::from(element);
    unsafe { objc2_core_foundation::CFRetained::retain(pointer) }
}

pub fn enable(pid: i32, bundle: Option<&str>) -> Element {
    let application = ax::application(pid);
    if !assert_accessibility(&application, bundle) {
        return application;
    }
    if !web_content_present(&application) {
        std::thread::sleep(Duration::from_millis(100));
        assert_accessibility(&application, bundle);
    }
    application
}

fn assert_accessibility(application: &AXUIElement, bundle: Option<&str>) -> bool {
    let web = bundle.is_some_and(|bundle| CHROMIUM.contains(&bundle) || WEBKIT.contains(&bundle));
    if web {
        ax::set_flag(application, ENHANCED, true);
        return true;
    }
    ax::set_flag(application, MANUAL, true) == objc2_application_services::AXError::Success
}

fn web_content_present(application: &AXUIElement) -> bool {
    let mut budget = WEB_PROBE_NODES;
    let mut stack: Vec<(Element, usize)> = vec![(unsafe { retain(application) }, 0)];
    while let Some((element, depth)) = stack.pop() {
        if budget == 0 || depth >= WEB_PROBE_DEPTH {
            continue;
        }
        for child in ax::children(&element) {
            budget = budget.saturating_sub(1);
            if budget == 0 {
                return false;
            }
            let values = ax::attributes(&child, &[ax::ROLE, ax::CHILDREN]);
            let role = ax::text(&values[0]).unwrap_or_default();
            if role == WEB_AREA && !ax::elements(&values[1]).is_empty() {
                return true;
            }
            stack.push((child, depth + 1));
        }
    }
    false
}
