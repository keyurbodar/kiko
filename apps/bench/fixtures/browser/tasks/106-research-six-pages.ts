import { escape, html, json, type Handlers } from "../types"
import { answerPage } from "./1xx-common"

type Region = { slug: string; name: string; replicas: number; active: boolean }

const regionPage = (region: Region): Response =>
  html(`
<h1>${escape(region.name)} region</h1>
<p>${escape(region.name)} has ${region.replicas} replicas.</p>
<p>Status: ${region.active ? "active" : "decommissioned"}.</p>
<p><a href="/wiki">Back to the wiki</a></p>`)

const regions = (ctx: { data: Record<string, any> }): Region[] => ctx.data.regions as Region[]

export const research: Handlers = {
  pages: {
    "/wiki": (ctx) => {
      const list = regions(ctx)
      return html(`
<h1>Fleet wiki</h1>
<p>The fleet runs in ${list.length} regions. A decommissioned region is no longer part of the fleet and its machines do not count toward capacity.</p>
<ul>${list.map((region) => `<li><a href="/wiki/${escape(region.slug)}">${escape(region.name)} region</a></li>`).join("")}</ul>
<p><a href="/wiki/maintenance">Maintenance window</a> | <a href="/wiki/policy">Spare capacity policy</a></p>`)
    },
    "/wiki/north": (ctx) => regionPage(regions(ctx).find((region) => region.slug === "north")!),
    "/wiki/south": (ctx) => regionPage(regions(ctx).find((region) => region.slug === "south")!),
    "/wiki/east": (ctx) => regionPage(regions(ctx).find((region) => region.slug === "east")!),
    "/wiki/maintenance": (ctx) =>
      html(`
<h1>Maintenance window</h1>
<p>During the next window we drain ${escape(ctx.data.drain)} replicas from each active region.</p>
<p><a href="/wiki">Back to the wiki</a></p>`),
    "/wiki/policy": (ctx) =>
      html(`
<h1>Spare capacity policy</h1>
<p>Keep spare capacity equal to ${escape(ctx.data.sparePercent)}% of the replicas that are still serving after the maintenance window. Round the spare count up to a whole replica.</p>
<p><a href="/wiki">Back to the wiki</a></p>`),
    "/answer": () => answerPage("How many spare replicas should we keep?"),
  },
  api: {
    "POST /api/answer": (ctx, body) => {
      ctx.record("answer", { value: String(body?.value ?? "").trim() })
      return json({ ok: true })
    },
  },
}
