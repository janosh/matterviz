# MatterViz for JupyterLab

Open crystal structures, MD trajectories, band structures and volumetric data directly from the JupyterLab file browser — double-click a `.cif`, or right-click → **Open With** → **MatterViz**. The counterpart to the [MatterViz VS Code extension](https://marketplace.visualstudio.com/items?itemName=janosh.matterviz), for people whose file browser lives inside JupyterHub.

![Li10GeP2S12.cif opened from the JupyterLab file browser](https://github.com/janosh/matterviz/releases/download/v0.4.4/2026-08-01-jupyterlab-file-viewer.png)

## Install

```sh
pip install matterviz-jupyterlab
```

That's it — the wheel ships prebuilt assets, so there is no `jupyter labextension install` step and no Node.js on the user's machine. Restart JupyterLab and verify with:

```sh
jupyter labextension list
```

Requires JupyterLab 4.

## Supported formats

| Kind           | Extensions                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------- |
| Structures     | `cif`, `mcif`, `mmcif`, `xyz`, `extxyz`, `poscar`, `vasp`, `pdb`, `mol`, `mol2`, `sdf`, `lmp` |
| Trajectories   | `traj`, `h5`, `hdf5`, `xtc`, `trr`, `dcd`, `dump`, `lammpstrj`, multi-frame `xyz`             |
| Volumetric     | `cube`, `CHGCAR`/`vaspwave.h5`                                                                |
| Fermi surfaces | `bxsf`, `frmsf`                                                                               |

`POSCAR`, `CONTCAR` and `XDATCAR` are matched by name since they carry no extension. Every format above is also recognized with a `.gz` suffix. Structure JSON (pymatgen/ASE `as_dict()` output) is available under **Open With** without displacing Lab's built-in JSON viewer.

## Limits

Files above 100 MB are refused. JupyterLab's contents API delivers a file as a single JSON response — base64-inflated by a third for binary formats — and the parser then holds the bytes a second time while copying them into WASM memory. Past roughly that size the browser tab is the wrong place to do the work; parse it in the kernel instead, e.g. with [pymatviz](https://github.com/janosh/pymatviz)'s `TrajectoryWidget`.

Unlike the VS Code extension, there is no host-side streaming bridge, so very large trajectories cannot be indexed and paged in frame by frame.

## Development

```sh
pnpm install --config.strict-dep-builds=false
pnpm build   # vite build && jupyter labextension build . (needs jupyter on PATH)
uv build --wheel
```

`uv_build` packages whatever is already on disk — run `pnpm build` first or you will ship an empty extension. The flag on install is needed because `@jupyterlab/application` depends on fontawesome, whose install script pnpm declines to run unattended and then exits non-zero over.

The build runs in two stages, which is load-bearing:

1. **Vite** compiles `src/index.ts` plus the MatterViz Svelte component graph into plain ESM under `lib/`. All `@jupyterlab/*` and `@lumino/*` imports stay external so JupyterLab supplies the shared singleton instances — bundling a private copy would produce plugin tokens that never match the ones in the application registry.
2. **`jupyter labextension build`** webpacks `lib/index.js` into a federated module under `data/share/jupyter/labextensions/matterviz-jupyterlab/`, which `uv_build` copies into the wheel's data directory so pip unpacks it over `{sys.prefix}/share`.

Webpack cannot build MatterViz directly: the source relies on Vite-only features (`import.meta.glob`, `.json.gz` imports) and Svelte compilation. Feeding it already-compiled ESM sidesteps both. Vite's dynamic-import chunks survive the second pass, so HDF5 support stays a ~4.6 MB chunk fetched only when someone actually opens an `.h5` file.

`jupyter labextension build` emits an asset-size warning for the three-dimensional viewer chunks. That is expected for a bundle carrying three.js.
