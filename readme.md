<h1 align="center">
  <sub><img src="static/favicon.svg" alt="Logo" width="40px"></sub> MatterViz
</h1>

<h4 align="center">

[![CI](https://github.com/janosh/matterviz/actions/workflows/ci.yml/badge.svg)](https://github.com/janosh/matterviz/actions/workflows/ci.yml)
[![GH Pages](https://github.com/janosh/matterviz/actions/workflows/gh-pages.yml/badge.svg)](https://github.com/janosh/matterviz/actions/workflows/gh-pages.yml)
[![npm](https://img.shields.io/npm/v/matterviz?logo=npm&color=blue)](https://npmjs.com/package/matterviz)
[![VSCode Extension](https://img.shields.io/badge/Install%20VSCode-Extension-blue?logo=typescript&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=janosh.matterviz)
[![Docs](https://img.shields.io/badge/Read-the%20docs-blue?logo=googledocs&logoColor=white)](https://matterviz.janosh.dev)
[![DOI](https://img.shields.io/badge/DOI-10.5281%2Fzenodo.17094509-blue)](https://doi.org/10.5281/zenodo.17094509)

</h4>

**Interactive, GPU-accelerated visualization for materials science, in the browser, your editor and your notebooks.** Drop in a CIF, POSCAR, MD trajectory or CHGCAR and explore it in 3D, or build your own web UI from the same components: crystal structures, trajectories, volumetric data, band structures, phase diagrams, convex hulls, periodic tables and a full 2D/3D plotting library.

**[Try it in your browser →](https://matterviz.janosh.dev)** &nbsp;No install, just drag a file onto any viewer.

![Two crystal structures with coordination polyhedra rendered side by side](https://github.com/janosh/matterviz/releases/download/v0.9.0/structure-viewer.webp)

## 🧰 &thinsp; Use it where you work

|                      |                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VS Code / Cursor** | Right-click any structure or trajectory file → _Render with MatterViz_. Install from the [VS Code Marketplace] or [Open VSX]. Works over Remote SSH. [Settings and file formats](extensions/vscode/readme.md) |
| **JupyterLab**       | Double-click files in the JupyterLab file browser: `pip install matterviz-jupyterlab`. [Details](extensions/jupyterlab/readme.md)                                                                             |
| **Jupyter / Marimo** | Notebook widgets for pymatgen and ASE objects via [`pymatviz`](https://github.com/janosh/pymatviz/blob/main/readme.md#interactive-widgets)                                                                    |
| **Svelte apps**      | `npm add matterviz` and import components (quick start below)                                                                                                                                                 |
| **React, Vue, HTML** | Prebuilt custom elements like `<mv-structure>` and `<mv-trajectory>`, no build step needed. [Guide](https://matterviz.janosh.dev/how-to/use-without-svelte)                                                   |
| **Command line**     | `pnpm snapshot` renders structure images in batch; `pnpm movie` scripts camera flights through MD trajectories into MP4/WebM. Run either with `--help` from a repo checkout                                   |

[VS Code Marketplace]: https://marketplace.visualstudio.com/items?itemName=janosh.matterviz
[Open VSX]: https://open-vsx.org/extension/janosh/matterviz

## 🖼️ &thinsp; Gallery

<table>
  <tr>
    <td width="50%">
      <a href="https://matterviz.janosh.dev/trajectory"><img src="https://github.com/janosh/matterviz/releases/download/v0.9.0/trajectory-viewer.webp" alt="MD trajectory viewer with energy and force plots"></a>
      <b>Trajectories</b>: step through MD runs and relaxations with linked energy, force and volume plots. Streams multi-GB HDF5 and ASE trajectories frame by frame, plus MSD, VACF, RDF and thermal-hotspot analysis.
    </td>
    <td width="50%">
      <a href="https://matterviz.janosh.dev/structure/isosurface"><img src="https://github.com/janosh/matterviz/releases/download/v0.9.0/isosurface.webp" alt="Fe3O4 charge density isosurfaces with coordination polyhedra"></a>
      <b>Volumetric data</b>: isosurfaces and 2D slices of CHGCAR, ELFCAR, LOCPOT and cube files, meshed off the main thread. Color one field by another, e.g. density by electrostatic potential.
    </td>
  </tr>
  <tr>
    <td>
      <a href="https://matterviz.janosh.dev/reciprocal/brillouin-bands-dos"><img src="https://github.com/janosh/matterviz/releases/download/v0.9.0/phonon-bz-bands-dos.webp" alt="Brillouin zone, phonon bands and DOS from three ML potentials vs DFT"></a>
      <b>Bands, DOS & Brillouin zones</b>: electronic and phonon band structures with linked k-paths and DOS. Overlay ML potentials against DFT, here CHGNet, M3GNet and MACE vs PBE.
    </td>
    <td>
      <a href="https://matterviz.janosh.dev/phase-diagram"><img src="https://github.com/janosh/matterviz/releases/download/v0.9.0/phase-diagram-comparison.webp" alt="Binary Ag-Cu phase diagram comparing a model against an assessment, with scored observations"></a>
      <b>Phase diagrams</b>: binary and ternary diagrams with lever-rule tooltips and isopleths. Compare two diagrams with shaded disagreement regions and score predictions against experimental observations.
    </td>
  </tr>
  <tr>
    <td>
      <a href="https://matterviz.janosh.dev/convex-hull"><img src="https://github.com/janosh/matterviz/releases/download/v0.9.0/quaternary-convex-hulls.webp" alt="Quaternary convex hulls of Li-Co-Ni-O and Na-Fe-P-O"></a>
      <b>Convex hulls</b>: binary to quaternary formation-energy hulls colored by energy above hull. Also chemical potential diagrams, temperature-dependent free energies and synthesis planning.
    </td>
    <td>
      <a href="https://matterviz.janosh.dev/reciprocal/fermi-surface"><img src="https://github.com/janosh/matterviz/releases/download/v0.9.0/fermi-surface.webp" alt="Fermi surface of BaFe2As2"></a>
      <b>Fermi surfaces</b> from BXSF, FRMSF and IFermi JSON files, with per-band colors, spin channels and reciprocal-lattice vectors.
    </td>
  </tr>
  <tr>
    <td colspan="2">
      <a href="https://matterviz.janosh.dev/periodic-table"><img src="https://github.com/janosh/matterviz/releases/download/v0.9.0/periodic-table-heatmap.webp" alt="Periodic table heatmap splitting each tile between atomic mass and density"></a>
      <b>Periodic tables</b>: heatmaps of any elemental property, including multiple values per tile, with inset scatter plots and rich element pages.
    </td>
  </tr>
</table>

There's much more in the [docs](https://matterviz.janosh.dev): XRD, IR/Raman spectra, NEB reaction paths, symmetry elements, slab and interface builders, and 2D/3D scatter, histogram, violin, sunburst and Sankey plots.

## 🚀 &thinsp; Quick start

```sh
npm add matterviz
```

```svelte
<script>
  import { PeriodicTable, Structure, Trajectory } from 'matterviz'
</script>

<!-- structures: CIF, POSCAR, (ext)XYZ, pymatgen/ASE/OPTIMADE JSON, PDB, ... (also .gz) -->
<Structure source="/structures/TiO2.cif" style="height: 500px" />

<!-- trajectories: extXYZ, ASE .traj, HDF5, LAMMPS, XDATCAR, vasprun.xml, ... -->
<Trajectory source="/traj/md-run.xyz.gz" auto_play />

<!-- heatmap of any elemental property -->
<PeriodicTable heatmap_values={{ H: 10, He: 4, Li: 8, Fe: 3, O: 24 }} />
```

Every viewer also accepts parsed data (`structure`, `trajectory`, `band_structs`, ...), handles drag-and-drop and has built-in export (PNG, SVG, CIF, POSCAR, JSON, GLB, video). Each viewer lists its keyboard shortcuts in its info pane.

Not using Svelte? The same components ship as custom elements:

```html
<mv-structure source="/TiO2.cif" style="height: 500px"></mv-structure>
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/matterviz/dist/elements/matterviz-elements.js"
></script>
```

## 📚 &thinsp; Learn more

- **[Live demos](https://matterviz.janosh.dev)**: every component with its source code and a documented props table
- **[Use without Svelte](https://matterviz.janosh.dev/how-to/use-without-svelte)**: React, Vue and plain HTML
- **[Connect to external APIs](https://matterviz.janosh.dev/how-to/hook-up-to-external-api)**: fetch structures from OPTIMADE databases
- **[Changelog](changelog.md)**: breaking changes and migration notes for each release

## 🙏 &thinsp; Acknowledgements

MatterViz builds on [three.js](https://threejs.org), [threlte](https://threlte.xyz), [d3](https://d3js.org), [Svelte](https://svelte.dev) and [Vite](https://vite.dev), with element data and photos from many generous sources. See the full [acknowledgements](https://matterviz.janosh.dev/acknowledgements).

## 📝 &thinsp; How to cite

Use [`citation.cff`](citation.cff) or cite the [Zenodo record](https://doi.org/10.5281/zenodo.17094509):

```bib
@software{riebesell_matterviz_2022,
  title = {matterviz: visualization toolkit for materials informatics},
  author = {Riebesell, Janosh and Evans, Matthew},
  date = {2026-11-10},
  year = {2026},
  doi = {10.5281/zenodo.17094509},
  url = {https://github.com/janosh/matterviz},
  note = {10.5281/zenodo.17094509 - https://github.com/janosh/matterviz},
  urldate = {2026-11-10}, % optional, replace with your date of access
  version = {0.9.0}, % replace with the version you use
}
```
