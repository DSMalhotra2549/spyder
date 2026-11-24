# Contributing

Thanks for your interest. Spyder is a small personal tool with firm opinions, so **open an issue before a large change** to check that it fits.

## Before you start

- Read [`AGENTS.md`](AGENTS.md). It's written for AI agents, but it's also the shortest map of the code, the invariants and how to verify a change.
- Use the terms in [`CONTEXT.md`](CONTEXT.md) (block, loop, answer, untracked…) in code, UI copy and commits.
- Behavior is settled in [`docs/product-decisions.md`](docs/product-decisions.md) (P1…) and architecture in [`docs/adr/`](docs/adr/). A change that contradicts one of them needs a discussion first.
- **No AI or LLM features** ([ADR-0009](docs/adr/0009-no-ai.md)). Pull requests adding them will be closed.

## Setup

Windows 10/11 and Node.js 22.13 or newer.

```powershell
npm install
npm run build:helper
$env:SPYDER_DATA_DIR = "$env:TEMP\spyder-dev"   # keep your real data out of it
npm run seed
npm run dev
```

Don't turn on the `.githooks` pre-push hook. It reinstalls the app over your installed copy after every push of `main` (maintainer only).

## Every change

1. Add or extend a test: Vitest next to the file for `src/core/`, Playwright in `tests/e2e/` for app behavior. Control time with the debug clock instead of waiting (see `AGENTS.md` → Verify).
2. All four must pass:

   ```
   npm run typecheck
   npm run lint
   npm test
   npm run test:e2e
   ```

3. For UI changes, look at the screenshots the e2e run saves in `tests/e2e/__shots__/` and compare them with [`design/DESIGN.md`](design/DESIGN.md). Include before/after shots in the pull request.
4. Commit messages use the conventional style and cite the decision they implement, e.g. `feat: bar label wraps to two lines (P47)`. The body has `What:`, `Why:` and `If you pull this:` sections (see [`AGENTS.md`](AGENTS.md) → Commits), and the same commit adds an entry to [`CHANGELOG.md`](CHANGELOG.md).

By contributing, you agree your contribution is licensed under the [MIT License](LICENSE).
