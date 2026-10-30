use std::collections::HashMap;
use std::time::{Duration, Instant};

use kiko_driver::{Action, Node, Rect, Ref};
use objc2_application_services::{AXError, AXUIElement};
use objc2_core_foundation::{CFNumber, CFType};

use crate::ax::{self, Element};
use crate::cf;

pub const MAX_DEPTH: usize = 40;
pub const DEADLINE: Duration = Duration::from_millis(3000);
pub const PAGE_HIDDEN: &str = "the page content is not exposed to macOS accessibility: use browser_tabs, browser_read or browser_act for it, and if they say the browser needs consent, ask the owner to allow remote debugging\n";
const VALUE_LIMIT: usize = 500;
const WEB_PROBE_DEPTH: usize = 10;
const WEB_PROBE_NODES: usize = 400;
const WEB_WAIT: Duration = Duration::from_secs(4);
const WEB_POLL: Duration = Duration::from_millis(100);
const REMEMBERED: usize = 32;

const ATTRIBUTES: [&str; 13] = [
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
    ax::SUBROLE,
    ax::CHILDREN,
];

const CHROMIUM: [&str; 7] = [
    "com.google.Chrome",
    "com.google.Chrome.canary",
    "com.microsoft.edgemac",
    "com.brave.Browser",
    "org.chromium.Chromium",
    "company.thebrowser.Browser",
    "com.vivaldi.Vivaldi",
];

const WEBKIT: [&str; 1] = ["com.apple.Safari"];

const WEB_NAMES: [&str; 6] = [
    "Google Chrome",
    "Google Chrome Canary",
    "Microsoft Edge",
    "Brave Browser",
    "Chromium",
    "Safari",
];

const ENHANCED: &str = "AXEnhancedUserInterface";
const MANUAL: &str = "AXManualAccessibility";
const WEB_AREA: &str = "AXWebArea";
const MENU: &str = "AXMenu";
const MENU_BAR: &str = "AXMenuBar";

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

pub fn walk(window: &AXUIElement, origin: Rect, extras: &[Element]) -> Walk {
    let deadline = Instant::now() + DEADLINE;
    let mut nodes: Vec<Node> = Vec::new();
    let mut elements: Vec<Element> = Vec::new();
    let mut stack: Vec<Pending> = extras
        .iter()
        .rev()
        .map(|element| Pending {
            element: element.clone(),
            depth: 0,
            parent: None,
        })
        .collect();
    stack.push(Pending {
        element: ax::retain(window),
        depth: 0,
        parent: None,
    });

    while let Some(pending) = stack.pop() {
        if Instant::now() >= deadline || nodes.len() >= kiko_driver::MAX_NODES {
            break;
        }
        let (node, children) = describe(&pending.element, origin);
        let parent = match node {
            Some(mut node) => {
                let index = nodes.len();
                node.reference = (index + 1) as Ref;
                if let Some(parent) = pending.parent {
                    nodes[parent].children.push(node.reference);
                }
                elements.push(pending.element.clone());
                nodes.push(node);
                Some(index)
            }
            None => pending.parent,
        };

        if pending.depth < MAX_DEPTH {
            for child in children.into_iter().rev() {
                stack.push(Pending {
                    element: child,
                    depth: pending.depth + 1,
                    parent,
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
    let children = ax::elements(&values[12]);
    let Some(role) = ax::text(&values[0]) else {
        return (None, children);
    };
    let role = role.trim_start_matches("AX").to_lowercase();
    let name = first_name(&values[1], &values[2], &values[3], &values[11]);
    let value = ax::text(&values[4]).map(|value| truncate(value, VALUE_LIMIT));
    let frame = frame(&values, origin);
    let states = states(&role, &values);
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
    subrole: &Option<objc2_core_foundation::CFRetained<CFType>>,
) -> String {
    for value in [title, description, label] {
        if let Some(text) = ax::text(value).filter(|text| !text.is_empty()) {
            return text;
        }
    }
    ax::text(subrole)
        .filter(|subrole| !subrole.is_empty() && subrole != "AXUnknown")
        .map(|subrole| subrole_name(&subrole))
        .unwrap_or_default()
}

fn subrole_name(subrole: &str) -> String {
    let mut name = String::new();
    for (index, character) in subrole.trim_start_matches("AX").chars().enumerate() {
        if character.is_uppercase() && index > 0 {
            name.push(' ');
        }
        name.extend(character.to_lowercase());
    }
    name
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

fn states(role: &str, values: &[Option<objc2_core_foundation::CFRetained<CFType>>]) -> Vec<String> {
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
    if expand_role(role) {
        match ax::flag(&values[10]) {
            Some(true) => states.push("expanded".to_string()),
            Some(false) => states.push("collapsed".to_string()),
            None => {}
        }
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
    matches!(role, "textfield" | "textarea" | "combobox" | "searchfield")
}

fn range_role(role: &str) -> bool {
    matches!(role, "slider" | "stepper" | "incrementor")
}

fn select_role(role: &str) -> bool {
    matches!(
        role,
        "radiobutton" | "menuitem" | "tab" | "row" | "cell" | "listitem" | "checkbox"
    )
}

fn expand_role(role: &str) -> bool {
    matches!(role, "disclosuretriangle" | "popupbutton" | "outlinerow")
}

fn scroll_role(role: &str) -> bool {
    matches!(
        role,
        "scrollarea" | "webarea" | "table" | "outline" | "list" | "browser" | "textarea"
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
    if role == "checkbox" {
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

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WebPage {
    Exposed,
    Hidden,
}

#[derive(Default)]
pub struct WebPages {
    seen: HashMap<(i32, u64), WebPage>,
}

impl WebPages {
    pub fn enable(&mut self, pid: i32, bundle: Option<&str>, app: &str) -> (Element, WebPage) {
        let application = ax::application(pid);
        let key = launch(pid).map(|started| (pid, started));
        if let Some(page) = key.and_then(|key| self.seen.get(&key).copied()) {
            return (application, page);
        }
        let (page, settled) = probe(&application, bundle, app);
        if let (Some(key), true) = (key, settled) {
            self.remember(key, page);
        }
        (application, page)
    }

    fn remember(&mut self, key: (i32, u64), page: WebPage) {
        if self.seen.len() >= REMEMBERED {
            self.seen.clear();
        }
        self.seen.retain(|(pid, _), _| *pid != key.0);
        self.seen.insert(key, page);
    }
}

fn probe(application: &AXUIElement, bundle: Option<&str>, app: &str) -> (WebPage, bool) {
    let opt = opt_in(application, bundle, app);
    if !opt.active && !opt.refused {
        return (WebPage::Hidden, false);
    }
    let present = web_content_present(application);
    let appeared = !present && wait_for_web_area(application, bundle, app);
    decide(&opt, present || appeared)
}

fn decide(opt: &OptIn, exposed: bool) -> (WebPage, bool) {
    if exposed {
        return (WebPage::Exposed, true);
    }
    (WebPage::Hidden, opt.refused)
}

fn launch(pid: i32) -> Option<u64> {
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    let read = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    if read != size {
        return None;
    }
    let info = unsafe { info.assume_init() };
    Some(
        info.pbi_start_tvsec
            .wrapping_mul(1_000_000)
            .wrapping_add(info.pbi_start_tvusec),
    )
}

fn wait_for_web_area(application: &AXUIElement, bundle: Option<&str>, app: &str) -> bool {
    let deadline = Instant::now() + WEB_WAIT;
    while !web_content_present(application) {
        if Instant::now() >= deadline {
            return false;
        }
        opt_in(application, bundle, app);
        std::thread::sleep(WEB_POLL);
    }
    true
}

#[derive(Default)]
struct OptIn {
    active: bool,
    refused: bool,
}

fn opt_in(application: &AXUIElement, bundle: Option<&str>, app: &str) -> OptIn {
    let names: &[&str] = if web_app(bundle, app) {
        &[ENHANCED, MANUAL]
    } else {
        &[MANUAL]
    };
    let mut opt_in = OptIn::default();
    for name in names {
        if attribute_on(application, name) {
            opt_in.active = true;
            continue;
        }
        let turned = turn_on(application, name);
        opt_in.active |= turned.active;
        opt_in.refused |= turned.refused;
    }
    opt_in
}

fn attribute_on(application: &AXUIElement, name: &str) -> bool {
    ax::attributes(application, &[name])
        .first()
        .and_then(|value| value.as_ref())
        .and_then(|value| cf::flag(value))
        .unwrap_or(false)
}

fn turn_on(application: &AXUIElement, name: &str) -> OptIn {
    let boolean = ax::set_flag(application, name, true);
    if boolean == AXError::Success {
        return OptIn {
            active: true,
            refused: false,
        };
    }
    let number = CFNumber::new_i64(1);
    let numeric = ax::set(application, name, &number);
    OptIn {
        active: numeric == AXError::Success,
        refused: refused(boolean) || refused(numeric),
    }
}

fn refused(error: AXError) -> bool {
    error == AXError::NotImplemented || error == AXError::AttributeUnsupported
}

pub fn chromium(bundle: Option<&str>) -> bool {
    bundle.is_some_and(|bundle| CHROMIUM.contains(&bundle))
}

pub fn web_app(bundle: Option<&str>, app: &str) -> bool {
    bundle.is_some_and(|bundle| CHROMIUM.contains(&bundle) || WEBKIT.contains(&bundle))
        || WEB_NAMES.contains(&app)
}

pub fn open_menus(application: &AXUIElement) -> Vec<Element> {
    let mut menus = Vec::new();
    for child in ax::children(application) {
        let role = ax::text(&ax::attribute(&child, ax::ROLE)).unwrap_or_default();
        match role.as_str() {
            MENU => menus.push(child),
            MENU_BAR => menus.extend(
                ax::children(&child)
                    .into_iter()
                    .filter(|item| ax::flag(&ax::attribute(item, ax::SELECTED)) == Some(true)),
            ),
            _ => {}
        }
    }
    menus
}

fn web_content_present(application: &AXUIElement) -> bool {
    let mut budget = WEB_PROBE_NODES;
    let mut stack: Vec<(Element, usize)> = vec![(ax::retain(application), 0)];
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_unsupported_attribute_counts_as_refused() {
        assert!(refused(AXError::NotImplemented));
        assert!(refused(AXError::AttributeUnsupported));
        assert!(!refused(AXError::CannotComplete));
        assert!(!refused(AXError::Success));
    }

    fn opt_in(active: bool, refused: bool) -> OptIn {
        OptIn { active, refused }
    }

    #[test]
    fn a_web_area_that_appeared_is_remembered() {
        assert_eq!(decide(&opt_in(true, false), true), (WebPage::Exposed, true));
        assert_eq!(decide(&opt_in(false, true), true), (WebPage::Exposed, true));
    }

    #[test]
    fn a_refused_opt_in_with_no_web_area_is_remembered_as_hidden() {
        assert_eq!(decide(&opt_in(false, true), false), (WebPage::Hidden, true));
    }

    #[test]
    fn an_accepted_opt_in_that_was_only_slow_is_asked_again() {
        assert_eq!(
            decide(&opt_in(true, false), false),
            (WebPage::Hidden, false)
        );
    }

    #[test]
    fn a_relaunch_replaces_the_page_decision() {
        let mut pages = WebPages::default();
        pages.remember((7, 100), WebPage::Hidden);
        pages.remember((7, 101), WebPage::Exposed);
        assert_eq!(pages.seen.len(), 1);
        assert_eq!(pages.seen.get(&(7, 101)), Some(&WebPage::Exposed));
    }

    #[test]
    fn the_memory_stays_small() {
        let mut pages = WebPages::default();
        for pid in 0..(REMEMBERED as i32 + 5) {
            pages.remember((pid, 1), WebPage::Hidden);
        }
        assert!(pages.seen.len() <= REMEMBERED);
    }
}
