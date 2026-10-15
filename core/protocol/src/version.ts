// The wire protocol version. Bump it when a frame changes in a way an older client cannot read.
// A client speaks this version and the one before it. A backend further behind is blocked.
export const PROTOCOL = 1
