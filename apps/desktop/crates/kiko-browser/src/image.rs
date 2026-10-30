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
    let shot = json!({ "format": "jpeg", "quality": 80, "fromSurface": true, "captureBeyondViewport": true, "clip": clip });
    let data = shoot(link, session, shot).await.map_err(|error| {
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

async fn shoot(link: &Link, session: &str, params: Value) -> Result<String> {
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
