# E2E Tests — AgenticOS

## Local invocation

```bash
# One-time: install Chromium browser binaries
bun run test:e2e:install

# Run all e2e tests (auto-starts dev server, runs both viewport projects)
bun run test:e2e

# Open Playwright UI (interactive test runner)
bun run test:e2e:ui
```

The `webServer` block in `playwright.config.ts` auto-starts `bun run dev` on
`http://localhost:4321` and tears it down after the run. If a dev server is
already running it will be reused (local) or rejected (CI).

## Writing a new spec

Create a file in `tests/e2e/` with the pattern `<feature>.spec.ts`. Import
helpers from `fixtures.ts`:

```ts
import { test, expect, statCard, quotaCard, sprintBurnup } from './fixtures.ts';

test('my feature shows stat cards', async ({ page }) => {
  await page.goto('/');
  await expect(statCard(page).first()).toBeVisible();
});
```

Playwright runs each `test()` against **both** viewport projects
(`chromium-desktop` 1440×900 and `chromium-mobile` 390×844) automatically.
You do not need to manage viewports per test.

## Referencing spec files from PMO acceptance bullets

PMO story acceptance bullets can reference spec files directly. Example:

```
- B3 verified via tests/e2e/kanban.spec.ts — `kanban columns render`
```

The qa-verifier agent will run `bun run test:e2e` and check that the named
test passes.

## Limitations

- `/ops` is Cloudflare Access-protected in production. Locally (`bun run dev`)
  the Astro SSR route responds without authentication, so both `/` and `/ops`
  are tested. If a local auth middleware is added in future, update
  `_smoke.spec.ts` to only test `/` for the ops route and note the change here.
- Tests run `workers: 1` (serial) to avoid port conflicts with the dev server.
