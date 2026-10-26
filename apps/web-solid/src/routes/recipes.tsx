import { createFileRoute } from "@tanstack/solid-router"
import RecipesPage from "../recipes/page"

export const Route = createFileRoute("/recipes")({
  validateSearch: (search: Record<string, unknown>): { room?: string } =>
    typeof search.room === "string" ? { room: search.room } : {},
  component: RecipesPage,
})
