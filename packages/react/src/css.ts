/**
 * Default stylesheet. Every rule is wrapped in :where() so it has zero
 * specificity: any class you add (or `classNames` slot) wins without !important.
 * All values come from CSS variables set on `.fb-root` from the theme.
 */
export const feedbackCss = `
:where(.fb-root) { font-family: var(--fb-font-body); color: var(--fb-color-text); background: var(--fb-color-background); font-size: var(--fb-font-size-md); line-height: 1.4; display: flex; flex-direction: column; min-height: 100%; box-sizing: border-box; -webkit-font-smoothing: antialiased; }
:where(.fb-root) *, :where(.fb-root) *::before, :where(.fb-root) *::after { box-sizing: inherit; }
:where(.fb-root) button { font: inherit; cursor: pointer; }
:where(.fb-root) button:disabled { cursor: default; opacity: .5; }
:where(.fb-root) :focus-visible { outline: 2px solid var(--fb-color-primary); outline-offset: 2px; }

:where(.fb-header) { display: flex; align-items: center; gap: var(--fb-space-sm); padding: var(--fb-space-md) var(--fb-space-lg); background: var(--fb-color-surface); border-bottom: 1px solid var(--fb-color-border); }
:where(.fb-headerTitle) { flex: 1; margin: 0; font-family: var(--fb-font-heading); font-size: var(--fb-font-size-lg); font-weight: var(--fb-font-weight-bold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:where(.fb-backButton) { background: none; border: 0; padding-block: var(--fb-space-xs); padding-inline: 0 var(--fb-space-sm); color: var(--fb-color-primary); font-weight: var(--fb-font-weight-medium); min-height: 44px; }

:where(.fb-tabBar) { display: flex; gap: var(--fb-space-xs); padding: var(--fb-space-sm) var(--fb-space-md) 0; background: var(--fb-color-surface); border-bottom: 1px solid var(--fb-color-border); overflow-x: auto; }
:where(.fb-tab) { display: inline-flex; align-items: center; gap: var(--fb-space-xs); background: none; border: 0; border-bottom: 2px solid transparent; padding: calc(var(--fb-space-sm) + 2px) var(--fb-space-md); color: var(--fb-color-text-muted); font-size: var(--fb-font-size-sm); font-weight: var(--fb-font-weight-medium); white-space: nowrap; }
:where(.fb-tabActive) { color: var(--fb-color-text); border-bottom-color: var(--fb-color-primary); }
:where(.fb-tabBadge) { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--fb-color-primary); color: var(--fb-color-on-primary); font-size: var(--fb-font-size-xs); font-weight: var(--fb-font-weight-bold); }

:where(.fb-toolbar) { display: flex; flex-direction: column; gap: var(--fb-space-sm); padding: var(--fb-space-md) var(--fb-space-lg) 0; }
:where(.fb-chipRow) { display: flex; gap: var(--fb-space-xs); overflow-x: auto; padding: 2px 0; flex-wrap: wrap; }
:where(.fb-chip) { border: 1px solid var(--fb-color-border); background: var(--fb-color-surface); color: var(--fb-color-text-muted); border-radius: var(--fb-radius-pill); padding: calc(var(--fb-space-xs) + 2px) var(--fb-space-md); font-size: var(--fb-font-size-sm); font-weight: var(--fb-font-weight-medium); white-space: nowrap; }
:where(.fb-chipActive) { background: var(--fb-color-primary); border-color: var(--fb-color-primary); color: var(--fb-color-on-primary); }

:where(.fb-input), :where(.fb-textarea), :where(.fb-searchInput) { width: 100%; font: inherit; color: var(--fb-color-text); background: var(--fb-color-surface); border: 1px solid var(--fb-color-border); border-radius: var(--fb-radius-md); padding: calc(var(--fb-space-sm) + 2px) var(--fb-space-md); }
:where(.fb-textarea) { min-height: 120px; resize: vertical; }
:where(.fb-inputLabel) { font-size: var(--fb-font-size-sm); font-weight: var(--fb-font-weight-medium); }
:where(.fb-helperText) { font-size: var(--fb-font-size-xs); color: var(--fb-color-text-muted); }
:where(.fb-errorText) { font-size: var(--fb-font-size-sm); font-weight: var(--fb-font-weight-medium); color: var(--fb-color-danger); margin: 0; }

:where(.fb-list) { display: flex; flex-direction: column; gap: var(--fb-space-md); padding: var(--fb-space-lg); padding-bottom: 96px; margin: 0; list-style: none; }
:where(.fb-card) { position: relative; display: flex; gap: var(--fb-space-md); padding: var(--fb-space-md); background: var(--fb-color-surface); border: 1px solid var(--fb-color-border); border-radius: var(--fb-radius-lg); box-shadow: var(--fb-shadow-card); }
:where(.fb-cardPending) { border-style: dashed; border-color: var(--fb-status-pending); }
:where(.fb-cardBody) { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--fb-space-xs); }
:where(.fb-cardLink) { background: none; border: 0; padding: 0; font: inherit; color: inherit; text-align: start; }
/* Stretch the title button over the card; the vote buttons sit above it. */
:where(.fb-cardLink)::after { content: ''; position: absolute; inset: 0; border-radius: var(--fb-radius-lg); }
:where(.fb-cardTitle) { margin: 0; font-family: var(--fb-font-heading); font-size: var(--fb-font-size-md); font-weight: var(--fb-font-weight-bold); }
:where(.fb-cardExcerpt) { margin: 0; color: var(--fb-color-text-muted); font-size: var(--fb-font-size-sm); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
:where(.fb-cardMeta) { display: flex; flex-wrap: wrap; align-items: center; gap: var(--fb-space-sm); margin-top: var(--fb-space-xs); }
:where(.fb-cardMetaText) { font-size: var(--fb-font-size-xs); color: var(--fb-color-text-muted); }

:where(.fb-voteBox) { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 44px; }
:where(.fb-voteButton) { width: 44px; height: 32px; border: 0; border-radius: var(--fb-radius-sm); background: var(--fb-color-surface-alt); color: var(--fb-color-text-muted); font-size: var(--fb-font-size-sm); font-weight: var(--fb-font-weight-bold); }
:where(.fb-voteButtonActive) { background: var(--fb-color-primary); color: var(--fb-color-on-primary); }
:where(.fb-voteCount) { font-weight: var(--fb-font-weight-bold); text-align: center; }

:where(.fb-statusPill), :where(.fb-categoryPill) { display: inline-block; padding: 2px var(--fb-space-sm); border-radius: var(--fb-radius-pill); font-size: var(--fb-font-size-xs); font-weight: var(--fb-font-weight-bold); background: var(--fb-color-surface-alt); }
:where(.fb-categoryPill) { font-weight: var(--fb-font-weight-medium); color: var(--fb-color-text-muted); }
:where(.fb-moderationBanner) { padding: var(--fb-space-md); border-radius: var(--fb-radius-md); background: var(--fb-color-surface-alt); border-inline-start: 3px solid var(--fb-status-pending); font-size: var(--fb-font-size-sm); }

:where(.fb-button), :where(.fb-buttonSecondary), :where(.fb-buttonDanger) { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 var(--fb-space-lg); border: 0; border-radius: var(--fb-radius-md); font-weight: var(--fb-font-weight-bold); }
:where(.fb-button) { background: var(--fb-color-primary); color: var(--fb-color-on-primary); }
:where(.fb-buttonSecondary) { background: var(--fb-color-surface-alt); color: var(--fb-color-text); font-weight: var(--fb-font-weight-medium); }
:where(.fb-buttonDanger) { background: var(--fb-color-danger); color: var(--fb-color-on-danger); }
:where(.fb-fab) { position: sticky; bottom: var(--fb-space-xl); align-self: flex-end; margin: 0 var(--fb-space-lg) var(--fb-space-lg) auto; border-radius: var(--fb-radius-pill); padding: 0 var(--fb-space-xl); box-shadow: var(--fb-shadow-card); }

:where(.fb-form) { display: flex; flex-direction: column; gap: var(--fb-space-md); padding: var(--fb-space-lg); }
:where(.fb-detail) { display: flex; flex-direction: column; gap: var(--fb-space-md); padding: var(--fb-space-lg); }
:where(.fb-detailTitle) { margin: 0; font-family: var(--fb-font-heading); font-size: var(--fb-font-size-xl); font-weight: var(--fb-font-weight-bold); }
:where(.fb-detailBody) { margin: 0; white-space: pre-wrap; line-height: 1.5; }
:where(.fb-attachmentRow) { display: flex; flex-wrap: wrap; gap: var(--fb-space-sm); }
:where(.fb-attachmentImage) { width: 96px; height: 96px; object-fit: cover; border-radius: var(--fb-radius-md); background: var(--fb-color-surface-alt); display: block; }
:where(.fb-sectionTitle) { margin: var(--fb-space-md) 0 0; font-family: var(--fb-font-heading); font-size: var(--fb-font-size-md); font-weight: var(--fb-font-weight-bold); }

:where(.fb-commentList) { display: flex; flex-direction: column; gap: var(--fb-space-sm); margin: 0; padding: 0; list-style: none; }
:where(.fb-commentItem) { display: flex; flex-direction: column; gap: var(--fb-space-xs); padding: var(--fb-space-md); background: var(--fb-color-surface); border: 1px solid var(--fb-color-border); border-radius: var(--fb-radius-md); }
:where(.fb-commentOfficial) { border-color: var(--fb-color-primary); }
:where(.fb-commentHeader) { display: flex; align-items: center; gap: var(--fb-space-sm); }
:where(.fb-commentAuthor) { font-size: var(--fb-font-size-sm); font-weight: var(--fb-font-weight-bold); }
:where(.fb-commentTime) { font-size: var(--fb-font-size-xs); color: var(--fb-color-text-muted); }
:where(.fb-commentBody) { margin: 0; white-space: pre-wrap; }
:where(.fb-officialBadge) { display: inline-block; padding: 2px var(--fb-space-sm); border-radius: var(--fb-radius-pill); background: var(--fb-color-primary); color: var(--fb-color-on-primary); font-size: var(--fb-font-size-xs); font-weight: var(--fb-font-weight-bold); }
:where(.fb-composer) { display: flex; align-items: flex-end; gap: var(--fb-space-sm); padding: var(--fb-space-md); border-top: 1px solid var(--fb-color-border); background: var(--fb-color-surface); position: sticky; bottom: 0; }
:where(.fb-composerInput) { flex: 1; min-height: 44px; max-height: 160px; resize: vertical; font: inherit; color: var(--fb-color-text); background: var(--fb-color-surface); border: 1px solid var(--fb-color-border); border-radius: var(--fb-radius-md); padding: calc(var(--fb-space-sm) + 2px) var(--fb-space-md); }
:where(.fb-avatar) { width: 24px; height: 24px; border-radius: 50%; background: var(--fb-color-surface-alt); color: var(--fb-color-text-muted); display: inline-flex; align-items: center; justify-content: center; overflow: hidden; font-size: var(--fb-font-size-xs); font-weight: var(--fb-font-weight-bold); flex-shrink: 0; }
:where(.fb-avatar) img { width: 100%; height: 100%; object-fit: cover; }

:where(.fb-empty) { display: flex; flex-direction: column; align-items: center; gap: var(--fb-space-md); padding: var(--fb-space-xl); text-align: center; color: var(--fb-color-text-muted); }
:where(.fb-loading) { display: flex; justify-content: center; padding: var(--fb-space-xl); }
:where(.fb-spinner) { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--fb-color-border); border-top-color: var(--fb-color-primary); animation: fb-spin .8s linear infinite; }
@keyframes fb-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { :where(.fb-spinner) { animation-duration: 2.4s; } }

:where(.fb-roadmap) { display: flex; gap: var(--fb-space-md); padding: var(--fb-space-lg); overflow-x: auto; align-items: flex-start; }
:where(.fb-roadmapColumn) { flex: 0 0 280px; display: flex; flex-direction: column; gap: var(--fb-space-sm); padding: var(--fb-space-md); background: var(--fb-color-surface-alt); border-radius: var(--fb-radius-lg); }
:where(.fb-roadmapColumnHeader) { display: flex; align-items: center; gap: var(--fb-space-sm); margin-bottom: var(--fb-space-xs); }
:where(.fb-roadmapCount) { font-size: var(--fb-font-size-sm); color: var(--fb-color-text-muted); font-weight: var(--fb-font-weight-medium); }
:where(.fb-roadmapCard) { display: flex; flex-direction: column; gap: var(--fb-space-xs); padding: var(--fb-space-md); border: 0; border-radius: var(--fb-radius-md); background: var(--fb-color-surface); box-shadow: var(--fb-shadow-card); text-align: start; color: inherit; }
:where(.fb-roadmapCardTitle) { font-size: var(--fb-font-size-sm); font-weight: var(--fb-font-weight-bold); }

:where(.fb-updateItem) { display: flex; flex-direction: column; gap: var(--fb-space-xs); padding: var(--fb-space-md); background: var(--fb-color-surface); border: 1px solid var(--fb-color-border); border-radius: var(--fb-radius-md); text-align: start; color: inherit; width: 100%; }
:where(.fb-updateKind) { font-size: var(--fb-font-size-xs); font-weight: var(--fb-font-weight-bold); color: var(--fb-color-primary); }
:where(.fb-updateTitle) { font-weight: var(--fb-font-weight-medium); }
:where(.fb-adminBar) { display: flex; flex-direction: column; gap: var(--fb-space-sm); padding: var(--fb-space-md); border-radius: var(--fb-radius-md); background: var(--fb-color-surface-alt); }
:where(.fb-adminRow) { display: flex; flex-wrap: wrap; gap: var(--fb-space-sm); }
:where(.fb-srOnly) { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
`;
