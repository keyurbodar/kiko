use kiko_driver::{DriverError, ErrorCode};

pub(crate) fn failed(message: impl Into<String>) -> DriverError {
    DriverError::new(ErrorCode::Failed, message)
}

pub(crate) fn denied(message: impl Into<String>) -> DriverError {
    DriverError::new(ErrorCode::Denied, message)
}

pub(crate) fn stale() -> DriverError {
    DriverError::new(
        ErrorCode::Stale,
        "this ref is from an older look; look again",
    )
}

pub(crate) fn not_found(message: impl Into<String>) -> DriverError {
    DriverError::new(ErrorCode::NotFound, message)
}

pub(crate) fn background_unavailable(message: impl Into<String>) -> DriverError {
    DriverError::new(ErrorCode::BackgroundUnavailable, message)
}

pub(crate) fn unsupported(message: impl Into<String>) -> DriverError {
    DriverError::new(ErrorCode::Unsupported, message)
}

pub(crate) fn timeout(message: impl Into<String>) -> DriverError {
    DriverError::new(ErrorCode::Timeout, message)
}
