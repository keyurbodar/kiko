export const isMac = typeof navigator !== "undefined" && /mac/i.test(`${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`)
