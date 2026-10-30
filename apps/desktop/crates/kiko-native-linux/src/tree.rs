use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use atspi::zbus::Connection;
use atspi::{CoordType, Interface, InterfaceSet, Role, State, StateSet};
use kiko_driver::{Action, Node, Rect, Ref};

use crate::a11y::{self, CALL, Target};

const MAX_DEPTH: usize = 40;
const MAX_CHILDREN: usize = 2048;
const DEADLINE: Duration = Duration::from_secs(3);

pub(crate) struct RefAllocator {
    next: Ref,
    targets: HashMap<Ref, Target>,
}

impl RefAllocator {
    pub fn new(next: Ref) -> Self {
        Self {
            next,
            targets: HashMap::new(),
        }
    }

    fn allocate(&mut self, target: Target) -> Ref {
        let reference = self.next;
        self.next += 1;
        self.targets.insert(reference, target);
        reference
    }

    pub fn next_ref(&self) -> Ref {
        self.next
    }

    pub fn into_table(self) -> HashMap<Ref, Target> {
        self.targets
    }
}

#[derive(Clone)]
struct Item {
    role: Role,
    name: String,
    states: StateSet,
    ifaces: InterfaceSet,
    count: i32,
}

#[derive(Default)]
struct Index {
    items: HashMap<Target, Item>,
    children: HashMap<Target, Vec<(i32, Target)>>,
    buses: HashSet<String>,
}

impl Index {
    async fn load(&mut self, conn: &Connection, bus: &str, budget: Duration) {
        if !self.buses.insert(bus.to_string()) {
            return;
        }
        let Some(entries) = a11y::cache(conn, bus, budget).await else {
            return;
        };
        for entry in entries {
            if let Some(parent) = entry.parent {
                self.children
                    .entry(parent)
                    .or_default()
                    .push((entry.index, entry.object.clone()));
            }
            if !entry.children.is_empty() {
                let ordered: Vec<(i32, Target)> = entry
                    .children
                    .iter()
                    .enumerate()
                    .map(|(index, target)| (index as i32, target.clone()))
                    .collect();
                self.children.insert(entry.object.clone(), ordered);
            }
            let item = Item {
                role: entry.role,
                name: entry.name,
                states: entry.states,
                ifaces: entry.ifaces,
                count: entry.count,
            };
            self.items.insert(entry.object, item);
        }
        for children in self.children.values_mut() {
            children.sort_by_key(|(index, _)| *index);
        }
    }

    async fn item(&mut self, conn: &Connection, target: &Target, budget: Duration) -> Option<Item> {
        if let Some(item) = self.items.get(target) {
            return Some(item.clone());
        }
        let item = live_item(conn, target, budget).await?;
        self.items.insert(target.clone(), item.clone());
        Some(item)
    }

    async fn children_of(
        &mut self,
        conn: &Connection,
        target: &Target,
        item: &Item,
        budget: Duration,
    ) -> Vec<Target> {
        if item.count <= 0 {
            return Vec::new();
        }
        if let Some(children) = self
            .children
            .get(target)
            .filter(|children| !children.is_empty())
        {
            return children
                .iter()
                .take(MAX_CHILDREN)
                .map(|(_, target)| target.clone())
                .collect();
        }
        let Ok(accessible) = a11y::accessible(conn, target).await else {
            return Vec::new();
        };
        let references = a11y::within(budget, accessible.get_children())
            .await
            .unwrap_or_default();
        let children: Vec<Target> = references
            .iter()
            .filter_map(Target::from_ref)
            .take(MAX_CHILDREN)
            .collect();
        let ordered: Vec<(i32, Target)> = children
            .iter()
            .enumerate()
            .map(|(index, target)| (index as i32, target.clone()))
            .collect();
        self.children.insert(target.clone(), ordered);
        children
    }
}

async fn live_item(conn: &Connection, target: &Target, budget: Duration) -> Option<Item> {
    let accessible = a11y::accessible(conn, target).await.ok()?;
    let role = a11y::within(budget, accessible.get_role()).await?;
    let name = a11y::within(budget, accessible.name())
        .await
        .unwrap_or_default();
    let states = a11y::within(budget, accessible.get_state())
        .await
        .unwrap_or_else(StateSet::empty);
    let ifaces = a11y::within(budget, accessible.get_interfaces())
        .await
        .unwrap_or_else(InterfaceSet::empty);
    let count = a11y::within(budget, accessible.child_count())
        .await
        .unwrap_or(0);
    Some(Item {
        role,
        name,
        states,
        ifaces,
        count,
    })
}

pub(crate) async fn build(
    conn: &Connection,
    start: &Target,
    frame: Rect,
    alloc: &mut RefAllocator,
) -> Vec<Node> {
    let deadline = Instant::now() + DEADLINE;
    let mut index = Index::default();
    index.load(conn, &start.bus, CALL).await;
    let mut assigned: HashMap<Target, Ref> = HashMap::new();
    let mut seen: HashSet<Target> = HashSet::new();
    let mut nodes: Vec<Node> = Vec::new();
    let mut enriched: Vec<(usize, Target, Role, StateSet, InterfaceSet)> = Vec::new();
    let mut stack = vec![(start.clone(), 0usize)];
    while let Some((target, depth)) = stack.pop() {
        if nodes.len() >= kiko_driver::MAX_NODES || remaining(deadline).is_zero() {
            break;
        }
        if !seen.insert(target.clone()) {
            continue;
        }
        if !index.buses.contains(&target.bus) {
            index.load(conn, &target.bus, remaining(deadline)).await;
        }
        let Some(item) = index.item(conn, &target, remaining(deadline)).await else {
            continue;
        };
        let reference = assigned
            .entry(target.clone())
            .or_insert_with(|| alloc.allocate(target.clone()))
            .to_owned();
        let child_targets = if depth >= MAX_DEPTH {
            Vec::new()
        } else {
            index
                .children_of(conn, &target, &item, remaining(deadline))
                .await
        };
        let children = child_targets
            .iter()
            .map(|child| {
                *assigned
                    .entry(child.clone())
                    .or_insert_with(|| alloc.allocate(child.clone()))
            })
            .collect();
        let node = Node {
            reference,
            role: item.role.name().to_string(),
            name: item.name.clone(),
            value: None,
            frame: None,
            states: states_of(&item.states),
            actions: actions_of(item.role, &item.states, item.ifaces),
            children,
        };
        enriched.push((
            nodes.len(),
            target.clone(),
            item.role,
            item.states,
            item.ifaces,
        ));
        nodes.push(node);
        for child in child_targets.into_iter().rev() {
            stack.push((child, depth + 1));
        }
    }
    for (index, target, role, states, ifaces) in enriched {
        if remaining(deadline).is_zero() {
            break;
        }
        if let Some(rect) = frame_of(conn, &target, frame, ifaces, remaining(deadline)).await {
            nodes[index].frame = Some(rect);
        }
        if let Some(value) =
            value_of(conn, &target, role, states, ifaces, remaining(deadline)).await
        {
            nodes[index].value = Some(value);
        }
    }
    nodes
}

fn remaining(deadline: Instant) -> Duration {
    deadline.saturating_duration_since(Instant::now()).min(CALL)
}

async fn frame_of(
    conn: &Connection,
    target: &Target,
    frame: Rect,
    ifaces: InterfaceSet,
    budget: Duration,
) -> Option<Rect> {
    if !ifaces.contains(Interface::Component) {
        return None;
    }
    let component = a11y::component(conn, target).await?;
    if let Some((x, y, w, h)) = a11y::within(budget, component.get_extents(CoordType::Window)).await
        && w > 0
        && h > 0
        && x > -1
        && y > -1
    {
        return Some(Rect {
            x: f64::from(x),
            y: f64::from(y),
            w: f64::from(w),
            h: f64::from(h),
        });
    }
    let (x, y, w, h) = a11y::within(budget, component.get_extents(CoordType::Screen)).await?;
    if w <= 0 || h <= 0 {
        return None;
    }
    Some(Rect {
        x: f64::from(x) - frame.x,
        y: f64::from(y) - frame.y,
        w: f64::from(w),
        h: f64::from(h),
    })
}

async fn value_of(
    conn: &Connection,
    target: &Target,
    role: Role,
    states: StateSet,
    ifaces: InterfaceSet,
    budget: Duration,
) -> Option<String> {
    if !value_role(role, &states) {
        return None;
    }
    if let Some(text) = a11y::text(conn, target).await {
        let count = a11y::within(budget, text.character_count())
            .await
            .unwrap_or(0);
        if count > 0 {
            let value = a11y::within(budget, text.get_text(0, count.min(4096)))
                .await
                .unwrap_or_default();
            if !value.is_empty() {
                return Some(value);
            }
        }
        return None;
    }
    if ifaces.contains(Interface::Value) {
        let value = a11y::value(conn, target).await?;
        let current = a11y::within(budget, value.current_value()).await?;
        return Some(format_number(current));
    }
    None
}

fn format_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        format!("{value}")
    }
}

fn states_of(states: &StateSet) -> Vec<String> {
    const NAMED: &[(State, &str)] = &[
        (State::Focused, "focused"),
        (State::Checked, "checked"),
        (State::Selected, "selected"),
        (State::Expanded, "expanded"),
        (State::Collapsed, "collapsed"),
        (State::Pressed, "pressed"),
        (State::Focusable, "focusable"),
        (State::Selectable, "selectable"),
        (State::Expandable, "expandable"),
        (State::Editable, "editable"),
        (State::Modal, "modal"),
        (State::Busy, "busy"),
        (State::Visible, "visible"),
        (State::Showing, "showing"),
    ];
    let mut names: Vec<String> = NAMED
        .iter()
        .filter(|(state, _)| states.contains(*state))
        .map(|(_, name)| (*name).to_string())
        .collect();
    if !states.contains(State::Enabled) {
        names.push("disabled".to_string());
    }
    names
}

fn actions_of(role: Role, states: &StateSet, ifaces: InterfaceSet) -> Vec<Action> {
    let mut actions = Vec::new();
    if ifaces.contains(Interface::Action) {
        push(&mut actions, Action::Press);
        if toggle_role(role) || states.contains(State::Checked) {
            push(&mut actions, Action::Toggle);
        }
        if states.contains(State::Expandable) {
            push(
                &mut actions,
                if states.contains(State::Expanded) {
                    Action::Collapse
                } else {
                    Action::Expand
                },
            );
        }
        if menu_role(role) {
            push(&mut actions, Action::ShowMenu);
        }
        if selectable_role(role) {
            push(&mut actions, Action::Select);
        }
    }
    if ifaces.contains(Interface::EditableText) || states.contains(State::Editable) {
        push(&mut actions, Action::SetValue);
        push(&mut actions, Action::Type);
    }
    if ifaces.contains(Interface::Value) {
        push(&mut actions, Action::SetValue);
        if role == Role::ScrollBar {
            push(&mut actions, Action::Scroll);
        }
    }
    if ifaces.contains(Interface::Component) {
        if scrollable_role(role) {
            push(&mut actions, Action::Scroll);
        }
        if states.contains(State::Focusable) {
            push(&mut actions, Action::Focus);
        }
    }
    actions
}

fn push(actions: &mut Vec<Action>, action: Action) {
    if !actions.contains(&action) {
        actions.push(action);
    }
}

fn toggle_role(role: Role) -> bool {
    matches!(
        role,
        Role::CheckBox
            | Role::CheckMenuItem
            | Role::RadioButton
            | Role::RadioMenuItem
            | Role::ToggleButton
    )
}

fn menu_role(role: Role) -> bool {
    matches!(
        role,
        Role::Menu | Role::MenuItem | Role::PopupMenu | Role::PushButtonMenu
    )
}

fn selectable_role(role: Role) -> bool {
    matches!(
        role,
        Role::ListItem
            | Role::TableCell
            | Role::TreeItem
            | Role::PageTab
            | Role::MenuItem
            | Role::RadioMenuItem
            | Role::CheckMenuItem
    )
}

fn scrollable_role(role: Role) -> bool {
    matches!(
        role,
        Role::ScrollPane
            | Role::Viewport
            | Role::List
            | Role::ListBox
            | Role::Table
            | Role::Tree
            | Role::TreeTable
            | Role::Text
            | Role::Terminal
            | Role::PageTabList
            | Role::DocumentText
            | Role::DocumentWeb
            | Role::DocumentFrame
            | Role::DocumentSpreadsheet
            | Role::DocumentPresentation
    )
}

fn value_role(role: Role, states: &StateSet) -> bool {
    matches!(
        role,
        Role::Entry
            | Role::PasswordText
            | Role::ComboBox
            | Role::SpinButton
            | Role::Slider
            | Role::ScrollBar
            | Role::ProgressBar
    ) || (role == Role::Text && states.contains(State::Editable))
}

pub(crate) fn is_window_role(role: Role) -> bool {
    matches!(
        role,
        Role::Frame | Role::Window | Role::Dialog | Role::Alert | Role::FileChooser
    )
}
