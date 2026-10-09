// Settings, appearance: a few titled groups of rows. One theme in light and dark, an accent from
// the flock, and the interface and font settings.
import { For, type JSX } from "solid-js"
import { appearanceOf } from "./apply"
import { buttonClass, Group, Row, Segmented, Slider, Toggle } from "../settings/kit"
import { look, updateLook } from "./live"
import { Select } from "../settings/select"
import { CHAT_WIDTHS, CODE_FONTS, CONTRAST, DEFAULT_DISPLAY, FONT_SIZES, INTERFACE_FONTS, PROMPT_FONTS, type Display, type FontSizes } from "./display"
import { DEFAULT_LOOK, type Mode } from "./look"
import { ACCENT_IDS, ACCENTS } from "./palette"

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
  // t3code resets a font row's family and size together.
  const resetFont = (family: "interfaceFont" | "promptFont" | "codeFont", size: keyof FontSizes) =>
    d()[family] !== DEFAULT_DISPLAY[family] || d().sizes[size] !== DEFAULT_DISPLAY.sizes[size]
      ? () => set({ [family]: DEFAULT_DISPLAY[family], sizes: { ...d().sizes, [size]: DEFAULT_DISPLAY.sizes[size] } })
      : undefined
  const SizeSelect = (props: { label: string; size: keyof FontSizes }) => {
    const range = FONT_SIZES[props.size]
    const steps = Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i)
    return (
      <Select
        label={props.label}
        class="kit-select--size"
        value={d().sizes[props.size]}
        options={steps.map((px) => ({ value: px, label: `${px} px` }))}
        onChange={(px) => set({ sizes: { ...d().sizes, [props.size]: px } })}
      />
    )
  }
  const options = <T extends string>(table: Record<T, { label: string }>, fallback: T) =>
    (Object.keys(table) as T[]).map((value) => ({ value, label: value === fallback ? `${table[value].label} (default)` : table[value].label }))
  return (
    <>
      <Group title="Interface">
        <Row label="Contrast" description="Adjust the contrast of borders, lines, and fills across the interface." onReset={reset("contrast")}>
          <Slider label="Contrast" value={d().contrast} display={`${d().contrast}%`} min={CONTRAST.min} max={CONTRAST.max} step={CONTRAST.step} onChange={(contrast) => set({ contrast })} />
        </Row>
        <Row label="Chat width" description="How wide messages and the composer can grow on large screens." onReset={reset("chatWidth")}>
          <Select label="Chat width" value={d().chatWidth} options={options(CHAT_WIDTHS, DEFAULT_DISPLAY.chatWidth)} onChange={(chatWidth) => set({ chatWidth })} />
        </Row>
      </Group>
      <Group title="Fonts">
        <Row label="Interface font" description="Messages and everything outside code blocks." onReset={resetFont("interfaceFont", "interface")}>
          <div class="flex items-center gap-2">
            <Select label="Interface font" value={d().interfaceFont} options={options(INTERFACE_FONTS, DEFAULT_DISPLAY.interfaceFont)} onChange={(interfaceFont) => set({ interfaceFont })} />
            <SizeSelect label="Interface font size" size="interface" />
          </div>
        </Row>
        <Row label="Prompt font" description="Only the box you write messages in." onReset={resetFont("promptFont", "prompt")}>
          <div class="flex items-center gap-2">
            <Select label="Prompt font" value={d().promptFont} options={options(PROMPT_FONTS, DEFAULT_DISPLAY.promptFont)} onChange={(promptFont) => set({ promptFont })} />
            <SizeSelect label="Prompt font size" size="prompt" />
          </div>
        </Row>
        <Row label="Code font" description="Code blocks and inline code." onReset={resetFont("codeFont", "code")}>
          <div class="flex items-center gap-2">
            <Select label="Code font" value={d().codeFont} options={options(CODE_FONTS, DEFAULT_DISPLAY.codeFont)} onChange={(codeFont) => set({ codeFont })} />
            <SizeSelect label="Code font size" size="code" />
          </div>
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
