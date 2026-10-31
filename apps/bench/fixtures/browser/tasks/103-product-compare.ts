import { escape, html, json, type Handlers } from "../types"
import { formPage } from "./1xx-common"

type Product = {
  name: string
  price: number
  batteryHours: number
  shipping: number
  warranty: number
}

const productPage = (product: Product, index: number): Response =>
  html(`
<h1>${escape(product.name)}</h1>
<p>Price: $${product.price.toFixed(2)}</p>
<p>Battery life: ${product.batteryHours} hours</p>
<p><a href="/compare">Back to the comparison</a></p>
<p><a href="/p/${(index + 1) % 3}">Next product</a></p>`)

export const productCompare: Handlers = {
  pages: {
    "/shop": (ctx) => {
      const products = ctx.data.products as Product[]
      return html(`
<h1>Field radios</h1>
<ul>${products.map((product, index) => `<li><a href="/p/${index}">${escape(product.name)}</a></li>`).join("")}</ul>
<p><a href="/shipping">Shipping costs</a> | <a href="/warranty">Warranty terms</a> | <a href="/compare">Comparison table</a></p>`)
    },
    "/p/0": (ctx) => productPage((ctx.data.products as Product[])[0]!, 0),
    "/p/1": (ctx) => productPage((ctx.data.products as Product[])[1]!, 1),
    "/p/2": (ctx) => productPage((ctx.data.products as Product[])[2]!, 2),
    "/shipping": () =>
      html(`
<h1>Shipping costs</h1>
<p>Orders under $100 ship for $4.99. Orders from $100 up to $299.99 ship for $9.99. Orders of $300 or more ship free.</p>`),
    "/warranty": () =>
      html(`
<h1>Warranty terms</h1>
<p>Every radio carries a 12 month warranty. Radios priced above $200 carry 24 months.</p>`),
    "/compare": (ctx) => {
      const products = ctx.data.products as Product[]
      const fields = products.flatMap((product, index) => [
        { id: `p${index}_price`, label: `${product.name} price in dollars (number only)` },
        { id: `p${index}_battery`, label: `${product.name} battery life in hours (number only)` },
        { id: `p${index}_shipping`, label: `${product.name} shipping cost in dollars (number only)` },
        { id: `p${index}_warranty`, label: `${product.name} warranty in months (number only)` },
      ])
      return formPage("Product comparison", fields, "/api/compare", { submit: "Save comparison" })
    },
  },
  api: {
    "POST /api/compare": (ctx, body) => {
      const fields = ctx.data.products.flatMap((_: Product, index: number) => [
        `p${index}_price`,
        `p${index}_battery`,
        `p${index}_shipping`,
        `p${index}_warranty`,
      ])
      const table: Record<string, string> = {}
      for (const field of fields) {
        const value = String(body?.[field] ?? "").trim()
        if (!/^\d+(\.\d+)?$/.test(value)) return json({ error: `Enter a number for ${field}.` }, 400)
        table[field] = value
      }
      ctx.record("comparison", table)
      return json({ ok: true })
    },
  },
}
