# Visual baselines

One PNG per screen and theme (`<screen>-<light|dark>.png`), written by
`playwright.visual.config.ts` and compared by `pnpm visual` (issue #697).

**Linux pixels only.** Fonts differ per operating system, so a baseline made on
Windows or macOS never matches the CI runner. Never commit a PNG generated
outside the Playwright Linux container. To (re)generate the set, run the
"Visual baselines" workflow (Actions → Visual baselines → Run workflow) on your
branch, or `pnpm visual:update` inside `mcr.microsoft.com/playwright:<version>-jammy`
with the core built there. The procedure, and when to update, is in
`frontend/e2e/README.md` under "Visual regression".

While this folder holds no PNG the visual job fails on purpose: a comparison
against nothing is not a pass.
