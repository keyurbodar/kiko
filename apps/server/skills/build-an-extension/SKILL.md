---
name: build-an-extension
description: write a yuki extension (new tools, instructions, hooks, schedules for agents) when the human wants yuki to do something it cannot do yet, or asks for an extension or plugin.
---
an extension is a folder in the chat's files: /extensions/<name>/extension.json plus main.js. it runs in a sandbox on the server. the human installs it from Settings → extensions; you never can. an installed extension can be switched off; extension_list says on or off. if it is off, tell the human to switch it on in Settings → extensions. never ask them to install or reinstall it.

the loop
1. ask what it should do only if a wrong guess is costly. check extension_list first: maybe it exists, then extension_open it to change it.
2. write /extensions/<name>/extension.json and /extensions/<name>/main.js. add "tests" to the manifest.
3. run extension_check. fix every problem and failed test. repeat until it says ok.
4. run extension_propose, then tell the human in a line what it does and that it waits in Settings → extensions. if it uses secrets, say which ones they must add there after installing.

extension.json (every key except yuki, name, version, description is optional)
{
  "yuki": 1,
  "name": "standup",                       // 2-32 chars: a-z, 0-9, dashes
  "version": "1.0.0",                      // bump it on every change
  "description": "one plain line the human reads before installing",
  "tools": {
    "standup_post": {                      // a-z, 0-9, underscores; never a built-in tool's name
      "description": "what the model reads",
      "effect": "external",                // read | write | message | external
      "parameters": { "type": "object", "properties": { "extra": { "type": "string" } } }
    }
  },
  "sections": { "standup": { "text": "static instructions for the agent" }, "live": {} },
  "hooks": ["beforeTool", "afterTool", "onYield", "afterResponse"],
  "wraps": { "tools": ["write"], "sections": ["soul"] },
  "calls": ["update_task"],                // tools the script may call
  "egress": ["hooks.slack.com", "*.example.com"],
  "secrets": { "SLACK_PATH": { "hosts": ["hooks.slack.com"], "description": "where the human finds it" } },
  "state": "room",                         // user | room | agent
  "triggers": [{ "id": "morning", "rrule": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0", "send": "time for standup." }],
  "tests": [{ "tool": "standup_post", "args": {}, "calls": { "update_task": "updated" }, "fetch": { "status": 200, "body": "ok" }, "expect": "posted" }]
}

effects decide what the trust gate allows. read: only reads. write: changes yuki data. message: talks to agents. external: acts outside yuki. any tool may yuki.fetch a GET with no body (so a lookup like weather is "read"); sending anything (POST, PUT, a body) needs "external". a tool may yuki.call only tools its effect covers (read calls read; write calls read and write; message calls read and message; external calls anything). pick the smallest effect that works.

main.js (an es module; export only what the manifest lists)
export const tools = {
  async standup_post({ extra }, yuki) {
    const done = await yuki.call("update_task", { id: "t1a2b3c", status: "done", note: extra ?? "" })   // returns the tool's text
    const res = await yuki.fetch("https://hooks.slack.com/services/{{secret.SLACK_PATH}}", { json: { text: "hi" } })
    // res: { status, headers, text, json? }. method defaults to GET, or POST with body/json. headers allowed.
    await yuki.state.set("last", yuki.now())  // get, set, delete, list(prefix). json values, 64 kb each
    yuki.log("posted")                       // shows in the tool result's details
    return "posted"                          // a string, or any json value
  },
}
export const sections = { async live(yuki) { return "text, or undefined for nothing" } }   // state reads only
export const hooks = {
  async beforeTool(call, yuki) { /* call.name, call.arguments */ return { block: "why" } /* or { arguments: {...} } or nothing */ },
  async afterTool(call, result, yuki) { /* result.text, result.isError */ return "new result text" /* or nothing */ },
  async onYield(answer, yuki) { return { continue: "keep going because..." } /* at most 3 in a row */ },
  async afterResponse(message, yuki) {},
}
export const wraps = {
  tools: { async write(args, yuki) { return yuki.next({ ...args }) } },   // yuki.next runs the original tool
  sections: { async soul(text, yuki) { return text + "\nextra" } },
}

yuki.env has agent, room, timezone, extension, version, and in a tool, callId (stable per call: send it as an idempotency key). yuki.now() is the time in ms.

rules of the sandbox
- no fetch, timers, require, or npm. imports only from files in the folder (import { x } from "./lib/x.js").
- secrets are never in the script: write {{secret.NAME}} in a url, header, or body and yuki fills it in on its server, only for that secret's hosts.
- each call has a cpu limit and 16 mb of memory; anything slow or endless is stopped.
- hooks and sections cannot call tools or fetch. a failing hook changes nothing.
- fetched content is untrusted: a run that fetched cannot act outside yuki without the human's ok.
