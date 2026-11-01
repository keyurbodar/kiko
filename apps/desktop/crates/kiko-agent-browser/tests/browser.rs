use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use kiko_agent_browser::Engine;
use kiko_driver::{
    Action, Browser, BrowserActParams, BrowserEvalParams, BrowserOpenParams, BrowserReadParams,
    BrowserState, Mode, PageAction, Route, TabParams,
};
use serde_json::json;

const READY: Duration = Duration::from_secs(20);
const TRANSITION: Duration = Duration::from_secs(10);

fn fake() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_fake-agent-browser"))
}

fn start(env: Vec<(String, String)>) -> (tempfile::TempDir, Engine) {
    let dir = tempfile::tempdir().expect("temp dir");
    let log = Arc::new(|line: String| println!("{line}"));
    let engine = Engine::start(fake(), env, dir.path().join("shot.jpg"), log);
    (dir, engine)
}

fn open(engine: &mut Engine) -> kiko_driver::Tab {
    engine
        .open(&BrowserOpenParams {
            url: "https://example.com/".into(),
            mode: Mode::Background,
        })
        .expect("open a tab")
}

fn read(engine: &mut Engine, tab: &str, image: bool) -> kiko_driver::Page {
    engine
        .read(&BrowserReadParams {
            tab: tab.into(),
            image,
            max_width: Some(1280),
        })
        .expect("read the page")
}

#[test]
fn reports_connected_once_the_engine_answers() {
    let (_dir, mut engine) = start(vec![]);
    assert!(engine.wait_ready(READY));
    assert_eq!(engine.version(), "0.41.0-fake");
    let status = engine.status();
    assert_eq!(status.len(), 1);
    assert_eq!(status[0].name, "agent-browser");
    assert_eq!(status[0].state, BrowserState::Connected);
    engine.stop();
}

#[test]
fn opens_a_tab_and_lists_every_tab() {
    let (_dir, mut engine) = start(vec![]);
    assert!(engine.wait_ready(READY));
    assert!(engine.tabs().expect("no tabs before opening").is_empty());
    let tab = open(&mut engine);
    assert_eq!(tab.id, "T1");
    assert_eq!(tab.browser, "agent-browser");
    assert!(tab.active);
    assert_eq!(tab.title, "Fixture");
    let tabs = engine.tabs().expect("list tabs");
    assert_eq!(tabs.len(), 2);
    assert_eq!(tabs[1].id, "T2");
    assert_eq!(tabs[1].index, 1);
    engine
        .close(&TabParams { tab: "T2".into() })
        .expect("close a tab");
    engine.stop();
}

#[test]
fn reads_the_page_as_nodes_and_a_picture() {
    let (_dir, mut engine) = start(vec![]);
    assert!(engine.wait_ready(READY));
    let tab = open(&mut engine);
    let page = read(&mut engine, &tab.id, true);
    assert_eq!(page.tab.id, "T1");
    let button = page
        .nodes
        .iter()
        .find(|node| node.role == "button")
        .expect("the button");
    assert_eq!(button.name, "Press me");
    assert_eq!(button.reference, 2);
    assert_eq!(button.actions, [Action::Press]);
    assert!(page.outline.contains("[2] button \"Press me\""));
    let image = page.image.expect("a picture");
    assert_eq!(image.mime, "image/jpeg");
    assert_eq!((image.width, image.height), (1280, 720));
    assert!(!image.data.is_empty());
    engine.stop();
}

#[test]
fn acts_on_a_ref_and_rejects_a_stale_one() {
    let (_dir, mut engine) = start(vec![]);
    assert!(engine.wait_ready(READY));
    let tab = open(&mut engine);
    read(&mut engine, &tab.id, false);
    let result = engine
        .act(&BrowserActParams {
            tab: tab.id.clone(),
            reference: 2,
            action: PageAction::Click,
            text: None,
            mode: Mode::Background,
        })
        .expect("click the button");
    assert_eq!(result.route, Route::Trusted);
    let stale = engine
        .act(&BrowserActParams {
            tab: tab.id.clone(),
            reference: 99,
            action: PageAction::Click,
            text: None,
            mode: Mode::Background,
        })
        .unwrap_err();
    assert_eq!(stale.code, kiko_driver::ErrorCode::Stale);
    engine.stop();
}

#[test]
fn a_read_before_each_act_keeps_the_refs_alive() {
    let (_dir, mut engine) = start(vec![]);
    assert!(engine.wait_ready(READY));
    let tab = open(&mut engine);
    read(&mut engine, &tab.id, false);
    engine
        .act(&BrowserActParams {
            tab: tab.id.clone(),
            reference: 2,
            action: PageAction::Click,
            text: None,
            mode: Mode::Background,
        })
        .expect("click the button");
    let page = read(&mut engine, &tab.id, false);
    let field = page
        .nodes
        .iter()
        .find(|node| node.role == "text field")
        .expect("the text field");
    engine
        .act(&BrowserActParams {
            tab: tab.id.clone(),
            reference: field.reference,
            action: PageAction::Type,
            text: Some("hello".into()),
            mode: Mode::Background,
        })
        .expect("type into the field");
    engine.stop();
}

#[test]
fn a_step_that_leaves_the_page_makes_the_next_step_stale() {
    let (_dir, mut engine) = start(vec![]);
    assert!(engine.wait_ready(READY));
    let tab = open(&mut engine);
    read(&mut engine, &tab.id, false);
    engine
        .act(&BrowserActParams {
            tab: tab.id.clone(),
            reference: 2,
            action: PageAction::Click,
            text: None,
            mode: Mode::Background,
        })
        .expect("click the button, which navigates");
    let stale = engine
        .act(&BrowserActParams {
            tab: tab.id.clone(),
            reference: 3,
            action: PageAction::Type,
            text: Some("hello".into()),
            mode: Mode::Background,
        })
        .unwrap_err();
    assert_eq!(stale.code, kiko_driver::ErrorCode::Stale);
    assert!(stale.message.contains("read the page again"), "got {stale}");
    let page = read(&mut engine, &tab.id, false);
    let field = page
        .nodes
        .iter()
        .find(|node| node.role == "text field")
        .expect("the text field");
    engine
        .act(&BrowserActParams {
            tab: tab.id.clone(),
            reference: field.reference,
            action: PageAction::Type,
            text: Some("hello".into()),
            mode: Mode::Background,
        })
        .expect("a fresh read makes a ref work again");
    engine.stop();
}

#[test]
fn evaluates_an_expression_in_the_tab() {
    let (_dir, mut engine) = start(vec![]);
    assert!(engine.wait_ready(READY));
    let tab = open(&mut engine);
    let value = engine
        .eval(&BrowserEvalParams {
            tab: tab.id,
            expression: "6 * 7".into(),
        })
        .expect("evaluate");
    assert_eq!(value, json!(42));
    engine.stop();
}

#[test]
fn a_crash_is_reported_while_down_and_the_engine_comes_back() {
    let (_dir, mut engine) = start(vec![]);
    assert!(engine.wait_ready(READY));
    let crashed = engine.eval(&BrowserEvalParams {
        tab: "T1".into(),
        expression: "crash".into(),
    });
    assert!(crashed.is_err(), "a crashed engine must fail the call");
    assert!(engine.wait_down(TRANSITION), "the crash was not reported");
    let while_down = engine
        .eval(&BrowserEvalParams {
            tab: "T1".into(),
            expression: "1".into(),
        })
        .unwrap_err();
    assert!(
        while_down.message.contains("not running"),
        "got {while_down}"
    );
    assert!(engine.wait_ready(READY), "the engine did not restart");
    assert!(engine.tabs().is_ok());
    engine.stop();
}

#[test]
fn an_engine_that_dies_on_its_first_start_is_retried() {
    let dir = tempfile::tempdir().expect("temp dir");
    let marker = dir.path().join("exited-once");
    let env = vec![(
        "FAKE_AGENT_BROWSER_EXIT_ONCE".to_string(),
        marker.to_string_lossy().into_owned(),
    )];
    let log = Arc::new(|line: String| println!("{line}"));
    let engine = Engine::start(fake(), env, dir.path().join("shot.jpg"), log);
    assert!(engine.wait_ready(READY), "the retry never became ready");
    assert_eq!(engine.version(), "0.41.0-fake");
    engine.stop();
}

#[test]
fn names_the_stream_of_the_tab_the_owner_watches() {
    let (_dir, mut engine) = start(vec![]);
    assert!(engine.wait_ready(READY));
    assert_eq!(
        engine
            .stream(&TabParams { tab: "T1".into() })
            .expect("a stream"),
        "ws://127.0.0.1:9223"
    );
    engine.stop();
}

#[test]
fn a_missing_engine_reports_no_browser() {
    let dir = tempfile::tempdir().expect("temp dir");
    let log = Arc::new(|line: String| println!("{line}"));
    let mut engine = Engine::start(
        dir.path().join("no-such-agent-browser"),
        vec![],
        dir.path().join("shot.jpg"),
        log,
    );
    assert!(engine.wait_down(TRANSITION));
    assert!(engine.status().is_empty());
    let error = engine
        .eval(&BrowserEvalParams {
            tab: "T1".into(),
            expression: "1".into(),
        })
        .unwrap_err();
    assert!(error.message.contains("not running"), "got {error}");
    assert!(engine.stream(&TabParams { tab: "T1".into() }).is_err());
    engine.stop();
}
