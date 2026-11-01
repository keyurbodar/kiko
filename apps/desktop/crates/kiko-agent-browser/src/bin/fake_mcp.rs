use std::collections::HashSet;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use serde_json::{Value, json};

static LAUNCHED: AtomicBool = AtomicBool::new(false);

fn refs() -> &'static Mutex<HashSet<String>> {
    static REFS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    REFS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn page_url() -> &'static Mutex<String> {
    static URL: OnceLock<Mutex<String>> = OnceLock::new();
    URL.get_or_init(|| Mutex::new("https://example.com/".to_string()))
}

fn current_url() -> String {
    page_url().lock().unwrap().clone()
}

fn set_url(value: &str) {
    *page_url().lock().unwrap() = value.to_string();
}

fn clear_refs() {
    refs().lock().unwrap().clear();
}

fn snapshot_refs() {
    let mut held = refs().lock().unwrap();
    held.clear();
    held.insert("e2".into());
    held.insert("e3".into());
}

fn check_ref(selector: &str) -> Result<(), String> {
    let Some(name) = selector.strip_prefix('@') else {
        return Ok(());
    };
    if refs().lock().unwrap().contains(name) {
        return Ok(());
    }
    Err(format!("Unknown ref: {name}"))
}

fn click(target: &str) -> Result<Value, String> {
    check_ref(target)?;
    if target == "@e2" {
        set_url("https://example.com/next");
    }
    Ok(json!({ "clicked": true }))
}

fn command(items: &[&str]) -> Result<Value, String> {
    let (action, args) = items.split_first().ok_or("an empty command")?;
    let target = args.first().copied().unwrap_or_default();
    match *action {
        "get" if args.first() == Some(&"url") => Ok(json!({ "url": current_url() })),
        "click" => click(target),
        "type" | "fill" | "select" | "scrollintoview" | "focus" => {
            check_ref(target)?;
            Ok(json!({ "ok": true }))
        }
        "press" => Ok(json!({ "ok": true })),
        other => Err(format!("unknown command {other}")),
    }
}

fn batch(arguments: &Value) -> Result<Vec<Value>, String> {
    let commands = arguments
        .get("commands")
        .and_then(Value::as_array)
        .ok_or("no commands")?;
    let bail = arguments
        .get("bail")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut entries = Vec::new();
    for (index, line) in commands.iter().enumerate() {
        let items: Vec<&str> = line
            .as_array()
            .map(|list| list.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        let result = command(&items);
        let success = result.is_ok();
        let mut entry = json!({ "index": index, "success": success });
        match result {
            Ok(data) => entry["result"] = data,
            Err(message) => entry["error"] = json!(message),
        }
        entries.push(entry);
        if !success && bail {
            break;
        }
    }
    Ok(entries)
}

fn jpeg() -> Vec<u8> {
    let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08];
    bytes.extend_from_slice(&720u16.to_be_bytes());
    bytes.extend_from_slice(&1280u16.to_be_bytes());
    bytes.extend_from_slice(&[0x03, 0, 0, 0, 0, 0, 0, 0, 0]);
    bytes
}

fn tabs() -> Value {
    json!({ "tabs": [
        { "tabId": "t1", "targetId": "T1", "label": null, "title": "Fixture", "url": current_url(), "type": "page", "active": true },
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
            clear_refs();
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
            clear_refs();
            Ok(json!({ "tabId": arguments.get("tab").cloned().unwrap_or(Value::Null) }))
        }
        "agent_browser_tab_close" => Ok(json!({ "closed": true })),
        "agent_browser_snapshot" => {
            snapshot_refs();
            Ok(snapshot())
        }
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
        "agent_browser_click" => click(
            arguments
                .get("selector")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ),
        "agent_browser_type"
        | "agent_browser_fill"
        | "agent_browser_select"
        | "agent_browser_focus"
        | "agent_browser_scroll_into_view" => {
            check_ref(
                arguments
                    .get("selector")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )?;
            Ok(json!({ "ok": true }))
        }
        "fail" => Err("it broke".into()),
        "crash" => std::process::exit(3),
        _ => Ok(json!({ "ok": true })),
    }
}

fn call(name: &str, arguments: &Value) -> Value {
    if name == "agent_browser_batch" {
        return match batch(arguments) {
            Ok(entries) => {
                let failed = entries
                    .iter()
                    .any(|entry| entry.get("success").and_then(Value::as_bool) != Some(true));
                json!({
                    "content": [{ "type": "text", "text": "ok" }],
                    "structuredContent": { "exitCode": failed as u8, "stdout": "", "stderr": "", "response": Value::Array(entries) },
                    "isError": failed,
                })
            }
            Err(message) => json!({
                "content": [{ "type": "text", "text": message }],
                "structuredContent": { "response": { "success": false, "error": message } },
                "isError": true,
            }),
        };
    }
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
