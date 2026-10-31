import type { Handlers } from "../types"
import { checkout } from "./101-checkout"
import { reauth } from "./102-reauth"
import { productCompare } from "./103-product-compare"
import { formFromPdf } from "./104-form-from-pdf"
import { issueTriage } from "./105-issue-triage"
import { research } from "./106-research-six-pages"
import { inboxZero } from "./107-inbox-zero"
import { shadowIframe } from "./108-shadow-iframe"
import { infiniteScroll } from "./109-infinite-scroll"
import { kanbanDrag } from "./110-kanban-drag"
import { richText } from "./111-rich-text"
import { oauthPopup } from "./112-oauth-popup"
import { flakyBackend } from "./113-flaky-backend"
import { humanWall } from "./114-human-wall"
import { datePicker } from "./115-date-picker"
import { fileUpload } from "./116-file-upload"
import { hiddenTab } from "./117-hidden-tab"

export const hardBrowserTasks: Record<string, Handlers> = {
  "browser-101-checkout": checkout,
  "browser-102-reauth-settings": reauth,
  "browser-103-product-compare": productCompare,
  "browser-104-form-from-pdf": formFromPdf,
  "browser-105-issue-triage": issueTriage,
  "browser-106-research-six-pages": research,
  "browser-107-inbox-zero": inboxZero,
  "browser-108-shadow-iframe": shadowIframe,
  "browser-109-infinite-scroll": infiniteScroll,
  "browser-110-kanban-drag": kanbanDrag,
  "browser-111-rich-text": richText,
  "browser-112-oauth-popup": oauthPopup,
  "browser-113-flaky-backend": flakyBackend,
  "browser-114-human-wall": humanWall,
  "browser-115-date-picker": datePicker,
  "browser-116-file-upload": fileUpload,
  "browser-117-hidden-tab": hiddenTab,
}
