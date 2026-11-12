// The components shipped both as custom elements (./vite.config.ts) and as anywidget widgets
// (extensions/anywidget): each one's path under src/lib, keyed by its anywidget widget_type.
// The file name is the component's `matterviz` export and, through tag_name, its element tag.
export const COMPONENTS = {
  structure: `structure/Structure`,
  trajectory: `trajectory/Trajectory`,
  periodic_table: `periodic-table/PeriodicTable`,
  composition: `composition/Composition`,
  scatter_plot: `plot/scatter/ScatterPlot`,
  scatter_plot_3d: `plot/scatter-3d/ScatterPlot3D`,
  bar_plot: `plot/bar/BarPlot`,
  spacegroup_bar: `plot/bar/SpacegroupBarPlot`,
  histogram: `plot/histogram/Histogram`,
  box_plot: `plot/box/BoxPlot`,
  ternary_plot: `plot/ternary/TernaryPlot`,
  treemap: `plot/treemap/Treemap`,
  sunburst: `plot/sunburst/Sunburst`,
  sankey: `plot/sankey/Sankey`,
  heatmap_matrix: `heatmap-matrix/HeatmapMatrix`,
  band_structure: `spectral/Bands`,
  dos: `spectral/Dos`,
  bands_and_dos: `spectral/BandsAndDos`,
  phonon_mode_explorer: `spectral/PhononModeExplorer`,
  brillouin_zone: `brillouin/BrillouinZone`,
  fermi_surface: `fermi-surface/FermiSurface`,
  convex_hull: `convex-hull/ConvexHull`,
  phase_diagram: `phase-diagram/IsobaricBinaryPhaseDiagram`,
  ternary_phase_diagram: `phase-diagram/ternary/IsobaricTernaryPhaseDiagram`,
  chem_pot_diagram: `chempot-diagram/ChemPotDiagram`,
  xrd: `xrd/XrdPlot`,
  rdf_plot: `rdf/RdfPlot`,
  neb_plot: `neb/NebPlot`,
  eos_plot: `eos/EosPlot`,
} as const

// The custom-element tag of a component path or name: ScatterPlot3D -> mv-scatter-plot-3d
export const tag_name = (path: string): string => {
  const words = path.slice(path.lastIndexOf(`/`) + 1).match(/[A-Z][a-z]*|\d+[A-Z]?/g) ?? []
  return `mv-${words.join(`-`).toLowerCase()}`
}
