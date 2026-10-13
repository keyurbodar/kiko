// Settings, appearance: a few titled groups of rows. One theme in light and dark, an accent from
// the flock, and the interface and font settings.
import { For, type JSX } from "solid-js"
import { appearanceOf } from "@kiko/theme/apply"
import { buttonClass, Group, Row, Segmented, Slider, Toggle } from "../settings/kit"
import { look, updateLook } from "./live"
import { Select } from "../settings/select"
import { BASE_SIZE, CHAT_WIDTHS, CONTRAST, DEFAULT_DISPLAY, type ChatWidth, type Display } from "@kiko/theme/display"
import { DEFAULT_LOOK, type Mode } from "@kiko/theme/look"
import { ACCENT_IDS, ACCENTS } from "@kiko/theme/palette"

const shown = () => appearanceOf(look().mode)

function AccentPicker(): JSX.Element {
  return (
    <div class="flex items-center gap-1" role="radiogroup" aria-label="Accent color">
      <For each={ACCENT_IDS}>
        {(id) => (
          <button
            type="button"
            role="radio"
            aria-checked={look().accent === id}
            aria-label={ACCENTS[id].label}
            title={ACCENTS[id].label}
            data-accent={id}
            class="grid size-7 cursor-pointer place-items-center rounded-full outline-none [&[aria-checked=true]>span]:shadow-[0_0_0_2px_var(--bg),0_0_0_3px_var(--text)]"
            onClick={() => updateLook({ accent: id })}
          >
            <span class="block size-5 rounded-full" style={{ background: ACCENTS[id][shown()] }} />
          </button>
        )}
      </For>
    </div>
  )
}

function ColorGroup(): JSX.Element {
  return (
    <Group title="Theme">
      <Row label="Mode" description="System follows the OS appearance." onReset={look().mode !== DEFAULT_LOOK.mode ? () => updateLook({ mode: DEFAULT_LOOK.mode }) : undefined}>
        <Segmented<Mode>
          label="Mode"
          value={look().mode}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={(mode) => updateLook({ mode })}
        />
      </Row>
      <Row label="Accent color" description="Links, mentions, focus, and your message bubbles." onReset={look().accent !== DEFAULT_LOOK.accent ? () => updateLook({ accent: DEFAULT_LOOK.accent }) : undefined}>
        <AccentPicker />
      </Row>
    </Group>
  )
}

function InterfaceGroups(): JSX.Element {
  const d = () => look().display
  const set = (patch: Partial<Display>) => updateLook({ display: { ...d(), ...patch } })
  const reset = <K extends keyof Display>(key: K) => (d()[key] !== DEFAULT_DISPLAY[key] ? () => set({ [key]: DEFAULT_DISPLAY[key] } as Partial<Display>) : undefined)
  const sizes = Array.from({ length: BASE_SIZE.max - BASE_SIZE.min + 1 }, (_, i) => BASE_SIZE.min + i)
  return (
    <>
      <Group title="Interface">
        <Row label="Contrast" description="Adjust the contrast of borders, lines, and fills across the interface." onReset={reset("contrast")}>
          <Slider label="Contrast" value={d().contrast} display={`${d().contrast}%`} min={CONTRAST.min} max={CONTRAST.max} step={CONTRAST.step} onChange={(contrast) => set({ contrast })} />
        </Row>
        <Row label="Chat width" description="How wide messages and the composer can grow on large screens." onReset={reset("chatWidth")}>
          <Select label="Chat width" value={d().chatWidth} options={(Object.keys(CHAT_WIDTHS) as ChatWidth[]).map((value) => ({ value, label: CHAT_WIDTHS[value].label }))} onChange={(chatWidth) => set({ chatWidth })} />
        </Row>
        <Row label="Text size" description="The interface text. Chat messages stay one step larger." onReset={reset("baseSize")}>
          <Select label="Text size" value={d().baseSize} options={sizes.map((px) => ({ value: px, label: `${px} px` }))} onChange={(baseSize) => set({ baseSize })} />
        </Row>
      </Group>
      <Group title="Fonts">
        <Row label="Interface font" description="Any font installed on this device. Empty uses the system font." onReset={reset("interfaceFont")}>
          <input class="kit-field w-56" aria-label="Interface font" placeholder="System" value={d().interfaceFont} onChange={(e) => set({ interfaceFont: e.currentTarget.value.trim() })} />
        </Row>
        <Row label="Code font" description="Code blocks and inline code. Any installed monospace font, or empty for the system mono." onReset={reset("codeFont")}>
          <input class="kit-field w-56" aria-label="Code font" placeholder="System mono" value={d().codeFont} onChange={(e) => set({ codeFont: e.currentTarget.value.trim() })} />
        </Row>
        <Row label="Font smoothing" description="Use thinner grayscale text smoothing instead of the system default." onReset={reset("smoothing")}>
          <Toggle label="Font smoothing" on={d().smoothing} onChange={(smoothing) => set({ smoothing })} />
        </Row>
      </Group>
    </>
  )
}

export default function Appearance(): JSX.Element {
  return (
    <div class="flex flex-col gap-8" data-component="appearance" data-appearance-now={shown()}>
      <ColorGroup />
      <InterfaceGroups />
      <div class="flex justify-end">
        <button type="button" class={buttonClass()} data-action="restore-appearance" onClick={() => updateLook({ mode: DEFAULT_LOOK.mode, accent: DEFAULT_LOOK.accent, display: DEFAULT_DISPLAY })}>
          Restore defaults
        </button>
      </div>
    </div>
  )
}
