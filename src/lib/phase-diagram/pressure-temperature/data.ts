// Validation, units and phase styling for pressure-temperature phase diagrams

import { plot_color } from '#lib/colors/index.js'
import { array_extent, type Vec2 } from '#lib/math.js'
import type { TempUnit } from '../types'
import { named_phase_color } from '../utils'
import type {
  PressureUnit,
  PtBoundary,
  PtPhase,
  PtPhaseDiagramData,
  PtSpecialPoint,
  PtSpecialPointType,
} from './types'

// Pascal per unit
export const PRESSURE_UNITS: Readonly<Record<PressureUnit, number>> = Object.freeze({
  Pa: 1,
  kPa: 1e3,
  MPa: 1e6,
  GPa: 1e9,
  bar: 1e5,
  kbar: 1e8,
  atm: 101_325,
})
export const TEMP_UNITS: readonly TempUnit[] = [`K`, `°C`, `°F`]

export const convert_pressure = (
  value: number,
  from: PressureUnit,
  to: PressureUnit,
): number => (from === to ? value : (value * PRESSURE_UNITS[from]) / PRESSURE_UNITS[to])

export const phase_label = (phase: PtPhase): string => phase.name ?? phase.id

// Explicit color, else the shared phase palette when the name matches one of its patterns
// (liquid, Greek letters) and no earlier phase took that color, else the categorical plot
// palette by phase index
export function pt_phase_colors(phases: readonly PtPhase[]): Map<string, string> {
  const taken = new Set(phases.flatMap((phase) => phase.color ?? []))
  return new Map(
    phases.map((phase, idx) => {
      const named = named_phase_color(phase_label(phase))
      const color =
        phase.color ?? (named && !taken.has(named) ? named : null) ?? plot_color(idx)
      taken.add(color)
      return [phase.id, color]
    }),
  )
}

const is_vec2 = (value: unknown): value is Vec2 =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
const is_sigma = (value: number) => Number.isFinite(value) && value >= 0
// One error per repeated id
const duplicate_ids = (kind: string, items: readonly { id: string }[]): string[] =>
  items.flatMap((item, idx) =>
    items.findIndex((other) => other.id === item.id) < idx
      ? [`duplicate ${kind} id '${item.id}'`]
      : [],
  )

const SPECIAL_POINT_TYPES: readonly PtSpecialPointType[] = [`triple`, `critical`, `custom`]

const is_object = (value: unknown): value is Record<string, unknown> =>
  typeof value === `object` && value !== null && !Array.isArray(value)

// Python's None arrives as null: drop null-valued object keys (recursively, not array
// entries) so null means "not set" everywhere, like an omitted key
const drop_nulls = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(drop_nulls)
  if (!is_object(value)) return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      entry === null ? [] : [[key, drop_nulls(entry)]],
    ),
  )
}

// Field kinds the shape check knows, with the name its errors use
const KINDS = {
  string: [(value: unknown) => typeof value === `string`, `a string`],
  array: [Array.isArray, `an array`],
  boolean: [(value: unknown) => typeof value === `boolean`, `a boolean`],
  object: [is_object, `an object`],
  number: [Number.isFinite, `a finite number`],
} as const satisfies Record<string, readonly [(value: unknown) => boolean, string]>
type Kind = keyof typeof KINDS
// One error per key of `obj` not in `fields` and per field set to the wrong kind, named
// `${owner}${field}`
const field_errors = (
  obj: Record<string, unknown>,
  fields: Readonly<Record<string, Kind>>,
  owner: string,
): string[] => [
  ...Object.keys(obj).flatMap((key) =>
    Object.hasOwn(fields, key) ? [] : [`${owner}${key} is not a known field`],
  ),
  ...Object.entries(fields).flatMap(([field, kind]) => {
    const [is_kind, name] = KINDS[kind]
    return obj[field] === undefined || is_kind(obj[field])
      ? []
      : [`${owner}${field} must be ${name}`]
  }),
]

// Every field by list, with its kind: an unknown key is likely a typo of an optional one, and
// a wrong kind would throw in the detailed checks (sigma.length, phases.forEach) or render as
// nonsense (a truthy `metastable: "no"`)
const LISTS = {
  phases: [`phase`, { id: `string`, name: `string`, color: `string`, description: `string` }],
  boundaries: [
    `boundary`,
    {
      id: `string`,
      phases: `array`,
      points: `array`,
      sigma_t: `array`,
      sigma_p: `array`,
      label: `string`,
      metastable: `boolean`,
      style: `object`,
    },
  ],
  regions: [`region`, { phase: `string`, vertices: `array`, label_position: `array` }],
  special_points: [
    `special point`,
    {
      id: `string`,
      type: `string`,
      position: `array`,
      phases: `array`,
      sigma_t: `number`,
      sigma_p: `number`,
      label: `string`,
    },
  ],
} as const satisfies Record<string, readonly [string, Record<string, Kind>]>
const TOP_FIELDS = {
  ...Object.fromEntries(Object.keys(LISTS).map((key) => [key, `array`])),
  pressure_range: `array`,
  temperature_range: `array`,
  pressure_unit: `string`,
  temperature_unit: `string`,
  system: `string`,
  title: `string`,
} as const satisfies Record<string, Kind>
const STYLE_FIELDS = { color: `string`, width: `number`, dash: `string` } as const

// Shape problems (unknown keys, wrong container types, non-object entries, missing ids,
// mistyped fields) that would make the detailed checks throw or the diagram render garbage
function shape_errors(data: unknown): string[] {
  if (!is_object(data)) return [`data must be an object`]
  const errors = field_errors(data, TOP_FIELDS, ``)
  for (const [key, [owner, fields]] of Object.entries(LISTS)) {
    const list = data[key]
    if (list === undefined && (key === `regions` || key === `special_points`)) continue
    if (!Array.isArray(list)) {
      if (list === undefined) errors.push(`${key} must be an array`)
      continue
    }
    list.forEach((entry, idx) => {
      if (!is_object(entry)) errors.push(`${key}[${idx}] must be an object`)
      else if (key !== `regions` && !(typeof entry.id === `string` && entry.id)) {
        errors.push(`${key}[${idx}] needs a non-empty string id`)
      } else {
        const name = key === `regions` ? `region ${idx} ` : `${owner} '${entry.id}' `
        errors.push(...field_errors(entry, fields, name))
        if (is_object(entry.style)) {
          errors.push(...field_errors(entry.style, STYLE_FIELDS, `${name}style.`))
        }
      }
    })
  }
  return errors
}

// Normalized data (null keys dropped) and every problem in it; data is null unless it
// renders as given. Checks shapes, ids, phase references, point and sigma arrays, ranges and
// units, so a malformed diagram fails loudly instead of drawing shifted error bars or
// silently dropping a region.
export function parse_pt_data(input: unknown): {
  data: PtPhaseDiagramData | null
  errors: string[]
} {
  const normalized = drop_nulls(input)
  const shape = shape_errors(normalized)
  const errors = shape.length ? shape : detail_errors(normalized as PtPhaseDiagramData)
  return { data: errors.length ? null : (normalized as PtPhaseDiagramData), errors }
}

function detail_errors(data: PtPhaseDiagramData): string[] {
  const { phases, boundaries, regions = [], special_points = [] } = data
  if (phases.length === 0) return [`phases must be non-empty`]
  const errors = [
    ...duplicate_ids(`phase`, phases),
    ...duplicate_ids(`boundary`, boundaries),
    ...duplicate_ids(`special point`, special_points),
  ]
  const phase_ids = new Set(phases.map((phase) => phase.id))
  const check_phase = (id: string, owner: string) => {
    if (!phase_ids.has(id)) errors.push(`${owner} references unknown phase '${id}'`)
  }

  for (const { id, phases: pair, points, sigma_t, sigma_p } of boundaries) {
    const owner = `boundary '${id}'`
    if (!Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1]) {
      errors.push(`${owner} needs two distinct phases, got ${JSON.stringify(pair)}`)
    } else pair.forEach((phase_id) => check_phase(phase_id, owner))
    if (!Array.isArray(points) || points.length < 2) {
      errors.push(`${owner} needs at least 2 points`)
      continue
    }
    const bad_idx = points.findIndex((point) => !is_vec2(point))
    if (bad_idx !== -1) {
      errors.push(`${owner} point ${bad_idx} is not a finite [P, T] pair`)
    }
    for (const [key, sigmas] of [
      [`sigma_t`, sigma_t],
      [`sigma_p`, sigma_p],
    ] as const) {
      if (sigmas === undefined) continue
      if (sigmas.length !== points.length) {
        errors.push(`${owner} ${key} has ${sigmas.length} entries for ${points.length} points`)
      } else if (!sigmas.every(is_sigma)) {
        errors.push(`${owner} ${key} must be finite and non-negative`)
      }
    }
  }

  regions.forEach((region, idx) => {
    const owner = `region ${idx} (${region.phase})`
    check_phase(region.phase, owner)
    if (!Array.isArray(region.vertices) || region.vertices.length < 3) {
      errors.push(`${owner} needs at least 3 vertices`)
    } else if (!region.vertices.every(is_vec2)) {
      errors.push(`${owner} has a non-finite vertex`)
    }
    if (region.label_position !== undefined && !is_vec2(region.label_position)) {
      errors.push(`${owner} label_position is not a finite [P, T] pair`)
    }
  })

  for (const point of special_points) {
    const owner = `special point '${point.id}'`
    if (!SPECIAL_POINT_TYPES.includes(point.type)) {
      errors.push(
        `${owner} has unknown type '${point.type}' (${SPECIAL_POINT_TYPES.join(`, `)})`,
      )
    }
    if (!is_vec2(point.position)) errors.push(`${owner} position is not a finite [P, T] pair`)
    if (point.type === `critical` && critical_boundaries(point, boundaries).length !== 1) {
      errors.push(`${owner} phases must be the two phases of exactly one boundary`)
    }
    point.phases?.forEach((phase_id) => check_phase(phase_id, owner))
    if (
      ![point.sigma_t, point.sigma_p].every((sigma) => sigma === undefined || is_sigma(sigma))
    ) {
      errors.push(`${owner} sigma must be finite and non-negative`)
    }
  }

  for (const key of [`pressure_range`, `temperature_range`] as const) {
    const range = data[key]
    if (range !== undefined && !(is_vec2(range) && range[0] < range[1])) {
      errors.push(`${key} must be [min, max] with min < max, got ${JSON.stringify(range)}`)
    }
  }
  if (data.pressure_unit !== undefined && !Object.hasOwn(PRESSURE_UNITS, data.pressure_unit)) {
    errors.push(`unknown pressure_unit '${data.pressure_unit}'`)
  }
  if (data.temperature_unit !== undefined && !TEMP_UNITS.includes(data.temperature_unit)) {
    errors.push(`unknown temperature_unit '${data.temperature_unit}'`)
  }
  return errors
}

// Boundaries between a critical point's two phases: the line that ends there (a valid diagram
// has exactly one)
export const critical_boundaries = (
  { phases: ids }: PtSpecialPoint,
  boundaries: readonly PtBoundary[],
): PtBoundary[] =>
  ids?.length === 2
    ? boundaries.filter(({ phases }) => phases.every((id) => ids.includes(id)))
    : []

// Every [P, T] the diagram draws: boundary points, special points and region vertices
const all_points = (data: PtPhaseDiagramData): Vec2[] => [
  ...data.boundaries.flatMap((boundary) => boundary.points),
  ...(data.special_points ?? []).map((point) => point.position),
  ...(data.regions ?? []).flatMap((region) => region.vertices),
]

// [[p_min, p_max], [t_min, t_max]] in data units: the declared ranges, else the extent of
// all_points (widened by 1 when it has zero span)
export function pt_data_extent(data: PtPhaseDiagramData): [Vec2, Vec2] {
  const points = all_points(data)
  const extent = (axis: 0 | 1): Vec2 => {
    const [lo, hi] = array_extent(points.map((point) => point[axis]))
    if (lo < hi) return [lo, hi]
    return Number.isFinite(lo) ? [lo - 1, hi + 1] : [0, 1]
  }
  return [data.pressure_range ?? extent(0), data.temperature_range ?? extent(1)]
}

// Lowest pressure a log axis shows: a positive declared lower bound, else the smallest
// positive pressure in the data. null when there is none below the window's upper pressure
// (a log axis can't show the data).
export function pressure_log_floor(data: PtPhaseDiagramData): number | null {
  const declared = data.pressure_range?.[0]
  const [floor] =
    declared !== undefined && declared > 0
      ? [declared]
      : array_extent(
          all_points(data).flatMap(([pressure]) => (pressure > 0 ? [pressure] : [])),
        )
  return floor < pt_data_extent(data)[0][1] ? floor : null
}
