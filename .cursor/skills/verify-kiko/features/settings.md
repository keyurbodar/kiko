# Settings dialog

## Sub-features

Settings over the current chat, six sections, keyword search, legacy URL redirects, keyboard/focus behavior and narrow-screen section navigation.

## How to get to it (user POV)

Complete setup and open a chat. Use Settings gear, Account footer button or Mod+comma. Legacy bookmarks `/settings` and `/settings/<section>` open the dialog over the active/resumed chat.

## Driving it with agent-browser

1. Focus and click `[data-component=sidebar-settings]`. Require `[role=dialog] [data-component=settings]`, a still-mounted chat transcript, and the current chat URL. Press Escape, wait for dialog removal, require focus returns to the gear. Repeat for `[data-component=sidebar-me]` and require `[data-section=account][aria-current=page]` before closing; require focus returns to Account.
2. Focus the composer. Press Control+comma on Linux (Meta+comma on macOS); require dialog opens. Repeat shortcut to close. Check focus returns to the composer.
3. Open settings. Visit `[data-section=models]`, tools, appearance, general, keyboard and account; require each selected row has `aria-current=page` and corresponding page content is visible. At 390x844 the selected row must scroll into view and the body must scroll without horizontal page overflow.
4. Fill Search settings with `provider`; require Models remains. Fill a nonmatching query; require Nothing matches. First Escape clears search while keeping dialog open; second closes it. Tab/Shift+Tab must stay in the dialog while open. Close button also closes and restores focus.
5. Navigate to `/settings/appearance`; require Appearance selected, chat underneath, and URL replaced by `/chat/<id>`. Reload: chat returns without dialog. Repeat `/settings/providers` → Models, `/settings/integrations` → Tools, `/settings/initiative` → General and unknown section → Models. Do not require focus on a nonexistent opener after a deep link.
6. In Appearance switch dark/light using the visible controls. Require the sidebar and chat update immediately and survive reload. Restore the audit owner's original preference.

## Gotchas

Sources: `settings/settings-dialog.tsx`, `settings/sections.ts`, `settings/dialog-state.ts`, `app/routes.tsx`, `commands/nav-commands.ts`. Search matches keywords, not just labels. Escape clears nonempty search before closing. Portal model pickers/selects may be outside the dialog DOM; check they remain clickable and scrollable. Do not disconnect providers or sign out a shared owner to test the redesign.
