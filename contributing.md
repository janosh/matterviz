# Contributing

Bug fix pull requests always welcome! For new features, please open an issue first to discuss.

## Setup

```sh
git clone https://github.com/janosh/matterviz
cd matterviz
pnpm install
```

`pnpm install` runs the root `prepare` hook (`src/scripts/prepare.mjs`): it always runs `svelte-kit sync` and, only while `dist/` is missing, also builds the component library (`pnpm package:dist`, ~20 s) so that `github:janosh/matterviz#main` installs work for downstream consumers. Set `MATTERVIZ_SKIP_PREPARE=1` (CI does, in `.github/actions/setup`) to skip that first-install build and run `pnpm package:dist` yourself whenever you need a fresh `dist/`.

## Development

Start the dev server:

```sh
pnpm exec vp dev
```

## Testing

Run unit and end-to-end (E2E) tests:

```sh
pnpm exec vitest run
pnpm exec playwright test
```

VS Code extension tests run separately: `pnpm -C extensions/vscode test`.

### Numerical performance

Moving-average smoothing uses compensated sums and scales only when a window could overflow, so tiny values survive. Keep the extreme-value regressions in `tests/vitest/plot/data-cleaning.test.ts` passing when optimizing it: that accuracy costs some speed, which we accept.

### Scatter interaction benchmarks

Run `MATTERVIZ_PERF=1 pnpm exec playwright test scatter-performance --workers 1` on an otherwise idle machine. This opt-in Chromium benchmark renders seeded 100k/500k canvas points at a fixed viewport, warms both directions, then records 12 alternating pan, pinch-zoom, palette and radius updates. Every operation and measurement phase resets the view and styles; padded ranges keep all points visible, checked after every update. JSON attachments contain raw timings, median and nearest-rank p95 of completed-gesture redraw latency: event dispatch through two animation frames, allowing Svelte to flush and a paint opportunity, including frame scheduling rather than physical display latency.

Six separate updates per operation use CDP heap sampling, including objects collected by either GC, to estimate allocated JavaScript bytes per update. These estimates include page/harness overhead and exclude native canvas/GPU memory; they are not retained-heap deltas. Allocation profiles are attached for inspection in DevTools. Timing excludes profiler overhead. Compare the same browser, hardware and build mode; the default starts Vite development mode, while `MATTERVIZ_E2E_MODE=preview` starts an already-built site. Playwright may reuse an existing server, so the report records the page's actual build mode. There are no machine-specific performance gates.

### Test Requirements

**New features should include tests.** Bug fixes should include a test that fails on the old code and passes with your fix.

- Unit tests go in [`tests/vitest/`](https://github.com/janosh/matterviz/tree/main/tests/vitest)
- E2E tests go in [`tests/playwright/`](https://github.com/janosh/matterviz/tree/main/tests/playwright)
- Give each test a concise, descriptive title.

Before you start committing, create and check out a descriptively named branch:

```sh
git checkout -b cool-new-feature
# or
git checkout -b bug-fix-for-something
```

## Making a Release

1. Update the version in `package.json` plus every `extensions/*/package.json` and `extensions/*/pyproject.toml` (follows [semver](https://semver.org)). The `prepare` job in `publish.yml` fails the release if any of them disagree.
1. Generate changelog:

   ```sh
   npx tsx https://github.com/janosh/workflows/raw/refs/heads/main/scripts/make-release-notes.ts
   ```

1. Commit and push the release commit:

   ```sh
   git add package.json extensions/*/package.json extensions/*/pyproject.toml changelog.md readme.md
   git commit -m "v1.2.3"
   git push
   ```

1. Create a GitHub release tagged `vX.Y.Z` (no pre-release flag) targeting the release commit on `main`, e.g. `gh release create v1.2.3 --generate-notes`. The [Publish workflow](https://github.com/janosh/matterviz/actions/workflows/publish.yml) runs automatically: it builds and validates all artifacts, publishes to npm and Open VSX and uploads the VSIX to the release. Run the workflow by hand (`workflow_dispatch`) only for dry runs or to recover a partially published release.
1. Upload the `matterviz.vsix` asset from the GitHub release to the [VS Code Marketplace](https://marketplace.visualstudio.com/manage).
