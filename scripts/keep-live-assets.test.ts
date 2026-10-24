import { describe, expect, it } from "vitest"
import { assetRefs } from "./keep-live-assets"

describe("assetRefs", () => {
  it("finds every hashed chunk an entry page or chunk references", () => {
    const html = `<script type="module" src="/assets/main-CtdB4Wd8.js"></script><link href="/assets/main-Bx1_aZ9q.css">`
    const chunk = `import("./chat-view-Du1PbH0C.js");const a="assets/RichText-BtIq9Y9d.js";url(./inter-latin-AbCdEf12.woff2)`
    expect(assetRefs(html)).toEqual(["main-CtdB4Wd8.js", "main-Bx1_aZ9q.css"])
    expect(assetRefs(chunk)).toEqual(["chat-view-Du1PbH0C.js", "RichText-BtIq9Y9d.js", "inter-latin-AbCdEf12.woff2"])
  })

  it("ignores names without a build hash", () => {
    expect(assetRefs(`fetch("/releases/latest-owner.json");import "solid-js"`)).toEqual([])
  })
})
