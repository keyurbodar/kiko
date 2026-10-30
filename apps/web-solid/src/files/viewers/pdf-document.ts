import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist"

export async function openPdfDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  if (!GlobalWorkerOptions.workerSrc)
    GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default
  return getDocument({
    data: bytes,
    useSystemFonts: true,
    canvasMaxAreaInBytes: 32 * 1024 * 1024,
  }).promise
}
