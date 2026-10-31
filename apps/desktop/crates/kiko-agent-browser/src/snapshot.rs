use std::collections::HashSet;

use kiko_driver::{Action, Node, Ref};

pub const SYNTHETIC_BASE: Ref = 1_000_000;

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub depth: usize,
    pub role: String,
    pub name: String,
    pub value: Option<String>,
    pub states: Vec<String>,
    pub reference: Option<Ref>,
}

pub struct Built {
    pub nodes: Vec<Node>,
    pub refs: HashSet<Ref>,
}

pub fn parse(tree: &str) -> Vec<Entry> {
    tree.lines().filter_map(parse_line).collect()
}

pub fn build(entries: &[Entry], budget: usize) -> Built {
    let tree = Tree::new(entries);
    let mut builder = Builder {
        entries,
        tree: &tree,
        out: Vec::new(),
        refs: HashSet::new(),
        budget,
        synthetic: 0,
    };
    for &root in &tree.roots {
        builder.visit(root);
    }
    Built {
        nodes: builder.out,
        refs: builder.refs,
    }
}

fn parse_line(line: &str) -> Option<Entry> {
    let trimmed = line.trim_start_matches(' ');
    let spaces = line.len() - trimmed.len();
    let body = trimmed.strip_prefix("- ")?;
    let end = body
        .find(|character: char| {
            character == ' ' || character == '"' || character == '[' || character == ':'
        })
        .unwrap_or(body.len());
    if end == 0 {
        return None;
    }
    let role = body[..end].to_string();
    let mut rest = body[end..].strip_prefix(' ').unwrap_or(&body[end..]);
    let mut name = String::new();
    if rest.starts_with('"') {
        let (value, used) = quoted(rest)?;
        name = value;
        rest = rest[used..].strip_prefix(' ').unwrap_or(&rest[used..]);
    }
    let mut states = Vec::new();
    let mut reference = None;
    if let Some(after) = rest.strip_prefix('[') {
        let close = after.find(']')?;
        attributes(&after[..close], &mut reference, &mut states);
        rest = &after[close + 1..];
    }
    let value = rest
        .find(": ")
        .map(|at| rest[at + 2..].to_string())
        .filter(|value| !value.is_empty());
    Some(Entry {
        depth: spaces / 2,
        role,
        name,
        value,
        states,
        reference,
    })
}

fn quoted(text: &str) -> Option<(String, usize)> {
    let mut escaped = false;
    for (index, character) in text.char_indices().skip(1) {
        if escaped {
            escaped = false;
            continue;
        }
        match character {
            '\\' => escaped = true,
            '"' => {
                return Some((
                    serde_json::from_str::<String>(&text[..=index]).ok()?,
                    index + 1,
                ));
            }
            _ => {}
        }
    }
    None
}

fn attributes(attrs: &str, reference: &mut Option<Ref>, states: &mut Vec<String>) {
    for attr in attrs.split(", ") {
        if let Some(value) = attr.strip_prefix("checked=") {
            match value {
                "true" => states.push("checked".into()),
                "mixed" => states.push("mixed".into()),
                _ => {}
            }
        } else if let Some(value) = attr.strip_prefix("expanded=") {
            match value {
                "true" => states.push("expanded".into()),
                "false" => states.push("collapsed".into()),
                _ => {}
            }
        } else if let Some(value) = attr.strip_prefix("ref=") {
            *reference = value
                .strip_prefix('e')
                .and_then(|number| number.parse().ok());
        } else if matches!(attr, "selected" | "disabled" | "required") {
            states.push(attr.to_string());
        }
    }
}

fn role_of(role: &str) -> Option<String> {
    let mapped = match role {
        "InlineTextBox" | "LineBreak" => return None,
        "RootWebArea" => "document",
        "StaticText" => "text",
        "textbox" => "text field",
        "combobox" => "combo box",
        "listbox" | "MenuListPopup" => "list box",
        other => other,
    };
    Some(mapped.to_string())
}

fn actions_for(role: &str) -> Vec<Action> {
    match role {
        "button" | "link" | "menuitem" | "tab" | "menuitemcheckbox" | "menuitemradio" => {
            vec![Action::Press]
        }
        "option" => vec![Action::Press, Action::Select],
        "checkbox" | "radio" | "switch" => vec![Action::Press, Action::Toggle],
        "text field" | "searchbox" | "combo box" | "spinbutton" => {
            vec![Action::SetValue, Action::Type, Action::Focus]
        }
        "list box" => vec![Action::Select, Action::Focus],
        "slider" => vec![Action::SetValue, Action::Focus],
        _ => Vec::new(),
    }
}

fn collapsible(entry: &Entry, role: &str) -> bool {
    matches!(
        role,
        "generic" | "none" | "GenericContainer" | "presentation"
    ) && entry.name.is_empty()
        && entry.value.is_none()
}

struct Tree {
    roots: Vec<usize>,
    children: Vec<Vec<usize>>,
}

impl Tree {
    fn new(entries: &[Entry]) -> Self {
        let mut roots = Vec::new();
        let mut children = vec![Vec::new(); entries.len()];
        let mut stack: Vec<usize> = Vec::new();
        for (index, entry) in entries.iter().enumerate() {
            while let Some(&top) = stack.last() {
                if entries[top].depth >= entry.depth {
                    stack.pop();
                } else {
                    break;
                }
            }
            match stack.last() {
                Some(&parent) => children[parent].push(index),
                None => roots.push(index),
            }
            stack.push(index);
        }
        Self { roots, children }
    }
}

struct Builder<'a> {
    entries: &'a [Entry],
    tree: &'a Tree,
    out: Vec<Node>,
    refs: HashSet<Ref>,
    budget: usize,
    synthetic: Ref,
}

impl Builder<'_> {
    fn visit(&mut self, index: usize) -> Vec<Ref> {
        let entry = &self.entries[index];
        let mut children = Vec::new();
        for &child in &self.tree.children[index] {
            children.extend(self.visit(child));
        }
        if self.budget == 0 {
            return children;
        }
        let Some(role) = role_of(&entry.role) else {
            return children;
        };
        if collapsible(entry, &role) {
            return children;
        }
        self.budget -= 1;
        let (reference, actionable) = match entry.reference {
            Some(reference) => {
                self.refs.insert(reference);
                (reference, true)
            }
            None => {
                self.synthetic += 1;
                (SYNTHETIC_BASE + self.synthetic, false)
            }
        };
        let actions = if actionable {
            actions_for(&role)
        } else {
            Vec::new()
        };
        self.out.push(Node {
            reference,
            role,
            name: entry.name.clone(),
            value: entry.value.clone(),
            frame: None,
            states: entry.states.clone(),
            actions,
            children,
        });
        vec![reference]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_snapshot_line_with_a_name_and_attributes() {
        let entries = parse(
            "- heading \"Title\" [level=2]\n  - button \"Save\" [disabled, ref=e7]\n  - textbox \"Name\" [ref=e9]: hello\n",
        );
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].role, "heading");
        assert_eq!(entries[0].name, "Title");
        assert_eq!(entries[0].depth, 0);
        assert_eq!(entries[1].depth, 1);
        assert_eq!(entries[1].states, ["disabled"]);
        assert_eq!(entries[1].reference, Some(7));
        assert_eq!(entries[2].role, "textbox");
        assert_eq!(entries[2].value.as_deref(), Some("hello"));
    }

    #[test]
    fn reads_a_value_without_a_name_and_skips_cursor_hints() {
        let entries =
            parse("- paragraph\n  - text: Hello\n  - generic clickable [cursor=pointer]: Press\n");
        assert_eq!(entries[1].role, "text");
        assert_eq!(entries[1].value.as_deref(), Some("Hello"));
        assert_eq!(entries[2].value.as_deref(), Some("Press"));
        assert_eq!(entries[2].reference, None);
    }

    #[test]
    fn keeps_quoted_names_with_escapes() {
        let entries = parse("- button \"Save \\\"draft\\\"\" [ref=e1]\n");
        assert_eq!(entries[0].name, "Save \"draft\"");
        assert_eq!(entries[0].reference, Some(1));
    }

    #[test]
    fn builds_nested_nodes_and_collapses_anonymous_groups() {
        let built = build(
            &parse(
                "- generic\n  - button \"Save\" [ref=e1]\n  - textbox \"Title\" [ref=e2]\n- StaticText \"Hello\"\n",
            ),
            2_000,
        );
        let roles: Vec<&str> = built.nodes.iter().map(|node| node.role.as_str()).collect();
        assert_eq!(roles, ["button", "text field", "text"]);
        assert_eq!(built.nodes[0].actions, [Action::Press]);
        assert_eq!(
            built.nodes[1].actions,
            [Action::SetValue, Action::Type, Action::Focus]
        );
        assert_eq!(built.nodes[0].reference, 1);
        assert!(built.refs.contains(&1));
        assert!(built.nodes[2].reference >= SYNTHETIC_BASE);
        assert!(built.nodes[2].actions.is_empty());
    }

    #[test]
    fn nests_children_under_their_parent() {
        let built = build(
            &parse("- list\n  - listitem \"One\"\n    - link \"A\" [ref=e3]\n"),
            2_000,
        );
        let link = built
            .nodes
            .iter()
            .find(|node| node.role == "link")
            .expect("the link");
        let item = built
            .nodes
            .iter()
            .find(|node| node.name == "One")
            .expect("the item");
        assert_eq!(item.children, [link.reference]);
    }

    #[test]
    fn stops_at_the_budget() {
        let built = build(
            &parse("- button \"A\" [ref=e1]\n- button \"B\" [ref=e2]\n"),
            1,
        );
        assert_eq!(built.nodes.len(), 1);
    }
}
