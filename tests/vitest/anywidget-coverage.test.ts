import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { expect, test } from 'vitest'

const repo_root = resolve(import.meta.dirname, `../..`)
const lib_root = `${repo_root}/src/lib`
const public_entry = `${lib_root}/index.ts`
const anywidget_entry = `${repo_root}/extensions/anywidget/anywidget.ts`

const exclude_components = (reason: string, component_names: string): Record<string, string> =>
  Object.fromEntries(
    component_names
      .trim()
      .split(/\s+/)
      .map((component_name) => [component_name, reason]),
  )

// Public components intentionally unavailable through anywidget. Every entry belongs
// to a reasoned group so adding a public component always requires a support decision.
const ANYWIDGET_EXCLUSIONS: Record<string, string> = {
  ...exclude_components(
    `Auxiliary UI or implementation detail, not a standalone visualization`,
    `Arrow AtomLegend AxisLabel BarPlotControls Bond BoxPlotControls
      BrillouinZoneControls BrillouinZoneExportPane BrillouinZoneInfoPane
      BrillouinZoneScene BrillouinZoneTooltip CanvasTooltip ClickFeedback ColorBar
      ColorScaleSelect ContextMenu ControlPane ConvexHullControls ConvexHullInfoPane
      ConvexHullStats ConvexHullTooltip Cylinder DragControlTab DragOverlay DraggablePane
      ElementHeading ElementPhoto ElementStats ElementTile EmptyState ExportPane
      FermiSurfaceControls FermiSurfaceScene FermiSurfaceTooltip FilePicker FillArea
      FormulaFilter FullscreenButton FullscreenToggle GasPressureControls GlassChip
      HeatmapMatrixControls HistogramControls Icon InfoCard InfoTag InteractiveAxisLabel
      IsosurfaceControls JsonTree Lattice Line MillerIndexInput Nucleus NumberRangeInput
      PeriodicTableControls PhaseDiagramControls PhaseDiagramEditorPane
      PhaseDiagramExportPane PhaseDiagramTooltip PlotAxis PlotControls PlotLegend
      PlotMarginals PlotTooltip PortalSelect PropertyFilter PropertySelect ReciprocalVectors
      ReferenceLine ReferenceLine3D ReferencePlane SankeyControls ScatterPlot3DControls
      ScatterPlot3DScene ScatterPlotControls ScatterPoint SceneCamera SettingsSection Spinner
      StatusMessage StructureControls StructureExportPane StructureInfoPane StructurePopup
      StructureScene StructureViewport SubpageGrid SunburstControls Surface3D
      SymmetryElementControls TableInset TdbInfoPanel TemperatureSlider ToggleMenu
      TreemapControls ViewerChrome WyckoffTable ZeroLines ZoomRect`,
  ),
  ...exclude_components(
    `Covered by a higher-level anywidget component`,
    `BarChart BrillouinBandsDos BubbleChart ChemPotDiagram2D ChemPotDiagram3D
      ConvexHull2D ConvexHull3D ConvexHull4D ElementScatter FermiSlice PieChart
      StructureCarousel SymmetryElements SymmetryStats Violin`,
  ),
  ...exclude_components(
    `No standalone JSON-serializable anywidget API yet`,
    `BinnedScatterPlot BohrAtom BoxPlot CoordinationBarPlot Formula HeatmapTable Sankey
      Sunburst VolumetricIsosurface`,
  ),
}

const resolve_module = (from_file: string, specifier: string): string | null => {
  const base_path = specifier.startsWith(`$lib/`)
    ? `${lib_root}/${specifier.slice(5)}`
    : specifier.startsWith(`.`)
      ? resolve(dirname(from_file), specifier)
      : null
  if (!base_path) return null

  for (const candidate of [base_path, `${base_path}.ts`, `${base_path}/index.ts`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

const component_exports = new Map<string, Set<string>>()

const collect_component_exports = (file_path: string): Set<string> => {
  const cached = component_exports.get(file_path)
  if (cached) return cached

  const exports = new Set<string>()
  component_exports.set(file_path, exports)
  const source_file = ts.createSourceFile(
    file_path,
    readFileSync(file_path, `utf8`),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )

  for (const statement of source_file.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.isTypeOnly
    ) {
      continue
    }
    const target = resolve_module(file_path, statement.moduleSpecifier.text)
    if (!target) continue

    if (!statement.exportClause) {
      for (const name of collect_component_exports(target)) {
        if (name !== `default`) exports.add(name)
      }
      continue
    }
    if (!ts.isNamedExports(statement.exportClause)) continue

    const target_exports = target.endsWith(`.svelte`)
      ? null
      : collect_component_exports(target)
    for (const element of statement.exportClause.elements) {
      if (element.isTypeOnly) continue
      const source_name = element.propertyName?.text ?? element.name.text
      if (target.endsWith(`.svelte`) && source_name === `default`) {
        exports.add(element.name.text)
      } else if (target_exports?.has(source_name)) exports.add(element.name.text)
    }
  }
  return exports
}

const property_name = (name: ts.PropertyName): string | null =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null

const collect_widget_components = (): Set<string> => {
  const source_file = ts.createSourceFile(
    anywidget_entry,
    readFileSync(anywidget_entry, `utf8`),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const widgets = new Set<string>()

  for (const statement of source_file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const declaration = statement.declarationList.declarations.find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === `WIDGETS`,
    )
    if (!declaration?.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) {
      continue
    }
    for (const widget of declaration.initializer.properties) {
      if (
        !ts.isPropertyAssignment(widget) ||
        !ts.isObjectLiteralExpression(widget.initializer)
      ) {
        continue
      }
      const component = widget.initializer.properties.find(
        (candidate) =>
          ts.isPropertyAssignment(candidate) && property_name(candidate.name) === `component`,
      )
      if (
        component &&
        ts.isPropertyAssignment(component) &&
        ts.isIdentifier(component.initializer)
      ) {
        widgets.add(component.initializer.text)
      }
    }
  }
  return widgets
}

test(`every public component is registered with anywidget or explicitly excluded`, () => {
  const public_components = collect_component_exports(public_entry)
  const widget_components = collect_widget_components()
  const excluded_components = new Set(Object.keys(ANYWIDGET_EXCLUSIONS))
  const sorted_difference = (left: Set<string>, right: Set<string>): string[] =>
    [...left].filter((name) => !right.has(name)).sort()

  expect({
    unclassified: sorted_difference(
      public_components,
      new Set([...widget_components, ...excluded_components]),
    ),
    non_public_widgets: sorted_difference(widget_components, public_components),
    stale_exclusions: sorted_difference(excluded_components, public_components),
    registered_and_excluded: [...widget_components]
      .filter((name) => excluded_components.has(name))
      .sort(),
    empty_exclusion_reasons: Object.entries(ANYWIDGET_EXCLUSIONS)
      .filter(([, reason]) => !reason.trim())
      .map(([name]) => name)
      .sort(),
  }).toEqual({
    unclassified: [],
    non_public_widgets: [],
    stale_exclusions: [],
    registered_and_excluded: [],
    empty_exclusion_reasons: [],
  })
})
