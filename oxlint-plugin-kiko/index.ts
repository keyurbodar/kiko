import { definePlugin } from "@oxlint/plugins"

import noDomTestEnvironment from "./rules/no-dom-test-environment.ts"
import noFrameWaitsInBrowserTests from "./rules/no-frame-waits-in-browser-tests.ts"
import noLowValueComments from "./rules/no-low-value-comments.ts"
import noPollingLoopInTests from "./rules/no-polling-loop-in-tests.ts"
import noRealTimeWaitInTests from "./rules/no-real-time-wait-in-tests.ts"
import noTestInLoop from "./rules/no-test-in-loop.ts"
import noTestTimeoutOrUnreasonedSkip from "./rules/no-test-timeout-or-unreasoned-skip.ts"
import noWallClockInTests from "./rules/no-wall-clock-in-tests.ts"
import requireDisposableRender from "./rules/require-disposable-render.ts"

export default definePlugin({
  meta: {
    name: "kiko",
  },
  rules: {
    "no-dom-test-environment": noDomTestEnvironment,
    "no-frame-waits-in-browser-tests": noFrameWaitsInBrowserTests,
    "no-low-value-comments": noLowValueComments,
    "no-polling-loop-in-tests": noPollingLoopInTests,
    "no-real-time-wait-in-tests": noRealTimeWaitInTests,
    "no-test-in-loop": noTestInLoop,
    "no-test-timeout-or-unreasoned-skip": noTestTimeoutOrUnreasonedSkip,
    "no-wall-clock-in-tests": noWallClockInTests,
    "require-disposable-render": requireDisposableRender,
  },
})
