// Sweeps for ElectronicStructure: a material's electronic structure along one axis (pressure,
// strain, doping), in one or more series (phases, lineages), each an ascending list of frames.
// Frames hold the light data up front and may get their heavy data (band grids, spectra) from
// a loader on demand. Descriptors are per-frame scalars plotted against the axis: a frame's
// supplied value wins, built-in ones are computed from its data when it supplies none.
import { is_elem_symbol } from '#lib/element/helpers.js'
import type { ElementSymbol } from '#lib/element/types.js'
import { normalize_band_grid, normalize_fermi_surface } from '#lib/fermi-surface/parse.js'
import type { BandGridJson, FermiSurfaceJson } from '#lib/fermi-surface/parse.js'
import type { BandGridData, FermiSurfaceData } from '#lib/fermi-surface/types.js'
import { create_lattice_converters, det_3x3, pbc_dist } from '#lib/math.js'
import type { LatticeConverters } from '#lib/math.js'
import type { Crystal, Pbc } from '#lib/structure/index.js'
import { is_structure_like, structure_from_json } from '#lib/structure/parse.js'
import { is_crystal } from '#lib/structure/validation.js'
import { is_plain_object } from '#lib/utils.js'
import { normalize_band_structure, normalize_dos } from './helpers'
import type { BaseBandStructure, DosData } from './types'

export interface SweepAxis {
  key: string // e.g. `pressure`
  label: string // e.g. `Pressure`
  unit?: string // e.g. `GPa`
}

export interface SweepFrame {
  value: number // position on the axis, strictly ascending within a series
  label?: string // shown instead of value + unit, e.g. `150 GPa (relaxed at 151.3)`
  structure?: Crystal
  band_data?: BandGridData | BandGridJson
  fermi_data?: FermiSurfaceData | FermiSurfaceJson
  band_structs?: Record<string, BaseBandStructure>
  // `total` (or a single entry) is the total DOS; element symbols key element projections
  doses?: Record<string, DosData>
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
}

export interface Sweep {
  axis: SweepAxis
  series: SweepSeries[]
  descriptors?: DescriptorSpec[]
}

// Heavy frame data fetched on demand (merged over the frame's own fields)
export type SweepFrameLoader = (
  series_id: string,
  frame_idx: number,
) => Promise<Partial<Omit<SweepFrame, `value`>>>

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
  const keys = new Set<string>()
  for (const spec of sweep.descriptors ?? []) {
    if (keys.has(spec.key)) throw new Error(`Sweep descriptor key "${spec.key}" is not unique`)
    keys.add(spec.key)
    const is_share = spec.compute === `fermi_dos_share`
    if (is_share !== Boolean(spec.element)) {
      throw new Error(
        `Descriptor "${spec.key}": element goes with (and only with) fermi_dos_share`,
      )
    }
    if (spec.pair && spec.compute !== `min_pair_distance`) {
      throw new Error(`Descriptor "${spec.key}": pair goes only with min_pair_distance`)
    }
  }
}

export const format_axis_value = (axis: SweepAxis, frame: SweepFrame): string =>
  frame.label ?? `${frame.value}${axis.unit ? ` ${axis.unit}` : ``}`

// === computed descriptors ===
export const volume_per_atom = (structure: Crystal): number =>
  Math.abs(det_3x3(structure.lattice.matrix)) / structure.sites.length

const site_element = (site: Crystal[`sites`][number]): string | undefined =>
  site.species[0]?.element

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
    element === undefined || site_element(site) === element
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
  const { band_data, fermi_data, doses, band_structs } = frame
  const from_dos = Object.values(doses ?? {}).find(
    (dos) => dos.type === `electronic` && dos.efermi !== undefined,
  )
  return (
    band_data?.fermi_energy ??
    fermi_data?.fermi_energy ??
    (from_dos?.type === `electronic` ? from_dos.efermi : undefined) ??
    Object.values(band_structs ?? {}).find((bands) => bands.efermi !== undefined)?.efermi
  )
}

// `total`, else a lone DOS that is no element projection
const total_dos = (doses: Record<string, DosData>): DosData | undefined => {
  const entries = Object.entries(doses)
  if (doses.total) return doses.total
  const [lone] = entries.length === 1 ? entries : []
  return lone && !is_elem_symbol(lone[0]) ? lone[1] : undefined
}

// Bands of the grid whose energies span E_F, per spin channel; for a meshed surface (always at
// E_F) its distinct sheets
export function fermi_band_count(frame: Partial<SweepFrame>): number | undefined {
  if (frame.band_data) {
    const grid = normalize_band_grid(frame.band_data)
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

// === JSON input (dropped files, notebook widgets) ===
const fail = (path: string, problem: string): never => {
  throw new Error(`Invalid sweep at ${path}: ${problem}`)
}

const FRAME_KEYS = new Set([
  `value`,
  `label`,
  `structure`,
  `band_data`,
  `fermi_data`,
  `band_structs`,
  `doses`,
  `scalars`,
  `status`,
])
// an optional string field: absent, or a string
const optional_string = (value: unknown, path: string): string | undefined =>
  value === undefined || typeof value === `string`
    ? value
    : fail(path, `must be a string, got ${JSON.stringify(value)}`)

function normalize_frame(raw: unknown, path: string): SweepFrame {
  if (!is_plain_object(raw)) return fail(path, `frame must be an object`)
  const unknown_key = Object.keys(raw).find((key) => !FRAME_KEYS.has(key))
  if (unknown_key) return fail(`${path}.${unknown_key}`, `unknown frame field`)
  const { value, structure, band_data, fermi_data, band_structs, doses } = raw
  if (typeof value !== `number`) return fail(path, `value must be a number`)
  const frame: SweepFrame = { value }
  const label = optional_string(raw.label, `${path}.label`)
  if (label !== undefined) frame.label = label
  if (structure !== undefined) {
    const parsed = is_structure_like(structure) ? structure_from_json(structure) : undefined
    if (!is_crystal(parsed)) return fail(`${path}.structure`, `needs a periodic structure`)
    frame.structure = parsed
  }
  // the grid and surface parsers name the field that is wrong; prefix where in the sweep
  const parse = <Value>(key: string, parser: () => Value): Value => {
    try {
      return parser()
    } catch (error) {
      return fail(`${path}.${key}`, error instanceof Error ? error.message : String(error))
    }
  }
  if (band_data !== undefined) {
    if (!is_plain_object(band_data)) return fail(`${path}.band_data`, `must be an object`)
    frame.band_data = parse(`band_data`, () => normalize_band_grid(band_data))
  }
  if (fermi_data !== undefined) {
    if (!is_plain_object(fermi_data)) return fail(`${path}.fermi_data`, `must be an object`)
    frame.fermi_data = parse(`fermi_data`, () => normalize_fermi_surface(fermi_data))
  }
  const normalize_record = <Value>(
    record: unknown,
    key: string,
    normalize: (item: unknown) => Value | null,
  ): Record<string, Value> | undefined => {
    if (record === undefined) return undefined
    if (!is_plain_object(record)) return fail(`${path}.${key}`, `must be an object`)
    return Object.fromEntries(
      Object.entries(record).map(([name, item]) => [
        name,
        normalize(item) ?? fail(`${path}.${key}.${name}`, `unrecognized data`),
      ]),
    )
  }
  const bands = normalize_record(band_structs, `band_structs`, normalize_band_structure)
  if (bands) frame.band_structs = bands
  const dos = normalize_record(doses, `doses`, normalize_dos)
  if (dos) frame.doses = dos
  if (raw.scalars !== undefined) {
    if (!is_plain_object(raw.scalars)) return fail(`${path}.scalars`, `must be an object`)
    frame.scalars = Object.fromEntries(
      Object.entries(raw.scalars).map(([key, scalar]) => {
        if (scalar !== null && typeof scalar !== `number`) {
          return fail(`${path}.scalars.${key}`, `must be a number or null`)
        }
        return [key, scalar]
      }),
    )
  }
  if (raw.status !== undefined) {
    if (!is_plain_object(raw.status)) return fail(`${path}.status`, `must be an object`)
    const { unstable, note } = raw.status
    if (unstable !== undefined && typeof unstable !== `boolean`) {
      return fail(`${path}.status.unstable`, `must be a boolean`)
    }
    const status_note = optional_string(note, `${path}.status.note`)
    frame.status = {
      ...(unstable !== undefined && { unstable }),
      ...(status_note !== undefined && { note: status_note }),
    }
  }
  return frame
}

const is_computed = (name: unknown): name is ComputedDescriptor =>
  COMPUTED_DESCRIPTORS.some((computed) => computed === name)

function normalize_descriptor(raw: unknown, idx: number): DescriptorSpec {
  const path = `descriptors[${idx}]`
  if (!is_plain_object(raw)) return fail(path, `must be an object`)
  const { key, label, compute, pair, element, range, threshold } = raw
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
  return {
    key,
    label,
    ...(unit !== undefined && { unit }),
    ...(compute !== undefined && { compute }),
    ...(pair && { pair: [pair[0], pair[1]] }),
    ...(element !== undefined && { element }),
    ...(range && { range: [range[0], range[1]] }),
    ...(threshold !== undefined && { threshold }),
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
  const { axis, series, descriptors } = raw
  if (!is_plain_object(axis)) return fail(`axis`, `must be an object`)
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
