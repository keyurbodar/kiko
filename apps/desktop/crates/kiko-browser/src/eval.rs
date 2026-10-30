use std::time::Duration;

use kiko_driver::{BrowserEvalParams, DriverError, ErrorCode, Result};
use serde_json::{Value, json};

use crate::state::{State, split_tab};

const EVAL_TIMEOUT: Duration = Duration::from_secs(10);

pub async fn run(state: &mut State, params: &BrowserEvalParams) -> Result<Value> {
    let (slug, target) = split_tab(&params.tab)?;
    let (link, session) = state.session(&slug, &target).await?;
    let result = link
        .send_with(
            Some(&session),
            "Runtime.evaluate",
            json!({ "expression": params.expression, "returnByValue": true, "awaitPromise": true }),
            EVAL_TIMEOUT,
        )
        .await?;
    if let Some(exception) = result.get("exceptionDetails") {
        let text = exception["exception"]["description"]
            .as_str()
            .or_else(|| exception["text"].as_str())
            .unwrap_or("the page raised an error");
        return Err(DriverError::new(ErrorCode::Failed, text.to_string()));
    }
    Ok(result
        .get("result")
        .and_then(|result| result.get("value"))
        .cloned()
        .unwrap_or(Value::Null))
}
