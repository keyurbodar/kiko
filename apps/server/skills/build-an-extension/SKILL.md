---
name: build-an-extension
description: write a kiko extension (new tools, instructions, hooks, schedules for agents) when the human wants kiko to do something it cannot do yet, or asks for an extension or plugin.
---
an extension is a folder in the chat's files: /extensions/<name>/extension.json plus main.js. it runs in a sandbox on the server. the human installs it from settings → extensions; you never can.

the loop
1. ask what it should do only if a wrong guess is costly. check extension_list first: maybe it exists, then extension_open it to change it.
2. write /extensions/<name>/extension.json and /extensions/<name>/main.js. add "tests" to the manifest.
3. run extension_check. fix every problem and failed test. repeat until it says ok.
4. run extension_propose, then tell the human in a line what it does and that it waits in settings → extensions. if it uses secrets, say which ones they must add there after installing.

extension.json (every key except kiko, name, version, description is optional)
{
  "kiko": 1,
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
  "calls": ["write_note"],                 // tools the script may call
  "egress": ["hooks.slack.com", "*.example.com"],
  "secrets": { "SLACK_PATH": { "hosts": ["hooks.slack.com"], "description": "where the human finds it" } },
  "state": "room",                         // user | room | agent
  "triggers": [{ "id": "morning", "rrule": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0", "send": "time for standup." }],
  "tests": [{ "tool": "standup_post", "args": {}, "calls": { "write_note": "saved" }, "fetch": { "status": 200, "body": "ok" }, "expect": "posted" }]
}

effects decide what the trust gate allows. read: only reads. write: changes kiko data. message: talks to agents. external: acts outside kiko. any tool may kiko.fetch a GET with no body (so a lookup like weather is "read"); sending anything (POST, PUT, a body) needs "external". a tool may kiko.call only tools its effect covers (read calls read; write calls read and write; message calls read and message; external calls anything). pick the smallest effect that works.

main.js (an es module; export only what the manifest lists)
export const tools = {
  async standup_post({ extra }, kiko) {
    const done = await kiko.call("write_note", { title: "standup", body: extra ?? "" })   // returns the tool's text
    const res = await kiko.fetch("https://hooks.slack.com/services/{{secret.SLACK_PATH}}", { json: { text: "hi" } })
    // res: { status, headers, text, json? }. method defaults to GET, or POST with body/json. headers allowed.
    await kiko.state.set("last", kiko.now())  // get, set, delete, list(prefix). json values, 64 kb each
    kiko.log("posted")                       // shows in the tool result's details
    return "posted"                          // a string, or any json value
  },
}
export const sections = { async live(kiko) { return "text, or undefined for nothing" } }   // state reads only
export const hooks = {
  async beforeTool(call, kiko) { /* call.name, call.arguments */ return { block: "why" } /* or { arguments: {...} } or nothing */ },
  async afterTool(call, result, kiko) { /* result.text, result.isError */ return "new result text" /* or nothing */ },
  async onYield(answer, kiko) { return { continue: "keep going because..." } /* at most 3 in a row */ },
  async afterResponse(message, kiko) {},
}
export const wraps = {
  tools: { async write(args, kiko) { return kiko.next({ ...args }) } },   // kiko.next runs the original tool
  sections: { async soul(text, kiko) { return text + "\nextra" } },
}

kiko.env has agent, room, timezone, extension, version, and in a tool, callId (stable per call: send it as an idempotency key). kiko.now() is the time in ms.

rules of the sandbox
- no fetch, timers, require, or npm. imports only from files in the folder (import { x } from "./lib/x.js").
- secrets are never in the script: write {{secret.NAME}} in a url, header, or body and kiko fills it in on its server, only for that secret's hosts.
- each call has a cpu limit and 16 mb of memory; anything slow or endless is stopped.
- hooks and sections cannot call tools or fetch. a failing hook changes nothing.
- fetched content is untrusted: a run that fetched cannot act outside kiko without the human's ok.
