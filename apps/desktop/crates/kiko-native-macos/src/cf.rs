use objc2_core_foundation::{CFArray, CFBoolean, CFNumber, CFRetained, CFString, CFType};

pub fn string(text: &str) -> CFRetained<CFString> {
    CFString::from_str(text)
}

pub fn text(value: &CFType) -> Option<String> {
    if let Some(value) = value.downcast_ref::<CFString>() {
        return Some(value.to_string());
    }
    if let Some(value) = value.downcast_ref::<CFNumber>() {
        return Some(number_text(value));
    }
    if let Some(value) = value.downcast_ref::<CFBoolean>() {
        return Some(value.as_bool().to_string());
    }
    None
}

pub fn flag(value: &CFType) -> Option<bool> {
    if let Some(value) = value.downcast_ref::<CFBoolean>() {
        return Some(value.as_bool());
    }
    value
        .downcast_ref::<CFNumber>()
        .and_then(CFNumber::as_i64)
        .map(|n| n != 0)
}

pub fn items(value: &CFType) -> Option<Vec<CFRetained<CFType>>> {
    Some(typed(value.downcast_ref::<CFArray>()?).to_vec())
}

pub fn typed(array: &CFArray) -> &CFArray<CFType> {
    unsafe { array.cast_unchecked() }
}

fn number_text(value: &CFNumber) -> String {
    match (value.as_i64(), value.as_f64()) {
        (Some(integer), Some(float)) if float != integer as f64 => format!("{float}"),
        (Some(integer), _) => integer.to_string(),
        (None, Some(float)) => format!("{float}"),
        (None, None) => String::new(),
    }
}
