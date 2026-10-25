import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"

const WIDTH = 560

export async function pdfFirstPage(bytes: Uint8Array): Promise<Blob> {
  if (!GlobalWorkerOptions.workerSrc)
    GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default
  const doc = await getDocument({ data: bytes }).promise
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: WIDTH / base.width })
    const canvas = document.createElement("canvas")
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(Math.min(viewport.height, viewport.width * 1.5))
    await page.render({ canvas, viewport }).promise
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No page image"))), "image/jpeg", 0.82),
    )
  } finally {
    void doc.destroy()
  }
}
