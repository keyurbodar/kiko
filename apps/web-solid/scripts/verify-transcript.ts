import assert from "node:assert/strict"
import {
  KIKO_HOME_ROOM,
  isAgentSlug,
  newRoomId,
  type ClientToOwner,
  type OwnerToClient,
  type RoomId,
} from "@kiko/protocol"
import type { Browser, Page } from "playwright"

function exchange(socket: WebSocket, frame: ClientToOwner, match: (frame: OwnerToClient) => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`No answer to ${frame.t}`)), 10_000)
    const receive = (event: MessageEvent) => {
      if (event.data === "pong") return
      const incoming: OwnerToClient = JSON.parse(String(event.data))
      if (match(incoming)) finish()
    }
    function finish(error?: Error) {
      clearTimeout(timer)
      socket.removeEventListener("message", receive)
      if (error) reject(error)
      else resolve()
    }
    socket.addEventListener("message", receive)
    socket.send(JSON.stringify(frame))
  })
}

async function connected(origin: string, token: string): Promise<WebSocket> {
  const socket = new WebSocket(`${origin.replace(/^http/, "ws")}/api/ws`, ["kiko", token])
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true })
    socket.addEventListener("error", () => reject(new Error("Could not open transcript socket")), { once: true })
  })
  await exchange(socket, { t: "hello", lastSeq: 0 }, (f) => f.t === "reset" || f.t === "events")
  return socket
}

async function otherRoom(origin: string, token: string): Promise<RoomId> {
  const socket = await connected(origin, token)
  const roomId = newRoomId()
  const slug = "runtime-scout"
  assert(isAgentSlug(slug))
  const agent = {
    id: crypto.randomUUID(),
    slug,
    name: "Runtime scout",
    prompt: "Help with runtime verification",
    model: "",
  }
  try {
    await exchange(
      socket,
      { t: "agent", op: { op: "create", agent } },
      (f) => f.t === "events" && f.events.some((e) => e.t === "agent" && e.agent.id === agent.id),
    )
    await exchange(
      socket,
      { t: "chat", op: { op: "create", roomId, title: "Runtime scout", agents: [agent.id] } },
      (f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId),
    )
    return roomId
  } finally {
    socket.close()
  }
}

async function seed(origin: string, token: string, texts: string[], roomId = KIKO_HOME_ROOM): Promise<void> {
  const socket = await connected(origin, token)
  try {
    await exchange(
      socket,
      { t: "subscribe", roomId, lastSeq: 0 },
      (f) => f.t === "room" && (f.frame.t === "reset" || f.frame.t === "events"),
    )
    for (const text of texts) {
      const clientId = crypto.randomUUID()
      await exchange(
        socket,
        { t: "room", roomId, frame: { t: "send", clientId, text } },
        (f) => f.t === "room" && f.frame.t === "ack" && f.frame.clientId === clientId,
      )
    }
  } finally {
    socket.close()
  }
}

async function transcript(page: Page, texts: string[]): Promise<void> {
  await page.locator('[data-component="chat-scroll"]').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  for (const text of texts.toReversed()) {
    await page.getByText(text, { exact: true }).first().waitFor()
    await page
      .getByText(text, { exact: true })
      .first()
      .evaluate((element) => {
        element.closest("[data-virtual-scroll]")?.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }))
        element.scrollIntoView({ block: "start" })
      })
  }
  const blank = await page
    .locator('[data-component="chat-row"] [data-slot="bubble-content"]')
    .evaluateAll(
      (bubbles) =>
        bubbles.filter(
          (bubble) => !bubble.textContent?.trim() && !bubble.querySelector("img,video,[data-component=chat-file]"),
        ).length,
    )
  assert.equal(blank, 0, "Transcript contains empty message bubbles")
}

export async function verifyTranscript(browser: Browser, origin: string, observe: (page: Page) => void): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 600 } })
  try {
    const response = await context.request.post(`${origin}/api/auth/dev/session`, {
      data: { name: `transcript-${crypto.randomUUID().slice(0, 16)}` },
    })
    assert(response.ok())
    const { user, token } = await response.json()
    assert(
      (
        await context.request.post(`${origin}/api/settings`, {
          headers: { authorization: `Bearer ${token}` },
          data: { onboarded: true },
        })
      ).ok(),
    )
    const texts = Array.from(
      { length: 8 },
      (_, i) =>
        `Transcript message ${i + 1} stays visible. ${"The complete message must remain readable. ".repeat(8).trim()}`,
    )
    await seed(origin, token, texts)
    const alternate = await otherRoom(origin, token)
    const alternateText = "Messages follow the currently open agent"
    await seed(origin, token, [alternateText], alternate)
    await context.addInitScript(
      ({ user, token }) => {
        localStorage.setItem("kiko:session", JSON.stringify(user))
        localStorage.setItem("kiko:token", token)
      },
      { user, token },
    )
    const page = await context.newPage()
    observe(page)
    await page.goto(`${origin}/chat/${KIKO_HOME_ROOM}`)
    await page.locator('[data-component="prompt-input"]').waitFor()
    for (let visit = 0; visit < 3; visit++) {
      await page.getByRole("link", { name: "Recipes", exact: true }).click()
      await page.getByRole("searchbox", { name: "Search recipes" }).waitFor()
      await page
        .getByRole("navigation", { name: "Recipes navigation" })
        .getByRole("link", { name: "Chats", exact: true })
        .click()
      await page.locator('[data-component="crash"], [data-component="prompt-input"]').first().waitFor()
      assert.equal(
        await page.locator('[data-component="crash"]').count(),
        0,
        "Returning from Recipes crashed the chat timeline",
      )
      await page.locator('[data-component="prompt-input"]').waitFor()
    }
    console.log("pass Recipes to populated chat navigation")
    await transcript(page, texts)
    await page.reload()
    await page.locator('[data-component="prompt-input"]').waitFor()
    await transcript(page, texts)
    const reconnected = page.waitForEvent("websocket")
    await context.setOffline(true)
    await context.setOffline(false)
    await reconnected
    await page.locator("[data-virtual-scroll]").evaluate((element) => {
      element.dispatchEvent(new WheelEvent("wheel", { deltaY: 1 }))
      element.scrollTop = element.scrollHeight
    })
    const live = "Live message appears without a refresh"
    await seed(origin, token, [live])
    await page.getByText(live, { exact: true }).waitFor()
    for (let visit = 0; visit < 3; visit++) {
      await page.locator('[data-component="sidebar-row"]').filter({ hasText: "Runtime scout" }).click()
      await page.getByText(alternateText, { exact: true }).waitFor()
      await page
        .locator('[data-component="prompt-input"]')
        .pressSequentially("Draft :lol: stays editable", { delay: 30 })
      await page.locator('[data-component="prompt-input"]').fill("")
      await page.locator('[data-component="sidebar-row"][data-main]').click()
      await page.getByText(live, { exact: true }).waitFor()
      assert.equal(
        await page.locator('[data-component="crash"]').count(),
        0,
        "Switching populated chats crashed the transcript",
      )
    }
    console.log("pass populated agent navigation without a refresh")
    console.log("pass transcript cold load, warm cache, scrolling, reconnect and live arrival")
  } finally {
    await context.close()
  }
}
