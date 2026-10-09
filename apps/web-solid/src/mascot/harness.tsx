// The flock board: every flavor, outfit, mood, scene and group stack, drawn by the real
// components. Open /src/mascot/harness.html on the dev server.

import { For, type JSX } from "solid-js"
import { render } from "solid-js/web"
import "../styles/app.css"
import { TypingIndicator } from "../chat/typing/TypingIndicator"
import { ChatAvatar } from "../lib/IdentityAvatar"
import { SidebarSky } from "../sidebar/sky"
import { Bird } from "./bird"
import { FLAVOR_IDS, FLAVORS, OUTFIT_IDS, OUTFITS, YUKI, type BirdState } from "./birds"
import { setBirdPicks } from "./choices"
import Moment from "./moment"
import Perch from "./perch"
import { SEASON_OUTFIT } from "./scene"

const MOODS: BirdState[] = ["idle", "thinking", "working", "typing", "sending", "wave", "sleeping"]
const SEASONS = [
  ["Winter", new Date(2026, 0, 10, 14)],
  ["Spring", new Date(2026, 3, 10, 9)],
  ["Summer", new Date(2026, 6, 10, 19)],
  ["Autumn night", new Date(2026, 9, 10, 23)],
] as const

// Fixed picks, so the board shows chosen flavors rather than seeded ones.
setBirdPicks({ ada: "matcha.none", bo: "ramune.phones", cy: "ichigo.bow", dee: "kinako.none" })

const card = "flex flex-col items-center gap-2 rounded-2xl bg-[var(--panel)] p-3 text-xs text-muted"

function Section(props: { title: string; note: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-3">
      <div class="flex items-baseline gap-3">
        <h2 class="text-lg font-semibold text-text">{props.title}</h2>
        <span class="text-sm text-muted">{props.note}</span>
      </div>
      {props.children}
    </section>
  )
}

function Board() {
  return (
    <div class="flex h-screen flex-col gap-10 overflow-y-auto bg-[var(--bg)] p-8 text-text" data-board>
      <header class="flex items-center gap-4">
        <Bird spec={YUKI} size={120} alive />
        <div>
          <h1 class="text-3xl font-semibold">Yuki and the sweets flock</h1>
          <p class="text-muted">Every bird here is drawn by the app's own components.</p>
        </div>
      </header>

      <Section title="Flavors" note="Yuki is the warm cream chief; the friends are colorways other agents wear">
        <div class="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
          <For each={FLAVOR_IDS}>
            {(f) => (
              <div class={card}>
                <Bird spec={{ flavor: f, outfit: "none" }} size={88} alive />
                <span class="font-medium text-text">{FLAVORS[f].label}</span>
                <span>{FLAVORS[f].vibe}</span>
                <div class="flex items-end gap-2">
                  <Bird spec={{ flavor: f, outfit: "none" }} size={32} />
                  <Bird spec={{ flavor: f, outfit: "none" }} size={20} />
                </div>
              </div>
            )}
          </For>
        </div>
      </Section>

      <Section title="Outfits" note="the wardrobe, plus the three seasonal touches the brand mark wears">
        <div class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
          <For each={OUTFIT_IDS}>
            {(o, i) => (
              <div class={card}>
                <Bird spec={{ flavor: FLAVOR_IDS[i() % FLAVOR_IDS.length]!, outfit: o }} size={80} />
                <span class="font-medium text-text">{OUTFITS[o].label}</span>
              </div>
            )}
          </For>
        </div>
      </Section>

      <Section title="Moods" note="what an agent is doing, acted out; the typing row and the info panel use these">
        <div class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
          <For each={MOODS}>
            {(m) => (
              <div class={card}>
                <Bird spec={YUKI} size={80} state={m} alive />
                <span class="font-medium text-text">{m.charAt(0).toUpperCase() + m.slice(1)}</span>
                <Bird spec={{ flavor: "ramune", outfit: "none" }} size={32} state={m} alive />
              </div>
            )}
          </For>
        </div>
      </Section>

      <Section title="Group stacks" note="a dango huddle, the chief in front">
        <div class="flex flex-wrap items-end gap-6">
          <For each={[["kiko", "ada"], ["kiko", "ada", "bo"], ["ada", "cy", "dee"]]}>
            {(faces) => (
              <div class={card}>
                <div class="flex items-end gap-3">
                  <ChatAvatar faces={faces} size={56} />
                  <ChatAvatar faces={faces} size={40} />
                  <ChatAvatar faces={faces} size={24} />
                </div>
                <span>{faces.join(", ")}</span>
              </div>
            )}
          </For>
        </div>
      </Section>

      <Section title="Empty chat" note="the chat's birds on a birch twig, with the season and the time of day">
        <div class="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-3">
          <For each={SEASONS}>
            {([label, now], i) => (
              <div class={card}>
                <Perch faces={[["kiko"], ["kiko", "ada"], ["kiko", "ada", "bo"], ["kiko", "cy"]][i()]!} now={now} />
                <span>{label}</span>
              </div>
            )}
          </For>
        </div>
      </Section>

      <Section title="Brand and sidebar sky" note="Yuki in each season's touch; the sky by day and by night">
        <div class="flex flex-wrap items-start gap-6">
          <div class={card}>
            <div class="flex gap-3">
              <For each={["winter", "spring", "summer", "autumn"] as const}>{(s) => <Bird spec={{ ...YUKI, outfit: SEASON_OUTFIT[s] }} size={44} />}</For>
            </div>
            <span>Brand mark through the year</span>
          </div>
          <For each={[new Date(2026, 9, 9, 13), new Date(2026, 9, 9, 23)]}>
            {(now) => (
              <div class="relative h-[96px] w-[280px] overflow-hidden rounded-2xl bg-[var(--panel)]">
                <SidebarSky now={now} />
                <div class="relative flex items-center gap-2 p-3 text-sm font-semibold">
                  <Bird spec={{ ...YUKI, outfit: "momiji" }} size={22} />
                  Yuki
                </div>
              </div>
            )}
          </For>
        </div>
      </Section>

      <Section title="Moments" note="an empty search, an empty list, the first success">
        <div class="flex items-end gap-10">
          <Moment kind="nothing" />
          <Moment kind="nest" faces={["kiko"]} />
          <Moment kind="cheer" faces={["kiko", "ada", "bo"]} />
        </div>
      </Section>

      <Section title="Typing" note="each row's bird acts out the run">
        <div class="flex flex-col gap-3">
          <TypingIndicator typists={["ada", "bo", "cy"]} seeds={["ada", "bo", "cy"]} doings={[undefined, "reading a web page", "editing /plan.md"]} group />
        </div>
      </Section>
    </div>
  )
}

render(() => <Board />, document.getElementById("root")!)
