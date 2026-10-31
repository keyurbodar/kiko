use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{Value, json};

static LAUNCHED: AtomicBool = AtomicBool::new(false);

fn jpeg() -> Vec<u8> {
    let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08];
    bytes.extend_from_slice(&720u16.to_be_bytes());
    bytes.extend_from_slice(&1280u16.to_be_bytes());
    bytes.extend_from_slice(&[0x03, 0, 0, 0, 0, 0, 0, 0, 0]);
    bytes
}

fn tabs() -> Value {
    json!({ "tabs": [
        { "tabId": "t1", "targetId": "T1", "label": null, "title": "Fixture", "url": "https://example.com/", "type": "page", "active": true },
        { "tabId": "t2", "targetId": "T2", "label": null, "title": "Second", "url": "https://example.com/two", "type": "page", "active": false },
    ] })
}

fn snapshot() -> Value {
    json!({
        "snapshot": "- heading \"Fixture\"\n- button \"Press me\" [ref=e2]\n- textbox \"Name\" [ref=e3]\n- StaticText \"idle\"\n",
        "origin": "https://example.com/",
        "refs": { "e2": { "role": "button", "name": "Press me" }, "e3": { "role": "textbox", "name": "Name" } },
        "removedRefs": [],
    })
}

fn data(name: &str, arguments: &Value) -> Result<Value, String> {
    match name {
        "agent_browser_open" | "agent_browser_tab_new" => {
            LAUNCHED.store(true, Ordering::SeqCst);
            Ok(
                json!({ "url": "https://example.com/", "title": "Fixture", "tabId": "t2", "total": 2 }),
            )
        }
        "agent_browser_tab_list" => {
            if !LAUNCHED.load(Ordering::SeqCst) {
                return Err("Browser not launched".into());
            }
            Ok(tabs())
        }
        "agent_browser_tab_switch" => {
            Ok(json!({ "tabId": arguments.get("tab").cloned().unwrap_or(Value::Null) }))
        }
        "agent_browser_tab_close" => Ok(json!({ "closed": true })),
        "agent_browser_snapshot" => Ok(snapshot()),
        "agent_browser_screenshot" => {
            let path = arguments
                .get("path")
                .and_then(Value::as_str)
                .ok_or("no path")?;
            std::fs::write(path, jpeg()).map_err(|error| error.to_string())?;
            Ok(json!({ "path": path }))
        }
        "agent_browser_eval" => {
            if arguments.get("script").and_then(Value::as_str) == Some("crash") {
                std::process::exit(3);
            }
            Ok(json!({ "result": 42 }))
        }
        "agent_browser_close" => Ok(json!({ "closed": true })),
        "fail" => Err("it broke".into()),
        "crash" => std::process::exit(3),
        _ => Ok(json!({ "ok": true })),
    }
}

fn call(name: &str, arguments: &Value) -> Value {
    match data(name, arguments) {
        Ok(data) => json!({
            "content": [{ "type": "text", "text": "ok" }],
            "structuredContent": {
                "exitCode": 0,
                "stdout": "",
                "stderr": "",
                "response": { "success": true, "data": data },
            },
            "isError": false,
        }),
        Err(message) => json!({
            "content": [{ "type": "text", "text": message }],
            "structuredContent": {
                "exitCode": 1,
                "stdout": "",
                "stderr": message,
                "response": { "success": false, "error": message },
            },
            "isError": true,
        }),
    }
}

fn answer(id: &Value, message: &Value) -> Value {
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32600, "message": "no method" } });
    };
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": "2025-06-18",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "fake-agent-browser", "version": "0.41.0-fake" },
        })),
        "tools/list" => Ok(json!({
            "tools": [
                { "name": "agent_browser_open", "description": "Open", "inputSchema": { "type": "object" } },
                { "name": "agent_browser_snapshot", "description": "Snapshot", "inputSchema": { "type": "object" } },
            ],
        })),
        "tools/call" => {
            let name = message
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let arguments = message
                .pointer("/params/arguments")
                .cloned()
                .unwrap_or(json!({}));
            Ok(call(name, &arguments))
        }
        other => Err(format!("unknown method {other}")),
    };
    match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(message) => {
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": message } })
        }
    }
}

fn exits_once() -> bool {
    let Some(path) = std::env::var_os("FAKE_AGENT_BROWSER_EXIT_ONCE") else {
        return false;
    };
    let path = PathBuf::from(path);
    if path.exists() {
        return false;
    }
    std::fs::write(path, b"1").is_ok()
}

fn serve() -> std::io::Result<()> {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if message.get("id").is_none() {
            continue;
        }
        let reply = answer(message.get("id").unwrap_or(&Value::Null), &message);
        writeln!(stdout, "{reply}")?;
        stdout.flush()?;
    }
    Ok(())
}

fn main() {
    if std::env::args().any(|arg| arg == "--version") {
        println!("agent-browser 0.41.0-fake");
        return;
    }
    if exits_once() {
        std::process::exit(4);
    }
    if let Err(error) = serve() {
        eprintln!("fake-agent-browser: {error}");
        std::process::exit(1);
    }
}
