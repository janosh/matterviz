# MatterViz anywidget bundle

A prebuilt [anywidget](https://anywidget.dev) bundle that renders MatterViz
components in notebook environments (Jupyter, marimo, VS Code) and anywhere an
ESM module can be loaded.

`anywidget.ts` is the entry point: it dispatches on a `widget_type` string to the
matching MatterViz Svelte component, mounts it into the host element, and forwards
the widget's traitlet values as props. The build is a single self-contained ESM
file (`build/matterviz.js`) plus its CSS (`build/matterviz.css`), with all
dependencies (matterviz components, Svelte runtime, three.js, ...) inlined.

This is a peer of `extensions/vscode`: a framework adapter
that wraps the MatterViz component library for a specific host runtime.

## Bundle size

Two large WASM dependencies are kept out of the inlined bundle (10.4 MB -> 3.4 MB),
configured in `vite.config.ts`:

- **h5wasm** (~5 MB HDF5 reader for client-side `.h5` trajectory parsing) is aliased
  to a stub (`h5wasm-stub.ts`). Hosts that drive this widget (e.g. pymatviz) parse
  trajectories on the Python side and pass structured data, so the in-browser HDF5
  path is never hit; it throws a clear error if it ever is.
- **moyo** (~1.9 MB spglib symmetry WASM, inlined twice) is loaded from jsDelivr on demand by a small build plugin, only when spacegroup/symmetry analysis runs. For offline use, set `globalThis.matterviz_moyo_wasm_url` to a locally served URL or a WASM data URL before the widget renders; symmetry then runs on the main thread, since workers can't read that global. Rendering never needs it.

The publish workflow's size gate fails if either WASM creeps back in.

## Web Workers

The bundle has no URL of its own to load worker files from (anywidget imports it from a `blob:`, CDN or `file://` URL), so the `inline_workers` plugin in `vite.config.ts` ships every MatterViz worker (file parsing, MSD, VACF, RDF, structure ID, spectroscopy, chempot, ternary hulls, isosurfaces, Fermi surfaces, symmetry) as a string in `matterviz.js` (~0.8 MB of 6.2 MB) and starts it from a `blob:` URL. That keeps parsing and analysis off the notebook's UI thread: RDF over 100 frames of a 10k-atom run froze the page for 10 s before, and now runs in 2 s across parallel workers with no frame longer than ~50 ms. A page CSP whose `worker-src` (or its `child-src`/`script-src` fallback) leaves out `blob:` refuses these workers; the bundle tests that once at load and then logs a warning and computes on the main thread.

## Consumers

- [pymatviz](https://github.com/janosh/pymatviz) loads this bundle to render its
  Python widget classes and to power headless image/HTML export.
- Any Python (or JS) wrapper can mount the bundle: call its default export's
  `render({ model, el })` with an anywidget-compatible model exposing
  `get(key)` for the widget's `widget_type` and props.

## Build

```sh
# from the matterviz repo root: the anywidget package links the root's matterviz
# (bundling its dist/) and the svelte-widgets the root installed
pnpm install && pnpm package:dist

pnpm install:anywidget             # standalone install, no lockfile or pnpm-workspace.yaml
pnpm -C extensions/anywidget build # -> build/matterviz.js + build/matterviz.css
```

### Building from a matterviz checkout in downstream CI

Python consumers that want to test against unreleased matterviz `main` (instead of the
`matterviz-anywidget@<version>` npm release they pin) build the bundle themselves. The root
`build:anywidget` script chains the three steps above (`package:dist`, the anywidget install, the
bundle build); `MATTERVIZ_SKIP_PREPARE=1` stops the root `prepare` hook from building `dist/` a
first time during `pnpm install`:

```sh
git clone --depth 1 https://github.com/janosh/matterviz
cd matterviz
corepack enable # picks up the pinned pnpm from package.json
MATTERVIZ_SKIP_PREPARE=1 pnpm install --config.strict-dep-builds=false
pnpm build:anywidget
# bundle: extensions/anywidget/build/matterviz.js + build/matterviz.css
```

pymatviz reads that directory when `MATTERVIZ_ANYWIDGET_DIR` points at it
(`export MATTERVIZ_ANYWIDGET_DIR="$PWD/extensions/anywidget/build"`), bypassing its
pinned CDN version.

JS consumers can depend on the component library straight from git: the root `prepare` hook
(`src/scripts/prepare.mjs`) builds `dist/` inside the clone, so `npm install github:janosh/matterviz#main`
works as is. pnpm >= 11.9 only runs git-dependency build scripts for an exact `allowBuilds` key
(`matterviz@https://codeload.github.com/janosh/matterviz/tar.gz/<sha>: true` in
`pnpm-workspace.yaml`, so pin a commit), or install a locally built checkout with
`pnpm add file:../matterviz`.

## Publish (CDN distribution)

Published to npm as `matterviz-anywidget`; the prebuilt bundle is then served with
CORS and a JavaScript MIME type via jsDelivr/unpkg, e.g.:

```txt
https://cdn.jsdelivr.net/npm/matterviz-anywidget@<version>/build/matterviz.js
```

`build/` is gitignored; the bundle never enters version control. See the
`package_anywidget` job in `.github/workflows/publish.yml`.
