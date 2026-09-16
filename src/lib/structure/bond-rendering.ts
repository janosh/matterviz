import { numeric_sites } from './site'
import type { Vec3 } from '$lib/math'
import type { AnyStructure, BondOrder, BondPair } from '$lib/structure'
import type { TypedArray } from 'three/webgpu'

export type BondColumns = {
  indices: Uint32Array
  lengths: Float64Array
  orders: Uint8Array
  images: Float64Array
}
export type BondPlacements = {
  centers: Float32Array<ArrayBuffer>
  deltas: Float32Array<ArrayBuffer>
  sizes: Float32Array<ArrayBuffer>
  instance_count: number
  max_site_idx: number
}
export const BOND_ORDERS = [undefined, 1, 1.5, 2, 3, `aromatic`] as const

export function pack_bonds(bonds: readonly BondPair[]): BondColumns {
  const indices = new Uint32Array(bonds.length * 2)
  const lengths = new Float64Array(bonds.length)
  const orders = new Uint8Array(bonds.length)
  let image_count = 0
  for (const bond of bonds) if (bond.cell_shift) image_count++
  const images = new Float64Array(image_count * 7)
  let image_offset = 0
  for (let idx = 0; idx < bonds.length; idx++) {
    const { site_idx_1, site_idx_2, bond_length, bond_order, pos_2, cell_shift } = bonds[idx]
    indices[idx * 2] = site_idx_1
    indices[idx * 2 + 1] = site_idx_2
    lengths[idx] = bond_length
    orders[idx] = BOND_ORDERS.indexOf(bond_order)
    if (cell_shift) {
      images.set([idx, ...pos_2, ...cell_shift], image_offset)
      image_offset += 7
    }
  }
  return { indices, lengths, orders, images }
}

// One immutable column snapshot, shared by rendering and on-demand rich consumers.
export class BondFrame {
  private records: BondPair[] | undefined
  private readonly shifted = new Map<number, { position: Vec3; shift: Vec3 }>()
  private readonly sites
  constructor(
    readonly structure: AnyStructure,
    readonly columns: BondColumns,
    readonly placements?: BondPlacements,
  ) {
    this.sites = numeric_sites.get(structure)
    const { images } = columns
    for (let offset = 0; offset < images.length; offset += 7)
      this.shifted.set(images[offset], {
        position: [images[offset + 1], images[offset + 2], images[offset + 3]],
        shift: [images[offset + 4], images[offset + 5], images[offset + 6]],
      })
  }
  get length(): number {
    return this.columns.lengths.length
  }
  order(idx: number): BondOrder | undefined {
    return BOND_ORDERS[this.columns.orders[idx]]
  }
  cell_shift(idx: number): Vec3 | undefined {
    return this.shifted.get(idx)?.shift
  }
  position_1(idx: number): Vec3 {
    const site_idx = this.columns.indices[idx * 2]
    return this.sites ? this.sites.position(site_idx) : this.structure.sites[site_idx].xyz
  }
  position_2(idx: number): Vec3 {
    const image = this.shifted.get(idx)
    if (image) return image.position
    const site_idx = this.columns.indices[idx * 2 + 1]
    return this.sites ? this.sites.position(site_idx) : this.structure.sites[site_idx].xyz
  }
  write_endpoints(idx: number, start: Vec3, end: Vec3): void {
    const first = this.columns.indices[idx * 2]
    const second = this.columns.indices[idx * 2 + 1]
    const image = this.shifted.get(idx)?.position
    for (let axis = 0; axis < 3; axis++) {
      start[axis] = this.sites
        ? this.sites.coordinates[first * this.sites.stride + axis]
        : this.structure.sites[first].xyz[axis]
      end[axis] = image
        ? image[axis]
        : this.sites
          ? this.sites.coordinates[second * this.sites.stride + axis]
          : this.structure.sites[second].xyz[axis]
    }
  }
  materialize(): BondPair[] {
    return (this.records ??= Array.from({ length: this.length }, (_unused, idx) => {
      const order = this.order(idx)
      const shift = this.shifted.get(idx)?.shift
      return {
        site_idx_1: this.columns.indices[idx * 2],
        site_idx_2: this.columns.indices[idx * 2 + 1],
        pos_1: this.position_1(idx),
        pos_2: this.position_2(idx),
        bond_length: this.columns.lengths[idx],
        ...(order === undefined ? {} : { bond_order: order }),
        ...(shift ? { cell_shift: shift } : {}),
      }
    }))
  }
}
export type BondData = readonly BondPair[] | BondFrame
export const bond_records = (bonds: BondData): readonly BondPair[] =>
  bonds instanceof BondFrame ? bonds.materialize() : bonds

// A tooltip needs one coordination shell. Scan packed indices without expanding bond
// records or allocating a graph for every atom on every trajectory frame.
export function bond_neighbors(bonds: BondData, site_idx: number): number[] {
  const neighbors: number[] = []
  for (let idx = 0; idx < bonds.length; idx++) {
    const first =
      bonds instanceof BondFrame ? bonds.columns.indices[idx * 2] : bonds[idx].site_idx_1
    const second =
      bonds instanceof BondFrame ? bonds.columns.indices[idx * 2 + 1] : bonds[idx].site_idx_2
    if (first === site_idx) neighbors.push(second)
    else if (second === site_idx) neighbors.push(first)
  }
  return neighbors
}

export const instance_count_for_order = (order: BondOrder | undefined): number =>
  order === 3 ? 3 : order === 2 || order === 1.5 || order === `aromatic` ? 2 : 1

export function count_bond_instances(bonds: BondData): number {
  if (bonds instanceof BondFrame && bonds.placements) return bonds.placements.instance_count
  let count = 0
  for (let idx = 0; idx < bonds.length; idx++)
    count += instance_count_for_order(
      bonds instanceof BondFrame ? bonds.order(idx) : bonds[idx].bond_order,
    )
  return count
}

// Immutable worker-prepared cylinder placement, independent of appearance. Store midpoint
// and displacement separately so short bonds remain distinct far from the origin.
export function prepare_bond_placements(bonds: BondData): BondPlacements {
  const instance_count = count_bond_instances(bonds)
  const centers = new Float32Array(instance_count * 3)
  const deltas = new Float32Array(instance_count * 3)
  const sizes = new Float32Array(instance_count * 3)
  let start: Vec3 = [0, 0, 0]
  let end: Vec3 = [0, 0, 0]
  let instance_idx = 0
  let max_site_idx = -1
  for (let idx = 0; idx < bonds.length; idx++) {
    if (bonds instanceof BondFrame) bonds.write_endpoints(idx, start, end)
    else {
      start = bonds[idx].pos_1
      end = bonds[idx].pos_2
    }
    const order = bonds instanceof BondFrame ? bonds.order(idx) : bonds[idx].bond_order
    const site_idx_1 =
      bonds instanceof BondFrame ? bonds.columns.indices[idx * 2] : bonds[idx].site_idx_1
    const site_idx_2 =
      bonds instanceof BondFrame ? bonds.columns.indices[idx * 2 + 1] : bonds[idx].site_idx_2
    max_site_idx = Math.max(max_site_idx, site_idx_1, site_idx_2)
    const copies = instance_count_for_order(order)
    const delta_x = end[0] - start[0]
    const delta_y = end[1] - start[1]
    const delta_z = end[2] - start[2]
    // oxlint-disable-next-line eslint-plugin-unicorn/prefer-modern-math-apis -- matches write_bond_transform
    const height = Math.sqrt(delta_x * delta_x + delta_y * delta_y + delta_z * delta_z)
    // Preserve coincident/near-axis branches before converting displacements to f32.
    const basis = height < 1e-10 ? 0 : Math.abs(delta_y / height) > 1 - 1e-10 ? 1 : 2
    for (let copy_idx = 0; copy_idx < copies; copy_idx++, instance_idx++) {
      const offset = instance_idx * 3
      centers[offset] = (start[0] + end[0]) / 2
      centers[offset + 1] = (start[1] + end[1]) / 2
      centers[offset + 2] = (start[2] + end[2]) / 2
      deltas[offset] = basis ? delta_x : 0
      deltas[offset + 1] = basis ? delta_y : 0
      deltas[offset + 2] = basis ? delta_z : 0
      sizes[offset] =
        copies === 1
          ? 1
          : order === 2
            ? 0.65
            : order === 3
              ? 0.55
              : copy_idx === 0
                ? 0.75
                : 0.4
      sizes[offset + 1] = 1.8 * (copy_idx - (copies - 1) / 2)
      sizes[offset + 2] = basis
    }
  }
  return { centers, deltas, sizes, instance_count, max_site_idx }
}

// Write one Y-up unit-cylinder transform directly into an InstancedMesh matrix buffer.
// Keeping the renderer transform out of BondPair means topology-only consumers no longer
// allocate or calculate 16 floats per bond.
export function write_bond_transform(
  matrix_buffer: TypedArray,
  instance_idx: number,
  pos_1: Vec3,
  pos_2: Vec3,
  radius_scale = 1,
): void {
  const matrix_offset = instance_idx * 16
  const delta_x = pos_2[0] - pos_1[0]
  const delta_y = pos_2[1] - pos_1[1]
  const delta_z = pos_2[2] - pos_1[2]
  // sqrt is much faster than hypot here; overflow would require coordinates above ~1e154.
  // oxlint-disable-next-line eslint-plugin-unicorn/prefer-modern-math-apis -- see above
  const height = Math.sqrt(delta_x * delta_x + delta_y * delta_y + delta_z * delta_z)

  // Write fixed entries directly; filling all 16 per bond rewrites the other 12 below.
  matrix_buffer[matrix_offset + 1] = 0
  matrix_buffer[matrix_offset + 3] = 0
  matrix_buffer[matrix_offset + 7] = 0
  matrix_buffer[matrix_offset + 11] = 0
  matrix_buffer[matrix_offset + 12] = (pos_1[0] + pos_2[0]) / 2
  matrix_buffer[matrix_offset + 13] = (pos_1[1] + pos_2[1]) / 2
  matrix_buffer[matrix_offset + 14] = (pos_1[2] + pos_2[2]) / 2
  matrix_buffer[matrix_offset + 15] = 1
  if (height < 1e-10) {
    matrix_buffer[matrix_offset + 2] = 0
    matrix_buffer[matrix_offset + 4] = 0
    matrix_buffer[matrix_offset + 5] = 0
    matrix_buffer[matrix_offset + 6] = 0
    matrix_buffer[matrix_offset + 8] = 0
    matrix_buffer[matrix_offset + 9] = 0
    matrix_buffer[matrix_offset] = radius_scale
    matrix_buffer[matrix_offset + 10] = radius_scale
    return
  }

  const dir_x = delta_x / height
  const dir_y = delta_y / height
  const dir_z = delta_z / height
  let right_x = 1
  let right_z = 0
  let up_x = 0
  let up_y = 0
  let up_z = dir_y < 0 ? -1 : 1
  if (Math.abs(dir_y) <= 1 - 1e-10) {
    // oxlint-disable-next-line eslint-plugin-unicorn/prefer-modern-math-apis -- see above
    const right_length = Math.sqrt(dir_x * dir_x + dir_z * dir_z)
    right_x = -dir_z / right_length
    right_z = dir_x / right_length
    up_x = -dir_y * right_z
    up_y = dir_x * right_z - dir_z * right_x
    up_z = dir_y * right_x
  }

  // Column-major Three.js matrix: scaled right, bond delta, scaled up, midpoint.
  matrix_buffer[matrix_offset] = right_x * radius_scale
  matrix_buffer[matrix_offset + 2] = right_z * radius_scale
  matrix_buffer[matrix_offset + 4] = delta_x
  matrix_buffer[matrix_offset + 5] = delta_y
  matrix_buffer[matrix_offset + 6] = delta_z
  matrix_buffer[matrix_offset + 8] = up_x * radius_scale
  matrix_buffer[matrix_offset + 9] = up_y * radius_scale
  matrix_buffer[matrix_offset + 10] = up_z * radius_scale
}
