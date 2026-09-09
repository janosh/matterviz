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
npx vite dev
```

## Testing

Run all tests:

```sh
npx vitest
# or
npm test
```

Run Playwright end-to-end (E2E) tests:

```sh
npx playwright test
```

The root test run (`pnpm exec vitest run`) no longer covers the VS Code extension; its host-side tests live in their own vitest project and run with `pnpm -C extensions/vscode test`.

### Numerical performance

Moving-average smoothing uses compensated sums and scales only when a window could overflow, retaining tiny terms separately to prevent underflow and cancellation losses. Preserve the extreme-value regressions in `tests/vitest/plot/data-cleaning.test.ts` when optimizing this path.

On 2026-09-09, 200,000-value benchmarks on an Apple M5 Max with Node 24.21.0 (seed `20260909`, five warm-ups, median of eleven alternating runs) measured 6–19% overhead on ordinary inputs and 53% on overflow-scale inputs versus the previous implementation that scaled every input. For example, a signed random series with a 501-point window took 11.50 ms versus 9.70 ms; the overflow-scale case took 22.76 ms versus 14.84 ms. These are local measurements, not performance guarantees. All five benchmark datasets matched the previous outputs exactly, and all seven numerical edge cases matched their expected outputs: maximum absolute and relative error were both zero. We accept this cost to preserve tiny values; optimize against both correctness and timing rather than dropping those safeguards.

### Test Requirements

**New features should include tests.** Bug fixes should include a test that fails on the old code and passes with your fix.

- Unit tests go in [`tests/vitest/`](https://github.com/janosh/matterviz/tree/main/tests/vitest)
- E2E tests go in [`tests/playwright/`](https://github.com/janosh/matterviz/tree/main/tests/playwright)
- Test functions should have typing annotations and concise docstrings explaining what they test.

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
