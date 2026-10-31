use atspi::proxy::accessible::AccessibleProxy;
use atspi::proxy::action::ActionProxy;
use atspi::proxy::editable_text::EditableTextProxy;
use atspi::proxy::proxy_ext::ProxyExt;
use atspi::zbus::Connection;
use atspi::{CoordType, ScrollType};
use kiko_driver::{ActParams, ActResult, Action, ErrorCode, Rect, Route};

use crate::a11y::{self, CALL, Target};
use crate::error::{background_unavailable, failed, stale};

const PRESS: &[&str] = &[
    "click",
    "press",
    "activate",
    "activate-default",
    "do-default",
    "open",
    "jump",
];
const TOGGLE: &[&str] = &["toggle", "check", "click", "press", "activate"];
const EXPAND: &[&str] = &["expand", "open", "activate"];
const COLLAPSE: &[&str] = &["collapse", "close", "activate"];
const MENU: &[&str] = &["show-menu", "menu", "open", "press", "click"];
const SELECT: &[&str] = &["select", "click", "press", "activate"];

pub(crate) async fn background(
    conn: &Connection,
    target: &Target,
    params: &ActParams,
) -> kiko_driver::Result<ActResult> {
    if params.reference.is_none() && params.point.is_some() {
        return Err(background_unavailable(
            "background mode cannot click at a point; pass a ref or use foreground mode",
        ));
    }
    let accessible = a11y::accessible(conn, target).await?;
    a11y::within(CALL, accessible.get_role())
        .await
        .ok_or_else(stale)?;
    let result = match params.action {
        Action::Press => named(&accessible, PRESS, true).await,
        Action::Toggle => named(&accessible, TOGGLE, true).await,
        Action::Expand => named(&accessible, EXPAND, false).await,
        Action::Collapse => named(&accessible, COLLAPSE, false).await,
        Action::ShowMenu => named(&accessible, MENU, false).await,
        Action::Select => select(conn, &accessible, target).await,
        Action::SetValue => {
            set_value(&accessible, params.text.as_deref().unwrap_or_default()).await
        }
        Action::Type => type_text(&accessible, params.text.as_deref().unwrap_or_default()).await,
        Action::Scroll => scroll(&accessible, params.dx, params.dy).await,
        Action::Focus => Err(background_unavailable(
            "focusing raises the window on Linux; use foreground mode",
        )),
        Action::Key => Err(background_unavailable(
            "keyboard input needs foreground mode on Linux; use set_value or type",
        )),
        Action::Raise => Err(background_unavailable(
            "raising a window changes what the owner sees; use foreground mode",
        )),
    };
    result.map(|()| ActResult {
        route: Route::Accessibility,
    })
}

async fn named(
    accessible: &AccessibleProxy<'_>,
    preferred: &[&str],
    single_fallback: bool,
) -> kiko_driver::Result<()> {
    let proxies = a11y::within(CALL, accessible.proxies())
        .await
        .ok_or_else(|| background_unavailable("the element did not answer"))?;
    let action = proxies.action().await.map_err(|_| {
        background_unavailable("this element has no accessibility action; use foreground mode")
    })?;
    let names = action_names(&action).await;
    let index = choose(&names, preferred, single_fallback).ok_or_else(|| {
        background_unavailable(format!(
            "no matching action on this element ({}); use foreground mode",
            names.join(", ")
        ))
    })?;
    dispatch(&action, index).await
}

async fn action_names(action: &ActionProxy<'_>) -> Vec<String> {
    if let Some(actions) = a11y::within(CALL, action.get_actions()).await {
        return actions.into_iter().map(|action| action.name).collect();
    }
    let count = a11y::within(CALL, action.n_actions()).await.unwrap_or(0);
    let mut names = Vec::new();
    for index in 0..count.max(0) {
        if let Some(name) = a11y::within(CALL, action.get_name(index)).await {
            names.push(name);
        }
    }
    names
}

fn choose(names: &[String], preferred: &[&str], single_fallback: bool) -> Option<usize> {
    for want in preferred {
        if let Some(index) = names
            .iter()
            .position(|name| name.eq_ignore_ascii_case(want))
        {
            return Some(index);
        }
    }
    for want in preferred {
        if let Some(index) = names
            .iter()
            .position(|name| name.to_lowercase().contains(want))
        {
            return Some(index);
        }
    }
    if single_fallback
        && !names.is_empty()
        && (names.len() == 1 || names.iter().all(|name| name.trim().is_empty()))
    {
        return Some(0);
    }
    None
}

async fn dispatch(action: &ActionProxy<'_>, index: usize) -> kiko_driver::Result<()> {
    match tokio::time::timeout(CALL, action.do_action(index as i32)).await {
        Ok(Ok(true)) => Ok(()),
        Ok(Ok(false)) => Err(failed("the app refused the action")),
        Ok(Err(error)) => Err(failed(format!("the action failed: {error}"))),
        Err(_) => Ok(()),
    }
}

async fn set_value(accessible: &AccessibleProxy<'_>, text: &str) -> kiko_driver::Result<()> {
    let proxies = a11y::within(CALL, accessible.proxies())
        .await
        .ok_or_else(|| background_unavailable("the element did not answer"))?;
    if let Ok(editable) = proxies.editable_text().await {
        return write_text(&editable, text).await;
    }
    if let Ok(value) = proxies.value().await {
        let number: f64 = text
            .trim()
            .parse()
            .map_err(|_| failed("that element takes a number, not text"))?;
        return value
            .set_current_value(number)
            .await
            .map_err(|error| failed(format!("could not set the value: {error}")));
    }
    Err(background_unavailable(
        "this element takes no text; use foreground mode",
    ))
}

async fn write_text(editable: &EditableTextProxy<'_>, text: &str) -> kiko_driver::Result<()> {
    match tokio::time::timeout(CALL, editable.set_text_contents(text)).await {
        Ok(Ok(true)) => Ok(()),
        Ok(Ok(false)) => Err(failed("the app refused the text")),
        Ok(Err(error)) => Err(failed(format!("could not set the text: {error}"))),
        Err(_) => Ok(()),
    }
}

async fn type_text(accessible: &AccessibleProxy<'_>, text: &str) -> kiko_driver::Result<()> {
    let proxies = a11y::within(CALL, accessible.proxies())
        .await
        .ok_or_else(|| background_unavailable("the element did not answer"))?;
    let editable = proxies.editable_text().await.map_err(|_| {
        background_unavailable("this element takes no typed text; use foreground mode")
    })?;
    let offset = match proxies.text().await {
        Ok(text_proxy) => a11y::within(CALL, text_proxy.character_count())
            .await
            .unwrap_or(0)
            .max(0),
        Err(_) => 0,
    };
    let length = i32::try_from(text.chars().count()).unwrap_or(i32::MAX);
    match tokio::time::timeout(CALL, editable.insert_text(offset, text, length)).await {
        Ok(Ok(true)) => Ok(()),
        Ok(Ok(false)) => Err(failed("the app refused the text")),
        Ok(Err(error)) => Err(failed(format!("could not type the text: {error}"))),
        Err(_) => Ok(()),
    }
}

async fn select(
    conn: &Connection,
    accessible: &AccessibleProxy<'_>,
    target: &Target,
) -> kiko_driver::Result<()> {
    match named(accessible, SELECT, false).await {
        Ok(()) => return Ok(()),
        Err(error) if error.code != ErrorCode::BackgroundUnavailable => return Err(error),
        Err(_) => {}
    }
    let parent = a11y::within(CALL, accessible.parent())
        .await
        .ok_or_else(|| {
            background_unavailable("this element cannot be selected in the background")
        })?;
    let parent_target = Target::from_ref(&parent).ok_or_else(|| {
        background_unavailable("this element cannot be selected in the background")
    })?;
    let parent_accessible = a11y::accessible(conn, &parent_target).await?;
    let siblings = a11y::within(CALL, parent_accessible.get_children())
        .await
        .unwrap_or_default();
    let index = siblings
        .iter()
        .position(|sibling| Target::from_ref(sibling).as_ref() == Some(target))
        .ok_or_else(|| {
            background_unavailable("this element cannot be selected in the background")
        })?;
    let selection = a11y::selection(conn, &parent_target).await.ok_or_else(|| {
        background_unavailable("the container has no selection interface; use foreground mode")
    })?;
    match tokio::time::timeout(CALL, selection.select_child(index as i32)).await {
        Ok(Ok(true)) => Ok(()),
        Ok(Ok(false)) => Err(failed("the app refused the selection")),
        Ok(Err(error)) => Err(failed(format!("could not select: {error}"))),
        Err(_) => Ok(()),
    }
}

async fn scroll(accessible: &AccessibleProxy<'_>, dx: f64, dy: f64) -> kiko_driver::Result<()> {
    let proxies = a11y::within(CALL, accessible.proxies())
        .await
        .ok_or_else(|| background_unavailable("the element did not answer"))?;
    if let Ok(value) = proxies.value().await {
        let current = a11y::within(CALL, value.current_value())
            .await
            .unwrap_or(0.0);
        let delta = if dy.abs() > f64::EPSILON { dy } else { dx };
        let maximum = a11y::within(CALL, value.maximum_value())
            .await
            .unwrap_or(current + delta.abs());
        let minimum = a11y::within(CALL, value.minimum_value())
            .await
            .unwrap_or(0.0);
        return value
            .set_current_value((current + delta).clamp(minimum, maximum))
            .await
            .map_err(|error| failed(format!("could not scroll: {error}")));
    }
    let component = proxies.component().await.map_err(|_| {
        background_unavailable("this element cannot scroll in the background; use foreground mode")
    })?;
    let scroll_type = if dy > 0.0 {
        ScrollType::BottomEdge
    } else if dy < 0.0 {
        ScrollType::TopEdge
    } else if dx > 0.0 {
        ScrollType::RightEdge
    } else if dx < 0.0 {
        ScrollType::LeftEdge
    } else {
        ScrollType::Anywhere
    };
    match tokio::time::timeout(CALL, component.scroll_to(scroll_type)).await {
        Ok(Ok(true)) => Ok(()),
        Ok(Ok(false)) => Err(background_unavailable(
            "this element did not scroll; use foreground mode",
        )),
        Ok(Err(error)) => Err(failed(format!("could not scroll: {error}"))),
        Err(_) => Ok(()),
    }
}

pub(crate) async fn focus(conn: &Connection, target: &Target) -> kiko_driver::Result<()> {
    let component = a11y::component(conn, target)
        .await
        .ok_or_else(|| background_unavailable("this element cannot take focus"))?;
    component
        .grab_focus()
        .await
        .map_err(|error| failed(format!("could not focus: {error}")))?;
    Ok(())
}

pub(crate) async fn node_rect(conn: &Connection, target: &Target) -> Option<Rect> {
    let component = a11y::component(conn, target).await?;
    let (x, y, w, h) = a11y::within(CALL, component.get_extents(CoordType::Window)).await?;
    (w > 0 && h > 0).then(|| Rect {
        x: f64::from(x),
        y: f64::from(y),
        w: f64::from(w),
        h: f64::from(h),
    })
}

#[cfg(test)]
mod tests {
    use super::{EXPAND, PRESS, choose};

    fn names(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    #[test]
    fn prefers_click_over_other_actions() {
        assert_eq!(choose(&names(&["activate", "click"]), PRESS, true), Some(1));
    }

    #[test]
    fn falls_back_to_the_only_action() {
        assert_eq!(choose(&names(&["push"]), PRESS, true), Some(0));
    }

    #[test]
    fn falls_back_when_names_are_blank() {
        assert_eq!(choose(&names(&["", ""]), PRESS, true), Some(0));
    }

    #[test]
    fn refuses_when_nothing_matches_and_there_is_no_fallback() {
        assert_eq!(choose(&names(&["", ""]), EXPAND, false), None);
    }
}
