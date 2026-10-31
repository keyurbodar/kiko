use std::io;

pub fn enabled() -> bool {
    imp::enabled()
}

pub fn set(on: bool) -> io::Result<()> {
    imp::set(on)
}

pub fn migrate() -> io::Result<()> {
    imp::migrate()
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

    pub fn migrate() -> io::Result<()> {
        Ok(())
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

    pub fn migrate() -> io::Result<()> {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::io;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    const LABEL: &str = "com.kiko.computer";
    const RUN_AT_LOAD_ON: &str = "<key>RunAtLoad</key><true/>";
    #[cfg(test)]
    const RUN_AT_LOAD_OFF: &str = "<key>RunAtLoad</key><false/>";
    const KEEP_ALIVE_ON: &str = "<key>KeepAlive</key><true/>";
    const KEEP_ALIVE_OFF: &str = "<key>KeepAlive</key><false/>";
    const KEEP_ALIVE_CRASH_ONLY: &str =
        "<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>";

    fn file() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Library")
            .join("LaunchAgents")
            .join(format!("{LABEL}.plist"))
    }

    pub fn enabled() -> bool {
        enabled_at(&file())
    }

    pub fn set(on: bool) -> io::Result<()> {
        let file = file();
        let exe = std::env::current_exe()?;
        if apply(&file, &exe, on)? {
            bootout();
        } else {
            bootstrap(&file);
        }
        Ok(())
    }

    pub fn migrate() -> io::Result<()> {
        let file = file();
        let Ok(body) = std::fs::read_to_string(&file) else {
            return Ok(());
        };
        let migrated = migrate_body(&body);
        if migrated == body {
            return Ok(());
        }
        write(&file, &migrated)
    }

    fn enabled_at(file: &Path) -> bool {
        std::fs::read_to_string(file)
            .map(|body| body.contains(RUN_AT_LOAD_ON))
            .unwrap_or(false)
    }

    fn apply(file: &Path, exe: &Path, on: bool) -> io::Result<bool> {
        if on {
            write(file, &plist(&exe.to_string_lossy()))?;
            return Ok(false);
        }
        remove(file)?;
        Ok(true)
    }

    fn write(file: &Path, body: &str) -> io::Result<()> {
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(file, body)
    }

    fn remove(file: &Path) -> io::Result<()> {
        match std::fs::remove_file(file) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }

    fn migrate_body(body: &str) -> String {
        if !body.contains(KEEP_ALIVE_ON) && !body.contains(KEEP_ALIVE_OFF) {
            return body.to_string();
        }
        body.replace(KEEP_ALIVE_ON, KEEP_ALIVE_CRASH_ONLY)
            .replace(KEEP_ALIVE_OFF, KEEP_ALIVE_CRASH_ONLY)
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
  {KEEP_ALIVE_CRASH_ONLY}
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
"
        )
    }

    fn bootout() {
        launchctl(&["bootout".to_string(), format!("gui/{}/{LABEL}", uid())]);
    }

    fn bootstrap(file: &Path) {
        launchctl(&[
            "bootstrap".to_string(),
            format!("gui/{}", uid()),
            file.to_string_lossy().into_owned(),
        ]);
    }

    fn launchctl(args: &[String]) {
        let _ = Command::new("launchctl").args(args).status();
    }

    fn uid() -> u32 {
        unsafe { libc::getuid() }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn a_new_plist_restarts_after_a_crash_but_not_a_quit() {
            let body = plist("/Applications/kiko.app/Contents/MacOS/kiko");
            assert!(body.contains(KEEP_ALIVE_CRASH_ONLY), "{body}");
            assert!(!body.contains(KEEP_ALIVE_ON), "{body}");
            assert!(body.contains(RUN_AT_LOAD_ON), "{body}");
        }

        #[test]
        fn turning_start_at_login_on_writes_a_runnable_plist() {
            let directory = tempfile::tempdir().expect("a temporary directory");
            let file = directory.path().join("com.kiko.computer.plist");
            let exe = Path::new("/Applications/kiko.app/Contents/MacOS/kiko");
            assert!(!apply(&file, exe, true).expect("write the plist"));
            assert!(enabled_at(&file));
            assert!(file.exists());
        }

        #[test]
        fn turning_start_at_login_off_removes_the_plist() {
            let directory = tempfile::tempdir().expect("a temporary directory");
            let file = directory.path().join("com.kiko.computer.plist");
            let exe = Path::new("/Applications/kiko.app/Contents/MacOS/kiko");
            apply(&file, exe, true).expect("write the plist");
            assert!(apply(&file, exe, false).expect("remove the plist"));
            assert!(!file.exists());
            assert!(!enabled_at(&file));
        }

        #[test]
        fn an_old_plist_is_rewritten_without_a_keep_alive_loop() {
            let old = format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\">\n<dict>\n  <key>RunAtLoad</key><true/>\n  {KEEP_ALIVE_ON}\n</dict>\n</plist>\n"
            );
            let migrated = migrate_body(&old);
            assert!(migrated.contains(KEEP_ALIVE_CRASH_ONLY), "{migrated}");
            assert!(!migrated.contains(KEEP_ALIVE_ON), "{migrated}");
            assert!(migrated.contains(RUN_AT_LOAD_ON), "{migrated}");
            assert_eq!(migrate_body(&migrated), migrated);
        }

        #[test]
        fn start_at_login_reads_run_at_load() {
            assert!(!enabled_at(Path::new("/nonexistent/kiko.plist")));
            let directory = tempfile::tempdir().expect("a temporary directory");
            let file = directory.path().join("kiko.plist");
            std::fs::write(&file, RUN_AT_LOAD_ON).expect("write a plist");
            assert!(enabled_at(&file));
            std::fs::write(&file, RUN_AT_LOAD_OFF).expect("write a plist");
            assert!(!enabled_at(&file));
        }
    }
}
