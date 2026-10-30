use kiko_driver::*;

struct Fake;

impl Native for Fake {
    fn permissions(&self) -> Permissions {
        Permissions { accessibility: Grant::Granted, screen: Grant::Denied, automation: Grant::NotNeeded }
    }
    fn request_permission(&mut self, _: PermissionKind) -> Result<()> {
        Ok(())
    }
    fn windows(&mut self) -> Result<Vec<Window>> {
        Ok(vec![Window {
            id: "w1".into(),
            pid: 7,
            app: "TextEdit".into(),
            bundle: None,
            title: "Notes".into(),
            frame: Rect { x: 0.0, y: 0.0, w: 10.0, h: 10.0 },
            focused: false,
            minimized: false,
            on_screen: true,
        }])
    }
    fn look(&mut self, _: &LookParams) -> Result<Look> {
        Err(DriverError::new(ErrorCode::NotFound, "no such window"))
    }
    fn act(&mut self, params: &ActParams) -> Result<ActResult> {
        match params.mode {
            Mode::Background => Err(DriverError::new(ErrorCode::BackgroundUnavailable, "needs the screen")),
            Mode::Foreground => Ok(ActResult { route: Route::Foreground }),
        }
    }
    fn open(&mut self, _: &OpenParams) -> Result<()> {
        Ok(())
    }
}

fn run(lines: &str) -> Vec<serde_json::Value> {
    let status = Status {
        version: "0.1.0".into(),
        os: "test".into(),
        session: "x11".into(),
        permissions: Fake.permissions(),
        browsers: vec![],
    };
    let mut out = Vec::new();
    serve(&mut Fake, &mut Unavailable, &status, lines.as_bytes(), &mut out).unwrap();
    String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect()
}

#[test]
fn answers_each_request_by_id() {
    let out = run("{\"id\":1,\"method\":\"windows\"}\n{\"id\":2,\"method\":\"status\"}\n");
    assert_eq!(out[0]["id"], 1);
    assert_eq!(out[0]["ok"], true);
    assert_eq!(out[0]["value"][0]["on_screen"], true);
    assert_eq!(out[1]["value"]["permissions"]["screen"], "denied");
}

#[test]
fn background_act_refuses_instead_of_taking_the_screen() {
    let out = run("{\"id\":3,\"method\":\"act\",\"params\":{\"window\":\"w1\",\"ref\":4,\"action\":\"press\"}}\n");
    assert_eq!(out[0]["ok"], false);
    assert_eq!(out[0]["error"]["code"], "background_unavailable");
    let out = run("{\"id\":4,\"method\":\"act\",\"params\":{\"window\":\"w1\",\"action\":\"press\",\"mode\":\"foreground\"}}\n");
    assert_eq!(out[0]["value"]["route"], "foreground");
}

#[test]
fn an_unknown_method_still_gets_an_answer() {
    let out = run("{\"id\":9,\"method\":\"teleport\"}\n");
    assert_eq!(out[0]["id"], 9);
    assert_eq!(out[0]["error"]["code"], "unsupported");
}

#[test]
fn browser_calls_without_a_browser_are_unsupported() {
    let out = run("{\"id\":5,\"method\":\"browser.tabs\"}\n");
    assert_eq!(out[0]["error"]["code"], "unsupported");
}
