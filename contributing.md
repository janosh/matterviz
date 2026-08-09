# Contributing

Bug fix pull requests always welcome! For new features, please open an issue first to discuss.

## Setup

```sh
git clone https://github.com/janosh/matterviz
cd matterviz
pnpm install
```

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

1. Run the [Publish workflow](https://github.com/janosh/matterviz/actions/workflows/publish.yml) from `main` with the release version and `dry_run` disabled. It builds and validates all artifacts, publishes to npm and Open VSX, then creates the tag and GitHub release.
1. Upload the `matterviz.vsix` asset from the GitHub release to the [VS Code Marketplace](https://marketplace.visualstudio.com/manage).
