use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use kiko_driver::{DriverError, ErrorCode, Image, Rect, Result};
use serde_json::{Value, json};

use crate::cdp::{Link, REQUEST_TIMEOUT};
use crate::jpeg;

pub const DEFAULT_MAX_WIDTH: u32 = 1280;

pub async fn capture(link: &Link, session: &str, max_width: Option<u32>) -> Result<Image> {
    let max_width = f64::from(max_width.unwrap_or(DEFAULT_MAX_WIDTH).max(1));
    let metrics = link
        .send_to(session, "Page.getLayoutMetrics", json!({}))
        .await?;
    let viewport = &metrics["cssVisualViewport"];
    let width = viewport["clientWidth"]
        .as_f64()
        .filter(|width| *width > 0.0)
        .unwrap_or(DEFAULT_MAX_WIDTH as f64);
    let height = viewport["clientHeight"]
        .as_f64()
        .filter(|height| *height > 0.0)
        .unwrap_or(720.0);
    let scale = (max_width / (width * pixel_ratio(link, session).await)).min(1.0);
    let clip = json!({
        "x": viewport["pageX"].as_f64().unwrap_or(0.0),
        "y": viewport["pageY"].as_f64().unwrap_or(0.0),
        "width": width,
        "height": height,
        "scale": scale,
    });
    let data = shoot(link, session, &clip).await.map_err(|error| {
        DriverError::new(
            ErrorCode::Failed,
            format!("{} would not capture the page: {error}", link.name()),
        )
    })?;
    let bytes = STANDARD
        .decode(&data)
        .map_err(|error| DriverError::new(ErrorCode::Failed, error.to_string()))?;
    let (image_width, image_height) =
        jpeg::dimensions(&bytes).unwrap_or((width as u32, height as u32));
    Ok(Image {
        mime: "image/jpeg".into(),
        data,
        width: image_width,
        height: image_height,
        covers: Rect {
            x: 0.0,
            y: 0.0,
            w: width,
            h: height,
        },
    })
}

async fn pixel_ratio(link: &Link, session: &str) -> f64 {
    let ratio = link
        .send_to(
            session,
            "Runtime.evaluate",
            json!({ "expression": "window.devicePixelRatio", "returnByValue": true }),
        )
        .await
        .ok()
        .and_then(|result| result["result"]["value"].as_f64())
        .filter(|ratio| *ratio > 0.0);
    ratio.unwrap_or(1.0)
}

async fn shoot(link: &Link, session: &str, clip: &Value) -> Result<String> {
    set_focus_emulation(link, session, true).await?;
    let started = std::time::Instant::now();
    let painted = wait_for_paint(link, session).await;
    eprintln!("probe paint wait {painted} in {:?}", started.elapsed());
    let started = std::time::Instant::now();
    let captured = match send_capture(link, session, clip).await {
        Ok(data) => {
            eprintln!("probe capture after paint: ok in {:?}", started.elapsed());
            Ok(data)
        }
        Err(first) => {
            eprintln!(
                "probe capture after paint: {first} in {:?}",
                started.elapsed()
            );
            let started = std::time::Instant::now();
            let window = json!({ "format": "jpeg", "quality": 80, "fromSurface": false });
            let warm = link
                .send_with(
                    Some(session),
                    "Page.captureScreenshot",
                    window,
                    REQUEST_TIMEOUT,
                )
                .await
                .map(|value| value["data"].as_str().unwrap_or_default().to_string());
            eprintln!(
                "probe window: {} in {:?}",
                describe(&warm),
                started.elapsed()
            );
            let started = std::time::Instant::now();
            let second = send_capture(link, session, clip).await;
            eprintln!(
                "probe capture after window: {} in {:?}",
                describe(&second),
                started.elapsed()
            );
            second
        }
    };
    let restored = set_focus_emulation(link, session, false).await;
    captured.and_then(|data| restored.map(|()| data))
}

fn describe(result: &Result<String>) -> String {
    match result {
        Ok(data) => format!("ok {} bytes", data.len()),
        Err(error) => error.to_string(),
    }
}

async fn wait_for_paint(link: &Link, session: &str) -> bool {
    let expression = "new Promise(resolve => { let seen = 0; const tick = () => { if (++seen >= 2) { resolve(true); return; } requestAnimationFrame(tick) }; requestAnimationFrame(tick); setTimeout(() => resolve(false), 2000) })";
    link.send_with(
        Some(session),
        "Runtime.evaluate",
        json!({ "expression": expression, "awaitPromise": true, "returnByValue": true }),
        REQUEST_TIMEOUT,
    )
    .await
    .ok()
    .and_then(|result| result["result"]["value"].as_bool())
    .unwrap_or(false)
}

async fn send_capture(link: &Link, session: &str, clip: &Value) -> Result<String> {
    let params = json!({ "format": "jpeg", "quality": 80, "fromSurface": true, "captureBeyondViewport": true, "clip": clip });
    let result = link
        .send_with(
            Some(session),
            "Page.captureScreenshot",
            params,
            REQUEST_TIMEOUT,
        )
        .await?;
    result["data"]
        .as_str()
        .filter(|data| !data.is_empty())
        .map(str::to_string)
        .ok_or_else(|| DriverError::new(ErrorCode::Failed, "the browser sent no image data"))
}

async fn set_focus_emulation(link: &Link, session: &str, enabled: bool) -> Result<()> {
    link.send_to(
        session,
        "Emulation.setFocusEmulationEnabled",
        json!({ "enabled": enabled }),
    )
    .await
    .map(|_| ())
}
