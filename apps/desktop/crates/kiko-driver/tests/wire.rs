use kiko_driver::*;

struct Fake;

impl Desktop for Fake {
    fn info(&self) -> DesktopInfo {
        DesktopInfo {
            version: "0.38.0".into(),
            tools: vec![DesktopTool {
                name: "list_windows".into(),
                description: "List top-level windows".into(),
                input_schema: serde_json::json!({ "type": "object", "properties": {} }),
            }],
        }
    }

    fn call(&mut self, name: &str, args: serde_json::Value) -> Result<serde_json::Value> {
        if name == "type_text" {
            return Ok(serde_json::json!({
                "content": [
                    { "type": "text", "text": format!("typed {}", args["text"]) },
                    { "type": "image", "data": "aGVsbG8=", "mimeType": "image/png" },
                ],
            }));
        }
        Err(DriverError::new(
            ErrorCode::NotFound,
            format!("no tool called {name}"),
        ))
    }

    fn permissions(&self) -> Permissions {
        Permissions {
            accessibility: Grant::Granted,
            screen: Grant::Denied,
            automation: Grant::NotNeeded,
        }
    }

    fn screens(&self) -> Vec<Display> {
        vec![Display {
            id: "primary".into(),
            width: 1280,
            height: 800,
            scale: 2.0,
        }]
    }
}

fn run(lines: &str) -> Vec<serde_json::Value> {
    let status = Status {
        version: "0.1.0".into(),
        os: "test".into(),
        session: "x11".into(),
        permissions: Permissions {
            accessibility: Grant::Unknown,
            screen: Grant::Unknown,
            automation: Grant::Unknown,
        },
        browsers: vec![],
        displays: vec![],
    };
    let mut out = Vec::new();
    serve(
        &mut Fake,
        &mut Unavailable,
        &status,
        lines.as_bytes(),
        &mut out,
    )
    .unwrap();
    String::from_utf8(out)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

#[test]
fn answers_each_request_by_id() {
    let out = run("{\"id\":1,\"method\":\"desktop.tools\"}\n{\"id\":2,\"method\":\"status\"}\n");
    assert_eq!(out[0]["id"], 1);
    assert_eq!(out[0]["ok"], true);
    assert_eq!(out[0]["value"]["version"], "0.38.0");
    assert_eq!(out[0]["value"]["tools"][0]["name"], "list_windows");
    assert_eq!(out[0]["value"]["tools"][0]["inputSchema"]["type"], "object");
    assert_eq!(out[1]["value"]["permissions"]["screen"], "denied");
    assert_eq!(out[1]["value"]["displays"][0]["width"], 1280);
}

#[test]
fn passes_a_tool_call_and_its_content_through() {
    let out = run(
        "{\"id\":3,\"method\":\"desktop.call\",\"params\":{\"name\":\"type_text\",\"args\":{\"text\":\"hi\"}}}\n",
    );
    assert_eq!(out[0]["ok"], true);
    assert_eq!(out[0]["value"]["content"][0]["text"], "typed \"hi\"");
    assert_eq!(out[0]["value"]["content"][1]["type"], "image");
}

#[test]
fn a_failing_tool_keeps_its_code() {
    let out = run("{\"id\":4,\"method\":\"desktop.call\",\"params\":{\"name\":\"nope\"}}\n");
    assert_eq!(out[0]["ok"], false);
    assert_eq!(out[0]["error"]["code"], "not_found");
}

#[test]
fn an_unknown_method_still_gets_an_answer() {
    let out = run("{\"id\":9,\"method\":\"teleport\"}\n");
    assert_eq!(out[0]["id"], 9);
    assert_eq!(out[0]["error"]["code"], "unsupported");
}

#[test]
fn browser_calls_without_a_browser_are_unsupported() {
    let out = run("{\"id\":5,\"method\":\"browser.tabs\"}\n");
    assert_eq!(out[0]["error"]["code"], "unsupported");
}
