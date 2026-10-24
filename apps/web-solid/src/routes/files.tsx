import { createFileRoute } from "@tanstack/solid-router"
import FilesPage from "../files/page"

export const Route = createFileRoute("/files")({
  validateSearch: (search: Record<string, unknown>): { open?: string } =>
    typeof search.open === "string" ? { open: search.open } : {},
  component: FilesPage,
})
