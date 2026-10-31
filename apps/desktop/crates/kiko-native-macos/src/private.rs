use std::ffi::{CStr, c_int, c_void};
use std::sync::OnceLock;

use objc2_application_services::AXUIElement;

const SKYLIGHT: &CStr = c"/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight";

pub type PostToPid = unsafe extern "C" fn(c_int, *mut c_void);
pub type SetAuthenticationMessage = unsafe extern "C" fn(*mut c_void, *mut c_void);
pub type SetIntegerField = unsafe extern "C" fn(*mut c_void, u32, i64);
pub type SetWindowLocation = unsafe extern "C" fn(*mut c_void, f64, f64);
pub type WindowOfElement = unsafe extern "C" fn(*const AXUIElement, *mut u32) -> i32;

fn load_skylight() {
    static LOADED: OnceLock<()> = OnceLock::new();
    LOADED.get_or_init(|| unsafe {
        libc::dlopen(SKYLIGHT.as_ptr(), libc::RTLD_LAZY | libc::RTLD_GLOBAL);
    });
}

fn lookup(name: &CStr) -> Option<*mut c_void> {
    load_skylight();
    let symbol = unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) };
    (!symbol.is_null()).then_some(symbol)
}

unsafe fn cast<T: Copy>(symbol: *mut c_void) -> T {
    unsafe { std::mem::transmute_copy(&symbol) }
}

fn resolve<T: Copy>(cell: &'static OnceLock<Option<T>>, name: &CStr) -> Option<T> {
    *cell.get_or_init(|| lookup(name).map(|symbol| unsafe { cast(symbol) }))
}

pub fn post_to_pid() -> Option<PostToPid> {
    static SYMBOL: OnceLock<Option<PostToPid>> = OnceLock::new();
    resolve(&SYMBOL, c"SLEventPostToPid")
}

pub fn set_authentication_message() -> Option<SetAuthenticationMessage> {
    static SYMBOL: OnceLock<Option<SetAuthenticationMessage>> = OnceLock::new();
    resolve(&SYMBOL, c"SLEventSetAuthenticationMessage")
}

pub fn set_integer_field() -> Option<SetIntegerField> {
    static SYMBOL: OnceLock<Option<SetIntegerField>> = OnceLock::new();
    resolve(&SYMBOL, c"SLEventSetIntegerValueField")
}

pub fn set_window_location() -> Option<SetWindowLocation> {
    static SYMBOL: OnceLock<Option<SetWindowLocation>> = OnceLock::new();
    resolve(&SYMBOL, c"CGEventSetWindowLocation")
}

pub fn window_of_element() -> Option<WindowOfElement> {
    static SYMBOL: OnceLock<Option<WindowOfElement>> = OnceLock::new();
    resolve(&SYMBOL, c"_AXUIElementGetWindow")
}

pub fn symbols() -> Vec<(&'static str, bool)> {
    vec![
        ("SLEventPostToPid", post_to_pid().is_some()),
        (
            "SLSEventAuthenticationMessage",
            set_authentication_message().is_some(),
        ),
        ("SLEventSetIntegerValueField", set_integer_field().is_some()),
        ("CGEventSetWindowLocation", set_window_location().is_some()),
        ("_AXUIElementGetWindow", window_of_element().is_some()),
    ]
}
