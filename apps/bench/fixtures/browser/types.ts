export type Ctx = {
  readonly data: Record<string, any>
  readonly state: Record<string, any>
  readonly save: () => void
  readonly record: (type: string, payload: unknown) => void
}

export type Api = (ctx: Ctx, body: any, url: URL) => Response | Promise<Response>
export type Page = (ctx: Ctx, url: URL) => Response

export type Handlers = {
  readonly pages: Record<string, Page>
  readonly api: Record<string, Api>
}

export const html = (body: string): Response =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Kiko bench fixture</title><style>
body{font:16px/1.4 system-ui,sans-serif;margin:40px;max-width:760px}
label{display:block;margin:12px 0}
input,select,button{font:inherit;padding:6px 8px}
table{border-collapse:collapse}td,th{border:1px solid #999;padding:6px 10px;text-align:left}
.msg{color:#b00}
</style></head><body>${body}</body></html>`,
    {
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  )

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

export const escape = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
