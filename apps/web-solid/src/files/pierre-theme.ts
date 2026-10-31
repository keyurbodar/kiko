export const PIERRE_TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-fg-override: var(--text-primary);
    --trees-fg-muted-override: var(--icon-secondary);
    --trees-selected-bg-override: var(--bg-tertiary);
    --trees-selected-fg-override: var(--text-primary);
    --trees-selected-focused-border-color-override: transparent;
    --trees-hover-bg-override: var(--bg-quaternary);
    --trees-border-color-override: var(--stroke-tertiary);
    --trees-indent-guide-bg-override: var(--stroke-tertiary);
    --trees-focus-ring-color-override: var(--focus-ring);
    --trees-font-family-override: var(--font-family-sans);
    --trees-font-size-override: var(--font-size-base);
    --trees-font-weight-semibold-override: 600;
    --trees-icon-width-override: 14px;
    --trees-border-radius-override: var(--radius-base);
  }
  [data-truncate-content='visible'] { overflow: hidden; text-overflow: ellipsis; }
  [data-truncate-marker] { display: none; }
  button[data-type='item'], button[data-type='item']::before { border-radius: var(--radius-base); }
`
