// https://api.slack.com/messaging/webhooks. The webhook path is a secret: kiko fills it in on its
// server, and only for hooks.slack.com. This script never sees it.
export const tools = {
  async slack_post({ text }, kiko) {
    const res = await kiko.fetch("https://hooks.slack.com/services/{{secret.SLACK_WEBHOOK_PATH}}", { json: { text } })
    if (res.status !== 200) return `slack answered ${res.status}: ${res.text.slice(0, 200)}`
    return "posted to slack"
  },
}
