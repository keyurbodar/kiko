use std::time::{Duration, Instant};

use kiko_browser::browser;
use kiko_driver::{
    Browser, BrowserActParams, BrowserEvalParams, BrowserOpenParams, BrowserReadParams,
    BrowserState, ErrorCode, Mode, Node, Page, PageAction, Route, Tab,
};
use serde_json::Value;

fn page_url(name: &str) -> String {
    let base =
        std::env::var("KIKO_E2E_PAGE").expect("KIKO_E2E_PAGE must point at the fixture page");
    format!("{base}?name={name}")
}

fn wait_for<T>(what: &str, mut probe: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if let Some(value) = probe() {
            return value;
        }
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn eval(driver: &mut Box<dyn Browser>, tab: &Tab, expression: &str) -> Value {
    driver
        .eval(&BrowserEvalParams {
            tab: tab.id.clone(),
            expression: expression.to_string(),
        })
        .unwrap_or_else(|error| panic!("eval {expression} failed: {error}"))
}

fn try_eval(driver: &mut Box<dyn Browser>, tab: &Tab, expression: &str) -> Option<Value> {
    driver
        .eval(&BrowserEvalParams {
            tab: tab.id.clone(),
            expression: expression.to_string(),
        })
        .ok()
}

fn navigate(driver: &mut Box<dyn Browser>, tab: &Tab, url: &str) {
    let expression = format!("location.href = {url:?}");
    if let Err(error) = driver.eval(&BrowserEvalParams {
        tab: tab.id.clone(),
        expression,
    }) {
        assert!(
            error.to_string().contains("navigated"),
            "navigating {} failed: {error}",
            tab.id
        );
    }
}

fn wait_search(driver: &mut Box<dyn Browser>, tab: &Tab, marker: &str) {
    wait_for(&format!("{} to load {marker}", tab.id), || {
        try_eval(driver, tab, "location.search")
            .and_then(|value| value.as_str().map(str::to_string))
            .is_some_and(|search| search.contains(marker))
            .then_some(())
    });
}

fn title(driver: &mut Box<dyn Browser>, tab: &Tab) -> String {
    eval(driver, tab, "document.title")
        .as_str()
        .unwrap_or_default()
        .to_string()
}

fn wait_title(driver: &mut Box<dyn Browser>, tab: &Tab, wanted: &str) {
    wait_for(
        &format!("the title of {} to become {wanted}", tab.id),
        || {
            (try_eval(driver, tab, "document.title")
                .as_ref()
                .and_then(Value::as_str)
                == Some(wanted))
            .then_some(())
        },
    );
}

fn read(driver: &mut Box<dyn Browser>, tab: &Tab, image: bool) -> Page {
    driver
        .read(&BrowserReadParams {
            tab: tab.id.clone(),
            image,
            max_width: Some(640),
        })
        .unwrap_or_else(|error| panic!("read of {} failed: {error}", tab.id))
}

fn find<'a>(page: &'a Page, role: &str, name: &str) -> &'a Node {
    page.nodes
        .iter()
        .find(|node| node.role == role && node.name == name)
        .unwrap_or_else(|| panic!("no {role} called {name} in\n{}", page.outline))
}

fn act(
    driver: &mut Box<dyn Browser>,
    tab: &Tab,
    node: &Node,
    action: PageAction,
    text: Option<&str>,
) -> Route {
    driver
        .act(&BrowserActParams {
            tab: tab.id.clone(),
            reference: node.reference,
            action,
            text: text.map(str::to_string),
            mode: Mode::Background,
        })
        .unwrap_or_else(|error| panic!("{action:?} on {} failed: {error}", node.name))
        .route
}

fn tab_for(driver: &mut Box<dyn Browser>, name: &str) -> Tab {
    let wanted = page_url(name);
    wait_for(&format!("the tab for {name}"), || {
        driver
            .tabs()
            .ok()?
            .into_iter()
            .find(|tab| tab.url == wanted)
    })
}

fn active(driver: &mut Box<dyn Browser>, name: &str) -> bool {
    let wanted = page_url(name);
    driver
        .tabs()
        .expect("tabs")
        .into_iter()
        .find(|tab| tab.url == wanted)
        .is_some_and(|tab| tab.active)
}

#[test]
#[ignore]
fn drives_a_tab_the_owner_is_not_looking_at() {
    let mut driver = browser();
    let status = driver.status();
    assert_eq!(
        status.len(),
        1,
        "the e2e points the driver at one profile: {status:?}"
    );
    assert_eq!(status[0].state, BrowserState::Connected, "{status:?}");

    driver
        .open(&BrowserOpenParams {
            url: page_url("A"),
            mode: Mode::Foreground,
        })
        .expect("open A");
    driver
        .open(&BrowserOpenParams {
            url: page_url("B"),
            mode: Mode::Background,
        })
        .expect("open B");
    let a = tab_for(&mut driver, "A");
    let b = tab_for(&mut driver, "B");
    assert!(a.active, "the foreground tab is active");
    assert!(!b.active, "a background tab is not active");
    if a.window_id == b.window_id {
        assert_ne!(
            a.index, b.index,
            "two tabs in one window get different indexes"
        );
    }
    wait_title(&mut driver, &a, "A");
    wait_title(&mut driver, &b, "B");

    let first = read(&mut driver, &b, false);
    assert_eq!(first.tab.id, b.id);
    assert!(
        first.outline.contains("Inner"),
        "the outline reaches into the iframe:\n{}",
        first.outline
    );
    let inner = find(&first, "button", "Inner");
    assert_eq!(
        act(&mut driver, &b, inner, PageAction::Click, None),
        Route::Dom
    );
    wait_title(&mut driver, &b, "inner:B");
    assert_eq!(
        title(&mut driver, &a),
        "A",
        "the hidden tab's click never reaches the other tab"
    );
    assert!(
        active(&mut driver, "A"),
        "clicking in a background tab leaves the owner's tab active"
    );

    let second = read(&mut driver, &b, false);
    let press = find(&second, "button", "Press");
    assert_eq!(
        act(&mut driver, &b, press, PageAction::Click, None),
        Route::Trusted,
        "a trusted click reaches a hidden tab"
    );
    wait_title(&mut driver, &b, "pressed:B");
    assert_eq!(title(&mut driver, &a), "A");
    assert!(
        active(&mut driver, "A"),
        "a trusted click in a background tab leaves the owner's tab active"
    );

    let name = find(&second, "text field", "Name");
    assert_eq!(
        act(
            &mut driver,
            &b,
            name,
            PageAction::SetValue,
            Some("fromreact")
        ),
        Route::Dom
    );
    let state = eval(
        &mut driver,
        &b,
        "JSON.stringify([document.querySelector('#text').value, document.querySelector('#text').dataset.trapped, document.querySelector('#text').dataset.events])",
    );
    assert_eq!(
        state,
        Value::from("[\"fromreact\",\"0\",\"1\"]"),
        "a controlled input takes the value through the native setter"
    );

    assert_eq!(
        act(&mut driver, &b, name, PageAction::Type, Some(" plus")),
        Route::Trusted
    );
    let typed = eval(&mut driver, &b, "document.querySelector('#text').value");
    assert!(
        typed.as_str().unwrap_or_default().contains("plus"),
        "typing reached the hidden tab: {typed}"
    );
    let events = eval(
        &mut driver,
        &b,
        "Number(document.querySelector('#text').dataset.events)",
    );
    assert!(
        events.as_u64().unwrap_or(0) >= 2,
        "typing fires input events: {events}"
    );

    for attempt in 1..=20 {
        let name = format!("cold{attempt}");
        driver
            .open(&BrowserOpenParams {
                url: page_url(&name),
                mode: Mode::Background,
            })
            .expect("open a freshly hidden tab");
        let cold = tab_for(&mut driver, &name);
        wait_title(&mut driver, &cold, &name);
        let page = read(&mut driver, &cold, false);
        let press = find(&page, "button", "Press");
        let started = Instant::now();
        let route = act(&mut driver, &cold, press, PageAction::Click, None);
        eprintln!(
            "trusted click {attempt} of a freshly opened hidden tab: {route:?} in {:?}",
            started.elapsed()
        );
        assert_eq!(
            route,
            Route::Trusted,
            "trusted click {attempt} reaches a freshly opened hidden tab"
        );
        wait_title(&mut driver, &cold, &format!("pressed:{name}"));
        driver
            .close(&kiko_driver::TabParams {
                tab: cold.id.clone(),
            })
            .expect("close the freshly hidden tab");
    }

    for attempt in 1..=20 {
        let marker = format!("click{attempt}");
        navigate(
            &mut driver,
            &b,
            &format!("{}&again={marker}", page_url("B")),
        );
        wait_search(&mut driver, &b, &marker);
        let page = read(&mut driver, &b, false);
        let press = find(&page, "button", "Press");
        let started = Instant::now();
        let route = act(&mut driver, &b, press, PageAction::Click, None);
        eprintln!(
            "trusted click {attempt} of a freshly loaded hidden tab: {route:?} in {:?}",
            started.elapsed()
        );
        assert_eq!(
            route,
            Route::Trusted,
            "trusted click {attempt} reaches a freshly loaded hidden tab"
        );
        wait_title(&mut driver, &b, "pressed:B");
    }

    let third = read(&mut driver, &b, false);
    let choice = find(&third, "combo box", "Choice");
    assert_eq!(
        act(&mut driver, &b, choice, PageAction::Select, Some("two")),
        Route::Dom
    );
    wait_title(&mut driver, &b, "chosen:two:B");

    let fourth = read(&mut driver, &b, false);
    let query = find(&fourth, "text field", "Query");
    assert_eq!(
        act(&mut driver, &b, query, PageAction::Type, Some("kiko")),
        Route::Trusted
    );
    assert_eq!(
        act(&mut driver, &b, query, PageAction::PressKey, Some("Enter")),
        Route::Trusted
    );
    wait_title(&mut driver, &b, "submitted:B");

    let started = Instant::now();
    let shot = read(&mut driver, &b, true);
    eprintln!(
        "the first capture of a hidden tab took {:?}",
        started.elapsed()
    );
    let image = shot
        .image
        .expect("a background tab still yields a screenshot");
    assert_eq!(image.mime, "image/jpeg");
    assert!(!image.data.is_empty());
    assert!(
        image.width > 0 && image.width <= 640,
        "the image is resized: {}x{}",
        image.width,
        image.height
    );
    assert!(image.covers.w > 0.0);

    let visible = read(&mut driver, &a, true);
    let image = visible
        .image
        .expect("the tab the owner is looking at still yields a screenshot");
    assert!(!image.data.is_empty());
    assert!(
        active(&mut driver, "A"),
        "capturing the owner's tab leaves it in front"
    );

    for attempt in 1..=20 {
        let marker = format!("reload{attempt}");
        navigate(
            &mut driver,
            &b,
            &format!("{}&again={marker}", page_url("B")),
        );
        wait_search(&mut driver, &b, &marker);
        let started = Instant::now();
        let captured = driver
            .read(&BrowserReadParams {
                tab: b.id.clone(),
                image: true,
                max_width: Some(640),
            })
            .unwrap_or_else(|error| {
                panic!("capture {attempt} of the reloaded hidden tab failed: {error}")
            });
        eprintln!(
            "capture {attempt} of the reloaded hidden tab took {:?}",
            started.elapsed()
        );
        assert!(
            captured.image.is_some_and(|image| !image.data.is_empty()),
            "the hidden tab yields a screenshot after reload {attempt}"
        );
    }

    navigate(&mut driver, &b, &page_url("B"));
    wait_for("the hidden tab to return to its page", || {
        (try_eval(&mut driver, &b, "location.search")
            .as_ref()
            .and_then(Value::as_str)
            == Some("?name=B"))
        .then_some(())
    });

    assert!(
        active(&mut driver, "A"),
        "everything above left the owner's tab in front"
    );
    assert!(!active(&mut driver, "B"));

    driver
        .show(&kiko_driver::TabParams { tab: b.id.clone() })
        .expect("show B");
    wait_for("B to become the active tab", || {
        active(&mut driver, "B").then_some(())
    });
    assert!(!active(&mut driver, "A"));
    let fifth = read(&mut driver, &b, false);
    let press = find(&fifth, "button", "Press");
    let route = driver
        .act(&BrowserActParams {
            tab: b.id.clone(),
            reference: press.reference,
            action: PageAction::Click,
            text: None,
            mode: Mode::Foreground,
        })
        .expect("foreground click")
        .route;
    assert_eq!(route, Route::Trusted);
    wait_title(&mut driver, &b, "pressed:B");

    let stale = BrowserActParams {
        tab: b.id.clone(),
        reference: 4_000_000,
        action: PageAction::Click,
        text: None,
        mode: Mode::Background,
    };
    let error = driver.act(&stale).expect_err("an unknown ref is stale");
    assert_eq!(error.code, ErrorCode::Stale);
}

#[test]
#[ignore]
fn closes_and_reopens_tabs() {
    let mut driver = browser();
    driver
        .open(&BrowserOpenParams {
            url: page_url("C"),
            mode: Mode::Background,
        })
        .expect("open C");
    let tab = tab_for(&mut driver, "C");
    driver
        .close(&kiko_driver::TabParams {
            tab: tab.id.clone(),
        })
        .expect("close C");
    wait_for("the closed tab to leave the list", || {
        driver
            .tabs()
            .ok()
            .filter(|tabs| tabs.iter().all(|other| other.id != tab.id))
            .map(|_| ())
    });
    assert!(
        driver
            .read(&BrowserReadParams {
                tab: tab.id.clone(),
                image: false,
                max_width: None
            })
            .is_err()
    );
    driver
        .show(&kiko_driver::TabParams { tab: tab.id })
        .expect_err("a closed tab cannot be shown");
}
