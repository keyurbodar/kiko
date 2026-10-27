import { describe, expect, it } from "vitest"
import { shellLabel } from "./shell-label"

describe("shellLabel", () => {
  it.each([
    ["cd /tmp && head -c 300 feed.json", "Read feed.json", "file-view"],
    ["cat /home/apps/hn-live/index.html", "Read /home/apps/hn-live/index.html", "file-view"],
    ["sed -n '1,40p' src/app.ts", "Read src/app.ts", "file-view"],
    ["ls -la", "Listed the folder", "folder"],
    ["cd /home/hn-feeds && ls", "Listed /home/hn-feeds", "folder"],
    ["rg -n deploy src", "Searched for “deploy” in src", "search"],
    ["curl -sL https://open-signal-8fbcf76d8a.lakebed.app", "Fetched open-signal-8fbcf76d8a.lakebed.app", "globe"],
    [
      'curl -s -o /dev/null -w "%{http_code} %{size_download}" https://example.com/feed.json',
      "Fetched example.com/feed.json",
      "globe",
    ],
  ])("names a command whose meaning is certain: %s", (command, label, icon) => {
    expect(shellLabel(command)).toEqual({ label, icon })
  })

  it.each([
    ["cd /tmp && jq -r 'to_entries|.[0:3]' feed.json", "Ran jq -r 'to_entries|.[0:3]' feed.json"],
    ['cd /home/apps/hn-live && grep -n "PAPER\\s*=" index.html', 'Ran grep -n "PAPER\\s*=" index.html'],
    ["curl -X POST -d '{}' https://example.com/hook", "Ran curl -X POST -d '{}' https://example.com/hook"],
    ["cat a.txt b.txt", "Ran cat a.txt b.txt"],
    ["tail -f server.log", "Ran tail -f server.log"],
    ["curl -s https://a.dev | head -c 300", "Ran curl -s https://a.dev | head -c 300"],
    ["bun test", "Ran bun test"],
  ])("shows the command itself when its meaning is not certain: %s", (command, label) => {
    expect(shellLabel(command)).toEqual({ label, icon: "terminal" })
  })

  it("drops the leading cd but never the command after it", () => {
    expect(shellLabel("cd /a && cd b && python3 build.py --fast")?.label).toBe("Ran python3 build.py --fast")
  })

  it("keeps long commands to one line", () => {
    expect(shellLabel(`echo ${"x".repeat(200)}`)?.label).toBe(`Ran echo ${"x".repeat(74)}…`)
  })
})
