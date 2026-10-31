import { formSignup } from "./tasks/001-form-signup"
import { formCookie } from "./tasks/002-cookie-banner"
import { formTabs } from "./tasks/003-two-tabs"
import { formHidden } from "./tasks/004-hidden-tab"
import { formDownload } from "./tasks/005-download"
import { formTable } from "./tasks/006-table-extract"
import { formLogin } from "./tasks/007-login"
import { formSearch } from "./tasks/008-search-filter"
import { formPagination } from "./tasks/009-pagination"
import { formModal } from "./tasks/010-modal-delete"
import { hardBrowserTasks } from "./tasks/1xx-index"
import type { Handlers } from "./types"

export const registry: Record<string, Handlers> = {
  "browser-001-form-signup": formSignup,
  "browser-002-cookie-banner": formCookie,
  "browser-003-two-tabs": formTabs,
  "browser-004-hidden-tab": formHidden,
  "browser-005-download": formDownload,
  "browser-006-table-extract": formTable,
  "browser-007-login": formLogin,
  "browser-008-search-filter": formSearch,
  "browser-009-pagination": formPagination,
  "browser-010-modal-delete": formModal,
  ...hardBrowserTasks,
}
