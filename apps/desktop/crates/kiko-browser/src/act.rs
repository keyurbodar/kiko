use kiko_driver::{
    ActResult, BrowserActParams, DriverError, ErrorCode, Mode, PageAction, Result, Route,
};
use serde_json::{Value, json};

use crate::cdp::Link;
use crate::keys;
use crate::paint;
use crate::read::quad_rect;
use crate::state::{State, split_tab};

fn stale() -> DriverError {
    DriverError::new(ErrorCode::Stale, "that ref is stale; read the page again")
}

fn needed(action: PageAction) -> DriverError {
    DriverError::new(ErrorCode::Failed, format!("{action:?} needs text"))
}

pub async fn act(state: &mut State, params: &BrowserActParams) -> Result<ActResult> {
    let (slug, target) = split_tab(&params.tab)?;
    let (link, session) = state.session(&slug, &target).await?;
    if params.mode == Mode::Foreground {
        link.send("Target.activateTarget", json!({ "targetId": target }))
            .await?;
        if let Ok(window) = link
            .send("Browser.getWindowForTarget", json!({ "targetId": target }))
            .await
            && let Some(window) = window["windowId"].as_u64()
        {
            state.remember_active(&slug, window as u32, &params.tab);
        }
    }
    let anchor = state
        .refs(&params.tab)
        .anchor(params.reference)
        .cloned()
        .ok_or_else(stale)?;
    let in_frame = anchor.frame.is_some();
    let session = match anchor.frame.clone() {
        Some(frame) => state
            .session(&slug, &frame)
            .await
            .map(|(_, session)| session)
            .unwrap_or(session),
        None => session,
    };
    let text = params.text.as_deref().unwrap_or_default();
    let route = match params.action {
        PageAction::Click => click(&link, &session, anchor.backend, in_frame).await?,
        PageAction::Type => {
            if text.is_empty() {
                return Err(needed(params.action));
            }
            type_text(&link, &session, anchor.backend, text).await?
        }
        PageAction::SetValue => {
            if text.is_empty() {
                return Err(needed(params.action));
            }
            set_value(&link, &session, anchor.backend, text).await?;
            Route::Dom
        }
        PageAction::Select => {
            if text.is_empty() {
                return Err(needed(params.action));
            }
            select(&link, &session, anchor.backend, text).await?;
            Route::Dom
        }
        PageAction::PressKey => {
            let object = object(&link, &session, anchor.backend).await?;
            call(
                &link,
                &session,
                &object,
                "function(){ this.focus(); }",
                json!([]),
            )
            .await?;
            keys::press(&link, &session, text).await?;
            Route::Trusted
        }
        PageAction::Scroll => {
            let object = object(&link, &session, anchor.backend).await?;
            call(
                &link,
                &session,
                &object,
                "function(){ this.scrollIntoView({block:'center', inline:'nearest'}); }",
                json!([]),
            )
            .await?;
            Route::Dom
        }
        PageAction::Focus => {
            let object = object(&link, &session, anchor.backend).await?;
            call(
                &link,
                &session,
                &object,
                "function(){ this.focus(); }",
                json!([]),
            )
            .await?;
            Route::Dom
        }
    };
    Ok(ActResult { route })
}

async fn click(link: &Link, session: &str, backend: u32, in_frame: bool) -> Result<Route> {
    if !in_frame && trusted_click(link, session, backend).await.is_ok() {
        return Ok(Route::Trusted);
    }
    let object = object(link, session, backend).await?;
    call(
        link,
        session,
        &object,
        "function(){ this.click(); }",
        json!([]),
    )
    .await?;
    Ok(Route::Dom)
}

async fn trusted_click(link: &Link, session: &str, backend: u32) -> Result<()> {
    paint::emulate_visible(link, session, true).await?;
    let clicked = click_box(link, session, backend).await;
    let restored = paint::emulate_visible(link, session, false).await;
    clicked.and(restored)
}

async fn click_box(link: &Link, session: &str, backend: u32) -> Result<()> {
    let _ = link
        .send_to(
            session,
            "DOM.scrollIntoViewIfNeeded",
            json!({ "backendNodeId": backend }),
        )
        .await;
    paint::wait_for_frame(link, session).await?;
    let model = link
        .send_to(
            session,
            "DOM.getBoxModel",
            json!({ "backendNodeId": backend }),
        )
        .await?;
    let rect = quad_rect(&model["model"]["content"])
        .filter(|rect| rect.w > 0.0 && rect.h > 0.0)
        .ok_or_else(|| DriverError::new(ErrorCode::Failed, "that element has no box to click"))?;
    let (x, y) = (rect.x + rect.w / 2.0, rect.y + rect.h / 2.0);
    mouse(link, session, "mouseMoved", x, y, "none").await?;
    mouse(link, session, "mousePressed", x, y, "left").await?;
    mouse(link, session, "mouseReleased", x, y, "left").await
}

async fn mouse(link: &Link, session: &str, kind: &str, x: f64, y: f64, button: &str) -> Result<()> {
    let click_count = if kind == "mouseMoved" { 0 } else { 1 };
    let params = json!({ "type": kind, "x": x, "y": y, "button": button, "buttons": if button == "left" { 1 } else { 0 }, "clickCount": click_count });
    link.send_to(session, "Input.dispatchMouseEvent", params)
        .await?;
    Ok(())
}

async fn type_text(link: &Link, session: &str, backend: u32, text: &str) -> Result<Route> {
    let object = object(link, session, backend).await?;
    call(
        link,
        session,
        &object,
        "function(){ this.focus(); }",
        json!([]),
    )
    .await?;
    if link
        .send_to(session, "Input.insertText", json!({ "text": text }))
        .await
        .is_ok()
    {
        return Ok(Route::Trusted);
    }
    set_value(link, session, backend, text).await?;
    Ok(Route::Dom)
}

async fn set_value(link: &Link, session: &str, backend: u32, text: &str) -> Result<()> {
    let object = object(link, session, backend).await?;
    let function = "function(value) {
        if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
            const proto = this instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) { setter.call(this, value); } else { this.value = value; }
        } else if (this.isContentEditable) {
            this.textContent = value;
        } else {
            this.value = value;
        }
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }";
    call(link, session, &object, function, json!([{ "value": text }])).await?;
    Ok(())
}

async fn select(link: &Link, session: &str, backend: u32, text: &str) -> Result<()> {
    let object = object(link, session, backend).await?;
    let function = "function(wanted) {
        if (this instanceof HTMLOptionElement) {
            this.selected = true;
            const select = this.closest('select');
            if (select) {
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        }
        const options = Array.from(this.options || []);
        const option = options.find(option => option.value === wanted || (option.textContent || '').trim() === wanted || String(option.index) === wanted);
        if (!option) { return false; }
        this.value = option.value;
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }";
    let result = call(link, session, &object, function, json!([{ "value": text }])).await?;
    if result.get("value").and_then(Value::as_bool) == Some(false) {
        return Err(DriverError::new(
            ErrorCode::NotFound,
            format!("no option called {text}"),
        ));
    }
    Ok(())
}

async fn object(link: &Link, session: &str, backend: u32) -> Result<String> {
    let result = link
        .send_to(
            session,
            "DOM.resolveNode",
            json!({ "backendNodeId": backend }),
        )
        .await?;
    result["object"]["objectId"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(stale)
}

async fn call(
    link: &Link,
    session: &str,
    object: &str,
    function: &str,
    arguments: Value,
) -> Result<Value> {
    let result = link
        .send_to(
            session,
            "Runtime.callFunctionOn",
            json!({ "objectId": object, "functionDeclaration": function, "arguments": arguments, "returnByValue": true }),
        )
        .await?;
    if let Some(exception) = result.get("exceptionDetails") {
        let text = exception["exception"]["description"]
            .as_str()
            .unwrap_or("the page raised an error");
        return Err(DriverError::new(ErrorCode::Failed, text.to_string()));
    }
    Ok(result.get("result").cloned().unwrap_or(Value::Null))
}
