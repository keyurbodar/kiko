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
    use std::io;
    use std::path::PathBuf;

    const LABEL: &str = "com.kiko.computer";
    const RUN_AT_LOAD_ON: &str = "<key>RunAtLoad</key><true/>";
    const RUN_AT_LOAD_OFF: &str = "<key>RunAtLoad</key><false/>";

    fn file() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Library")
            .join("LaunchAgents")
            .join(format!("{LABEL}.plist"))
    }

    pub fn enabled() -> bool {
        std::fs::read_to_string(file())
            .map(|body| body.contains(RUN_AT_LOAD_ON))
            .unwrap_or(false)
    }

    pub fn set(on: bool) -> io::Result<()> {
        let file = file();
        let body = match std::fs::read_to_string(&file) {
            Ok(body) => body,
            Err(_) => plist(&std::env::current_exe()?.to_string_lossy()),
        };
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(file, with_run_at_load(&body, on))
    }

    fn with_run_at_load(body: &str, on: bool) -> String {
        let stripped = body
            .replace(RUN_AT_LOAD_ON, "")
            .replace(RUN_AT_LOAD_OFF, "");
        let wanted = if on { RUN_AT_LOAD_ON } else { RUN_AT_LOAD_OFF };
        match stripped.find("<key>KeepAlive</key>") {
            Some(at) => format!("{}{wanted}{}", &stripped[..at], &stripped[at..]),
            None => format!("{stripped}{wanted}"),
        }
    }

    fn plist(exe: &str) -> String {
        let escaped = exe
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{escaped}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
"
        )
    }
}
