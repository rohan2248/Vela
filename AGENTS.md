<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# UI components

Two registries are wired into `components.json`:

- **shadcn** (default) — `npx shadcn@latest add button`
- **VengeanceUI** (`@vengeanceui`) — animated/landing-page components. Docs: https://www.vengenceui.com/docs

```bash
npx shadcn@latest add @vengeanceui/<component-name>
```

Component names come from https://www.vengenceui.com/docs/components-overview. Everything lands in `components/ui/` as owned source — edit it freely.

Notes when pulling VengeanceUI components:

- Most animated ones need `framer-motion` (already installed). A few pull extra deps the CLI will install: `gsap` (e.g. `glass-dock`), `three` + `@react-three/fiber` (e.g. `liquid-ocean`).
- Some components import helpers the registry doesn't ship — e.g. `expandable-bento-grid` imports `@/hooks/use-outside-click`. If a build fails on a missing import, write the hook by hand.
- All are client components (`"use client"`).
