# MatterViz anywidget bundle

A prebuilt [anywidget](https://anywidget.dev) bundle that renders MatterViz
components in notebook environments (Jupyter, marimo, VS Code) and anywhere an
ESM module can be loaded.

`anywidget.ts` is the entry point: it dispatches on a `widget_type` string to the
matching MatterViz Svelte component, mounts it into the host element, and forwards
the widget's traitlet values as props. The build is a single self-contained ESM
file (`build/matterviz.js`) plus its CSS (`build/matterviz.css`), with all
dependencies (matterviz components, Svelte runtime, three.js, ...) inlined.

This is a peer of `extensions/dash` and `extensions/vscode`: a framework adapter
that wraps the MatterViz component library for a specific host runtime.

## Consumers

- [pymatviz](https://github.com/janosh/pymatviz) loads this bundle to render its
  Python widget classes and to power headless image/HTML export.
- Any Python (or JS) wrapper can mount the bundle: call its default export's
  `render({ model, el })` with an anywidget-compatible model exposing
  `get(key)` for the widget's `widget_type` and props.

## Build

```sh
# from the matterviz repo root, build the component library first so the
# `matterviz` file: dependency resolves to dist/
pnpm install && pnpm package:dist

cd extensions/anywidget
pnpm install
pnpm build        # -> build/matterviz.js + build/matterviz.css
```

## Publish (CDN distribution)

Published to npm as `matterviz-anywidget`; the prebuilt bundle is then served with
CORS and a JavaScript MIME type via jsDelivr/unpkg, e.g.:

```txt
https://cdn.jsdelivr.net/npm/matterviz-anywidget@<version>/build/matterviz.js
```

`build/` is gitignored; the bundle never enters version control. See
`.github/workflows/publish-anywidget.yml`.
