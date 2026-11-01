use kiko_driver::Result;
use serde_json::json;

use crate::cdp::{Link, REQUEST_TIMEOUT};

const FRAME: &str = "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))";

pub async fn emulate_visible(link: &Link, session: &str, enabled: bool) -> Result<()> {
    link.send_to(
        session,
        "Emulation.setFocusEmulationEnabled",
        json!({ "enabled": enabled }),
    )
    .await
    .map(|_| ())
}

pub async fn wait_for_frame(link: &Link, session: &str) -> Result<()> {
    link.send_with(
        Some(session),
        "Runtime.evaluate",
        json!({ "expression": FRAME, "awaitPromise": true, "returnByValue": true }),
        REQUEST_TIMEOUT,
    )
    .await
    .map(|_| ())
}
