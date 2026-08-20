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
| Trajectories   | `traj` (ASE), `h5`/`hdf5` (vaspout, torch-sim), `lammpstrj`, multi-frame `xyz`                |
| Volumetric     | `cube`, `CHGCAR`, `LOCPOT`, `ELFCAR`, `PARCHG`, `AECCAR*`, `vaspwave.h5`                      |
| Fermi surfaces | `bxsf`, `frmsf`                                                                               |

Extensionless VASP names (`POSCAR`, `CONTCAR`, `XDATCAR` and the volumetric ones above) are matched by filename. Every format is also recognized with a `.gz` suffix. Structure JSON (pymatgen/ASE `as_dict()` output) is available under **Open With** without displacing Lab's built-in JSON viewer.

A `.dump` file opens as a structure showing its first frame only, not as an animated trajectory. `.xtc`, `.trr` and `.dcd` are deliberately not registered — MatterViz has no decoder for them, so claiming them would replace another application's handler with an error message.

## Limits

Files above 100 MB refuse to parse (transfer already happened; parse in the kernel instead, e.g. with [pymatviz](https://github.com/janosh/pymatviz)'s `TrajectoryWidget`). Below that, parsing runs in a Web Worker so the Lab UI stays responsive; should the worker fail to start, files up to 25 MiB (text) / 50 MiB (binary) parse on the main thread and larger ones show an error. No host-side streaming like the VS Code extension, so very large trajectories can't be paged frame by frame. Open viewers also don't auto-refresh on external writes — JupyterLab has no filesystem watcher; use **File → Reload from Disk**.

## Development

```sh
pnpm install --ignore-workspace --config.strict-dep-builds=false
pnpm build   # vite build && jupyter labextension build . (needs jupyter on PATH)
uv build --wheel
```

`uv_build` packages whatever is already on disk — run `pnpm build` first or you will ship an empty extension. The install flags are needed because this package is outside the monorepo workspace and `@jupyterlab/application` depends on fontawesome, whose install script pnpm declines to run unattended and then exits non-zero over.

The `process` devDependency is not imported by anything here. `@jupyterlab/builder`'s webpack config carries an unconditional `ProvidePlugin({ process: 'process/browser' })`, which has to resolve from this package under pnpm's strict layout. Don't delete it as unused.

The build runs in two stages, which is load-bearing:

1. **Vite** compiles `src/index.ts` plus the MatterViz Svelte component graph into plain ESM under `lib/`. All `@jupyterlab/*` and `@lumino/*` imports stay external so JupyterLab supplies the shared singleton instances — bundling a private copy would produce plugin tokens that never match the ones in the application registry.
2. **`jupyter labextension build`** webpacks `lib/index.js` into a federated module under `data/share/jupyter/labextensions/matterviz-jupyterlab/`, which `uv_build` copies into the wheel's data directory so pip unpacks it over `{sys.prefix}/share`.

Webpack cannot build MatterViz directly: the source relies on Vite-only features (`import.meta.glob`, `.json.gz` imports) and Svelte compilation. Feeding it already-compiled ESM sidesteps both. Vite's dynamic-import chunks survive the second pass, so HDF5 support stays a ~4.6 MB chunk fetched only when someone actually opens an `.h5` file.

`jupyter labextension build` emits an asset-size warning for the three-dimensional viewer chunks. That is expected for a bundle carrying three.js.
