## UI work

For any UI/UX design, redesign, implementation, visual review, or polish task, use these installed skills together when relevant:

- `design-philosophy`
- `apple-design`
- `emil-design-eng`

Prefer calm, restrained, native-feeling productivity UI.

Texgo is a conversion tool. Previews help users identify source assets and conversion outputs at a glance. Fit previews to the available viewport and omit scrolling, manual zoom, and pagination within the preview canvas.

Default principles:

- Keep the interface quiet at rest.
- Prefer whitespace and hierarchy over excessive borders, cards, badges, gradients, and shadows.
- Use compact desktop density and restrained color.
- Keep normal states visually neutral.
- Use subtle, purposeful motion only.
- Preserve platform-native behavior when possible.
- Avoid decorative or marketing-style UI unless explicitly requested.

Reference application source code is stored under:

`~/Documents/git/ref`

When relevant, inspect:

- **Cap** — visual language, macOS-like polish, controls, spacing, settings, dialogs, motion.
- **GitButler** — productivity-tool interaction, navigation, selection, history, undo, contextual actions.
- **Spacedrive** — file-oriented layouts, lists, previews, sidebars, search, context menus, multi-pane structure.

Reference priority:

- Visual language: `Cap > GitButler > Spacedrive`
- Tool interaction: `GitButler > Cap > Spacedrive`
- File/multi-pane structure: `Spacedrive > GitButler > Cap`

Do not mechanically copy another product. Adapt its design principles and implementation patterns to the current product and stack.

When modifying existing UI, prefer simplifying or removing conflicting legacy styles instead of layering more styling on top.
