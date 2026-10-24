// Sweeps for ElectronicStructure: a material's electronic structure along one axis (pressure,
// strain, doping), in one or more series (phases, lineages), each an ascending list of frames.
// Frames hold the light data up front and may get their heavy data (band grids, spectra) from
// the sweep's loader on demand. Descriptors are per-frame scalars plotted against the axis: a frame's
// supplied value wins, built-in ones are computed from its data when it supplies none.
import { is_elem_symbol } from '#lib/element/helpers.js'
import type { ElementSymbol } from '#lib/element/types.js'
import { normalize_band_grid, normalize_fermi_surface } from '#lib/fermi-surface/parse.js'
import type { BandGridData, FermiSurfaceData } from '#lib/fermi-surface/types.js'
import { create_lattice_converters, det_3x3, pbc_dist } from '#lib/math.js'
import type { LatticeConverters } from '#lib/math.js'
import type { Crystal, Pbc } from '#lib/structure/index.js'
import { is_structure_like, structure_from_json } from '#lib/structure/parse.js'
import { is_crystal } from '#lib/structure/validation.js'
import { is_plain_object } from '#lib/utils.js'
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
  const basis = converters.search_basis(pbc).lattice
  const shifts = (axis: number) => (pbc[axis] ? [-2, -1, 0, 1, 2] : [0])
  let shortest = Infinity
  for (const n_a of shifts(0)) {
    for (const n_b of shifts(1)) {
      for (const n_c of shifts(2)) {
        if (n_a === 0 && n_b === 0 && n_c === 0) continue
        const shift = [0, 1, 2].map(
          (axis) => n_a * basis[0][axis] + n_b * basis[1][axis] + n_c * basis[2][axis],
        )
        shortest = Math.min(shortest, Math.hypot(...shift))
      }
    }
  }
  return shortest
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
    let count = 0
    for (const spin of grid.energies) {
      for (const { values } of spin) {
        let [lowest, highest] = [Infinity, -Infinity]
        for (const energy of values) {
          if (energy < lowest) lowest = energy
          if (energy > highest) highest = energy
        }
        if (lowest < grid.fermi_energy && highest > grid.fermi_energy) count++
      }
    }
    return count
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

// Fails on a field the sweep format has no use for, e.g. a typo like `units` for `unit`
const reject_unknown = (
  raw: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void => {
  const unknown_key = Object.keys(raw).find((key) => !allowed.includes(key))
  if (unknown_key !== undefined) fail(`${path}.${unknown_key}`, `unknown field`)
}
// an optional string field: absent, or a string
const optional_string = (value: unknown, path: string): string | undefined =>
  value === undefined || typeof value === `string`
    ? value
    : fail(path, `must be a string, got ${JSON.stringify(value)}`)

const FRAME_DATA_KEYS = [
  `label`,
  `structure`,
  `band_data`,
  `fermi_data`,
  `band_structs`,
  `doses`,
  `phonon`,
  `scalars`,
  `status`,
] as const satisfies (keyof SweepFrameData)[]

// an optional object field: absent, or a plain object
const object_field = (
  raw: Record<string, unknown>,
  key: string,
  path: string,
): Record<string, unknown> | undefined => {
  const data = raw[key]
  return data === undefined || is_plain_object(data)
    ? data
    : fail(`${path}.${key}`, `must be an object`)
}

// A record of band structures and one of DOS, all of `type`: plotted in the other's panes,
// energies would read as frequencies or the reverse
function normalize_spectra(
  raw: Record<string, unknown>,
  path: string,
  type: `electronic` | `phonon`,
): SpectraRecords {
  const band_structs = typed_record(raw, `band_structs`, path, normalize_band_structure, type)
  const doses = typed_record(raw, `doses`, path, normalize_dos, type)
  return { ...(band_structs && { band_structs }), ...(doses && { doses }) }
}

// A record field whose entries parse to data of `type`
function typed_record<Value extends { type: string }, Typed extends Value = Value>(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  normalize: (item: unknown) => Value | null,
  type: Typed[`type`],
): Record<string, Typed> | undefined {
  const data = object_field(raw, key, path)
  if (!data) return undefined
  const is_typed = (parsed: Value): parsed is Typed => parsed.type === type
  return Object.fromEntries(
    Object.entries(data).map(([name, item]) => {
      const item_path = `${path}.${key}.${name}`
      const parsed = normalize(item) ?? fail(item_path, `unrecognized data`)
      if (is_typed(parsed)) return [name, parsed]
      return fail(item_path, `must be ${type} data, got ${parsed.type}`)
    }),
  )
}

// A frame's fields besides its value (a loader's result, or a JSON frame's rest), parsed like
// single files: throws naming the field (under `path`) that is wrong or unknown
export function normalize_frame_data(raw: unknown, path: string): SweepFrameData {
  if (!is_plain_object(raw)) return fail(path, `must be an object`)
  reject_unknown(raw, FRAME_DATA_KEYS, path)
  const frame: SweepFrameData = normalize_spectra(raw, path, `electronic`)
  const label = optional_string(raw.label, `${path}.label`)
  if (label !== undefined) frame.label = label
  const { structure } = raw
  if (structure !== undefined) {
    const parsed = is_structure_like(structure) ? structure_from_json(structure) : undefined
    if (!is_crystal(parsed)) return fail(`${path}.structure`, `needs a periodic structure`)
    frame.structure = parsed
  }
  // the grid and surface parsers name the field that is wrong; prefix where in the sweep
  const parse = <Value>(
    key: string,
    normalize: (data: Record<string, unknown>) => Value,
  ): Value | undefined => {
    const data = object_field(raw, key, path)
    if (!data) return undefined
    try {
      return normalize(data)
    } catch (error) {
      return fail(`${path}.${key}`, error instanceof Error ? error.message : String(error))
    }
  }
  const band_data = parse(`band_data`, normalize_band_grid)
  if (band_data) frame.band_data = band_data
  const fermi_data = parse(`fermi_data`, normalize_fermi_surface)
  if (fermi_data) frame.fermi_data = fermi_data
  const phonon = object_field(raw, `phonon`, path)
  if (phonon) {
    const phonon_path = `${path}.phonon`
    reject_unknown(phonon, [`band_structs`, `doses`, `a2f`], phonon_path)
    const a2f = typed_record<DosData, PhononDos>(
      phonon,
      `a2f`,
      phonon_path,
      normalize_dos,
      `phonon`,
    )
    frame.phonon = { ...normalize_spectra(phonon, phonon_path, `phonon`), ...(a2f && { a2f }) }
  }
  const scalars = object_field(raw, `scalars`, path)
  if (scalars) {
    frame.scalars = Object.fromEntries(
      Object.entries(scalars).map(([key, scalar]) =>
        scalar === null || typeof scalar === `number`
          ? [key, scalar]
          : fail(`${path}.scalars.${key}`, `must be a number or null`),
      ),
    )
  }
  const status = object_field(raw, `status`, path)
  if (status) {
    reject_unknown(status, [`unstable`, `note`], `${path}.status`)
    const { unstable } = status
    if (unstable !== undefined && typeof unstable !== `boolean`) {
      return fail(`${path}.status.unstable`, `must be a boolean`)
    }
    const note = optional_string(status.note, `${path}.status.note`)
    frame.status = {
      ...(unstable !== undefined && { unstable }),
      ...(note !== undefined && { note }),
    }
  }
  return frame
}

function normalize_frame(raw: unknown, path: string): SweepFrame {
  if (!is_plain_object(raw)) return fail(path, `frame must be an object`)
  const { value, ...data } = raw
  if (typeof value !== `number`) return fail(path, `value must be a number`)
  return { value, ...normalize_frame_data(data, path) }
}

const DESCRIPTOR_KEYS = [
  `key`,
  `label`,
  `unit`,
  `compute`,
  `pair`,
  `element`,
  `range`,
  `threshold`,
  `overlay`,
] as const satisfies (keyof DescriptorSpec)[]
const is_computed = (name: unknown): name is ComputedDescriptor =>
  COMPUTED_DESCRIPTORS.some((computed) => computed === name)

function normalize_descriptor(raw: unknown, idx: number): DescriptorSpec {
  const path = `descriptors[${idx}]`
  if (!is_plain_object(raw)) return fail(path, `must be an object`)
  reject_unknown(raw, DESCRIPTOR_KEYS, path)
  const { key, label, compute, pair, element, range, threshold, overlay } = raw
  if (typeof key !== `string` || typeof label !== `string`) {
    return fail(path, `needs a key and a label`)
  }
  const unit = optional_string(raw.unit, `${path}.unit`)
  const strings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === `string`)
  const is_symbol = (value: unknown): value is ElementSymbol =>
    typeof value === `string` && is_elem_symbol(value)
  if (compute !== undefined && !is_computed(compute)) {
    return fail(`${path}.compute`, `unknown ${JSON.stringify(compute)}`)
  }
  const is_pair = (value: unknown): value is [ElementSymbol, ElementSymbol] =>
    Array.isArray(value) && value.length === 2 && value.every(is_symbol)
  if (pair !== undefined && !is_pair(pair)) {
    return fail(`${path}.pair`, `must be two element symbols, got ${JSON.stringify(pair)}`)
  }
  if (element !== undefined && !is_symbol(element)) {
    return fail(`${path}.element`, `must be an element symbol, got ${JSON.stringify(element)}`)
  }
  if (range !== undefined && !(strings(range) && range.length === 2)) {
    return fail(`${path}.range`, `must be two scalar keys`)
  }
  if (threshold !== undefined && typeof threshold !== `number`) {
    return fail(`${path}.threshold`, `must be a number`)
  }
  if (overlay !== undefined && !strings(overlay)) {
    return fail(`${path}.overlay`, `must be descriptor keys`)
  }
  return {
    key,
    label,
    ...(unit !== undefined && { unit }),
    ...(compute !== undefined && { compute }),
    ...(pair && { pair: [pair[0], pair[1]] }),
    ...(element !== undefined && { element }),
    ...(range && { range: [range[0], range[1]] }),
    ...(threshold !== undefined && { threshold }),
    ...(overlay && { overlay: [...overlay] }),
  }
}

// Whether parsed JSON looks like a sweep (an axis and a series list), so a dropped JSON file
// is treated as one
export const is_sweep_like = (raw: unknown): boolean =>
  is_plain_object(raw) && is_plain_object(raw.axis) && Array.isArray(raw.series)

// A sweep from parsed JSON: structures, band grids, meshed surfaces, band structures and DOS
// in their JSON forms are normalized like single files. Throws naming the offending path.
export function normalize_sweep(raw: unknown): Sweep {
  if (!is_plain_object(raw)) return fail(`root`, `must be an object`)
  reject_unknown(raw, [`axis`, `series`, `descriptors`], `root`)
  const { axis, series, descriptors } = raw
  if (!is_plain_object(axis)) return fail(`axis`, `must be an object`)
  reject_unknown(axis, [`key`, `label`, `unit`], `axis`)
  if (!Array.isArray(series)) return fail(`series`, `must be an array`)
  if (typeof axis.key !== `string` || typeof axis.label !== `string`) {
    return fail(`axis`, `needs a key and a label`)
  }
  const axis_unit = optional_string(axis.unit, `axis.unit`)
  const sweep: Sweep = {
    axis: {
      key: axis.key,
      label: axis.label,
      ...(axis_unit !== undefined && { unit: axis_unit }),
    },
    series: series.map((entry, series_idx) => {
      const path = `series[${series_idx}]`
      if (!is_plain_object(entry) || !Array.isArray(entry.frames)) {
        return fail(path, `needs an id and a frames array`)
      }
      reject_unknown(entry, [`id`, `label`, `frames`], path)
      return {
        id: typeof entry.id === `string` ? entry.id : fail(path, `needs a string id`),
        ...(entry.label !== undefined && {
          label: optional_string(entry.label, `${path}.label`),
        }),
        frames: entry.frames.map((frame, frame_idx) =>
          normalize_frame(frame, `${path}.frames[${frame_idx}]`),
        ),
      }
    }),
  }
  if (descriptors !== undefined) {
    if (!Array.isArray(descriptors)) return fail(`descriptors`, `must be an array`)
    sweep.descriptors = descriptors.map((spec, idx) => normalize_descriptor(spec, idx))
  }
  validate_sweep(sweep)
  return sweep
}
