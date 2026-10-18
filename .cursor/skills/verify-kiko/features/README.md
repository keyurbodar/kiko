# Kiko frontend verification map

| Feature | Journeys | Source |
| --- | --- | --- |
| [Onboarding](onboarding.md) | Sign-in, provider selection, skip/finish, persistence | `apps/web-solid/src/app/first-run/` |
| [Sidebar](sidebar.md) | Search, unread filter, navigation, draft, mobile toggle | `apps/web-solid/src/sidebar/` |
| [Settings](settings.md) | Gear/account/shortcut, sections, search, deep links, focus | `apps/web-solid/src/settings/`, `app/routes.tsx` |
| [Chat regressions](chat-regressions.md) | Composer, optimistic send, replies, run panel, snapshot | `apps/web-solid/src/chat/`, `styles/motion.css` |

This map covers redesign gates, not every Kiko feature. Backend behavior still uses the CLI suites in SKILL.md. Every run reports each attempted journey and remaining prerequisites. Keep screenshots, snapshots and assertion results outside the repo. Do not claim a full maintenance pass until every listed feature has live coverage.
