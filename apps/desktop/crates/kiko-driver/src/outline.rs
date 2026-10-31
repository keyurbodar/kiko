use std::collections::{HashMap, HashSet};
use std::fmt::Write;

use crate::api::{Node, Ref};

pub const MAX_NODES: usize = 2_000;

fn quoted(text: &str) -> String {
    let flat: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let short: String = flat.chars().take(120).collect();
    format!("{short:?}")
}

fn is_noise(node: &Node) -> bool {
    node.name.is_empty()
        && node.value.is_none()
        && node.actions.is_empty()
        && !node.children.is_empty()
}

fn line(node: &Node, depth: usize, out: &mut String) {
    let _ = write!(
        out,
        "{}[{}] {}",
        "  ".repeat(depth),
        node.reference,
        node.role
    );
    if !node.name.is_empty() {
        let _ = write!(out, " {}", quoted(&node.name));
    }
    if let Some(value) = node.value.as_deref().filter(|v| !v.is_empty()) {
        let _ = write!(out, " = {}", quoted(value));
    }
    if !node.states.is_empty() {
        let _ = write!(out, " {{{}}}", node.states.join(","));
    }
    out.push('\n');
}

pub fn outline(nodes: &[Node]) -> String {
    let by_ref: HashMap<Ref, &Node> = nodes.iter().map(|n| (n.reference, n)).collect();
    let children: HashSet<Ref> = nodes
        .iter()
        .flat_map(|n| n.children.iter().copied())
        .collect();
    let mut out = String::new();
    let mut seen = HashSet::new();
    let mut stack: Vec<(Ref, usize)> = nodes
        .iter()
        .filter(|n| !children.contains(&n.reference))
        .map(|n| (n.reference, 0))
        .rev()
        .collect();
    if stack.is_empty() {
        stack.extend(nodes.first().map(|n| (n.reference, 0)));
    }
    while let Some((reference, depth)) = stack.pop() {
        if seen.len() >= MAX_NODES || !seen.insert(reference) {
            continue;
        }
        let Some(node) = by_ref.get(&reference) else {
            continue;
        };
        let next = if is_noise(node) {
            depth
        } else {
            line(node, depth, &mut out);
            depth + 1
        };
        stack.extend(node.children.iter().rev().map(|c| (*c, next)));
    }
    if seen.len() >= MAX_NODES {
        out.push_str("… more elements not shown; look at a smaller window or scroll\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::Action;

    fn node(reference: Ref, role: &str, name: &str, children: Vec<Ref>) -> Node {
        Node {
            reference,
            role: role.into(),
            name: name.into(),
            value: None,
            frame: None,
            states: vec![],
            actions: if name.is_empty() {
                vec![]
            } else {
                vec![Action::Press]
            },
            children,
        }
    }

    #[test]
    fn nests_named_nodes_and_flattens_anonymous_groups() {
        let nodes = vec![
            node(1, "window", "Notes", vec![2]),
            node(2, "group", "", vec![3, 4]),
            node(3, "button", "Save", vec![]),
            node(4, "text field", "Title", vec![]),
        ];
        assert_eq!(
            outline(&nodes),
            "[1] window \"Notes\"\n  [3] button \"Save\"\n  [4] text field \"Title\"\n"
        );
    }

    #[test]
    fn survives_cycles() {
        let nodes = vec![
            node(1, "window", "A", vec![2]),
            node(2, "button", "B", vec![1]),
        ];
        assert_eq!(outline(&nodes), "[1] window \"A\"\n  [2] button \"B\"\n");
    }
}
