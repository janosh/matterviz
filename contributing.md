# Contributing

Bug fix pull requests always welcome! For new features, please open an issue first to discuss.

## Setup

```sh
git clone https://github.com/janosh/matterviz
cd matterviz
npm install
```

## Development

Start the dev server:

```sh
npx vite
# or
npm run dev
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

**New features should include tests.** Bug fixes should include a test that fails on the old code and passes with your fix.

Before you start committing, create and check out a descriptively named branch:

```sh
git checkout -b cool-new-feature
# or
git checkout -b bug-fix-for-something
```

## Making a Release

1. Update version in `package.json` (follows [semver](https://semver.org))
1. Generate changelog (requires [`deno`](https://deno.com)):

   ```sh
   deno run -A https://github.com/janosh/workflows/raw/refs/heads/main/scripts/make-release-notes.ts
   ```

1. Commit and tag:

   ```sh
   git add package.json changelog.md readme.md
   git commit -m "v1.2.3"
   git tag v1.2.3
   git push && git push --tags
   ```

1. [Create GitHub release](https://github.com/janosh/matterviz/releases/new)
