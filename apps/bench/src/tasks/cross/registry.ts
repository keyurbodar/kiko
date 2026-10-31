import type { Task } from "../../types"
import { dashboardConfig } from "./cross-001-dashboard-config"
import { csvSpreadsheet } from "./cross-002-csv-spreadsheet"
import { dialogSearch } from "./cross-003-dialog-search"
import { releaseChecklist } from "./cross-004-release-checklist"
import { orderReceipt } from "./cross-005-order-receipt"
import { codeTransfer } from "./cross-006-code-transfer"

export const crossTasks: readonly Task[] = [
  dashboardConfig,
  csvSpreadsheet,
  dialogSearch,
  releaseChecklist,
  orderReceipt,
  codeTransfer,
]
