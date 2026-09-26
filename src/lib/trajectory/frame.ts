import { wrap_frac_coord } from '$lib/structure/pbc'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { cart_to_frac_with_fallback, make_lattice } from '$lib/structure/parsers/shared'
import type { Pbc } from '$lib/structure/pbc'
import type { AnyStructure, LatticeType, Site } from '$lib/structure'
import { register_structure_vectors } from '$lib/structure/vectors'
import { element_from_atomic_number, symbol_to_atomic_number } from '$lib/element/helpers'
import {
  make_site,
  snapshot_topologies,
  NumericSites,
  numeric_sites,
  write_site_properties,
} from '$lib/structure/site'
import type { TrajectoryFrame } from './index'

const SITE_FIELDS = new Set([`xyz`, `abc`, `species`, `label`, `properties`])
// Select from each frame's dense channels; a channel may be absent in individual frames.
// Omit vectors to read all channels; [] requests coordinates without vector payloads.
export type FrameChannels = { vectors?: readonly string[] }
const SPECIES_FIELDS = new Set([`element`, `occu`, `oxidation_state`])
const has_exact_fields = (record: object, fields: ReadonlySet<string>): boolean => {
  const keys = Object.keys(record)
  return keys.length === fields.size && keys.every((key) => fields.has(key))
}

// Transfer coordinates and dense vector properties in one buffer instead of cloning
// millions of small arrays. Sparse/mixed properties and other metadata stay in the packet.
export type NumericFrame = {
  header: Omit<TrajectoryFrame, 'structure'>
  structure: Omit<AnyStructure, 'sites'> & { lattice?: LatticeType }
  // Standard ordered MD sites need only atomic numbers; preserve arbitrary site metadata
  // in records for every other structure, including viewer-generated site provenance.
  sites: Omit<Site, 'xyz' | 'abc'>[] | Uint8Array
  // Set only by sources whose schema fixes atom identity to its row for the entire run.
  // Generic structure sequences make no identity claim based on equal counts or species.
  topology?: { kind: 'fixed-order'; revision: number }
  vector_keys: string[]
  available_vector_keys?: string[]
  scalar_columns?: Record<string, Float64Array>
  coordinates: Float64Array
  // Display preparation wraps periodic coordinates once, before transfer to the renderer.
  // Source reads and independently owned analysis packets keep their original coordinates.
  wrapped?: true
}

export function wrap_frame_coordinates(data: NumericFrame): NumericFrame {
  if (data.wrapped) return data
  let coordinates = data.coordinates
  const width = 6 + data.vector_keys.length * 3
  const { lattice } = data.structure
  const pbc = lattice?.pbc
  if (lattice && pbc?.some(Boolean)) {
    const [periodic_a, periodic_b, periodic_c] = pbc
    const end = data.sites.length * width
    let outside = false
    for (let offset = 0; offset < end; offset += width) {
      if (
        (periodic_a && (coordinates[offset + 3] < 0 || coordinates[offset + 3] >= 1)) ||
        (periodic_b && (coordinates[offset + 4] < 0 || coordinates[offset + 4] >= 1)) ||
        (periodic_c && (coordinates[offset + 5] < 0 || coordinates[offset + 5] >= 1))
      ) {
        outside = true
        break
      }
    }
    if (outside) {
      coordinates = coordinates.slice()
      // Hoist the basis while preserving create_frac_to_cart's multiply/add order.
      const [
        [basis_a_x, basis_a_y, basis_a_z],
        [basis_b_x, basis_b_y, basis_b_z],
        [basis_c_x, basis_c_y, basis_c_z],
      ] = lattice.matrix
      for (let offset = 0; offset < end; offset += width) {
        const raw_a = coordinates[offset + 3]
        const raw_b = coordinates[offset + 4]
        const raw_c = coordinates[offset + 5]
        const frac_a = periodic_a ? wrap_frac_coord(raw_a) : raw_a
        const frac_b = periodic_b ? wrap_frac_coord(raw_b) : raw_b
        const frac_c = periodic_c ? wrap_frac_coord(raw_c) : raw_c
        coordinates[offset] = basis_a_x * frac_a + basis_b_x * frac_b + basis_c_x * frac_c
        coordinates[offset + 1] = basis_a_y * frac_a + basis_b_y * frac_b + basis_c_y * frac_c
        coordinates[offset + 2] = basis_a_z * frac_a + basis_b_z * frac_b + basis_c_z * frac_c
        coordinates[offset + 3] = frac_a
        coordinates[offset + 4] = frac_b
        coordinates[offset + 5] = frac_c
      }
    }
  }
  return { ...data, coordinates, wrapped: true }
}

export function select_frame_channels(
  frame: NumericFrame,
  channels?: FrameChannels,
): NumericFrame {
  if (!channels?.vectors) return frame
  const available = frame.available_vector_keys ?? frame.vector_keys
  // Fixed-schema sources advertise their channels even when values are missing. Generic
  // frame sequences may instead gain/lose properties between steps.
  for (const key of channels.vectors)
    if (frame.available_vector_keys && !available.includes(key))
      throw new Error(`Unknown trajectory vector channel: ${key}`)
  const selected = frame.vector_keys.filter((key) => channels.vectors?.includes(key))
  if (selected.length === frame.vector_keys.length) return frame
  const source_width = 6 + frame.vector_keys.length * 3
  const target_width = 6 + selected.length * 3
  const source_offsets = selected.map((key) => 6 + frame.vector_keys.indexOf(key) * 3)
  const coordinates = new Float64Array(frame.sites.length * target_width)
  for (let idx = 0; idx < frame.sites.length; idx++) {
    const source = idx * source_width
    const target = idx * target_width
    for (let axis = 0; axis < 6; axis++)
      coordinates[target + axis] = frame.coordinates[source + axis]
    for (let column = 0; column < source_offsets.length; column++) {
      for (let axis = 0; axis < 3; axis++)
        coordinates[target + 6 + column * 3 + axis] =
          frame.coordinates[source + source_offsets[column] + axis]
    }
  }
  return { ...frame, coordinates, vector_keys: selected, available_vector_keys: available }
}

export const encode_frame = ({ structure, ...header }: TrajectoryFrame): NumericFrame => {
  const { sites, ...cell } = structure
  const vector_keys = Object.keys(sites[0]?.properties ?? {}).filter(
    (key) =>
      key !== `__proto__` &&
      sites.every(({ properties }) => {
        const vector = properties?.[key]
        return (
          Object.hasOwn(properties, key) &&
          Array.isArray(vector) &&
          vector.length === 3 &&
          typeof vector[0] === `number` &&
          typeof vector[1] === `number` &&
          typeof vector[2] === `number` &&
          Object.keys(vector).length === 3
        )
      }),
  )
  // Dense finite numeric scalars (LAMMPS id/type, charges) travel as columns too, sparing the
  // slow structuredClone(records) path
  const scalar_keys = Object.keys(sites[0]?.properties ?? {}).filter(
    (key) =>
      key !== `__proto__` &&
      !vector_keys.includes(key) &&
      sites.every(
        ({ properties }) =>
          Object.hasOwn(properties, key) &&
          typeof properties[key] === `number` &&
          Number.isFinite(properties[key]),
      ),
  )
  const scalar_columns = Object.fromEntries(
    scalar_keys.map((key) => [
      key,
      Float64Array.from(sites, ({ properties }) => properties[key] as number),
    ]),
  )
  const columnar_keys = new Set([...vector_keys, ...scalar_keys])
  const width = 6 + vector_keys.length * 3
  const coordinates = new Float64Array(sites.length * width)
  const elements = new Uint8Array(sites.length)
  let standard_sites = true
  for (let idx = 0; idx < sites.length; idx++) {
    const { xyz, abc, species, label, properties } = sites[idx]
    const offset = idx * width
    coordinates.set(xyz, offset)
    coordinates.set(abc, offset + 3)
    for (let vector_idx = 0; vector_idx < vector_keys.length; vector_idx++) {
      coordinates.set(
        properties[vector_keys[vector_idx]] as number[],
        offset + 6 + vector_idx * 3,
      )
    }
    if (!standard_sites) continue
    const entry = species[0]
    const atomic_number = entry && symbol_to_atomic_number(entry.element)
    standard_sites = Boolean(
      atomic_number &&
      species.length === 1 &&
      Object.keys(species).length === 1 &&
      entry.occu === 1 &&
      Object.is(entry.oxidation_state, 0) &&
      has_exact_fields(entry, SPECIES_FIELDS) &&
      label === `${entry.element}${idx + 1}` &&
      has_exact_fields(sites[idx], SITE_FIELDS) &&
      Object.keys(properties).length === columnar_keys.size,
    )
    if (atomic_number) elements[idx] = atomic_number
  }
  const snapshot = {
    ...structuredClone({ header, structure: cell }),
    vector_keys,
    coordinates,
    ...(scalar_keys.length > 0 && { scalar_columns }),
  }
  if (standard_sites) return { ...snapshot, sites: elements }
  const records = sites.map(({ xyz: _xyz, abc: _abc, ...site }) => {
    if (columnar_keys.size > 0) {
      site.properties = Object.fromEntries(
        Object.entries(site.properties).filter(([key]) => !columnar_keys.has(key)),
      )
    }
    return site
  })
  return { ...snapshot, sites: structuredClone(records) }
}

export const materialize_frame = (frame: NumericFrame): TrajectoryFrame => {
  const { header, structure, sites, vector_keys, coordinates } = frame
  return {
    ...structuredClone(header),
    structure: {
      ...structuredClone(structure),
      sites: Array.from({ length: sites.length }, (_unused, idx) => {
        const offset = idx * (6 + vector_keys.length * 3)
        const xyz: Site[`xyz`] = [
          coordinates[offset],
          coordinates[offset + 1],
          coordinates[offset + 2],
        ]
        const abc: Site[`abc`] = [
          coordinates[offset + 3],
          coordinates[offset + 4],
          coordinates[offset + 5],
        ]
        let site: Site
        if (sites instanceof Uint8Array) {
          const element = element_from_atomic_number(sites[idx])
          if (!element) throw new Error(`Invalid atomic number ${sites[idx]} at site ${idx}`)
          site = make_site(element, abc, xyz, `${element}${idx + 1}`)
        } else site = { ...structuredClone(sites[idx]), xyz, abc }
        write_site_properties(frame, idx, site.properties)
        return site
      }),
    },
  }
}

// HDF5 readers load contiguous vec3 arrays; the frame stores them beside each atom's coordinates.
export function write_frame_vector(
  frame: NumericFrame,
  column: number,
  values: ArrayLike<number>,
): void {
  const width = 6 + frame.vector_keys.length * 3
  for (let idx = 0; idx < frame.sites.length; idx++) {
    const source = idx * 3
    const target = idx * width + 6 + column * 3
    frame.coordinates[target] = values[source]
    frame.coordinates[target + 1] = values[source + 1]
    frame.coordinates[target + 2] = values[source + 2]
  }
}

// Materialization is explicit at consumers that need editable Site records. Numeric frames
// remain immutable snapshots; cached/source buffers must never be transferred or recycled.
export function materialize_frame_result(result: NumericFrame): TrajectoryFrame
export function materialize_frame_result(
  result: Promise<NumericFrame>,
): Promise<TrajectoryFrame>
export function materialize_frame_result(
  result: NumericFrame | Promise<NumericFrame>,
): TrajectoryFrame | Promise<TrajectoryFrame>
export function materialize_frame_result(
  result: NumericFrame | Promise<NumericFrame>,
): TrajectoryFrame | Promise<TrajectoryFrame> {
  return result instanceof Promise ? result.then(materialize_frame) : materialize_frame(result)
}

export const frame_transfers = (frame: NumericFrame): ArrayBufferLike[] => [
  ...new Set([
    frame.coordinates.buffer,
    ...(frame.sites instanceof Uint8Array ? [frame.sites.buffer] : []),
    ...Object.values(frame.scalar_columns ?? {}).map((column) => column.buffer),
  ]),
]

// Direct MD decoder output: no Site, species record, label or per-atom vector allocations.
// The source explicitly guarantees fixed row identity and supplies topology revision changes.
export function create_numeric_md_frame(
  positions: Float64Array,
  numbers: Uint8Array,
  lattice_matrix: Matrix3x3 | undefined,
  pbc: Pbc | undefined,
  step: number,
  metadata: Record<string, unknown>,
  vector_keys: string[],
): NumericFrame {
  if (positions.length !== numbers.length * 3)
    throw new Error(`MD frame has ${positions.length} coordinates for ${numbers.length} atoms`)
  const lattice = lattice_matrix ? make_lattice(lattice_matrix, pbc) : undefined
  const convert = lattice_matrix
    ? cart_to_frac_with_fallback(lattice_matrix, {
        context: `lattice ${JSON.stringify(lattice_matrix)}`,
      }).convert
    : undefined
  const width = 6 + vector_keys.length * 3
  const coordinates = new Float64Array(numbers.length * width)
  const xyz: Vec3 = [0, 0, 0]
  const fractional: Vec3 = [0, 0, 0]
  for (let idx = 0; idx < numbers.length; idx++) {
    const offset = idx * width
    xyz[0] = positions[idx * 3]
    xyz[1] = positions[idx * 3 + 1]
    xyz[2] = positions[idx * 3 + 2]
    if (!Number.isFinite(xyz[0]) || !Number.isFinite(xyz[1]) || !Number.isFinite(xyz[2]))
      throw new Error(`Invalid position at index ${idx}: expected 3 finite coordinates`)
    coordinates[offset] = xyz[0]
    coordinates[offset + 1] = xyz[1]
    coordinates[offset + 2] = xyz[2]
    if (convert) {
      convert(xyz, fractional)
      coordinates[offset + 3] = fractional[0]
      coordinates[offset + 4] = fractional[1]
      coordinates[offset + 5] = fractional[2]
    }
  }
  return {
    header: { step, metadata: lattice ? { ...metadata, volume: lattice.volume } : metadata },
    structure: lattice ? { lattice } : {},
    sites: numbers,
    topology: { kind: `fixed-order`, revision: 0 },
    vector_keys,
    coordinates,
  }
}

// A viewer projection never enters a run cache or an analysis result. Fixed topology reuses
// species and labels; coordinates/properties get fresh references so Svelte invalidates
// tooltips, measurements and tables and retained display frames never change underneath them.
export class FrameView {
  private topology:
    | { revision?: number; count: number; identities: Pick<Site, 'species' | 'label'>[] }
    | undefined

  clear(): void {
    this.topology = undefined
  }

  update(data: NumericFrame): TrajectoryFrame {
    data = wrap_frame_coordinates(data)
    const topology =
      data.topology?.kind === `fixed-order` && data.sites instanceof Uint8Array
        ? data.topology
        : undefined
    if (
      !this.topology ||
      !topology ||
      topology.revision !== this.topology.revision ||
      data.sites.length !== this.topology.count
    ) {
      this.topology = {
        revision: topology?.revision,
        count: data.sites.length,
        identities: [],
      }
    }
    let frame: TrajectoryFrame
    if (data.sites instanceof Uint8Array) {
      const columns = new NumericSites(
        data.sites,
        data.coordinates,
        data.vector_keys,
        this.topology.identities,
        data.scalar_columns,
      )
      const structure: AnyStructure = {
        ...structuredClone(data.structure),
        get sites() {
          return columns.materialize()
        },
      }
      numeric_sites.set(structure, columns)
      if (data.topology) snapshot_topologies.set(structure, this.topology)
      // Fresh top-level references for Svelte; a deep clone is too slow for large frames
      frame = {
        ...data.header,
        metadata: data.header.metadata && { ...data.header.metadata },
        structure,
      }
    } else frame = materialize_frame(data)
    if (data.available_vector_keys)
      register_structure_vectors(frame.structure, data.available_vector_keys)
    return frame
  }
}
