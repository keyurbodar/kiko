use std::ptr::NonNull;
use std::sync::mpsc;
use std::time::Duration;

use base64::Engine;
use block2::RcBlock;
use kiko_driver::{DriverError, ErrorCode, Image, Rect};
use objc2::rc::Retained;
use objc2::{AnyThread, ClassType};
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
use objc2_core_foundation::CFRetained;
use objc2_core_graphics::CGImage;
use objc2_foundation::{NSDictionary, NSError};
use objc2_screen_capture_kit::{
    SCContentFilter, SCScreenshotManager, SCShareableContent, SCStreamConfiguration,
};

const TIMEOUT: Duration = Duration::from_secs(4);
const DEFAULT_WIDTH: u32 = 1280;

pub fn screenshot(window: u32, frame: Rect, max_width: Option<u32>) -> kiko_driver::Result<Image> {
    let shareable = shareable()?;
    let scwindow = unsafe { shareable.windows() }
        .iter()
        .find(|candidate| unsafe { candidate.windowID() } == window)
        .ok_or_else(|| {
            DriverError::new(
                ErrorCode::NotFound,
                "the system will not share this window's pixels",
            )
        })?;

    let (width, height) = size(frame, max_width);
    let filter = unsafe {
        SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), &scwindow)
    };
    let config = configuration(width, height);
    let image = capture(&filter, &config)?;
    let bytes = jpeg(&image)?;

    Ok(Image {
        mime: "image/jpeg".to_string(),
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
        width,
        height,
        covers: frame,
    })
}

fn size(frame: Rect, max_width: Option<u32>) -> (u32, u32) {
    let width = frame.w.max(1.0);
    let height = frame.h.max(1.0);
    let limit = max_width.unwrap_or(DEFAULT_WIDTH).max(1) as f64;
    let scale = (limit / width).min(1.0);
    (
        ((width * scale).round() as u32).max(1),
        ((height * scale).round() as u32).max(1),
    )
}

fn configuration(width: u32, height: u32) -> Retained<SCStreamConfiguration> {
    let config: Retained<SCStreamConfiguration> =
        unsafe { objc2::msg_send![SCStreamConfiguration::class(), new] };
    unsafe {
        config.setWidth(width as usize);
        config.setHeight(height as usize);
        config.setShowsCursor(false);
        config.setCapturesAudio(false);
        config.setIgnoreShadowsSingleWindow(true);
    }
    config
}

fn shareable() -> kiko_driver::Result<Retained<SCShareableContent>> {
    let (sender, receiver) = mpsc::channel();
    let block = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            let result = if content.is_null() {
                Err(describe(error))
            } else {
                Ok(unsafe { Retained::retain(content) })
            };
            let _ = sender.send(result);
        },
    );
    unsafe {
        SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
            false,
            false,
            &block,
        );
    }
    let content = receiver
        .recv_timeout(TIMEOUT)
        .map_err(|_| {
            DriverError::new(
                ErrorCode::Timeout,
                "the window server did not answer a capture request",
            )
        })?
        .map_err(|message| DriverError::new(ErrorCode::Failed, message))?;
    content.ok_or_else(|| {
        DriverError::new(
            ErrorCode::Failed,
            "the window server returned no shareable content",
        )
    })
}

fn capture(
    filter: &SCContentFilter,
    config: &SCStreamConfiguration,
) -> kiko_driver::Result<CFRetained<CGImage>> {
    let (sender, receiver) = mpsc::channel();
    let block = RcBlock::new(move |image: *mut CGImage, error: *mut NSError| {
        let result = match NonNull::new(image) {
            Some(image) => Ok(unsafe { CFRetained::retain(image) }),
            None => Err(describe(error)),
        };
        let _ = sender.send(result);
    });
    unsafe {
        SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(
            filter,
            config,
            Some(&block),
        );
    }
    receiver
        .recv_timeout(TIMEOUT)
        .map_err(|_| {
            DriverError::new(
                ErrorCode::Timeout,
                "the window server did not return a screenshot",
            )
        })?
        .map_err(|message| DriverError::new(ErrorCode::Failed, message))
}

fn jpeg(image: &CGImage) -> kiko_driver::Result<Vec<u8>> {
    let bitmap = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), image);
    let properties = NSDictionary::new();
    let data = unsafe {
        bitmap.representationUsingType_properties(NSBitmapImageFileType::JPEG, &properties)
    }
    .ok_or_else(|| {
        DriverError::new(ErrorCode::Failed, "could not encode the screenshot as JPEG")
    })?;
    Ok(data.to_vec())
}

fn describe(error: *mut NSError) -> String {
    let Some(error) = NonNull::new(error) else {
        return "the window server gave no reason".to_string();
    };
    let error: &NSError = unsafe { error.as_ref() };
    error.localizedDescription().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scales_a_wide_window_down_to_the_limit() {
        let frame = Rect {
            x: 0.0,
            y: 0.0,
            w: 2560.0,
            h: 1440.0,
        };
        assert_eq!(size(frame, None), (1280, 720));
        assert_eq!(size(frame, Some(640)), (640, 360));
    }

    #[test]
    fn keeps_a_narrow_window_at_its_own_size() {
        let frame = Rect {
            x: 0.0,
            y: 0.0,
            w: 500.0,
            h: 300.0,
        };
        assert_eq!(size(frame, Some(1280)), (500, 300));
    }
}
