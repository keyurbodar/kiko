use std::ptr::NonNull;

use kiko_driver::Rect;
use objc2_application_services::{
    AXCopyMultipleAttributeOptions, AXError, AXUIElement, AXValue, AXValueType,
};
use objc2_core_foundation::{CFArray, CFRange, CFRetained, CFString, CFType, CGPoint, CGSize};

use crate::cf;
use crate::private;

pub const ROLE: &str = "AXRole";
pub const TITLE: &str = "AXTitle";
pub const DESCRIPTION: &str = "AXDescription";
pub const LABEL: &str = "AXLabel";
pub const VALUE: &str = "AXValue";
pub const POSITION: &str = "AXPosition";
pub const SIZE: &str = "AXSize";
pub const ENABLED: &str = "AXEnabled";
pub const FOCUSED: &str = "AXFocused";
pub const SELECTED: &str = "AXSelected";
pub const EXPANDED: &str = "AXExpanded";
pub const SUBROLE: &str = "AXSubrole";
pub const CHILDREN: &str = "AXChildren";
pub const WINDOWS: &str = "AXWindows";
pub const MINIMIZED: &str = "AXMinimized";
pub const FOCUSED_WINDOW: &str = "AXFocusedWindow";
pub const SELECTED_TEXT: &str = "AXSelectedText";
pub const PARENT: &str = "AXParent";
pub const VISIBLE_CHARACTER_RANGE: &str = "AXVisibleCharacterRange";

pub const MESSAGING_TIMEOUT: f32 = 0.5;

pub type Element = CFRetained<AXUIElement>;

pub fn application(pid: i32) -> Element {
    let element = unsafe { AXUIElement::new_application(pid) };
    timeout(&element, MESSAGING_TIMEOUT);
    element
}

pub fn timeout(element: &AXUIElement, seconds: f32) {
    unsafe { element.set_messaging_timeout(seconds) };
}

pub fn attribute(element: &AXUIElement, name: &str) -> Option<CFRetained<CFType>> {
    let attribute = cf::string(name);
    let mut value: *const CFType = std::ptr::null();
    let error = unsafe { element.copy_attribute_value(&attribute, NonNull::from(&mut value)) };
    if error != AXError::Success {
        return None;
    }
    Some(unsafe { CFRetained::from_raw(NonNull::new(value as *mut CFType)?) })
}

pub fn attributes(element: &AXUIElement, names: &[&str]) -> Vec<Option<CFRetained<CFType>>> {
    let keys: Vec<CFRetained<CFString>> = names.iter().map(|name| cf::string(name)).collect();
    let borrowed: Vec<&CFType> = keys.iter().map(AsRef::as_ref).collect();
    let request = CFArray::<CFType>::from_objects(&borrowed);
    let mut values: *const CFArray = std::ptr::null();
    let error = unsafe {
        element.copy_multiple_attribute_values(
            request.as_opaque(),
            AXCopyMultipleAttributeOptions::empty(),
            NonNull::from(&mut values),
        )
    };
    let empty = vec![None; names.len()];
    if error != AXError::Success {
        return empty;
    }
    let Some(values) = NonNull::new(values as *mut CFArray) else {
        return empty;
    };
    let values = unsafe { CFRetained::from_raw(values) };
    let values: Vec<CFRetained<CFType>> = cf::typed(&values).to_vec();
    if values.len() != names.len() {
        return empty;
    }
    values.into_iter().map(Some).collect()
}

pub fn text(value: &Option<CFRetained<CFType>>) -> Option<String> {
    value.as_deref().and_then(cf::text)
}

pub fn flag(value: &Option<CFRetained<CFType>>) -> Option<bool> {
    value.as_deref().and_then(cf::flag)
}

pub fn elements(value: &Option<CFRetained<CFType>>) -> Vec<Element> {
    let Some(items) = value.as_deref().and_then(cf::items) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let element = item.downcast_ref::<AXUIElement>()?;
            Some(unsafe { CFRetained::<AXUIElement>::retain(NonNull::from(element)) })
        })
        .collect()
}

pub fn retain(element: &AXUIElement) -> Element {
    unsafe { CFRetained::retain(NonNull::from(element)) }
}

pub fn element_attribute(element: &AXUIElement, name: &str) -> Option<Element> {
    let value = attribute(element, name)?;
    let element = value.downcast_ref::<AXUIElement>()?;
    Some(unsafe { CFRetained::<AXUIElement>::retain(NonNull::from(element)) })
}

pub fn parent(element: &AXUIElement) -> Option<Element> {
    element_attribute(element, PARENT)
}

pub fn children(element: &AXUIElement) -> Vec<Element> {
    elements(&attribute(element, CHILDREN))
}

pub fn action_names(element: &AXUIElement) -> Vec<String> {
    let mut names: *const CFArray = std::ptr::null();
    let error = unsafe { element.copy_action_names(NonNull::from(&mut names)) };
    if error != AXError::Success {
        return Vec::new();
    }
    let Some(names) = NonNull::new(names as *mut CFArray) else {
        return Vec::new();
    };
    let names = unsafe { CFRetained::from_raw(names) };
    let names: Vec<CFRetained<CFType>> = cf::typed(&names).to_vec();
    names.iter().filter_map(|name| cf::text(name)).collect()
}

pub fn perform(element: &AXUIElement, action: &str) -> AXError {
    unsafe { element.perform_action(&cf::string(action)) }
}

pub fn set(element: &AXUIElement, name: &str, value: &CFType) -> AXError {
    unsafe { element.set_attribute_value(&cf::string(name), value) }
}

pub fn set_flag(element: &AXUIElement, name: &str, value: bool) -> AXError {
    set(element, name, objc2_core_foundation::CFBoolean::new(value))
}

pub fn set_text(element: &AXUIElement, name: &str, value: &str) -> AXError {
    set(element, name, &cf::string(value))
}

pub fn point(value: &Option<CFRetained<CFType>>) -> Option<CGPoint> {
    let value = value.as_deref()?.downcast_ref::<AXValue>()?;
    let mut point = CGPoint::default();
    let decoded = unsafe { value.value(AXValueType::CGPoint, NonNull::from(&mut point).cast()) };
    decoded.then_some(point)
}

pub fn size(value: &Option<CFRetained<CFType>>) -> Option<CGSize> {
    let value = value.as_deref()?.downcast_ref::<AXValue>()?;
    let mut size = CGSize::default();
    let decoded = unsafe { value.value(AXValueType::CGSize, NonNull::from(&mut size).cast()) };
    decoded.then_some(size)
}

pub fn range(value: &Option<CFRetained<CFType>>) -> Option<CFRange> {
    let value = value.as_deref()?.downcast_ref::<AXValue>()?;
    let mut range = CFRange {
        location: 0,
        length: 0,
    };
    let decoded = unsafe { value.value(AXValueType::CFRange, NonNull::from(&mut range).cast()) };
    decoded.then_some(range)
}

pub fn frame(element: &AXUIElement) -> Option<Rect> {
    let values = attributes(element, &[POSITION, SIZE]);
    let point = point(&values[0])?;
    let size = size(&values[1])?;
    Some(Rect {
        x: point.x,
        y: point.y,
        w: size.width,
        h: size.height,
    })
}

pub fn window_id(element: &AXUIElement) -> Option<u32> {
    let get_window = private::window_of_element()?;
    let mut window = 0u32;
    let error = unsafe { get_window(element, &mut window) };
    (error == AXError::Success.0 && window != 0).then_some(window)
}

pub fn windows(element: &AXUIElement) -> Vec<Element> {
    elements(&attribute(element, WINDOWS))
}

pub fn focused_window(element: &AXUIElement) -> Option<Element> {
    let window = attribute(element, FOCUSED_WINDOW)?;
    let window = window.downcast_ref::<AXUIElement>()?;
    Some(unsafe { CFRetained::<AXUIElement>::retain(NonNull::from(window)) })
}

pub fn trusted() -> bool {
    unsafe { objc2_application_services::AXIsProcessTrusted() }
}

pub fn request_trust() {
    let key = cf::string("AXTrustedCheckOptionPrompt");
    let value = objc2_core_foundation::CFBoolean::new(true);
    let keys: [&CFType; 1] = [key.as_ref()];
    let values: [&CFType; 1] = [value.as_ref()];
    let options =
        objc2_core_foundation::CFDictionary::<CFType, CFType>::from_slices(&keys, &values);
    unsafe {
        objc2_application_services::AXIsProcessTrustedWithOptions(Some(options.as_opaque()));
    }
}
