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
import { desktopCalcColumn } from "./desktop/desktop-101-calc-column"
import { desktopSaveAs } from "./desktop/desktop-102-save-as-folder"
import { desktopBatchRename } from "./desktop/desktop-103-batch-rename"
import { desktopPreference } from "./desktop/desktop-104-app-preference"
import { desktopReport } from "./desktop/desktop-105-report-chart"
import { desktopBigForm } from "./desktop/desktop-106-big-form"
import { desktopModal } from "./desktop/desktop-107-modal-midtask"
import { desktopMinimized } from "./desktop/desktop-108-minimized-window"
import { desktopSameTitle } from "./desktop/desktop-109-same-title"
import { desktopHidpi } from "./desktop/desktop-110-hidpi"
import { desktopGermanKeyboard } from "./desktop/desktop-111-german-keyboard"
import { desktopNotification } from "./desktop/desktop-112-notification"
import { desktopOwnerTyping } from "./desktop/desktop-113-owner-typing"

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
  desktopCalcColumn,
  desktopSaveAs,
  desktopBatchRename,
  desktopPreference,
  desktopReport,
  desktopBigForm,
  desktopModal,
  desktopMinimized,
  desktopSameTitle,
  desktopHidpi,
  desktopGermanKeyboard,
  desktopNotification,
  desktopOwnerTyping,
]
