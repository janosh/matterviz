// One row per site with its coordinates and every per-site property the parsers keep (forces,
// magmoms, charges, velocities, selective dynamics, …), shared by the trajectory data inspector
// and the structure viewer's site sidebar.
import { display_idx, trajectory_property_config } from '#lib/labels.js'
import type { TrajPropertyConfig } from '#lib/labels.js'
import type { CellVal, Column, RowData } from '#lib/table/index.js'
import type { Site } from './index'

const VEC3_AXES = [`x`, `y`, `z`] as const
const FRAC_AXES = [`a`, `b`, `c`] as const

// Units for per-atom properties the parsers emit. trajectory_property_config covers per-frame
// scalars only (force_max, energy, …), never the per-site arrays. Velocities have no fixed unit
// (Å/fs in ASE-derived files, Å/ps in LAMMPS metal dumps), so none is shown.
const SITE_PROPERTY_UNITS: Record<string, string> = {
  force: `eV/Å`,
  forces: `eV/Å`,
  magmom: `μB`,
  magmoms: `μB`,
  charge: `e`,
  charges: `e`,
}

// Property row keys are namespaced so a property literally named `site` or `element` cannot
// overwrite an identity column. Headers use the display label, so the prefix never reaches the
// UI or the CSV/JSON export.
export const PROP_PREFIX = `prop_`

export const is_vec3_like = (value: unknown): value is (number | boolean)[] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((entry) => typeof entry === `number` || typeof entry === `boolean`)

export const vec3_norm = (vec: readonly (number | boolean)[]): number =>
  Math.hypot(Number(vec[0]), Number(vec[1]), Number(vec[2]))

// Label and unit of a property from the config that labels the plot axes
export const property_config = (key: string): TrajPropertyConfig | undefined =>
  trajectory_property_config[key] ?? trajectory_property_config[key.toLowerCase()]

// Shared by the site table and the trajectory inspector's other tables: virtualized plain
// tables (no heatmap) with column toggles, numbers to 6 significant digits
export const DATA_TABLE_PROPS = {
  virtual: true,
  show_column_toggle: true,
  show_controls: true,
  show_heatmap: false,
  default_num_format: `.6~g`,
  style: `text-align: left; width: 100%`,
} as const

// A docked sidebar is a flex column: its table scrolls within the height under the header
// rather than a viewport-tied cap
export const DOCKED_SCROLL_STYLE = `flex: 1; min-height: 0`

// Scalars pass through; tensors and nested objects are stringified so the cell shows the real
// value rather than [object Object]
const to_cell_value = (value: unknown): CellVal =>
  typeof value === `number` || typeof value === `string` || typeof value === `boolean`
    ? value
    : JSON.stringify(value)

// scalar: one column; vec3: three; numeric_vec3 (force, velocity) also gets its magnitude
export type SitePropertyShape = `scalar` | `vec3` | `numeric_vec3`

const shape_of = (value: unknown): SitePropertyShape =>
  !is_vec3_like(value)
    ? `scalar`
    : value.every((entry) => typeof entry === `number`)
      ? `numeric_vec3`
      : `vec3`

// Enumerated from the sites rather than hardcoded, in first-seen order: parsers keep growing
// the set of per-site entries they retain
export const site_property_specs = (sites: readonly Site[]): [string, SitePropertyShape][] => {
  const specs = new Map<string, SitePropertyShape>()
  for (const site of sites) {
    for (const [key, value] of Object.entries(site.properties ?? {})) {
      if (value != null && !specs.has(key)) specs.set(key, shape_of(value))
    }
  }
  return [...specs]
}

// Worth a table beside the 3D view: a site property with numbers in it (predicted forces,
// magnetic moments, charges, velocities). Flags like selective_dynamics or text tags alone are not.
export const has_site_data = (sites: readonly Site[] | undefined): boolean =>
  (sites ?? []).some(({ properties }) =>
    Object.values(properties ?? {}).some(
      (value) =>
        (typeof value === `number` && Number.isFinite(value)) ||
        shape_of(value) === `numeric_vec3`,
    ),
  )

// Column for one property, label and unit from the config that labels plot axes, else
// SITE_PROPERTY_UNITS. `axis` splits a vec3 into one column per axis, `norm` is its magnitude.
export const property_column = (prop_name: string, axis?: string): Column => {
  const config = property_config(prop_name)
  const label =
    axis === `norm`
      ? `|${prop_name}|`
      : axis
        ? `${prop_name} ${axis}`
        : (config?.label ?? prop_name)
  const unit = SITE_PROPERTY_UNITS[prop_name] ?? config?.unit
  const id = `${PROP_PREFIX}${prop_name}${axis ? `_${axis}` : ``}`
  return { id, key: id, label: unit ? `${label} (${unit})` : label, description: prop_name }
}

export const site_columns = (specs: [string, SitePropertyShape][]): Column[] => [
  { id: `site`, label: `Site`, format: `d`, color_scale: null, sticky: true },
  { id: `element`, label: `Element`, color_scale: null },
  ...[
    ...FRAC_AXES.map((axis) => [`frac_${axis}`, `${axis}<sub>frac</sub>`]),
    ...VEC3_AXES.map((axis) => [`cart_${axis}`, `${axis} (Å)`]),
  ].map(([id, label]) => ({ id, key: id, label, format: `.4~f` })),
  ...specs.flatMap(([key, shape]) =>
    shape === `scalar`
      ? [property_column(key)]
      : [...VEC3_AXES, ...(shape === `numeric_vec3` ? [`norm`] : [])].map((axis) =>
          property_column(key, axis),
        ),
  ),
]

// `source_indices` names the source atom behind each site of a render sample, so the Site
// column (1-based) numbers atoms like the full structure does
export const site_rows = (
  sites: readonly Site[],
  specs: [string, SitePropertyShape][],
  source_indices?: readonly number[],
): RowData[] =>
  sites.map((site, site_idx) => {
    const { species, abc, xyz, properties } = site
    const row: RowData = {
      site: display_idx(source_indices?.[site_idx] ?? site_idx),
      element: species.map(({ element }) => element).join(`/`),
      frac_a: abc[0],
      frac_b: abc[1],
      frac_c: abc[2],
      cart_x: xyz[0],
      cart_y: xyz[1],
      cart_z: xyz[2],
    }
    for (const [key, shape] of specs) {
      const value = properties?.[key]
      if (value == null) continue
      if (shape === `scalar`) row[`${PROP_PREFIX}${key}`] = to_cell_value(value)
      // a site whose value does not match the column's vec3 shape leaves its cells empty
      // (rendered "n/a") instead of silently misaligning components
      else if (is_vec3_like(value)) {
        VEC3_AXES.forEach((axis, axis_idx) => {
          row[`${PROP_PREFIX}${key}_${axis}`] = value[axis_idx]
        })
        if (shape === `numeric_vec3`) row[`${PROP_PREFIX}${key}_norm`] = vec3_norm(value)
      }
    }
    return row
  })
