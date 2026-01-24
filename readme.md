<h1 align="center">
  <sub><img src="static/favicon.svg" alt="Logo" width="40px"></sub> MatterViz
</h1>

<h4 align="center">

[![Tests](https://github.com/janosh/matterviz/actions/workflows/test.yml/badge.svg)](https://github.com/janosh/matterviz/actions/workflows/test.yml)
[![GH Pages](https://github.com/janosh/matterviz/actions/workflows/gh-pages.yml/badge.svg)](https://github.com/janosh/matterviz/actions/workflows/gh-pages.yml)
[![VSCode Extension](https://img.shields.io/badge/Install%20VSCode-Extension-blue?logo=typescript&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=janosh.matterviz)
[![Docs](https://img.shields.io/badge/Read-the%20docs-blue?logo=googledocs&logoColor=white)](https://matterviz.janosh.dev)
[![Open in StackBlitz](https://img.shields.io/badge/Open%20in-StackBlitz-darkblue?logo=stackblitz&logoColor=white)](https://stackblitz.com/github/janosh/matterviz)
[![Zenodo DOI](https://zenodo.org/badge/498793280.svg)](https://doi.org/10.5281/zenodo.17094509)

</h4>

`matterviz` is a toolkit for building interactive web UIs for materials science: 3D crystal structures, molecules, MD/relaxation trajectories, periodic tables, phase diagrams, convex hulls, spectral data (bands, DOS, XRD), heatmaps, and scatter plots.

## 🔌 &thinsp; [MatterViz VSCode Extension]

Visualize crystal structures, molecules, and molecular dynamics trajectories [directly in VSCode][MatterViz VSCode Extension]. Features include:

- Native support for common file formats (CIF, POSCAR, XYZ, TRAJ, HDF5, etc.)
- Context menu (right click > "Render with MatterViz") and keyboard shortcuts (<kbd>ctrl</kbd>+<kbd>shift</kbd>+<kbd>v</kbd> on Windows, <kbd>cmd</kbd>+<kbd>shift</kbd>+<kbd>v</kbd> on Mac) for quick access
- Custom viewer for MD trajectories/geometry optimizations
- **Extensive customization options** via VSCode settings - see [Configuration Guide](extensions/vscode/readme.md#️-configuration--customization) for examples

[matterviz vscode extension]: https://marketplace.visualstudio.com/items?itemName=janosh.matterviz

## 🗺️ &thinsp; Roadmap

- **✅ MatterViz Web**: [matterviz.janosh.dev](https://matterviz.janosh.dev)
- **✅ MatterViz VSCode/Cursor**: [marketplace.visualstudio.com/items?itemName=janosh.matterviz](https://marketplace.visualstudio.com/items?itemName=janosh.matterviz)
- **✅ pymatviz**: [Jupyter](https://jupyter.org)/[Marimo](https://marimo.io) widgets for Python notebooks. See [`pymatviz` readme](https://github.com/janosh/pymatviz/blob/main/readme.md#interactive-widgets).

![Landing page showing 3D structure viewers](https://github.com/janosh/matterviz/releases/download/v0.2.2/2026-01-23-landing-page.webp)

## ⚛️ &thinsp; 3D Structure Viewer

Interactively visualize crystal structures and molecules. Supports drag-and-drop file loading for CIF, POSCAR, XYZ/EXTXYZ, pymatgen JSON, OPTIMADE JSON, and compressed formats.

![3D Structure Viewer](https://github.com/janosh/matterviz/releases/download/v0.2.2/2026-01-23-structure-viewer.webp)

## 📊 &thinsp; Periodic Table Heatmap

Visualize elemental properties across the periodic table. The inset scatter plot shows how properties vary with atomic number - here demonstrating the periodicity of first ionization energy.

![Periodic table heatmap](https://github.com/janosh/matterviz/releases/download/v0.2.2/2026-01-23-heatmap.webp)

## 🔬 &thinsp; Element Details Pages

Rich element pages with physical properties, electron configurations, Bohr atom visualizations, and element photos.

![Element details page for gold](https://github.com/janosh/matterviz/releases/download/v0.2.2/2026-01-23-details-page.webp)

## 🔨 &thinsp; Installation

```sh
npm install --dev matterviz
```

## 📙 &thinsp; Usage

### Periodic Table

```svelte
<script>
  import { PeriodicTable } from 'matterviz'

  const heatmap_values = { H: 10, He: 4, Li: 8, Fe: 3, O: 24 }
</script>

<PeriodicTable {heatmap_values} />
```

### Structure

```svelte
<script>
  import { Structure } from 'matterviz'
  const data_url = '/structures/TiO2.cif'
  // supports .cif, .poscar, .xyz/.extxyz, pymatgen JSON, OPTIMADE JSON, .gz
</script>

<Structure {data_url} style="width: 500px; aspect-ratio: 1" />
```

### Composition

```svelte
<script>
  import { Composition } from 'matterviz'
  // modes can be 'pie' (default) | 'bubble' | 'bar'
</script>

<Composition composition="LiFePO4" mode="pie" />
```

### Trajectory

```svelte
<script>
  import { Trajectory } from 'matterviz'
  // supports .xyz/.extxyz, .traj, .hdf5, .npz, .pkl, .dat, .gz, .zip, .bz2, .xz
</script>

<Trajectory data_url="/traj/ase-md.xyz" auto_play fps={10} style="max-height: 700px" />
```

## 🧪 &thinsp; Coverage

| Statements                                                                                 | Branches                                                                          | Lines                                                                            |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ![Statements](https://img.shields.io/badge/statements-99.84%25-brightgreen.svg?style=flat) | ![Branches](https://img.shields.io/badge/branches-82.92%25-yellow.svg?style=flat) | ![Lines](https://img.shields.io/badge/lines-99.84%25-brightgreen.svg?style=flat) |

## 🙏 &thinsp; Acknowledgements

- Element properties in `src/lib/element-data.ts` were combined from [`Bowserinator/Periodic-Table-JSON`](https://github.com/Bowserinator/Periodic-Table-JSON/blob/master/PeriodicTableJSON.json) under Creative Commons license and [`robertwb/Periodic Table of Elements.csv`](https://gist.github.com/robertwb/22aa4dbfb6bcecd94f2176caa912b952) (unlicensed).
- Thanks to [Images of Elements](https://images-of-elements.com) for providing photos of elemental crystals and glowing excited gases.
- Thanks to [@kadinzhang](https://github.com/kadinzhang) and their [Periodicity project](https://ptable.netlify.app) [[code](https://github.com/kadinzhang/Periodicity)] for the idea to display animated Bohr model atoms and inset a scatter plot into the periodic table to visualize the periodic nature of elemental properties.
- Big thanks to all sources of element images. See [`fetch-elem-images.ts`](https://github.com/janosh/matterviz/blob/-/src/fetch-elem-images.ts) and [`static/elements`](https://github.com/janosh/matterviz/tree/main/static/elements).
- Thanks to [@ixxie](https://github.com/ixxie) ([shenhav.fyi](https://shenhav.fyi)) for great suggestions.

This project would not have been possible as a one-person side project without many fine open-source projects. 🙏 To name just a few:

|           3D graphics           |               2D graphics                |                     Docs                     |               Bundler               |               Testing                |
| :-----------------------------: | :--------------------------------------: | :------------------------------------------: | :---------------------------------: | :----------------------------------: |
| [three.js](https://threejs.org) |          [d3](https://d3js.org)          |         [mdsvex](https://mdsvex.com)         |     [vite](https://vitejs.dev)      | [playwright](https://playwright.dev) |
| [threlte](https://threlte.xyz)  | [sharp](https://sharp.pixelplumbing.com) | [rehype](https://github.com/rehypejs/rehype) | [sveltekit](https://kit.svelte.dev) |     [vitest](https://vitest.dev)     |

## How to cite `matterviz`

Use [`citation.cff`](citation.cff) or cite the [Zenodo record](https://zenodo.org/badge/latestdoi/498793280) using the following BibTeX entry:

```bib
@software{riebesell_matterviz_2022,
  title = {matterviz: visualization toolkit for materials informatics},
  author = {Riebesell, Janosh and Evans, Matthew},
  date = {2026-01-23},
  year = {2026},
  doi = {10.5281/zenodo.17094509},
  url = {https://github.com/janosh/matterviz},
  note = {10.5281/zenodo.17094509 - https://github.com/janosh/matterviz},
  urldate = {2026-01-23}, % optional, replace with your date of access
  version = {0.2.2}, % replace with the version you use
}
```
