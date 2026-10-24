// Periodic boundary conditions utilities
import type { Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import {
  get_bond_data,
  has_framework_potential,
  intern_site_elements,
  is_spectator_center,
  type BondingStrategy,
} from './bonding'
import { BondFrame, bond_site_1, bond_site_2, type BondData } from './bond-rendering'
import { compute_polyhedra } from './polyhedra'
import type { Polyhedron, ResolvedPolyhedraOptions } from './polyhedra'
import { numeric_sites } from './site'
import type { AnyStructure, Site } from './index'

export type Pbc = readonly [boolean, boolean, boolean]

// An integer lattice shift. Read-only: the shared constants below are handed to every caller.
type Shift = Readonly<Vec3>
const shifted = (vec: Shift, shift: Shift): Vec3 => [
  vec[0] + shift[0],
  vec[1] + shift[1],
  vec[2] + shift[2],
]
// Pack a site index and its lattice shift (-1/0/1 per axis) into one integer key, so the
// image dedupe in find_image_atoms builds no string per candidate
const pack_image_key = (site_idx: number, shift: Shift): number =>
  site_idx * 27 + (shift[0] + 1) * 9 + (shift[1] + 1) * 3 + shift[2] + 1
const FACE_TOLERANCE = 0.1 // Å from a cell face that still counts as on it (see phase 1)
const ZERO_SHIFT: Shift = [0, 0, 0]
// The displayed copies of an interior site: just the base atom
const BASE_ONLY: readonly Shift[] = [ZERO_SHIFT]
const AXES = [0, 1, 2] as const

// Wrap a single fractional coordinate to [0, 1), snapping near-1 values to 0 and rounding
// to 15 digits to suppress floating-point noise. The one wrap helper for parsed coordinates,
// moyo-standardized Wyckoff positions and symmetry-element fixed points alike; the symmetry
// dedup keys downstream quantize at 1e-4 / 1e-8, far coarser than this snap.
export const wrap_frac_coord = (coord: number): number => {
  const wrapped = coord - Math.floor(coord)
  if (wrapped >= 1 - 1e-10) return 0
  const scaled = wrapped * 1e15
  const fraction = scaled - Math.floor(scaled)
  // Near a decimal halfway boundary, scaled * EPSILON bounds multiplication error.
  // Outside that bound, rounding the product selects the same integer as toFixed.
  // Close boundaries retain toFixed's exact decimal rounding of the original float.
  if (Math.abs(fraction - 0.5) > scaled * Number.EPSILON) return Math.round(scaled) / 1e15
  return Number(wrapped.toFixed(15))
}

// Wrap fractional coords to [0, 1). Non-periodic axes keep their out-of-cell coordinate
// (matching normalize_fractional_coords) — folding a slab along its vacuum direction tears it.
export const wrap_to_unit_cell = (frac: Vec3, pbc: Pbc = [true, true, true]): Vec3 => [
  pbc[0] ? wrap_frac_coord(frac[0]) : frac[0],
  pbc[1] ? wrap_frac_coord(frac[1]) : frac[1],
  pbc[2] ? wrap_frac_coord(frac[2]) : frac[2],
]

// Trajectory-like data: >10% of atoms far outside the unit cell along a periodic axis (a
// slab may extend past its vacuum axis). Image-atom generation is skipped for such structures.
const is_scattered_trajectory = (sites: Site[], pbc: Pbc): boolean => {
  const atoms_outside_cell = sites.filter(({ abc }) =>
    abc.some((coord, axis) => pbc[axis] && (coord < -0.1 || coord > 1.1)),
  )
  return atoms_outside_cell.length > sites.length * 0.1
}

// How image atoms complete the boundary beyond the cell faces (see phase 2). Completion reads
// the renderer's own polyhedra options (polyhedra_options_from, absent while it draws no
// polyhedra) and bonding, so what it completes is what gets drawn.
export type ImageAtomOptions =
  | { completion: `none` }
  | {
      completion: `polyhedra` | `boundary`
      polyhedra?: ResolvedPolyhedraOptions
      bonding_strategy: BondingStrategy
      bonding_options: Record<string, unknown>
    }
export type ImageAtomCompletion = ImageAtomOptions[`completion`]
// [atom_idx, image_xyz, image_abc, is_completion]: is_completion marks phase-2 images that
// only complete bonds / coordination polyhedra at cell faces
export type ImageAtom = [number, Vec3, Vec3, boolean]

// Image atoms for PBC. Skips scattered trajectories.
export const find_image_atoms = (
  structure: AnyStructure,
  options: ImageAtomOptions,
): ImageAtom[] => image_atoms(structure, options).images

// Image atoms plus, once completion read the periodic polyhedra, the image keys
// (pack_image_key) of the displayed copies whose polyhedron it completed whole
function image_atoms(
  structure: AnyStructure,
  options: ImageAtomOptions,
): { images: ImageAtom[]; complete_centers?: Set<number> } {
  if (!(`lattice` in structure) || structure.sites.length === 0) return { images: [] }
  const { matrix, pbc } = structure.lattice // pbc: no images across vacuum
  if (is_scattered_trajectory(structure.sites, pbc)) return { images: [] }
  const frac_to_cart = math.create_frac_to_cart(matrix)
  const heights = math.cell_heights(matrix) // all Infinity for a zero-volume cell

  const images: ImageAtom[] = []
  const seen_images = new Set<number>()
  // Add the copy of a site shifted by whole cells, at most once
  const add_copy = (site_idx: number, shift: Shift, is_completion: boolean): void => {
    if (shift[0] === 0 && shift[1] === 0 && shift[2] === 0) return // the base atom
    const key = pack_image_key(site_idx, shift)
    if (seen_images.has(key)) return
    seen_images.add(key)
    const img_abc = shifted(structure.sites[site_idx].abc, shift)
    images.push([site_idx, frac_to_cart(img_abc), img_abc, is_completion])
  }

  // Phase 1: true periodic copies (not clamped to the face) of atoms within FACE_TOLERANCE of
  // a cell face along the cell heights: relaxation noise on face, edge and corner atoms, while
  // an interior atom's copy would float outside the drawn cell. copy_shifts lists each site's
  // displayed copies, base atom first; interior sites (most of a supercell) share one list.
  const tolerances = heights.map((height) => FACE_TOLERANCE / height)
  const near_low = (abc: Vec3, axis: number) =>
    pbc[axis] && Math.abs(abc[axis]) < tolerances[axis]
  const near_high = (abc: Vec3, axis: number) =>
    pbc[axis] && Math.abs(abc[axis] - 1) < tolerances[axis]
  const copy_shifts = structure.sites.map(({ abc }): readonly Shift[] => {
    if (AXES.every((axis) => !near_low(abc, axis) && !near_high(abc, axis))) return BASE_ONLY
    // per axis: stay, +1 off the low face, -1 off the high face
    const [shifts_a, shifts_b, shifts_c] = AXES.map((axis) => [
      0,
      ...(near_low(abc, axis) ? [1] : []),
      ...(near_high(abc, axis) ? [-1] : []),
    ])
    return shifts_a.flatMap((shift_a) =>
      shifts_b.flatMap((shift_b) =>
        shifts_c.map((shift_c): Vec3 => [shift_a, shift_b, shift_c]),
      ),
    )
  })
  for (const [idx, shifts] of copy_shifts.entries())
    for (const shift of shifts) add_copy(idx, shift, false)

  // Phase 2: copies beyond the faces, read off the renderer's bonding on the periodic bond
  // graph, so a copy only appears as the bonded partner of a displayed atom. The modes nest:
  // - polyhedra: the corners of every polyhedron the renderer draws, beside each displayed
  //   copy of its center, so polyhedra crossing a face stay whole while other bonds stop at it
  // - boundary: also every bond of an atom on a face, edge or corner
  // - none: nothing beyond the phase-1 face copies
  // A zero-volume cell has no periodic bond graph (infinite cell heights).
  if (options.completion === `none` || !pbc.some(Boolean) || heights.includes(Infinity))
    return { images }
  const { completion, polyhedra: polyhedra_options } = options
  const { symbols, site_elem_ids, elem_data } = intern_site_elements(structure.sites)
  // Polyhedra mode skips the bond search (and with no polyhedra to judge, stamps nothing)
  // when none draw: polyhedra hidden, or anion polyhedra in a metal or alloy (no nonmetal
  // corner). Corners of hidden polyhedra would still end drawn bonds, floating beyond faces.
  const no_polyhedra =
    !polyhedra_options ||
    (polyhedra_options.neighbor_mode === `anion` && elem_data.every((elem) => elem?.metal))
  if (completion === `polyhedra` && no_polyhedra) return { images }
  const { bonding_strategy, bonding_options } = options
  const bonds = get_bond_data(structure, bonding_strategy, { ...bonding_options, pbc })
  // Copies stay in the cell's neighbor shell (shifts of -1/0/1): completing the shells of
  // copies further out (bonds of a corner image pointing away from the cell) grows a cluster,
  // e.g. 36 instead of 12 completion images for a 1-atom fcc cell
  const in_shell = (shift: Shift) => shift.every((val) => Math.abs(val) <= 1)

  // Each displayed copy of a polyhedron center gets all its corners or none: a copy truncated
  // at the shell's edge is left out of complete_centers, so compute_polyhedra keeps it undrawn
  // rather than leave corners added for it floating
  const complete_centers = polyhedra_options && new Set<number>()
  const cart_to_frac = math.create_cart_to_frac(matrix)
  const polyhedra = polyhedra_options
    ? compute_polyhedra(structure, bonds, polyhedra_options)
    : []
  for (const { center_site_idx, vertex_site_idxs, vertices } of polyhedra) {
    const corner_shifts = vertex_site_idxs.map((site_idx, vertex_idx) => {
      const { abc } = structure.sites[site_idx]
      const frac = cart_to_frac(vertices[vertex_idx])
      return frac.map((coord, axis) => Math.round(coord - abc[axis])) as Vec3
    })
    for (const copy_shift of copy_shifts[center_site_idx]) {
      const shifts = corner_shifts.map((shift) => shifted(shift, copy_shift))
      if (!shifts.every(in_shell)) continue
      complete_centers?.add(pack_image_key(center_site_idx, copy_shift))
      for (const [vertex_idx, shift] of shifts.entries())
        add_copy(vertex_site_idxs[vertex_idx], shift, true)
    }
  }
  if (completion === `polyhedra`) return { images, complete_centers }

  // Boundary mode: every bond of a face atom (one with phase-1 copies), in both directions.
  // Spectator A-site cations (Li/Na, heavy alkaline earths) stay out when a framework cation
  // is present: they render no polyhedron, so completing their shells floats coordination
  // groups (e.g. a PO4 around a corner Li) beyond the cell. Purely ionic binaries (NaCl)
  // keep theirs. Resolved per element: a supercell repeats the same few elements.
  const skip_spectators = has_framework_potential(symbols)
  const elem_skipped = symbols.map((elem) => skip_spectators && is_spectator_center(elem))
  const shift: Vec3 = [0, 0, 0] // scratch: add_copy copies it
  // The bond's far end beside every displayed copy of a face atom at its near end; `sign`
  // flips the bond's cell shift for the reverse direction
  const complete_bond = (near: number, far: number, bond_shift: Shift, sign: number): void => {
    if (copy_shifts[near] === BASE_ONLY) return // interior atom
    for (const copy_shift of copy_shifts[near]) {
      for (const axis of AXES) shift[axis] = copy_shift[axis] + sign * bond_shift[axis]
      if (in_shell(shift)) add_copy(far, shift, true)
    }
  }
  for (let bond_idx = 0; bond_idx < bonds.length; bond_idx++) {
    const site_1 = bond_site_1(bonds, bond_idx)
    const site_2 = bond_site_2(bonds, bond_idx)
    if (copy_shifts[site_1] === BASE_ONLY && copy_shifts[site_2] === BASE_ONLY) continue
    if (elem_skipped[site_elem_ids[site_1]] || elem_skipped[site_elem_ids[site_2]]) continue
    // in-cell bonds carry no cell_shift: the bond normalizers drop zero shifts
    const bond_shift =
      (bonds instanceof BondFrame ? bonds.cell_shift(bond_idx) : bonds[bond_idx].cell_shift) ??
      ZERO_SHIFT
    complete_bond(site_1, site_2, bond_shift, 1)
    complete_bond(site_2, site_1, bond_shift, -1)
  }
  return { images, complete_centers }
}

// Return structure with image atoms added (unchanged when none are generated, e.g. for
// scattered trajectory-like data). Once completion read the periodic polyhedra, every site
// carries polyhedron_center, true only on the displayed copies whose polyhedron it completed.
export function get_pbc_image_sites(
  structure: AnyStructure,
  options: ImageAtomOptions,
): AnyStructure {
  const { images, complete_centers } = image_atoms(structure, options)
  if (images.length === 0 && !complete_centers) return structure
  const stamp = (site: Site, site_idx: number, shift: Shift): Site =>
    complete_centers
      ? {
          ...site,
          provenance: {
            ...site.provenance,
            polyhedron_center: complete_centers.has(pack_image_key(site_idx, shift)),
          },
        }
      : site
  const sites = structure.sites.map((site, site_idx) => stamp(site, site_idx, ZERO_SHIFT))
  for (const [site_idx, xyz, abc, is_completion] of images) {
    const orig_site = structure.sites[site_idx]
    const image: Site = {
      ...orig_site,
      abc,
      xyz,
      properties: { ...orig_site.properties },
      provenance: {
        ...orig_site.provenance,
        image_of: site_idx,
        // phase-2 images only complete bonds/polyhedra: drawn only while they end one
        ...(is_completion ? { completion: true } : {}),
      },
    }
    const shift = abc.map((coord, axis) => Math.round(coord - orig_site.abc[axis])) as Vec3
    sites.push(stamp(image, site_idx, shift))
  }
  return { ...structure, sites }
}

// A displayed site as its base site and lattice shift: stable while image sets renumber
export const site_token = ({ sites }: AnyStructure, site_idx: number): string => {
  const { abc, provenance } = sites[site_idx]
  const base_idx = provenance?.image_of
  if (base_idx === undefined) return `${site_idx}`
  return `${base_idx}:${abc.map((coord, axis) => Math.round(coord - sites[base_idx].abc[axis]))}`
}

const NO_SITES: ReadonlySet<number> = new Set()
// Completion images a drawn bond or polyhedron ends at, i.e. the ones that draw. Perceived bonds
// name the copy itself; explicit periodic bonds (and polyhedra built on them) name a site plus a
// cell shift, so an end away from its named site finds its copy by site_token. Numeric
// trajectory frames have no completion images (and reading their sites would build them).
export function find_drawn_completion_sites(
  structure: AnyStructure | undefined,
  bonds: BondData,
  polyhedra: readonly Polyhedron[],
): ReadonlySet<number> {
  if (!structure || !(`lattice` in structure) || numeric_sites.has(structure)) return NO_SITES
  const { sites } = structure
  if (!sites.some((site) => site.provenance?.completion)) return NO_SITES
  const cart_to_frac = math.create_cart_to_frac(structure.lattice.matrix)
  const drawn = new Set<number>()
  let copy_at: Map<string, number> | undefined // built on the first shifted end
  const add_end = (site_idx: number, xyz: Vec3): void => {
    drawn.add(site_idx)
    if (math.same_position(xyz, sites[site_idx].xyz)) return
    const base_idx = sites[site_idx].provenance?.image_of ?? site_idx
    const { abc } = sites[base_idx]
    const shift = cart_to_frac(xyz).map((coord, axis) => Math.round(coord - abc[axis]))
    copy_at ??= new Map(
      sites.flatMap((site, idx) =>
        site.provenance?.completion ? [[site_token(structure, idx), idx] as const] : [],
      ),
    )
    const copy_idx = copy_at.get(`${base_idx}:${shift}`)
    if (copy_idx !== undefined) drawn.add(copy_idx)
  }
  for (let idx = 0; idx < bonds.length; idx++) {
    drawn.add(bond_site_1(bonds, idx))
    const end = bonds instanceof BondFrame ? bonds.position_2(idx) : bonds[idx].pos_2
    add_end(bond_site_2(bonds, idx), end)
  }
  for (const { vertex_site_idxs, vertices } of polyhedra)
    for (const [vertex_idx, site_idx] of vertex_site_idxs.entries())
      add_end(site_idx, vertices[vertex_idx])
  return drawn
}
