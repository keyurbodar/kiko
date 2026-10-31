use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use kiko_cua::{Cua, Error};
use kiko_driver::{Display, Grant, Permissions};
use serde_json::json;

const READY: Duration = Duration::from_secs(20);
const TRANSITION: Duration = Duration::from_secs(10);

fn fake() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_fake-mcp"))
}

fn start(env: Vec<(String, String)>) -> (tempfile::TempDir, Cua) {
    let dir = tempfile::tempdir().expect("temp dir");
    let log = Arc::new(|line: String| println!("{line}"));
    let cua = Cua::start(fake(), dir.path().join("cua.sock"), env, log);
    (dir, cua)
}

#[test]
fn lists_the_driver_tools_with_their_schemas() {
    let (_dir, cua) = start(vec![]);
    assert!(cua.wait_ready(READY));
    let info = cua.info();
    assert_eq!(info.version, "0.38.0-fake");
    let names: Vec<&str> = info.tools.iter().map(|tool| tool.name.as_str()).collect();
    assert!(names.contains(&"list_windows"));
    assert!(names.contains(&"type_text"));
    let window = info
        .tools
        .iter()
        .find(|tool| tool.name == "get_window_state")
        .expect("get_window_state listed");
    assert_eq!(window.description, "Snapshot a window");
    assert_eq!(window.input_schema["properties"]["window_id"]["type"], "integer");
    assert_eq!(
        cua.screens(),
        vec![Display {
            id: "primary".into(),
            width: 1280,
            height: 800,
            scale: 2.0,
        }]
    );
    assert_eq!(
        cua.permissions(),
        Permissions {
            accessibility: Grant::Granted,
            screen: Grant::Denied,
            automation: Grant::NotNeeded,
        }
    );
    cua.stop();
}

#[test]
fn calls_a_tool_and_returns_its_content() {
    let (_dir, cua) = start(vec![]);
    assert!(cua.wait_ready(READY));
    let value = cua
        .call("type_text", json!({ "target": { "kind": "window" }, "text": "hello" }))
        .expect("type_text");
    let text = value["content"][0]["text"].as_str().expect("text content");
    assert!(text.contains("called type_text"));
    assert!(text.contains("hello"));
    cua.stop();
}

#[test]
fn passes_image_content_through() {
    let (_dir, cua) = start(vec![]);
    assert!(cua.wait_ready(READY));
    let value = cua.call("capture", json!({})).expect("capture");
    assert_eq!(value["content"][1]["type"], "image");
    assert_eq!(value["content"][1]["mimeType"], "image/png");
    assert_eq!(value["content"][1]["data"], "aGVsbG8=");
    cua.stop();
}

#[test]
fn reports_a_tool_error_as_error_content() {
    let (_dir, cua) = start(vec![]);
    assert!(cua.wait_ready(READY));
    let value = cua.call("fail", json!({})).expect("a failed tool still answers");
    assert_eq!(value["isError"], true);
    assert_eq!(value["content"][0]["text"], "it broke");
    cua.stop();
}

#[test]
fn a_crash_is_reported_while_down_and_the_driver_comes_back() {
    let (dir, cua) = start(vec![]);
    assert!(cua.wait_ready(READY));
    let crashed = cua.call("crash", json!({}));
    assert!(crashed.is_err(), "a crashed driver must fail the call");
    assert!(cua.wait_down(TRANSITION), "the crash was not reported");
    let while_down = cua.call("list_windows", json!({})).unwrap_err();
    assert!(matches!(while_down, Error::Down(_)), "got {while_down:?}");
    assert!(while_down.message().contains("not running"));
    assert!(cua.wait_ready(READY), "the driver did not restart");
    let value = cua.call("list_windows", json!({})).expect("list_windows after restart");
    assert!(
        value["content"][0]["text"]
            .as_str()
            .unwrap_or_default()
            .contains("list_windows")
    );
    drop(dir);
    cua.stop();
}

#[test]
fn a_driver_that_dies_on_its_first_start_is_retried() {
    let dir = tempfile::tempdir().expect("temp dir");
    let marker = dir.path().join("exited-once");
    let env = vec![(
        "FAKE_MCP_EXIT_ONCE".to_string(),
        marker.to_string_lossy().into_owned(),
    )];
    let log = Arc::new(|line: String| println!("{line}"));
    let cua = Cua::start(fake(), dir.path().join("cua.sock"), env, log);
    assert!(cua.wait_ready(READY), "the retry never became ready");
    assert!(!cua.info().tools.is_empty());
    cua.stop();
}
