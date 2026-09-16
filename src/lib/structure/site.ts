// Shared single-species Site construction used by all structure/trajectory/volumetric parsers,
// plus the site-provenance reads every consumer of supercell/image-atom copies shares
import type { ElementSymbol } from '$lib/element'
import type { Vec3 } from '$lib/math'
import type { AnyStructure, Site } from '$lib/structure'
import { element_from_atomic_number } from '$lib/element/helpers'
import type { PreparedVectorGeometry } from './vectors'

// Only immutable viewer snapshots register a topology identity. Editable structures use
// their actual site records; copying or editing a snapshot deliberately drops this identity.
export const snapshot_topologies = new WeakMap<AnyStructure, object>()
// Channel names survive selective reads so controls can request unloaded properties.
export const available_site_vector_keys = new WeakMap<AnyStructure, readonly string[]>()

// Settings-independent measurements of one immutable display snapshot. Magnitudes keep
// site indices aligned; NaN marks missing data, including invalid scalar overrides.
export type DisplayMetrics = {
  vector_magnitudes: Record<string, { values: Float64Array<ArrayBuffer>; max: number }>
  characteristic_atom_spacing: number
}

// Immutable numeric display snapshots expose individual records only to cold consumers
// (picking, editing, exports). Rendering can read columns without allocating Sites.
export class NumericSites {
  display_metrics?: DisplayMetrics
  vector_geometry?: PreparedVectorGeometry
  private readonly records: Site[] = []
  private readonly positions: Vec3[] = []
  private materialized = false
  private keys: string[] | undefined
  constructor(
    readonly numbers: Uint8Array,
    readonly coordinates: Float64Array,
    readonly vector_keys: readonly string[],
    private readonly identities: Pick<Site, 'species' | 'label'>[],
    readonly scalar_columns?: Record<string, Float64Array>,
  ) {}
  get length(): number {
    return this.numbers.length
  }
  get stride(): number {
    return 6 + this.vector_keys.length * 3
  }
  is_image(idx: number): boolean {
    return typeof this.scalar_columns?.orig_site_idx?.[idx] === `number`
  }
  property_keys(): readonly string[] {
    if (this.keys) return this.keys
    const keys: string[] = []
    for (const [key, values] of Object.entries(this.scalar_columns ?? {}))
      if (values.some(Number.isFinite)) keys.push(key)
    for (const [column, key] of this.vector_keys.entries()) {
      if (Object.hasOwn(this.scalar_columns ?? {}, key)) continue
      for (let idx = 0; idx < this.length; idx++) {
        const offset = idx * this.stride + 6 + column * 3
        if (
          Number.isFinite(this.coordinates[offset]) &&
          Number.isFinite(this.coordinates[offset + 1]) &&
          Number.isFinite(this.coordinates[offset + 2])
        ) {
          keys.push(key)
          break
        }
      }
    }
    return (this.keys = keys)
  }
  position(idx: number): Vec3 {
    const offset = idx * this.stride
    return (this.positions[idx] ??= [
      this.coordinates[offset],
      this.coordinates[offset + 1],
      this.coordinates[offset + 2],
    ])
  }
  get(idx: number): Site | undefined {
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.length) return undefined
    if (this.records[idx]) return this.records[idx]
    let identity = this.identities[idx]
    if (!identity) {
      const element = element_from_atomic_number(this.numbers[idx])
      if (!element)
        throw new Error(`Invalid atomic number ${this.numbers[idx]} at site ${idx}`)
      identity = {
        species: [{ element, occu: 1, oxidation_state: 0 }],
        label: `${element}${idx + 1}`,
      }
      this.identities[idx] = identity
    }
    const offset = idx * this.stride
    const properties: Record<string, unknown> = {}
    write_site_properties(this, idx, properties)
    return (this.records[idx] = {
      ...identity,
      xyz: this.position(idx),
      abc: [
        this.coordinates[offset + 3],
        this.coordinates[offset + 4],
        this.coordinates[offset + 5],
      ],
      properties,
    })
  }
  materialize(): Site[] {
    if (!this.materialized) {
      for (let idx = 0; idx < this.length; idx++) this.get(idx)
      this.materialized = true
    }
    return this.records
  }
}

// Display snapshots and editable exports decode the same columns. Scalar values override
// dense vectors of the same name; unrelated record properties remain untouched.
export function write_site_properties(
  columns: Pick<NumericSites, 'coordinates' | 'vector_keys' | 'scalar_columns'>,
  idx: number,
  properties: Record<string, unknown>,
): void {
  const { coordinates, vector_keys, scalar_columns } = columns
  const offset = idx * (6 + vector_keys.length * 3)
  for (let column = 0; column < vector_keys.length; column++) {
    const start = offset + 6 + column * 3
    properties[vector_keys[column]] = [
      coordinates[start],
      coordinates[start + 1],
      coordinates[start + 2],
    ]
  }
  for (const key in scalar_columns)
    if (Object.hasOwn(scalar_columns, key)) properties[key] = scalar_columns[key][idx]
}

export const numeric_sites = new WeakMap<object, NumericSites>()
export const site_count = (structure: AnyStructure | null | undefined): number =>
  structure ? (numeric_sites.get(structure)?.length ?? structure.sites.length) : 0
export const get_site = (
  structure: AnyStructure | null | undefined,
  idx: number,
): Site | undefined => {
  if (!structure || idx < 0) return undefined
  const columns = numeric_sites.get(structure)
  return columns ? columns.get(idx) : structure.sites[idx]
}

export const make_site = (
  element: ElementSymbol,
  abc: Vec3,
  xyz: Vec3,
  label: string,
  properties: Record<string, unknown> = {},
  occu = 1,
): Site => ({ species: [{ element, occu, oxidation_state: 0 }], abc, xyz, label, properties })

// PBC image copies carry the index of the site they mirror; every other site is an original
export const is_image_site = (site: Site | undefined): boolean =>
  typeof site?.properties?.orig_site_idx === `number`

// Index of the site a PBC image copies; every other site is its own source
export const get_image_source_idx = (site: Site | undefined, site_idx: number): number =>
  typeof site?.properties?.orig_site_idx === `number`
    ? site.properties.orig_site_idx
    : site_idx

// Index of the unit-cell site a displayed site descends from: make_supercell stamps
// `orig_unit_cell_idx` (into the cell it tiled), get_pbc_image_sites stamps `orig_site_idx`
// (into the structure it imaged, inheriting any `orig_unit_cell_idx`). Sites with neither are
// their own ancestor.
export const get_orig_site_idx = (site: Site | undefined, site_idx: number): number =>
  typeof site?.properties?.orig_unit_cell_idx === `number`
    ? site.properties.orig_unit_cell_idx
    : get_image_source_idx(site, site_idx)
