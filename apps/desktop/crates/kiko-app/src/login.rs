use std::io;

pub fn enabled() -> bool {
    imp::enabled()
}

pub fn set(on: bool) -> io::Result<()> {
    imp::set(on)
}

#[cfg(target_os = "linux")]
mod imp {
    use std::fs;
    use std::io;
    use std::path::PathBuf;

    fn file() -> PathBuf {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".config")
            });
        base.join("autostart").join("kiko.desktop")
    }

    pub fn enabled() -> bool {
        file().exists()
    }

    pub fn set(on: bool) -> io::Result<()> {
        let file = file();
        if !on {
            return match fs::remove_file(&file) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error),
            };
        }
        let exe = std::env::current_exe()?;
        let body = format!(
            "[Desktop Entry]\nType=Application\nName=kiko\nComment=The kiko agent on this computer\nExec=\"{}\"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
            exe.display()
        );
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(file, body)
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use std::io;

    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const VALUE: &str = "kiko";

    fn key(write: bool) -> io::Result<RegKey> {
        let root = RegKey::predef(HKEY_CURRENT_USER);
        if write {
            root.open_subkey_with_flags(RUN, KEY_SET_VALUE)
        } else {
            root.open_subkey(RUN)
        }
    }

    pub fn enabled() -> bool {
        key(false)
            .and_then(|key| key.get_value::<String, _>(VALUE))
            .is_ok()
    }

    pub fn set(on: bool) -> io::Result<()> {
        let key = key(true)?;
        if on {
            let exe = std::env::current_exe()?;
            key.set_value(VALUE, &format!("\"{}\"", exe.display()))
        } else {
            match key.delete_value(VALUE) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error),
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::CStr;
    use std::io;

    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject, Bool};

    #[link(name = "ServiceManagement", kind = "framework")]
    unsafe extern "C" {}

    const ENABLED: isize = 1;

    fn service() -> Option<*mut AnyObject> {
        let class = AnyClass::get(c"SMAppService").or_else(load)?;
        let service: *mut AnyObject = unsafe { msg_send![class, mainAppService] };
        (!service.is_null()).then_some(service)
    }

    fn load() -> Option<&'static AnyClass> {
        unsafe {
            let path = c"/System/Library/Frameworks/ServiceManagement.framework/ServiceManagement";
            if libc::dlopen(path.as_ptr(), libc::RTLD_LAZY).is_null() {
                return None;
            }
        }
        AnyClass::get(c"SMAppService")
    }

    fn in_bundle() -> bool {
        std::env::current_exe()
            .map(|exe| exe.to_string_lossy().contains(".app/Contents/MacOS/"))
            .unwrap_or(false)
    }

    pub fn enabled() -> bool {
        let Some(service) = service() else {
            return false;
        };
        let status: isize = unsafe { msg_send![service, status] };
        status == ENABLED
    }

    pub fn set(on: bool) -> io::Result<()> {
        if !in_bundle() {
            return Err(io::Error::other("start at login needs kiko.app"));
        }
        let service =
            service().ok_or_else(|| io::Error::other("ServiceManagement is unavailable"))?;
        let mut error: *mut AnyObject = std::ptr::null_mut();
        let changed: Bool = unsafe {
            if on {
                msg_send![service, registerAndReturnError: &mut error]
            } else {
                msg_send![service, unregisterAndReturnError: &mut error]
            }
        };
        if changed.as_bool() {
            Ok(())
        } else {
            Err(io::Error::other(describe(error)))
        }
    }

    fn describe(error: *mut AnyObject) -> String {
        if error.is_null() {
            return "ServiceManagement refused the change".into();
        }
        let text: *mut AnyObject = unsafe { msg_send![error, localizedDescription] };
        if text.is_null() {
            return "ServiceManagement refused the change".into();
        }
        let utf8: *const std::ffi::c_char = unsafe { msg_send![text, UTF8String] };
        if utf8.is_null() {
            return "ServiceManagement refused the change".into();
        }
        unsafe { CStr::from_ptr(utf8) }
            .to_string_lossy()
            .into_owned()
    }
}
