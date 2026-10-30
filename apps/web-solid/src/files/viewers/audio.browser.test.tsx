import "../../index.css"
import { expect, it } from "vitest"
import { render } from "../../../test/render"
import AudioViewer from "./audio"

function wav(): Blob {
  const samples = 32
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index))
  }
  write(0, "RIFF")
  view.setUint32(4, 36 + samples * 2, true)
  write(8, "WAVE")
  write(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 16000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, "data")
  view.setUint32(40, samples * 2, true)
  return new Blob([buffer], { type: "audio/wav" })
}

it("plays audio with native controls and names the file", async () => {
  const url = URL.createObjectURL(wav())
  try {
    const container = document.createElement("div")
    container.style.cssText = "display:flex;width:900px;height:600px"
    await using screen = await render(() => <AudioViewer src={url} name="note.wav" />, { container })
    const audio = screen.container.querySelector("audio")!
    expect(audio.getAttribute("aria-label")).toBe("note.wav")
    expect(audio.controls).toBe(true)
    expect(audio.preload).toBe("metadata")
    expect(screen.container.textContent).toContain("note.wav")
  } finally {
    URL.revokeObjectURL(url)
  }
})
