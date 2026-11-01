use std::collections::HashMap;

use kiko_driver::{Action, BrowserReadParams, MAX_NODES, Node, Page, Rect, Ref, Result, outline};
use serde_json::{Value, json};

use crate::cdp::Link;
use crate::image;
use crate::state::{State, split_tab};
use crate::tabs;

const MAX_BOXES: usize = 200;

#[derive(Debug, Clone)]
pub struct Anchor {
    pub backend: u32,
    pub frame: Option<String>,
}

#[derive(Debug, Default)]
pub struct Refs {
    by_node: HashMap<(u32, Option<String>), Ref>,
    by_ref: HashMap<Ref, Anchor>,
    next: Ref,
}

impl Refs {
    fn reference(&mut self, backend: u32, frame: Option<String>) -> Ref {
        let key = (backend, frame.clone());
        if let Some(reference) = self.by_node.get(&key) {
            return *reference;
        }
        self.next += 1;
        let reference = self.next;
        self.by_node.insert(key, reference);
        self.by_ref.insert(reference, Anchor { backend, frame });
        reference
    }

    pub fn anchor(&self, reference: Ref) -> Option<&Anchor> {
        self.by_ref.get(&reference)
    }
}

#[derive(Debug, Clone)]
struct AxNode {
    id: String,
    role: String,
    name: String,
    value: Option<String>,
    ignored: bool,
    backend: Option<u32>,
    children: Vec<String>,
    states: Vec<String>,
    frame: Option<String>,
}

#[derive(Debug, Default)]
struct Tree {
    nodes: Vec<AxNode>,
    index: HashMap<String, usize>,
}

impl Tree {
    fn parse(nodes: &Value) -> Self {
        let mut tree = Tree::default();
        let Some(nodes) = nodes.as_array() else {
            return tree;
        };
        for node in nodes {
            let Some(id) = node["nodeId"].as_str() else {
                continue;
            };
            let parsed = AxNode {
                id: id.to_string(),
                role: node["role"]["value"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                name: node["name"]["value"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                value: node["value"]["value"]
                    .as_str()
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                ignored: node["ignored"].as_bool().unwrap_or(false),
                backend: node["backendDOMNodeId"]
                    .as_u64()
                    .map(|backend| backend as u32),
                children: node["childIds"]
                    .as_array()
                    .map(|ids| {
                        ids.iter()
                            .filter_map(|id| id.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default(),
                states: states_of(node),
                frame: None,
            };
            tree.index.insert(id.to_string(), tree.nodes.len());
            tree.nodes.push(parsed);
        }
        tree
    }

    fn get(&self, id: &str) -> Option<&AxNode> {
        self.index.get(id).map(|index| &self.nodes[*index])
    }

    fn root(&self) -> Option<&AxNode> {
        self.nodes
            .iter()
            .find(|node| node.role == "RootWebArea")
            .or_else(|| self.nodes.first())
    }

    fn iframes(&self) -> Vec<(String, u32)> {
        self.nodes
            .iter()
            .filter(|node| node.role.eq_ignore_ascii_case("iframe"))
            .filter_map(|node| node.backend.map(|backend| (node.id.clone(), backend)))
            .collect()
    }

    fn graft(&mut self, anchor: &str, frame: &str, child: Tree) {
        let Some(root) = child.root().map(|node| node.id.clone()) else {
            return;
        };
        let prefix = format!("{anchor}/");
        let mut renamed = Tree::default();
        for mut node in child.nodes {
            node.id = format!("{prefix}{}", node.id);
            node.children = node
                .children
                .iter()
                .map(|id| format!("{prefix}{id}"))
                .collect();
            node.frame = Some(frame.to_string());
            renamed.index.insert(node.id.clone(), renamed.nodes.len());
            renamed.nodes.push(node);
        }
        let roots = renamed
            .get(&format!("{prefix}{root}"))
            .map(|node| node.children.clone())
            .unwrap_or_default();
        if let Some(index) = self.index.get(anchor).copied() {
            let existing = self.nodes[index].children.clone();
            self.nodes[index].children = existing.into_iter().chain(roots).collect();
        }
        for node in renamed.nodes {
            self.index.insert(node.id.clone(), self.nodes.len());
            self.nodes.push(node);
        }
    }
}

fn states_of(node: &Value) -> Vec<String> {
    let mut states = Vec::new();
    let Some(properties) = node["properties"].as_array() else {
        return states;
    };
    for property in properties {
        let name = property["name"].as_str().unwrap_or_default();
        let value = &property["value"]["value"];
        let truthy = value.as_bool() == Some(true) || value.as_str() == Some("true");
        match name {
            "focused" if truthy => states.push("focused".into()),
            "checked" if truthy => states.push("checked".into()),
            "checked" if value.as_str() == Some("mixed") => states.push("mixed".into()),
            "expanded" if truthy => states.push("expanded".into()),
            "expanded" if value.as_bool() == Some(false) => states.push("collapsed".into()),
            "disabled" if truthy => states.push("disabled".into()),
            "required" if truthy => states.push("required".into()),
            "selected" if truthy => states.push("selected".into()),
            "readonly" if truthy => states.push("readonly".into()),
            "pressed" if truthy => states.push("pressed".into()),
            "pressed" if value.as_str() == Some("mixed") => states.push("mixed".into()),
            "modal" if truthy => states.push("modal".into()),
            "editable" if value.as_str().is_some_and(|value| value != "false") => {
                states.push("editable".into())
            }
            "invalid"
                if value
                    .as_str()
                    .is_some_and(|value| !value.is_empty() && value != "false") =>
            {
                states.push("invalid".into())
            }
            _ => {}
        }
    }
    states
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

fn collapsible(node: &AxNode, role: &str) -> bool {
    matches!(
        role,
        "generic" | "none" | "GenericContainer" | "presentation"
    ) && node.name.is_empty()
        && node.value.is_none()
}

struct Builder<'a> {
    tree: &'a Tree,
    refs: &'a mut Refs,
    budget: usize,
}

impl Builder<'_> {
    fn build(&mut self, id: &str, out: &mut Vec<Node>) -> Vec<Ref> {
        let Some(node) = self.tree.get(id) else {
            return Vec::new();
        };
        let mut children = Vec::new();
        for child in &node.children {
            children.extend(self.build(child, out));
        }
        if node.ignored || self.budget == 0 {
            return children;
        }
        let Some(role) = role_of(&node.role) else {
            return children;
        };
        let Some(backend) = node.backend else {
            return children;
        };
        if collapsible(node, &role) {
            return children;
        }
        self.budget -= 1;
        let reference = self.refs.reference(backend, node.frame.clone());
        let actions = actions_for(&role);
        let entry = Node {
            reference,
            role,
            name: node.name.clone(),
            value: node.value.clone(),
            frame: None,
            states: node.states.clone(),
            actions,
            children,
        };
        out.push(entry);
        vec![reference]
    }
}

fn nodes_of(tree: &Tree, refs: &mut Refs) -> Vec<Node> {
    let Some(root) = tree.root().map(|node| node.id.clone()) else {
        return Vec::new();
    };
    let mut nodes = Vec::new();
    let mut builder = Builder {
        tree,
        refs,
        budget: MAX_NODES,
    };
    let root_children = tree
        .get(&root)
        .map(|node| node.children.clone())
        .unwrap_or_default();
    for child in root_children {
        builder.build(&child, &mut nodes);
    }
    nodes
}

pub async fn read(state: &mut State, params: &BrowserReadParams) -> Result<Page> {
    let (slug, target) = split_tab(&params.tab)?;
    let (link, session) = state.session(&slug, &target).await?;
    for domain in [
        "Page.enable",
        "DOM.enable",
        "Runtime.enable",
        "Accessibility.enable",
    ] {
        link.send_to(&session, domain, json!({})).await?;
    }
    let tab = tabs::one(state, &link, &slug, &target).await?;
    let tree = fetch(&link, &session, None).await?;
    let tree = with_frames(&link, &session, tree).await;
    let mut refs = std::mem::take(state.refs(&params.tab));
    let mut nodes = nodes_of(&tree, &mut refs);
    fill_boxes(&link, &session, &mut nodes, &refs).await;
    let page = Page {
        tab,
        outline: outline(&nodes),
        nodes,
        image: None,
    };
    *state.refs(&params.tab) = refs;
    let page = if params.image {
        let image = image::capture(&link, &session, params.max_width).await?;
        Page {
            image: Some(image),
            ..page
        }
    } else {
        page
    };
    Ok(page)
}

async fn fetch(link: &Link, session: &str, frame: Option<&str>) -> Result<Tree> {
    let params = match frame {
        Some(frame) => json!({ "frameId": frame }),
        None => json!({}),
    };
    let result = link
        .send_to(session, "Accessibility.getFullAXTree", params)
        .await?;
    Ok(Tree::parse(&result["nodes"]))
}

async fn with_frames(link: &Link, session: &str, mut tree: Tree) -> Tree {
    let iframes = tree.iframes();
    if iframes.is_empty() {
        return tree;
    }
    let frames = frame_ids(link, session).await;
    let targets = iframe_targets(link).await;
    for (anchor, backend) in iframes {
        let Some(frame) = describe_frame(link, session, backend).await else {
            continue;
        };
        if frames.contains(&frame) {
            if let Ok(child) = fetch(link, session, Some(&frame)).await {
                tree.graft(&anchor, &frame, child);
            }
        } else if targets.contains(&frame)
            && let Ok(iframe_session) = crate::state::attach(link, &frame).await
            && let Ok(child) = fetch(link, &iframe_session, None).await
        {
            tree.graft(&anchor, &frame, child);
        }
    }
    tree
}

async fn frame_ids(link: &Link, session: &str) -> Vec<String> {
    let Ok(result) = link.send_to(session, "Page.getFrameTree", json!({})).await else {
        return Vec::new();
    };
    let mut ids = Vec::new();
    collect_frames(&result["frameTree"], &mut ids);
    ids
}

fn collect_frames(tree: &Value, ids: &mut Vec<String>) {
    if let Some(id) = tree["frame"]["id"].as_str() {
        ids.push(id.to_string());
    }
    if let Some(children) = tree["childFrames"].as_array() {
        for child in children {
            collect_frames(child, ids);
        }
    }
}

async fn iframe_targets(link: &Link) -> Vec<String> {
    let Ok(result) = link.send("Target.getTargets", json!({})).await else {
        return Vec::new();
    };
    result["targetInfos"]
        .as_array()
        .map(|infos| {
            infos
                .iter()
                .filter(|info| info["type"] == "iframe")
                .filter_map(|info| info["targetId"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

async fn describe_frame(link: &Link, session: &str, backend: u32) -> Option<String> {
    let result = link
        .send_to(
            session,
            "DOM.describeNode",
            json!({ "backendNodeId": backend, "depth": 0 }),
        )
        .await
        .ok()?;
    result["node"]["frameId"].as_str().map(str::to_string)
}

async fn fill_boxes(link: &Link, session: &str, nodes: &mut [Node], refs: &Refs) {
    let mut boxes = 0;
    for node in nodes.iter_mut() {
        if node.actions.is_empty() || boxes >= MAX_BOXES {
            continue;
        }
        let Some(anchor) = refs.anchor(node.reference) else {
            continue;
        };
        let Ok(model) = link
            .send_to(
                session,
                "DOM.getBoxModel",
                json!({ "backendNodeId": anchor.backend }),
            )
            .await
        else {
            continue;
        };
        boxes += 1;
        node.frame = quad_rect(&model["model"]["content"]);
    }
}

pub(crate) fn quad_rect(quad: &Value) -> Option<Rect> {
    let values: Vec<f64> = quad.as_array()?.iter().filter_map(Value::as_f64).collect();
    if values.len() < 8 {
        return None;
    }
    let xs: Vec<f64> = values.iter().step_by(2).copied().collect();
    let ys: Vec<f64> = values.iter().skip(1).step_by(2).copied().collect();
    let x = xs.iter().copied().fold(f64::INFINITY, f64::min);
    let y = ys.iter().copied().fold(f64::INFINITY, f64::min);
    let right = xs.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let bottom = ys.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    Some(Rect {
        x,
        y,
        w: right - x,
        h: bottom - y,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> Tree {
        Tree::parse(&json!([
            { "nodeId": "1", "role": { "value": "RootWebArea" }, "name": { "value": "Doc" }, "childIds": ["2", "5"], "backendDOMNodeId": 1 },
            { "nodeId": "2", "role": { "value": "generic" }, "name": { "value": "" }, "childIds": ["3"], "backendDOMNodeId": 2 },
            { "nodeId": "3", "role": { "value": "button" }, "name": { "value": "Save" }, "childIds": [], "backendDOMNodeId": 3 },
            { "nodeId": "5", "ignored": true, "role": { "value": "none" }, "name": { "value": "" }, "childIds": ["6"], "backendDOMNodeId": 5 },
            { "nodeId": "6", "role": { "value": "textbox" }, "name": { "value": "Title" }, "value": { "value": "hello" }, "childIds": [], "backendDOMNodeId": 6,
              "properties": [{ "name": "focused", "value": { "value": true } }, { "name": "required", "value": { "value": true } }] }
        ]))
    }

    #[test]
    fn collapses_unnamed_generic_nodes_and_hoists_ignored_ones() {
        let mut refs = Refs::default();
        let nodes = nodes_of(&tree(), &mut refs);
        let roles: Vec<&str> = nodes.iter().map(|node| node.role.as_str()).collect();
        assert_eq!(roles, ["button", "text field"]);
        assert_eq!(nodes[0].name, "Save");
        assert_eq!(nodes[0].actions, [Action::Press]);
        assert_eq!(nodes[1].value.as_deref(), Some("hello"));
        assert_eq!(nodes[1].states, ["focused", "required"]);
        assert_eq!(
            nodes[1].actions,
            [Action::SetValue, Action::Type, Action::Focus]
        );
    }

    #[test]
    fn keeps_a_reference_stable_for_the_same_node() {
        let mut refs = Refs::default();
        let first = nodes_of(&tree(), &mut refs);
        let second = nodes_of(&tree(), &mut refs);
        assert_eq!(first[0].reference, second[0].reference);
        assert!(refs.anchor(first[0].reference).is_some());
    }

    #[test]
    fn grafts_a_child_frame_under_its_iframe() {
        let mut parent = Tree::parse(&json!([
            { "nodeId": "1", "role": { "value": "RootWebArea" }, "name": { "value": "Doc" }, "childIds": ["2"], "backendDOMNodeId": 1 },
            { "nodeId": "2", "role": { "value": "Iframe" }, "name": { "value": "" }, "childIds": [], "backendDOMNodeId": 2 }
        ]));
        let child = Tree::parse(&json!([
            { "nodeId": "1", "role": { "value": "RootWebArea" }, "name": { "value": "" }, "childIds": ["3"] },
            { "nodeId": "3", "role": { "value": "button" }, "name": { "value": "Inner" }, "childIds": [], "backendDOMNodeId": 9 }
        ]));
        parent.graft("2", "frame-1", child);
        let mut refs = Refs::default();
        let nodes = nodes_of(&parent, &mut refs);
        let frame = nodes
            .iter()
            .find(|node| node.role == "Iframe")
            .expect("the iframe node");
        let inner = nodes
            .iter()
            .find(|node| node.name == "Inner")
            .expect("the button inside the frame");
        assert_eq!(frame.children, [inner.reference]);
        assert_eq!(inner.actions, [Action::Press]);
        assert_eq!(
            refs.anchor(inner.reference)
                .and_then(|anchor| anchor.frame.as_deref()),
            Some("frame-1")
        );
    }

    #[test]
    fn reads_a_box_model_quad() {
        let rect = quad_rect(&json!([10, 20, 30, 20, 30, 40, 10, 40])).unwrap();
        assert_eq!(
            rect,
            Rect {
                x: 10.0,
                y: 20.0,
                w: 20.0,
                h: 20.0
            }
        );
    }
}
