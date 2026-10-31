use std::path::{Path, PathBuf};
use std::time::Duration;

use sysinfo::{ProcessesToUpdate, System};
use tokio::net::TcpStream;
use tokio::time::timeout;

const PORT_ANSWER: Duration = Duration::from_millis(400);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Chromium,
    Other,
}

#[derive(Debug, Clone)]
pub struct Profile {
    pub slug: String,
    pub name: String,
    pub dir: PathBuf,
    pub kind: Kind,
    pub executables: &'static [&'static str],
}

impl Profile {
    pub fn chromium(
        slug: &str,
        name: &str,
        dir: PathBuf,
        executables: &'static [&'static str],
    ) -> Self {
        Self {
            slug: slug.to_string(),
            name: name.to_string(),
            dir,
            kind: Kind::Chromium,
            executables,
        }
    }

    fn other(
        slug: &str,
        name: &str,
        dir: PathBuf,
        kind: Kind,
        executables: &'static [&'static str],
    ) -> Self {
        Self {
            slug: slug.to_string(),
            name: name.to_string(),
            dir,
            kind,
            executables,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevToolsPort {
    pub port: u16,
    pub path: String,
}

pub fn port(dir: &Path) -> Option<DevToolsPort> {
    parse_port(&std::fs::read_to_string(dir.join("DevToolsActivePort")).ok()?)
}

fn parse_port(text: &str) -> Option<DevToolsPort> {
    let mut lines = text.lines();
    let port = lines.next()?.trim().parse().ok()?;
    let path = lines.next()?.trim();
    if !path.starts_with("/devtools/") {
        return None;
    }
    Some(DevToolsPort {
        port,
        path: path.to_string(),
    })
}

pub async fn answers(port: u16) -> bool {
    matches!(
        timeout(PORT_ANSWER, TcpStream::connect(("127.0.0.1", port))).await,
        Ok(Ok(_))
    )
}

pub fn running_many(profiles: &[Profile]) -> Vec<bool> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let processes: Vec<_> = system.processes().values().collect();
    profiles
        .iter()
        .map(|profile| running_in(&processes, profile))
        .collect()
}

fn running_in(processes: &[&sysinfo::Process], profile: &Profile) -> bool {
    let dir = profile.dir.to_string_lossy().to_lowercase();
    let named = |name: &str| {
        let name = name.to_lowercase();
        profile
            .executables
            .iter()
            .any(|exe| name == *exe || name == format!("{exe}.exe"))
    };
    let with_dir = |cmd: &[std::ffi::OsString]| {
        cmd.iter().any(|arg| {
            let arg = arg.to_string_lossy().to_lowercase();
            arg == format!("--user-data-dir={dir}")
        })
    };
    let matching: Vec<_> = processes
        .iter()
        .filter(|process| named(&process.name().to_string_lossy()))
        .filter(|process| !process.cmd().is_empty())
        .collect();
    if matching.iter().any(|process| with_dir(process.cmd())) {
        return true;
    }
    processes
        .iter()
        .any(|process| named(&process.name().to_string_lossy()) && process.cmd().is_empty())
}

pub fn profiles() -> Vec<Profile> {
    if let Some(list) = std::env::var_os("KIKO_BROWSER_PROFILE_DIRS") {
        let overridden: Vec<Profile> = std::env::split_paths(&list)
            .filter(|dir| dir.is_dir())
            .map(|dir| {
                let name = dir
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Chrome".into());
                let slug = slugify(&name);
                let executables = executables_for(&slug);
                Profile::chromium(&slug, &name, dir, executables)
            })
            .collect();
        if !overridden.is_empty() {
            return overridden;
        }
    }
    let mut found = os_profiles();
    found.extend(other_browsers());
    found
}

pub fn find(slug: &str) -> Option<Profile> {
    profiles().into_iter().find(|profile| profile.slug == slug)
}

fn slugify(name: &str) -> String {
    let slug: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "chrome".into()
    } else {
        slug
    }
}

fn executables_for(slug: &str) -> &'static [&'static str] {
    if slug.starts_with("chromium") {
        &["chromium", "chromium-browser"]
    } else if slug.starts_with("edge") {
        &["msedge", "microsoft edge"]
    } else if slug.starts_with("brave") {
        &["brave", "brave browser", "brave-browser"]
    } else if slug.starts_with("vivaldi") {
        &["vivaldi", "vivaldi-bin", "vivaldi-snapshot"]
    } else if slug.starts_with("arc") {
        &["arc"]
    } else {
        &["chrome", "google chrome"]
    }
}

fn push(found: &mut Vec<Profile>, slug: &str, name: &str, dir: PathBuf) {
    if dir.is_dir() {
        found.push(Profile::chromium(slug, name, dir, executables_for(slug)));
    }
}

#[cfg(target_os = "linux")]
fn looks_like_profile(dir: &Path) -> bool {
    dir.join("Local State").is_file()
        || dir.join("Default").is_dir()
        || dir.join("DevToolsActivePort").is_file()
}

#[cfg(target_os = "macos")]
fn candidates() -> Vec<(&'static str, &'static str, PathBuf)> {
    let Some(home) = std::env::var_os("HOME") else {
        return Vec::new();
    };
    let support = PathBuf::from(home).join("Library/Application Support");
    [
        ("chrome", "Chrome", "Google/Chrome"),
        ("chrome-beta", "Chrome Beta", "Google/Chrome Beta"),
        ("chrome-dev", "Chrome Dev", "Google/Chrome Dev"),
        ("chrome-canary", "Chrome Canary", "Google/Chrome Canary"),
        ("edge", "Edge", "Microsoft Edge"),
        ("edge-beta", "Edge Beta", "Microsoft Edge Beta"),
        ("edge-dev", "Edge Dev", "Microsoft Edge Dev"),
        ("edge-canary", "Edge Canary", "Microsoft Edge Canary"),
        ("brave", "Brave", "BraveSoftware/Brave-Browser"),
        (
            "brave-beta",
            "Brave Beta",
            "BraveSoftware/Brave-Browser-Beta",
        ),
        (
            "brave-nightly",
            "Brave Nightly",
            "BraveSoftware/Brave-Browser-Nightly",
        ),
        ("chromium", "Chromium", "Chromium"),
        ("vivaldi", "Vivaldi", "Vivaldi"),
        ("arc", "Arc", "Arc/User Data"),
    ]
    .into_iter()
    .map(|(slug, name, path)| (slug, name, support.join(path)))
    .collect()
}

#[cfg(target_os = "windows")]
fn candidates() -> Vec<(&'static str, &'static str, PathBuf)> {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else {
        return Vec::new();
    };
    let local = PathBuf::from(local);
    [
        ("chrome", "Chrome", "Google/Chrome/User Data"),
        ("chrome-beta", "Chrome Beta", "Google/Chrome Beta/User Data"),
        ("chrome-dev", "Chrome Dev", "Google/Chrome Dev/User Data"),
        (
            "chrome-canary",
            "Chrome Canary",
            "Google/Chrome SxS/User Data",
        ),
        ("edge", "Edge", "Microsoft/Edge/User Data"),
        ("edge-beta", "Edge Beta", "Microsoft/Edge Beta/User Data"),
        ("edge-dev", "Edge Dev", "Microsoft/Edge Dev/User Data"),
        (
            "edge-canary",
            "Edge Canary",
            "Microsoft/Edge Canary/User Data",
        ),
        ("brave", "Brave", "BraveSoftware/Brave-Browser/User Data"),
        (
            "brave-beta",
            "Brave Beta",
            "BraveSoftware/Brave-Browser-Beta/User Data",
        ),
        (
            "brave-nightly",
            "Brave Nightly",
            "BraveSoftware/Brave-Browser-Nightly/User Data",
        ),
        ("chromium", "Chromium", "Chromium/User Data"),
        ("vivaldi", "Vivaldi", "Vivaldi/User Data"),
        ("arc", "Arc", "Arc/User Data"),
    ]
    .into_iter()
    .map(|(slug, name, path)| (slug, name, local.join(path)))
    .collect()
}

#[cfg(target_os = "linux")]
fn candidates() -> Vec<(&'static str, &'static str, PathBuf)> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return Vec::new();
    };
    let mut found: Vec<(&'static str, &'static str, PathBuf)> = [
        ("chrome", "Chrome", ".config/google-chrome"),
        ("chrome-beta", "Chrome Beta", ".config/google-chrome-beta"),
        ("chrome-dev", "Chrome Dev", ".config/google-chrome-unstable"),
        ("chromium", "Chromium", ".config/chromium"),
        ("edge", "Edge", ".config/microsoft-edge"),
        ("edge-beta", "Edge Beta", ".config/microsoft-edge-beta"),
        ("edge-dev", "Edge Dev", ".config/microsoft-edge-dev"),
        ("brave", "Brave", ".config/BraveSoftware/Brave-Browser"),
        (
            "brave-beta",
            "Brave Beta",
            ".config/BraveSoftware/Brave-Browser-Beta",
        ),
        (
            "brave-nightly",
            "Brave Nightly",
            ".config/BraveSoftware/Brave-Browser-Nightly",
        ),
        ("vivaldi", "Vivaldi", ".config/vivaldi"),
        (
            "vivaldi-snapshot",
            "Vivaldi Snapshot",
            ".config/vivaldi-snapshot",
        ),
        (
            "chromium",
            "Chromium (snap)",
            "snap/chromium/common/chromium",
        ),
    ]
    .into_iter()
    .map(|(slug, name, path)| (slug, name, home.join(path)))
    .collect();
    flatpak_candidates(&home, &mut found);
    found
}

#[cfg(target_os = "linux")]
fn flatpak_candidates(home: &Path, found: &mut Vec<(&'static str, &'static str, PathBuf)>) {
    let root = home.join(".var/app");
    let Ok(apps) = std::fs::read_dir(&root) else {
        return;
    };
    for app in apps.flatten() {
        let id = app.file_name().to_string_lossy().to_string();
        let config = app.path().join("config");
        let Ok(entries) = std::fs::read_dir(&config) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if looks_like_profile(&path) {
                let (slug, name) = flatpak_name(&id);
                found.push((slug, name, path));
                continue;
            }
            let Ok(nested) = std::fs::read_dir(&path) else {
                continue;
            };
            for inner in nested.flatten() {
                if looks_like_profile(&inner.path()) {
                    let (slug, name) = flatpak_name(&id);
                    found.push((slug, name, inner.path()));
                }
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn flatpak_name(id: &str) -> (&'static str, &'static str) {
    match id {
        "com.google.Chrome" => ("chrome", "Chrome"),
        "org.chromium.Chromium" => ("chromium", "Chromium"),
        "com.brave.Browser" => ("brave", "Brave"),
        "com.microsoft.Edge" => ("edge", "Edge"),
        "com.vivaldi.Vivaldi" => ("vivaldi", "Vivaldi"),
        _ => ("chrome", "Chrome"),
    }
}

fn os_profiles() -> Vec<Profile> {
    let mut found = Vec::new();
    for (slug, name, dir) in candidates() {
        push(&mut found, slug, name, dir);
    }
    found
}

fn other_browsers() -> Vec<Profile> {
    let mut found = Vec::new();
    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME") {
        let firefox = PathBuf::from(home).join("Library/Application Support/Firefox");
        if firefox.is_dir() {
            found.push(Profile::other(
                "firefox",
                "Firefox",
                firefox,
                Kind::Other,
                &["firefox"],
            ));
        }
    }
    #[cfg(target_os = "macos")]
    if Path::new("/Applications/Safari.app").is_dir() {
        found.push(Profile::other(
            "safari",
            "Safari",
            PathBuf::from("/Applications/Safari.app"),
            Kind::Other,
            &["safari"],
        ));
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(roaming) = std::env::var_os("APPDATA") {
            let firefox = PathBuf::from(roaming).join("Mozilla/Firefox");
            if firefox.is_dir() {
                found.push(Profile::other(
                    "firefox",
                    "Firefox",
                    firefox,
                    Kind::Other,
                    &["firefox"],
                ));
            }
        }
    }
    #[cfg(target_os = "linux")]
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        for path in [
            home.join(".mozilla/firefox"),
            home.join("snap/firefox/common/.mozilla/firefox"),
            home.join(".var/app/org.mozilla.firefox/.mozilla/firefox"),
        ] {
            if path.is_dir() {
                found.push(Profile::other(
                    "firefox",
                    "Firefox",
                    path,
                    Kind::Other,
                    &["firefox"],
                ));
                break;
            }
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_port_file_from_a_profile() {
        let dir = tempfile::tempdir().unwrap();
        assert!(port(dir.path()).is_none());
        std::fs::write(
            dir.path().join("DevToolsActivePort"),
            "9222\n/devtools/browser/abc\n",
        )
        .unwrap();
        assert_eq!(
            port(dir.path()),
            Some(DevToolsPort {
                port: 9222,
                path: "/devtools/browser/abc".into()
            })
        );
    }

    #[test]
    fn reads_the_port_file() {
        let port = parse_port("9222\n/devtools/browser/abc-123\n").unwrap();
        assert_eq!(port.port, 9222);
        assert_eq!(port.path, "/devtools/browser/abc-123");
    }

    #[test]
    fn rejects_a_file_without_a_browser_path() {
        assert!(parse_port("9222\n").is_none());
        assert!(parse_port("not a port\n/devtools/browser/abc\n").is_none());
    }

    fn candidate_paths() -> Vec<String> {
        candidates()
            .into_iter()
            .map(|(_, _, dir)| dir.to_string_lossy().replace('\\', "/"))
            .collect()
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn looks_where_linux_browsers_keep_their_profiles() {
        let paths = candidate_paths();
        for wanted in [
            ".config/google-chrome",
            ".config/chromium",
            ".config/microsoft-edge",
            ".config/BraveSoftware/Brave-Browser",
            "snap/chromium/common/chromium",
        ] {
            assert!(
                paths.iter().any(|path| path.ends_with(wanted)),
                "{wanted} in {paths:?}"
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn looks_where_macos_browsers_keep_their_profiles() {
        let paths = candidate_paths();
        for wanted in [
            "Library/Application Support/Google/Chrome",
            "Library/Application Support/Microsoft Edge",
            "Library/Application Support/BraveSoftware/Brave-Browser",
            "Library/Application Support/Arc/User Data",
        ] {
            assert!(
                paths.iter().any(|path| path.ends_with(wanted)),
                "{wanted} in {paths:?}"
            );
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn looks_where_windows_browsers_keep_their_profiles() {
        let paths = candidate_paths();
        for wanted in [
            "Google/Chrome/User Data",
            "Google/Chrome SxS/User Data",
            "Microsoft/Edge/User Data",
            "BraveSoftware/Brave-Browser/User Data",
        ] {
            assert!(
                paths.iter().any(|path| path.ends_with(wanted)),
                "{wanted} in {paths:?}"
            );
        }
    }

    #[test]
    fn slugifies_a_profile_name() {
        assert_eq!(slugify("Chrome Beta"), "chrome-beta");
        assert_eq!(slugify("  "), "chrome");
    }
}
