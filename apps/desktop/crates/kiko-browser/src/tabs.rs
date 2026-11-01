use kiko_driver::{BrowserOpenParams, DriverError, ErrorCode, Mode, Result, Tab, TabParams};
use serde_json::{Value, json};

use crate::cdp::Link;
use crate::state::{State, split_tab, tab_of};

pub async fn list(state: &mut State, link: &Link, slug: &str) -> Result<Vec<Tab>> {
    let targets = link.send("Target.getTargets", json!({})).await?;
    let pages: Vec<Value> = targets
        .get("targetInfos")
        .and_then(Value::as_array)
        .map(|infos| {
            infos
                .iter()
                .filter(|info| info["type"] == "page")
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    let mut windows: Vec<(u32, Vec<Value>)> = Vec::new();
    for page in pages {
        let window = window_of(link, &page).await;
        match windows.iter_mut().find(|(id, _)| *id == window) {
            Some((_, group)) => group.push(page),
            None => windows.push((window, vec![page])),
        }
    }
    let mut tabs = Vec::new();
    for (window, group) in windows {
        let active = active_in(state, slug, window, &group).await;
        for (index, page) in group.iter().enumerate() {
            let target = page["targetId"].as_str().unwrap_or_default();
            let id = format!("{slug}:{target}");
            let title = match page["title"].as_str().unwrap_or_default() {
                "" => document_title(state, slug, target)
                    .await
                    .unwrap_or_default(),
                title => title.to_string(),
            };
            tabs.push(tab_of(
                slug,
                target,
                window,
                index as u32,
                active.as_deref() == Some(id.as_str()),
                title,
                page["url"].as_str().unwrap_or_default().to_string(),
            ));
        }
        if let Some(active) = active {
            state.remember_active(slug, window, &active);
        }
    }
    Ok(tabs)
}

pub async fn one(state: &mut State, link: &Link, slug: &str, target: &str) -> Result<Tab> {
    list(state, link, slug)
        .await?
        .into_iter()
        .find(|tab| tab.id == format!("{slug}:{target}"))
        .ok_or_else(|| {
            DriverError::new(
                ErrorCode::NotFound,
                format!("{} has no tab {target}", link.name()),
            )
        })
}

async fn window_of(link: &Link, page: &Value) -> u32 {
    let target = page["targetId"].as_str().unwrap_or_default();
    link.send("Browser.getWindowForTarget", json!({ "targetId": target }))
        .await
        .ok()
        .and_then(|window| window["windowId"].as_u64())
        .map(|window| window as u32)
        .unwrap_or_default()
}

async fn document_title(state: &mut State, slug: &str, target: &str) -> Option<String> {
    let (link, session) = state.session(slug, target).await.ok()?;
    evaluate(&link, &session, "document.title")
        .await
        .and_then(|value| value.as_str().map(str::to_string))
}

pub async fn evaluate(link: &Link, session: &str, expression: &str) -> Option<Value> {
    let result = link
        .send_to(
            session,
            "Runtime.evaluate",
            json!({ "expression": expression, "returnByValue": true }),
        )
        .await
        .ok()?;
    result.get("result")?.get("value").cloned()
}

async fn active_in(state: &mut State, slug: &str, window: u32, group: &[Value]) -> Option<String> {
    if group.len() == 1 {
        return group[0]["targetId"]
            .as_str()
            .map(|target| format!("{slug}:{target}"));
    }
    let mut visible = Vec::new();
    let mut focused = Vec::new();
    for page in group {
        let Some(target) = page["targetId"].as_str() else {
            continue;
        };
        let Ok((link, session)) = state.session(slug, target).await else {
            continue;
        };
        let state_of = evaluate(
            &link,
            &session,
            "[document.visibilityState, document.hasFocus()]",
        )
        .await;
        let Some(state_of) = state_of.as_ref().and_then(Value::as_array) else {
            continue;
        };
        let id = format!("{slug}:{target}");
        if state_of.first().and_then(Value::as_str) == Some("visible") {
            visible.push(id.clone());
        }
        if state_of.get(1).and_then(Value::as_bool) == Some(true) {
            focused.push(id);
        }
    }
    if visible.len() == 1 {
        return visible.pop();
    }
    if focused.len() == 1 {
        return focused.pop();
    }
    state.remembered_active(slug, window).map(str::to_string)
}

pub async fn open(state: &mut State, params: &BrowserOpenParams) -> Result<Tab> {
    let link = state.preferred().await?;
    let slug = link.slug().to_string();
    let background = params.mode == Mode::Background;
    let created = link
        .send(
            "Target.createTarget",
            json!({ "url": params.url, "background": background, "newWindow": false }),
        )
        .await?;
    let target = created
        .get("targetId")
        .and_then(Value::as_str)
        .ok_or_else(|| DriverError::new(ErrorCode::Failed, "the browser did not open a tab"))?
        .to_string();
    if !background {
        link.send("Target.activateTarget", json!({ "targetId": target }))
            .await?;
    }
    let tab = one(state, &link, &slug, &target).await?;
    if tab.active {
        state.remember_active(&slug, tab.window_id, &tab.id);
    }
    Ok(tab)
}

pub async fn close(state: &mut State, params: &TabParams) -> Result<()> {
    let (slug, target) = split_tab(&params.tab)?;
    let link = state.link(&slug).await?;
    state.forget_session(&slug, &target);
    state.forget_tab(&params.tab);
    let closed = link
        .send("Target.closeTarget", json!({ "targetId": target }))
        .await?;
    if closed.get("success").and_then(Value::as_bool) == Some(false) {
        return Err(DriverError::new(
            ErrorCode::NotFound,
            format!("{} has no tab {}", link.name(), params.tab),
        ));
    }
    Ok(())
}

pub async fn show(state: &mut State, params: &TabParams) -> Result<()> {
    let (slug, target) = split_tab(&params.tab)?;
    let link = state.link(&slug).await?;
    link.send("Target.activateTarget", json!({ "targetId": target }))
        .await?;
    let window = link
        .send("Browser.getWindowForTarget", json!({ "targetId": target }))
        .await
        .ok();
    let window_id = window
        .as_ref()
        .and_then(|window| window["windowId"].as_u64())
        .unwrap_or_default() as u32;
    if window
        .as_ref()
        .and_then(|window| window["bounds"]["windowState"].as_str())
        == Some("minimized")
    {
        let _ = link
            .send(
                "Browser.setWindowBounds",
                json!({ "windowId": window_id, "bounds": { "windowState": "normal" } }),
            )
            .await;
    }
    state.remember_active(&slug, window_id, &params.tab);
    Ok(())
}
