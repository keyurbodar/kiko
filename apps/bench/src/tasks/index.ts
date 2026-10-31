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
]
