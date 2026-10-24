// Sweeps for ElectronicStructure: a material's electronic structure along one axis (pressure,
// strain, doping), in one or more series (phases, lineages), each an ascending list of frames.
// Frames hold the light data up front and may get their heavy data (band grids, spectra) from
// the sweep's loader on demand. Descriptors are per-frame scalars plotted against the axis: a frame's
// supplied value wins, built-in ones are computed from its data when it supplies none.
import { is_elem_symbol } from '#lib/element/helpers.js'
import type { ElementSymbol } from '#lib/element/types.js'
import { normalize_band_grid, normalize_fermi_surface } from '#lib/fermi-surface/parse.js'
import type { BandGridData, FermiSurfaceData } from '#lib/fermi-surface/types.js'
import { add, create_lattice_converters, det_3x3, pbc_dist, scale } from '#lib/math.js'
import type { LatticeConverters } from '#lib/math.js'
import type { Crystal, Pbc } from '#lib/structure/index.js'
import { is_structure_like, structure_from_json } from '#lib/structure/parse.js'
import { is_crystal } from '#lib/structure/validation.js'
import { is_plain_object, JSON_KINDS } from '#lib/utils.js'
import { to_error } from 'svelte-widgets/utils'
import { normalize_band_structure, normalize_dos } from './helpers'
import type {
  BaseBandStructure,
  DosData,
  PhononDos,
  PhononSpectra,
  SpectraRecords,
} from './types'

export interface SweepAxis {
  key: string // e.g. `pressure`
  label: string // e.g. `Pressure`
  unit?: string // e.g. `GPa`
}

export interface SweepFrame {
  value: number // position on the axis, strictly ascending within a series
  label?: string // shown instead of value + unit, e.g. `150 GPa (relaxed at 151.3)`
  structure?: Crystal
  band_data?: BandGridData // parsed: normalize_sweep and loads parse the JSON forms
  fermi_data?: FermiSurfaceData
  band_structs?: Record<string, BaseBandStructure>
  // `total` (or a single entry) is the total DOS; element symbols key element projections
  doses?: Record<string, DosData>
  phonon?: PhononSpectra // phonon bands, DOS and α²F
  scalars?: Record<string, number | null> // supplied descriptor values, null: known missing
  status?: { unstable?: boolean; note?: string } // unstable frames are greyed in the plot
}

export interface SweepSeries {
  id: string
  label?: string
  frames: SweepFrame[]
}

// Computed from a frame's data when its scalars hold no value for the descriptor's key:
// volume_per_atom (Å³), min_pair_distance (Å, between the `pair`'s elements when set),
// fermi_dos (states/eV per cell, both spins, at the total DOS's E_F), fermi_dos_share
// (`element`'s fraction of fermi_dos) and fermi_band_count (bands of the band grid, or sheets
// of a meshed surface, crossing E_F)
export const COMPUTED_DESCRIPTORS = [
  `volume_per_atom`,
  `min_pair_distance`,
  `fermi_dos`,
  `fermi_dos_share`,
  `fermi_band_count`,
] as const
export type ComputedDescriptor = (typeof COMPUTED_DESCRIPTORS)[number]

export interface DescriptorSpec {
  key: string // a key of frames' scalars
  label: string
  unit?: string
  compute?: ComputedDescriptor // fills frames that supply no value
  pair?: [ElementSymbol, ElementSymbol] // min_pair_distance only
  element?: ElementSymbol // fermi_dos_share only (required there)
  range?: [string, string] // scalar keys of a lower and upper bound, drawn as error bars
  threshold?: number // drawn as a horizontal line, e.g. a stability limit
  // keys of descriptors in the same unit drawn as extra lines on this one's plot, e.g.
  // Migdal–Eliashberg Tc over an Allen–Dynes Tc band
  overlay?: string[]
}

// A frame's fields besides its value: what a loader returns
export type SweepFrameData = Omit<SweepFrame, `value`>

// Fetches a frame's heavy data (0-based index into its series) when it is first shown. The
// result is parsed like a JSON frame (failing on a wrong field) and merged over the frame's own
// fields, records (scalars, status, doses, band_structs, phonon's) key by key.
export type SweepFrameLoader = (series_id: string, frame_idx: number) => Promise<unknown>

export interface Sweep {
  axis: SweepAxis
  series: SweepSeries[]
  descriptors?: DescriptorSpec[]
  load_frame?: SweepFrameLoader // never in JSON: a parsed sweep carries all its data
}

// Throws on what the viewer cannot show unambiguously, naming the offending entry
export function validate_sweep(sweep: Sweep): void {
  if (!sweep.axis?.key || !sweep.axis.label) {
    throw new Error(`Sweep axis needs a key and a label, got ${JSON.stringify(sweep.axis)}`)
  }
  if (!sweep.series?.length) throw new Error(`Sweep needs at least one series`)
  const series_ids = new Set<string>()
  for (const { id, frames } of sweep.series) {
    if (series_ids.has(id)) throw new Error(`Sweep series id "${id}" is not unique`)
    series_ids.add(id)
    if (!frames.length) throw new Error(`Sweep series "${id}" has no frames`)
    for (const [idx, { value }] of frames.entries()) {
      if (!Number.isFinite(value)) {
        throw new RangeError(
          `Sweep series "${id}" frame ${idx} has a non-finite value ${value}`,
        )
      }
      if (idx > 0 && !(value > frames[idx - 1].value)) {
        throw new Error(
          `Sweep series "${id}" values must be strictly ascending: frame ${idx} has ${value} after ${frames[idx - 1].value}`,
        )
      }
    }
  }
  const descriptors = sweep.descriptors ?? []
  // the map keeps a key's last spec, so an earlier one with the same key finds another
  const by_key = new Map(descriptors.map((spec) => [spec.key, spec]))
  for (const spec of descriptors) {
    if (by_key.get(spec.key) !== spec) {
      throw new Error(`Sweep descriptor key "${spec.key}" is not unique`)
    }
    if ((spec.compute === `fermi_dos_share`) !== Boolean(spec.element)) {
      throw new Error(
        `Descriptor "${spec.key}": element goes with (and only with) fermi_dos_share`,
      )
    }
    if (spec.pair && spec.compute !== `min_pair_distance`) {
      throw new Error(`Descriptor "${spec.key}": pair goes only with min_pair_distance`)
    }
    if (spec.overlay && new Set(spec.overlay).size !== spec.overlay.length) {
      throw new Error(`Descriptor "${spec.key}" overlays a descriptor twice: ${spec.overlay}`)
    }
    for (const key of spec.overlay ?? []) {
      const other = by_key.get(key)
      if (!other || key === spec.key) {
        throw new Error(`Descriptor "${spec.key}" overlays "${key}", no other descriptor`)
      }
      if (other.unit !== spec.unit) {
        throw new Error(
          `Descriptor "${spec.key}" (${spec.unit ?? `no unit`}) overlays "${key}" in ${other.unit ?? `no unit`}: overlays share their unit`,
        )
      }
    }
  }
}

export const format_axis_value = (axis: SweepAxis, frame: SweepFrame): string =>
  frame.label ?? `${frame.value}${axis.unit ? ` ${axis.unit}` : ``}`

// === computed descriptors ===
export const volume_per_atom = (structure: Crystal): number =>
  Math.abs(det_3x3(structure.lattice.matrix)) / structure.sites.length

// Shortest non-zero periodic translation, the distance of a site to its own image (Infinity
// without periodic axes). Searched in the Gauss-reduced periodic basis the minimum-image code
// uses, where the shortest vector has coefficients in [-1, 1] (±2 is margin), however sheared
// the input cell: [[3,0,0],[9.5,0.5,0],[0,0,10]] reaches 0.707 Å = |b − 3a| this way.
const shortest_translation = (converters: LatticeConverters, pbc: Pbc): number => {
  const [vec_a, vec_b, vec_c] = converters.search_basis(pbc).lattice
  const shifts = (axis: number) => (pbc[axis] ? [-2, -1, 0, 1, 2] : [0])
  const lengths = shifts(0).flatMap((n_a) =>
    shifts(1).flatMap((n_b) =>
      shifts(2).map((n_c) =>
        Math.hypot(...add(scale(vec_a, n_a), scale(vec_b, n_b), scale(vec_c, n_c))),
      ),
    ),
  )
  return Math.min(...lengths.filter((length) => length > 0))
}

// Shortest distance between two sites (or a site and its own image) under the lattice's
// periodic boundary conditions, between the pair's elements when set (e.g. [`H`, `H`]);
// undefined when the structure has no such pair
export function min_pair_distance(
  structure: Crystal,
  pair?: [ElementSymbol, ElementSymbol],
): number | undefined {
  const [elem_a, elem_b] = pair ?? []
  const matches = (site: Crystal[`sites`][number], element?: string) =>
    element === undefined || site.species[0]?.element === element
  const { sites, lattice } = structure
  const converters = create_lattice_converters(lattice.matrix)
  const self_image = shortest_translation(converters, lattice.pbc)
  let shortest = Infinity
  for (const [idx_a, site_a] of sites.entries()) {
    for (let idx_b = idx_a; idx_b < sites.length; idx_b++) {
      const site_b = sites[idx_b]
      const is_pair =
        (matches(site_a, elem_a) && matches(site_b, elem_b)) ||
        (matches(site_a, elem_b) && matches(site_b, elem_a))
      if (!is_pair) continue
      const dist =
        idx_a === idx_b
          ? self_image
          : pbc_dist(site_a.xyz, site_b.xyz, lattice.matrix, converters, lattice.pbc)
      shortest = Math.min(shortest, dist)
    }
  }
  return Number.isFinite(shortest) ? shortest : undefined
}

// Linear interpolation of an electronic DOS (both spins) at `energy`; undefined outside its
// energy range or for a phonon DOS
export function dos_at_energy(dos: DosData, energy: number): number | undefined {
  if (dos.type !== `electronic`) return undefined
  const { energies, densities, spin_down_densities } = dos
  const total = (idx: number) => densities[idx] + Math.abs(spin_down_densities?.[idx] ?? 0)
  if (!(energy >= energies[0] && energy <= energies[energies.length - 1])) return undefined
  const upper = energies.findIndex((value) => value >= energy)
  if (energies[upper] === energy || upper === 0) return total(upper)
  const frac = (energy - energies[upper - 1]) / (energies[upper] - energies[upper - 1])
  return total(upper - 1) + frac * (total(upper) - total(upper - 1))
}

// The frame's E_F: the band grid's, else its DOS's or band structure's
export function frame_fermi_energy(frame: Partial<SweepFrame>): number | undefined {
  const { band_data, fermi_data, doses = {}, band_structs = {} } = frame
  const levels = [...Object.values(doses), ...Object.values(band_structs)].map((spectrum) =>
    spectrum.type === `electronic` ? spectrum.efermi : undefined,
  )
  return (
    band_data?.fermi_energy ??
    fermi_data?.fermi_energy ??
    levels.find((level) => level !== undefined)
  )
}

// `total`, else a lone DOS that is no element projection
const total_dos = (doses: Record<string, DosData>): DosData | undefined => {
  if (doses.total) return doses.total
  const entries = Object.entries(doses)
  const [lone] = entries.length === 1 ? entries : []
  return lone && !is_elem_symbol(lone[0]) ? lone[1] : undefined
}

// Bands of the grid whose energies span E_F, per spin channel; for a meshed surface (always at
// E_F) its distinct sheets
export function fermi_band_count(frame: Partial<SweepFrame>): number | undefined {
  const grid = frame.band_data
  if (grid) {
    const { energies, fermi_energy } = grid
    return energies
      .flat()
      .filter(
        ({ values }) =>
          values.some((energy) => energy < fermi_energy) &&
          values.some((energy) => energy > fermi_energy),
      ).length
  }
  if (frame.fermi_data) {
    const { isosurfaces } = frame.fermi_data
    const sheets = isosurfaces.map(({ band_index, spin }) => `${band_index}:${spin}`)
    return new Set(sheets).size
  }
  return undefined
}

export function compute_descriptor(
  frame: Partial<SweepFrame>,
  spec: DescriptorSpec,
): number | undefined {
  const { structure, doses } = frame
  if (spec.compute === `volume_per_atom`) return structure && volume_per_atom(structure)
  if (spec.compute === `min_pair_distance`) {
    return structure && min_pair_distance(structure, spec.pair)
  }
  if (spec.compute === `fermi_band_count`) return fermi_band_count(frame)
  const total = doses && total_dos(doses)
  // the DOS's own E_F: a denser-k DOS is not evaluated at a coarse grid's
  const fermi_energy =
    total?.type === `electronic` ? (total.efermi ?? frame_fermi_energy(frame)) : undefined
  if (!total || fermi_energy === undefined) return undefined
  const at_fermi = dos_at_energy(total, fermi_energy)
  if (spec.compute === `fermi_dos`) return at_fermi
  if (spec.compute === `fermi_dos_share`) {
    const projected = spec.element && doses?.[spec.element]
    const share = projected && dos_at_energy(projected, fermi_energy)
    return share !== undefined && at_fermi ? share / at_fermi : undefined
  }
  return undefined
}

// The frame's value of a descriptor: its supplied scalar, else the computed one; null when the
// frame says it has none, undefined when neither is available (e.g. data not loaded yet)
export function descriptor_value(
  frame: Partial<SweepFrame>,
  spec: DescriptorSpec,
): number | null | undefined {
  const supplied = frame.scalars?.[spec.key]
  if (supplied === null) return null
  if (supplied !== undefined) return supplied
  return spec.compute ? compute_descriptor(frame, spec) : undefined
}

// The frame's point on a descriptor's line: its value and range bounds (null: none), or null
// without a value. Throws on a non-finite value or bounds that do not bracket it.
export function descriptor_point(
  frame: SweepFrame,
  spec: DescriptorSpec,
): { value: number; lower: number | null; upper: number | null } | null {
  const value = descriptor_value(frame, spec)
  if (value == null) return null
  const where = `Descriptor "${spec.key}" at ${frame.value}`
  if (!Number.isFinite(value)) throw new RangeError(`${where} has a non-finite value ${value}`)
  const [lower = null, upper = null] = (spec.range ?? []).map((key) => frame.scalars?.[key])
  for (const bound of [lower, upper]) {
    if (bound !== null && !Number.isFinite(bound)) {
      throw new RangeError(`${where} has a non-finite range bound ${bound}`)
    }
  }
  if ((lower !== null && lower > value) || (upper !== null && upper < value)) {
    throw new RangeError(`${where}: range [${lower}, ${upper}] does not bracket ${value}`)
  }
  return { value, lower, upper }
}

// === JSON input (dropped files, notebook widgets) and loaded frame data ===
const fail = (path: string, problem: string): never => {
  throw new Error(`Invalid sweep at ${path}: ${problem}`)
}

// A field's test and what it must be, for the error
type FieldCheck = readonly [is_valid: (value: unknown) => boolean, expected: string]
type FieldChecks<T> = { [key in keyof T]-?: FieldCheck }
const is_string = (value: unknown): value is string => typeof value === `string`
const is_symbol = (value: unknown): boolean => is_string(value) && is_elem_symbol(value)
const is_pair_of =
  (is_item: (item: unknown) => boolean) =>
  (value: unknown): boolean =>
    Array.isArray(value) && value.length === 2 && value.every(is_item)
const { string: STRING, object: OBJECT, array: ARRAY } = JSON_KINDS

// raw as a T: an object of only T's fields (failing on others, e.g. a typo like `units` for
// `unit`), each absent (unless required) or passing its check
function parse_fields<T extends object>(
  raw: unknown,
  path: string,
  checks: FieldChecks<T>,
  required: (keyof T)[] = [],
): T {
  if (!is_plain_object(raw)) return fail(path, `must be an object`)
  const unknown_key = Object.keys(raw).find((key) => !Object.hasOwn(checks, key))
  if (unknown_key !== undefined) fail(`${path}.${unknown_key}`, `unknown field`)
  for (const [key, [is_valid, expected]] of Object.entries<FieldCheck>(checks)) {
    const value = raw[key]
    if (value === undefined ? required.some((name) => name === key) : !is_valid(value)) {
      fail(`${path}.${key}`, `must be ${expected}, got ${JSON.stringify(value)?.slice(0, 80)}`)
    }
  }
  return raw as T
}

type RawRecords<Keys extends PropertyKey> = Partial<Record<Keys, Record<string, unknown>>>
type RawFrameData = { label?: string } & RawRecords<Exclude<keyof SweepFrameData, `label`>>
// oxfmt-ignore
const FRAME_FIELDS: FieldChecks<RawFrameData> = {
  label: STRING, structure: OBJECT, band_data: OBJECT, fermi_data: OBJECT, band_structs: OBJECT,
  doses: OBJECT, phonon: OBJECT, scalars: OBJECT, status: OBJECT,
}

// A record whose entries (under `path`) parse to data of `type`
function typed_record<Value extends { type: string }, Typed extends Value = Value>(
  data: Record<string, unknown> | undefined,
  path: string,
  normalize: (item: unknown) => Value | null,
  type: Typed[`type`],
): Record<string, Typed> | undefined {
  if (!data) return undefined
  const is_typed = (parsed: Value): parsed is Typed => parsed.type === type
  return Object.fromEntries(
    Object.entries(data).map(([name, item]) => {
      const parsed = normalize(item) ?? fail(`${path}.${name}`, `unrecognized data`)
      if (is_typed(parsed)) return [name, parsed]
      return fail(`${path}.${name}`, `must be ${type} data, got ${parsed.type}`)
    }),
  )
}

// Band structures and DOS all of `type`: plotted in the other's panes, energies would read as
// frequencies or the reverse
function normalize_spectra(
  raw: RawRecords<keyof SpectraRecords>,
  path: string,
  type: `electronic` | `phonon`,
): SpectraRecords {
  const band_structs = typed_record(
    raw.band_structs,
    `${path}.band_structs`,
    normalize_band_structure,
    type,
  )
  const doses = typed_record(raw.doses, `${path}.doses`, normalize_dos, type)
  return { ...(band_structs && { band_structs }), ...(doses && { doses }) }
}

// A frame's fields besides its value (a loader's result, or a JSON frame's rest), parsed like
// single files: throws naming the field (under `path`) that is wrong or unknown
export function normalize_frame_data(raw: unknown, path: string): SweepFrameData {
  const { label, structure, band_data, fermi_data, phonon, scalars, status, ...spectra } =
    parse_fields(raw, path, FRAME_FIELDS)
  const frame: SweepFrameData = {
    ...(label !== undefined && { label }),
    ...normalize_spectra(spectra, path, `electronic`),
  }
  if (structure) {
    const parsed = is_structure_like(structure) ? structure_from_json(structure) : undefined
    if (!is_crystal(parsed)) return fail(`${path}.structure`, `needs a periodic structure`)
    frame.structure = parsed
  }
  // the grid and surface parsers name the field that is wrong; prefix where in the sweep
  const parse = <Value>(key: string, normalize: () => Value): Value => {
    try {
      return normalize()
    } catch (error) {
      return fail(`${path}.${key}`, to_error(error).message)
    }
  }
  if (band_data) frame.band_data = parse(`band_data`, () => normalize_band_grid(band_data))
  if (fermi_data) {
    frame.fermi_data = parse(`fermi_data`, () => normalize_fermi_surface(fermi_data))
  }
  if (phonon) {
    const phonon_path = `${path}.phonon`
    const { a2f, ...phonon_spectra } = parse_fields<RawRecords<keyof PhononSpectra>>(
      phonon,
      phonon_path,
      { band_structs: OBJECT, doses: OBJECT, a2f: OBJECT },
    )
    const a2f_doses = typed_record<DosData, PhononDos>(
      a2f,
      `${phonon_path}.a2f`,
      normalize_dos,
      `phonon`,
    )
    frame.phonon = {
      ...normalize_spectra(phonon_spectra, phonon_path, `phonon`),
      ...(a2f_doses && { a2f: a2f_doses }),
    }
  }
  if (scalars) {
    frame.scalars = Object.fromEntries(
      Object.entries(scalars).map(([key, scalar]) =>
        scalar === null || typeof scalar === `number`
          ? [key, scalar]
          : fail(`${path}.scalars.${key}`, `must be a number or null`),
      ),
    )
  }
  if (status) {
    frame.status = parse_fields<NonNullable<SweepFrame[`status`]>>(status, `${path}.status`, {
      unstable: JSON_KINDS.boolean,
      note: STRING,
    })
  }
  return frame
}

function normalize_frame(raw: unknown, path: string): SweepFrame {
  if (!is_plain_object(raw)) return fail(path, `frame must be an object`)
  const { value, ...data } = raw
  if (typeof value !== `number`) return fail(path, `value must be a number`)
  return { value, ...normalize_frame_data(data, path) }
}

const DESCRIPTOR_FIELDS: FieldChecks<DescriptorSpec> = {
  key: STRING,
  label: STRING,
  unit: STRING,
  compute: [
    (value) => COMPUTED_DESCRIPTORS.some((name) => name === value),
    `one of ${COMPUTED_DESCRIPTORS.join(`, `)}`,
  ],
  pair: [is_pair_of(is_symbol), `two element symbols`],
  element: [is_symbol, `an element symbol`],
  range: [is_pair_of(is_string), `two scalar keys`],
  threshold: JSON_KINDS.number,
  overlay: [(value) => Array.isArray(value) && value.every(is_string), `descriptor keys`],
}

// Whether parsed JSON looks like a sweep (an axis and a series list), so a dropped JSON file
// is treated as one
export const is_sweep_like = (raw: unknown): boolean =>
  is_plain_object(raw) && is_plain_object(raw.axis) && Array.isArray(raw.series)

// A sweep from parsed JSON: structures, band grids, meshed surfaces, band structures and DOS
// in their JSON forms are normalized like single files. Throws naming the offending path.
export function normalize_sweep(raw: unknown): Sweep {
  const root = parse_fields<{ axis: unknown; series: unknown[]; descriptors?: unknown[] }>(
    raw,
    `root`,
    { axis: OBJECT, series: ARRAY, descriptors: ARRAY },
    [`axis`, `series`],
  )
  const sweep: Sweep = {
    axis: parse_fields<SweepAxis>(
      root.axis,
      `axis`,
      { key: STRING, label: STRING, unit: STRING },
      [`key`, `label`],
    ),
    series: root.series.map((entry, series_idx) => {
      const path = `series[${series_idx}]`
      const { frames, ...rest } = parse_fields<{
        id: string
        label?: string
        frames: unknown[]
      }>(entry, path, { id: STRING, label: STRING, frames: ARRAY }, [`id`, `frames`])
      const parsed = frames.map((frame, idx) =>
        normalize_frame(frame, `${path}.frames[${idx}]`),
      )
      return { ...rest, frames: parsed }
    }),
  }
  if (root.descriptors) {
    sweep.descriptors = root.descriptors.map((spec, idx) =>
      parse_fields(spec, `descriptors[${idx}]`, DESCRIPTOR_FIELDS, [`key`, `label`]),
    )
  }
  validate_sweep(sweep)
  return sweep
}
