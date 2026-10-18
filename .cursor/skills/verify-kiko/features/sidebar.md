# Sidebar

## Sub-features

Moonlit header and L1 mark, Chats list, search, unread-only filter, draft previews, new chat, account/settings openers and responsive toggle.

## How to get to it (user POV)

Complete or skip onboarding, then open a chat. Search/navigation requires two distinguishable chats created through New chat. Unread proof requires a real unread chat; absence of that fixture is a prerequisite, not a pass.

## Driving it with agent-browser

1. Wait for `[data-component=sidebar]`. Capture `[data-sky=moonlit][data-sky-size=band]`, brand, New chat and footer. Compare the header, search, rows and footer with the approved layout at desktop/mobile in dark/light. Switch the main theme in Appearance and require sidebar surfaces/text to follow the same theme tokens immediately and after reload; the moonlit decoration must not force an independent sidebar theme. Require no horizontal page overflow.
2. Create two chats through the UI. Fill `[data-component=sidebar-search-input]` with part of one title: matching chat remains and the other disappears. Use a nonmatching query: require `[data-component=sidebar-empty]`. Click `[data-component=sidebar-search-clear]` and require the chats return.
3. Toggle `[data-component=sidebar-filter]`; require `aria-pressed` changes and only unread chats remain. Toggle back and require the full list. Capture the unread fixture before filtering.
4. Open a `[data-component=sidebar-row]`, type an unsent composer draft, switch chats and back: require the draft is retained, and its sidebar Draft preview appears. Clear only the draft created by this run.
5. At 390x844 open/close `[data-component=sidebar-toggle]` and navigate to a chat. Require visible, operable composer and no sidebar overlay blocking it after navigation. Keyboard-open Settings and Account from the footer; those paths are verified in settings.md.

## Gotchas

Rows are virtualized; an absent offscreen DOM row is not proof that search filtered it out. Search matches source-derived fields; use visible unique titles, not counts alone. Fixtures belong to the audit's owner. `sidebar.tsx`, `chat-panel.tsx` and `filter.ts` define behavior; `sky/Sky.tsx` defines scene hooks. No animation of buttons or composer; check reduced motion separately from normal motion.
