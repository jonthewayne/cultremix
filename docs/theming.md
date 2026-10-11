# Theming

The UI follows shadcn/ui conventions:

- CSS variables live in `src/styles/app.css`.
- `components.json` has `tailwind.cssVariables` enabled and points at `src/styles/app.css`.
- Components use shadcn semantic utilities like `bg-background`, `text-foreground`, `bg-card`, `border-border`, `bg-sidebar`, `bg-sidebar-accent`, and `bg-sidebar-primary`.
- The global CSS includes the full shadcn token contract: base tokens, `chart-1` through `chart-5`, `sidebar-*`, and the derived radius scale.
- Light and dark variables are both present.

To customize:

1. Open https://ui.shadcn.com/themes.
2. Generate a theme.
3. Replace the `:root` and `.dark` variable blocks in `src/styles/app.css`.
4. Keep the `@theme inline` block and the variable names intact.

CultRemix pages, Admin included, are light only. The starter's theme toggle (`src/components/ui/theme-toggle.tsx`) is no longer rendered, so nothing applies `.dark`; the dark variables stay in `app.css` so a dark theme can come back.
