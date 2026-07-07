Use Bun.
Do not run the dev server.
Update these files in `docs/memory/` after each run - never create new ones. Only add game logic/design intent a future agent would otherwise miss or guess wrong (coordinate systems, simulation rules, state ownership, non-obvious "why"). Skip build tooling, lint/CI/Docker/package config - that's visible in the files themselves.

- `game.md` — world model + systems: coordinates, grid/iso math, tick order, state ownership, mechanic design intent
- `gotchas.md` — non-obvious game-logic bugs/behavior (not infra)
- `open.md` — noticed but unaddressed issues

Check for an existing entry before adding; update in place, don't duplicate.

Format:
## [YYYY-MM-DD] Title
- Why/non-obvious: 1-2 lines
- Files: paths
- Status: resolved/open

One idea per entry. Past ~300 lines, move resolved entries to `archive.md`.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
