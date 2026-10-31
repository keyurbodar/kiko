use std::path::Path;
use std::process::{Command, Stdio};

use kiko_driver::{OpenParams, OpenTarget, Result};

use crate::error::failed;

pub(crate) fn open(params: &OpenParams) -> Result<()> {
    for command in commands(params) {
        if spawn(&command).is_ok() {
            return Ok(());
        }
    }
    Err(failed(format!(
        "could not launch {}",
        describe(&params.target)
    )))
}

fn commands(params: &OpenParams) -> Vec<Vec<String>> {
    match &params.target {
        OpenTarget::App(app) if app.ends_with(".desktop") || app.contains('/') => {
            vec![vec!["gio".to_string(), "launch".to_string(), app.clone()]]
        }
        OpenTarget::App(app) => vec![
            vec!["gtk-launch".to_string(), app.clone()],
            vec!["gio".to_string(), "launch".to_string(), app.clone()],
        ],
        OpenTarget::Url(url) => vec![vec!["xdg-open".to_string(), url.clone()]],
        OpenTarget::Path(path) => vec![vec!["xdg-open".to_string(), path.clone()]],
    }
}

fn spawn(command: &[String]) -> std::io::Result<()> {
    let Some(program) = command.first() else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "empty command",
        ));
    };
    let mut process = if setsid() {
        let mut process = Command::new("setsid");
        process.args(command);
        process
    } else {
        let mut process = Command::new(program);
        process.args(&command[1..]);
        process
    };
    process
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
}

fn setsid() -> bool {
    ["/usr/bin/setsid", "/bin/setsid"]
        .iter()
        .any(|path| Path::new(path).exists())
}

fn describe(target: &OpenTarget) -> String {
    match target {
        OpenTarget::App(app) => app.clone(),
        OpenTarget::Url(url) => url.clone(),
        OpenTarget::Path(path) => path.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::commands;
    use kiko_driver::{Mode, OpenParams, OpenTarget};

    fn params(target: OpenTarget) -> OpenParams {
        OpenParams {
            target,
            mode: Mode::Background,
        }
    }

    #[test]
    fn desktop_files_go_through_gio_launch() {
        let commands = commands(&params(OpenTarget::App("kiko.desktop".to_string())));
        assert_eq!(
            commands,
            vec![vec![
                "gio".to_string(),
                "launch".to_string(),
                "kiko.desktop".to_string()
            ]]
        );
    }

    #[test]
    fn app_names_try_gtk_launch_first() {
        let commands = commands(&params(OpenTarget::App("gedit".to_string())));
        assert_eq!(
            commands.first().map(|command| command[0].as_str()),
            Some("gtk-launch")
        );
    }

    #[test]
    fn urls_and_paths_go_through_xdg_open() {
        assert_eq!(
            commands(&params(OpenTarget::Url("https://kiko.chat".to_string())))[0][0],
            "xdg-open"
        );
        assert_eq!(
            commands(&params(OpenTarget::Path("/tmp/a.txt".to_string())))[0][0],
            "xdg-open"
        );
    }
}
