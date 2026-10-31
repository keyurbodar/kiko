import type { Task } from "../types"
import { formSignup } from "./browser/001-form-signup"
import { cookieBanner } from "./browser/002-cookie-banner"
import { twoTabs } from "./browser/003-two-tabs"
import { hiddenTab } from "./browser/004-hidden-tab"
import { download } from "./browser/005-download"
import { tableExtract } from "./browser/006-table-extract"
import { login } from "./browser/007-login"
import { searchFilter } from "./browser/008-search-filter"
import { pagination } from "./browser/009-pagination"
import { modalDelete } from "./browser/010-modal-delete"
import { checkoutTask } from "./browser/browser-101-checkout"
import { reauthSettings } from "./browser/browser-102-reauth-settings"
import { productCompare } from "./browser/browser-103-product-compare"
import { formFromPdf } from "./browser/browser-104-form-from-pdf"
import { issueTriage } from "./browser/browser-105-issue-triage"
import { researchSixPages } from "./browser/browser-106-research-six-pages"
import { inboxZero } from "./browser/browser-107-inbox-zero"
import { shadowIframe } from "./browser/browser-108-shadow-iframe"
import { infiniteScroll } from "./browser/browser-109-infinite-scroll"
import { kanbanDrag } from "./browser/browser-110-kanban-drag"
import { richText } from "./browser/browser-111-rich-text"
import { oauthPopup } from "./browser/browser-112-oauth-popup"
import { flakyBackend } from "./browser/browser-113-flaky-backend"
import { humanWall } from "./browser/browser-114-human-wall"
import { datePicker } from "./browser/browser-115-date-picker"
import { fileUpload } from "./browser/browser-116-file-upload"
import { hiddenTabSurvey } from "./browser/browser-117-hidden-tab"
import { desktopForm } from "./desktop/001-set-field"
import { desktopSettings } from "./desktop/002-toggle-settings"
import { desktopMenu } from "./desktop/003-menu-pick"
import { desktopList } from "./desktop/004-drag-list"
import { desktopTooltip } from "./desktop/005-read-tooltip"
import { desktopDialog } from "./desktop/006-confirm-dialog"
import { desktopSlider } from "./desktop/007-slider"
import { desktopRadio } from "./desktop/008-radio-group"
import { desktopTree } from "./desktop/009-tree-select"
import { desktopWindows } from "./desktop/010-second-window"
import { countMatches } from "./terminal/count-matches"
import { fixScript } from "./terminal/fix-script"
import { gitBranch } from "./terminal/git-branch"
import { terminalTasksA } from "./terminal/registry-a"
import { terminalTasksB } from "./terminal/registry-b"

export const TASKS: readonly Task[] = [
  ...terminalTasksA,
  ...terminalTasksB,
  countMatches,
  fixScript,
  gitBranch,
  formSignup,
  cookieBanner,
  twoTabs,
  hiddenTab,
  download,
  tableExtract,
  login,
  searchFilter,
  pagination,
  modalDelete,
  desktopForm,
  desktopSettings,
  desktopMenu,
  desktopList,
  desktopTooltip,
  desktopDialog,
  desktopSlider,
  desktopRadio,
  desktopTree,
  desktopWindows,
  checkoutTask,
  reauthSettings,
  productCompare,
  formFromPdf,
  issueTriage,
  researchSixPages,
  inboxZero,
  shadowIframe,
  infiniteScroll,
  kanbanDrag,
  richText,
  oauthPopup,
  flakyBackend,
  humanWall,
  datePicker,
  fileUpload,
  hiddenTabSurvey,
]
