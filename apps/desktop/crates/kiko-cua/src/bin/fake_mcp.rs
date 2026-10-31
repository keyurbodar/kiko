use std::io::{BufRead, Write};
use std::path::PathBuf;

use serde_json::{Value, json};

const TOOLS: &[(&str, &str)] = &[
    ("list_windows", "List top-level windows"),
    ("get_window_state", "Snapshot a window"),
    ("type_text", "Type text into an element"),
    ("check_permissions", "Report permission status"),
    ("get_screen_size", "Logical display size"),
    ("capture", "Capture the screen"),
    ("fail", "Always fails"),
    ("crash", "Stop the server"),
];

fn schema(name: &str) -> Value {
    match name {
        "get_window_state" => json!({
            "type": "object",
            "properties": { "window_id": { "type": "integer" }, "include_screenshot": { "type": "boolean" } },
            "required": ["window_id"],
        }),
        "type_text" => json!({
            "type": "object",
            "properties": { "target": { "type": "object" }, "text": { "type": "string" } },
            "required": ["target", "text"],
        }),
        "check_permissions" => json!({
            "type": "object",
            "properties": { "prompt": { "type": "boolean" } },
        }),
        _ => json!({ "type": "object", "properties": {} }),
    }
}

fn listing() -> Value {
    let tools: Vec<Value> = TOOLS
        .iter()
        .map(|(name, description)| {
            json!({ "name": name, "description": description, "inputSchema": schema(name) })
        })
        .collect();
    json!({ "tools": tools })
}

fn call(name: &str, arguments: &Value) -> Value {
    match name {
        "check_permissions" => json!({
            "content": [{ "type": "text", "text": "{\"accessibility\":true,\"screen_recording\":false}" }],
            "structuredContent": { "accessibility": true, "screen_recording": false },
        }),
        "get_screen_size" => json!({
            "content": [{ "type": "text", "text": "{\"width\":1280,\"height\":800,\"scale\":2}" }],
            "structuredContent": { "width": 1280, "height": 800, "scale": 2 },
        }),
        "capture" => json!({
            "content": [
                { "type": "text", "text": "captured" },
                { "type": "image", "data": "aGVsbG8=", "mimeType": "image/png" },
            ],
        }),
        "fail" => json!({
            "content": [{ "type": "text", "text": "it broke" }],
            "isError": true,
        }),
        "crash" => {
            std::process::exit(3);
        }
        _ => json!({
            "content": [{ "type": "text", "text": format!("called {name} with {arguments}") }],
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
            "serverInfo": { "name": "fake-mcp", "version": "0.0.0" },
        })),
        "tools/list" => Ok(listing()),
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
    let Some(path) = std::env::var_os("FAKE_MCP_EXIT_ONCE") else {
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
        println!("cua-driver 0.38.0-fake");
        return;
    }
    if exits_once() {
        std::process::exit(4);
    }
    if let Err(error) = serve() {
        eprintln!("fake-mcp: {error}");
        std::process::exit(1);
    }
}
