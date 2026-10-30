use std::io::{BufRead, Write};

use serde::Serialize;

use crate::api::{Call, DriverError, ErrorCode, False, Request, Response, Status, True};
use crate::{Browser, Native};

fn value<T: Serialize>(result: crate::Result<T>) -> crate::Result<serde_json::Value> {
    result.and_then(|v| {
        serde_json::to_value(v).map_err(|e| DriverError::new(ErrorCode::Failed, e.to_string()))
    })
}

pub fn dispatch(
    native: &mut dyn Native,
    browser: &mut dyn Browser,
    status: &Status,
    call: Call,
) -> crate::Result<serde_json::Value> {
    match call {
        Call::Status => {
            let mut status = status.clone();
            status.permissions = native.permissions();
            status.browsers = browser.status();
            value(Ok(status))
        }
        Call::PermissionsRequest(p) => value(native.request_permission(p.kind)),
        Call::Windows => value(native.windows()),
        Call::Look(p) => value(native.look(&p)),
        Call::Act(p) => value(native.act(&p)),
        Call::Open(p) => value(native.open(&p)),
        Call::BrowserTabs => value(browser.tabs()),
        Call::BrowserOpen(p) => value(browser.open(&p)),
        Call::BrowserClose(p) => value(browser.close(&p)),
        Call::BrowserShow(p) => value(browser.show(&p)),
        Call::BrowserRead(p) => value(browser.read(&p)),
        Call::BrowserAct(p) => value(browser.act(&p)),
        Call::BrowserEval(p) => value(browser.eval(&p)),
    }
}

fn respond(id: u64, result: crate::Result<serde_json::Value>) -> Response {
    match result {
        Ok(value) => Response::Ok {
            id,
            ok: True,
            value,
        },
        Err(error) => Response::Err {
            id,
            ok: False,
            error,
        },
    }
}

fn answer(
    native: &mut dyn Native,
    browser: &mut dyn Browser,
    status: &Status,
    line: &str,
) -> Option<Response> {
    match serde_json::from_str::<Request>(line) {
        Ok(request) => Some(respond(
            request.id,
            dispatch(native, browser, status, request.call),
        )),
        Err(error) => {
            let id = serde_json::from_str::<serde_json::Value>(line)
                .ok()?
                .get("id")?
                .as_u64()?;
            Some(respond(
                id,
                Err(DriverError::new(ErrorCode::Unsupported, error.to_string())),
            ))
        }
    }
}

pub fn serve(
    native: &mut dyn Native,
    browser: &mut dyn Browser,
    status: &Status,
    input: impl BufRead,
    mut output: impl Write,
) -> std::io::Result<()> {
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        if let Some(response) = answer(native, browser, status, &line) {
            serde_json::to_writer(&mut output, &response)?;
            output.write_all(b"\n")?;
            output.flush()?;
        }
    }
    Ok(())
}
