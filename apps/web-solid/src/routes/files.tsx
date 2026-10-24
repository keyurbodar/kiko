import { createFileRoute } from "@tanstack/solid-router"
import FilesPage from "../files/page"

export const Route = createFileRoute("/files")({ component: FilesPage })
