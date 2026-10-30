use kiko_driver::{DriverError, ErrorCode, Grant, PermissionKind, Permissions};

use crate::ax;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

pub fn current() -> Permissions {
    Permissions {
        accessibility: grant(ax::trusted()),
        screen: grant(unsafe { CGPreflightScreenCaptureAccess() }),
        automation: Grant::NotNeeded,
    }
}

fn grant(value: bool) -> Grant {
    if value { Grant::Granted } else { Grant::Denied }
}

pub fn request(kind: PermissionKind) -> kiko_driver::Result<()> {
    match kind {
        PermissionKind::Accessibility => {
            ax::request_trust();
            open_pane("Privacy_Accessibility");
        }
        PermissionKind::Screen => {
            unsafe { CGRequestScreenCaptureAccess() };
            open_pane("Privacy_ScreenCapture");
        }
        PermissionKind::Automation | PermissionKind::Browser => {
            return Err(DriverError::new(
                ErrorCode::Unsupported,
                "macOS asks for automation and browser consent on first use",
            ));
        }
    }
    Ok(())
}

fn open_pane(anchor: &str) {
    let _ = std::process::Command::new("open")
        .arg(format!(
            "x-apple.systempreferences:com.apple.preference.security?{anchor}"
        ))
        .spawn();
}
