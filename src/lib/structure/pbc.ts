// Periodic boundary conditions utilities
import type { Vec3 } from '#lib/math'
import * as math from '#lib/math'
import {
  get_bond_data,
  get_explicit_bond_metadata,
  has_framework_potential,
  intern_site_elements,
  is_spectator_center,
  lattice_shift,
  shift_bonds_for_moved_sites,
  type BondingOptions,
  type BondingStrategy,
} from './bonding'
import { BondFrame, bond_site_1, bond_site_2, type BondData } from './bond-rendering'
import { compute_polyhedra } from './polyhedra'
import type { Polyhedron, ResolvedPolyhedraOptions } from './polyhedra'
import { numeric_sites } from './site'
import type { AnyStructure, BondPair, Site, StructureBond } from './index'

export type Pbc = readonly [boolean, boolean, boolean]

// An integer lattice shift. Read-only: the shared constants below are handed to every caller.
type Shift = Readonly<Vec3>
const shifted = (vec: Shift, shift: Shift): Vec3 => [
  vec[0] + shift[0],
  vec[1] + shift[1],
  vec[2] + shift[2],
]
// Pack a site index and its lattice shift (within -reach..reach per axis) into one integer
// key, so the image dedupe in find_image_atoms builds no string per candidate
const pack_image_key = (site_idx: number, shift: Shift, reach: number): number => {
  const radix = 2 * reach + 1
  return (
    ((site_idx * radix + shift[0] + reach) * radix + shift[1] + reach) * radix +
    shift[2] +
    reach
  )
}
// in-cell bonds carry no cell_shift: the bond normalizers drop zero shifts
const bond_cell_shift = (bonds: BondData, bond_idx: number): Shift | undefined =>
  bonds instanceof BondFrame ? bonds.cell_shift(bond_idx) : bonds[bond_idx].cell_shift
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
export const wrap_to_unit_cell = (frac: Vec3, pbc: Pbc = [true, true, true]): Vec3 =>
  frac.map((coord, axis) => (pbc[axis] ? wrap_frac_coord(coord) : coord)) as Vec3

// Trajectory-like data: >10% of atoms far outside the unit cell along a periodic axis (a
// slab may extend past its vacuum axis). Image-atom generation is skipped for such structures.
const is_scattered_trajectory = (sites: Site[], pbc: Pbc): boolean => {
  // molecules kept whole reach past faces by design (unwrap_molecules), so they don't count
  const atoms_outside_cell = sites.filter(
    ({ abc, provenance }) =>
      !provenance?.whole_molecule &&
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
      bonding_options: BondingOptions
    }
export type ImageAtomCompletion = ImageAtomOptions[`completion`]
// is_completion marks phase-2 images that only complete bonds / coordination polyhedra at
// cell faces
export type ImageAtom = { site_idx: number; xyz: Vec3; abc: Vec3; is_completion: boolean }

// Image atoms for PBC. Skips scattered trajectories.
export const find_image_atoms = (
  structure: AnyStructure,
  options: ImageAtomOptions,
): ImageAtom[] => image_atoms(structure, options).images

// Image atoms plus, once completion read the periodic polyhedra, the image keys
// (pack_image_key with `reach`) of the displayed copies whose polyhedron it completed whole
function image_atoms(
  structure: AnyStructure,
  options: ImageAtomOptions,
): { images: ImageAtom[]; complete_centers?: Set<number>; reach: number } {
  if (!(`lattice` in structure) || structure.sites.length === 0)
    return { images: [], reach: 1 }
  const { matrix, pbc } = structure.lattice // pbc: no images across vacuum
  if (is_scattered_trajectory(structure.sites, pbc)) return { images: [], reach: 1 }
  const frac_to_cart = math.create_frac_to_cart(matrix)
  const heights = math.cell_heights(matrix) // all Infinity for a zero-volume cell

  const images: ImageAtom[] = []
  const push_copy = (site_idx: number, shift: Shift, is_completion: boolean): void => {
    const abc = shifted(structure.sites[site_idx].abc, shift)
    images.push({ site_idx, xyz: frac_to_cart(abc), abc, is_completion })
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
  // Sites of a molecule kept whole (unwrap_molecules) get none: the copy would sit alone
  const copy_shifts = structure.sites.map(({ abc, provenance }): readonly Shift[] => {
    if (
      provenance?.whole_molecule ||
      AXES.every((axis) => !near_low(abc, axis) && !near_high(abc, axis))
    )
      return BASE_ONLY
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
    // distinct shifts, base atom first
    for (let shift_idx = 1; shift_idx < shifts.length; shift_idx++)
      push_copy(idx, shifts[shift_idx], false)

  // Phase 2: copies beyond the faces, read off the renderer's bonding on the periodic bond
  // graph, so a copy only appears as the bonded partner of a displayed atom. The modes nest:
  // - polyhedra: the corners of every polyhedron the renderer draws, beside each displayed
  //   copy of its center, so polyhedra crossing a face stay whole while other bonds stop at it
  // - boundary: also every bond of an atom on a face, edge or corner
  // - none: nothing beyond the phase-1 face copies
  // A zero-volume cell has no periodic bond graph (infinite cell heights).
  if (options.completion === `none` || !pbc.some(Boolean) || heights.includes(Infinity))
    return { images, reach: 1 }
  const { completion, polyhedra: polyhedra_options } = options
  const { symbols, site_elem_ids, elem_data } = intern_site_elements(structure.sites)
  // Polyhedra mode skips the bond search (and with no polyhedra to judge, stamps nothing)
  // when none draw: polyhedra hidden, or anion polyhedra in a metal or alloy (no nonmetal
  // corner). Corners of hidden polyhedra would still end drawn bonds, floating beyond faces.
  const no_polyhedra =
    !polyhedra_options ||
    (polyhedra_options.neighbor_mode === `anion` && elem_data.every((elem) => elem?.metal))
  if (completion === `polyhedra` && no_polyhedra) return { images, reach: 1 }
  const { bonding_strategy, bonding_options } = options
  const bonds = get_bond_data(structure, bonding_strategy, { ...bonding_options, pbc })
  // Copies stay in the cell's neighbor shell: the cells holding the bond partners of the
  // base cell (shifts of -1/0/1 unless a sheared cell bonds further, e.g. cubic SrTiO3 in
  // basis [[1,0,0],[2,1,0],[-1,1,1]] has Ti-O bonds 2 cells out). Completing the shells of
  // copies further out (bonds of a corner image pointing away from the cell) grows a
  // cluster, e.g. 36 instead of 12 completion images for a 1-atom fcc cell.
  const shell: Vec3 = [1, 1, 1]
  // Sites bonded across a face: with the face sites, the only polyhedron centers that can
  // need corners beyond the cell
  const bonds_out = new Uint8Array(structure.sites.length)
  for (let bond_idx = 0; bond_idx < bonds.length; bond_idx++) {
    const bond_shift = bond_cell_shift(bonds, bond_idx)
    if (!bond_shift) continue
    bonds_out[bond_site_1(bonds, bond_idx)] = 1
    bonds_out[bond_site_2(bonds, bond_idx)] = 1
    for (const axis of AXES) shell[axis] = Math.max(shell[axis], Math.abs(bond_shift[axis]))
  }
  // An interior center's polyhedron lies in the cell: it is complete, its corners are base atoms
  const is_interior = (site_idx: number): boolean =>
    copy_shifts[site_idx] === BASE_ONLY && !bonds_out[site_idx]
  const in_shell = (shift: Shift) => AXES.every((axis) => Math.abs(shift[axis]) <= shell[axis])
  const reach = Math.max(...shell) // the largest |shift| of any image
  // Explicit file bonds can span absurdly many cells; past 2^53 distinct image keys would
  // collide, so skip completion (keeping the face copies) rather than crash the viewer
  if (structure.sites.length * (2 * reach + 1) ** 3 > Number.MAX_SAFE_INTEGER) {
    console.warn(`Bond cell shifts reach ${reach} cells, too far to complete periodic images`)
    return { images, reach: 1 }
  }
  const seen_images = new Set(
    images.map(({ site_idx, abc }) =>
      pack_image_key(site_idx, lattice_shift(abc, structure.sites[site_idx].abc), reach),
    ),
  )
  // Add the copy of a site shifted by whole cells, at most once
  const add_copy = (site_idx: number, shift: Shift): void => {
    if (shift[0] === 0 && shift[1] === 0 && shift[2] === 0) return // the base atom
    const key = pack_image_key(site_idx, shift, reach)
    if (seen_images.has(key)) return
    seen_images.add(key)
    push_copy(site_idx, shift, true)
  }

  // Each displayed copy of a polyhedron center gets all its corners or none: a copy truncated
  // at the shell's edge is left out of complete_centers, so compute_polyhedra keeps it undrawn
  // rather than leave corners added for it floating
  const complete_centers = polyhedra_options && new Set<number>()
  const cart_to_frac = math.create_cart_to_frac(matrix)
  const polyhedra = polyhedra_options
    ? compute_polyhedra(structure, bonds, polyhedra_options, is_interior)
    : []
  for (const { center_site_idx, vertex_site_idxs, vertices } of polyhedra) {
    if (is_interior(center_site_idx)) {
      complete_centers?.add(pack_image_key(center_site_idx, ZERO_SHIFT, reach))
      continue
    }
    const corner_shifts = vertex_site_idxs.map((site_idx, vertex_idx) => {
      const { abc } = structure.sites[site_idx]
      return lattice_shift(cart_to_frac(vertices[vertex_idx]), abc)
    })
    for (const copy_shift of copy_shifts[center_site_idx]) {
      const shifts = corner_shifts.map((shift) => shifted(shift, copy_shift))
      if (!shifts.every(in_shell)) continue
      complete_centers?.add(pack_image_key(center_site_idx, copy_shift, reach))
      for (const [vertex_idx, shift] of shifts.entries())
        add_copy(vertex_site_idxs[vertex_idx], shift)
    }
  }
  if (completion === `polyhedra`) return { images, complete_centers, reach }

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
      if (in_shell(shift)) add_copy(far, shift)
    }
  }
  for (let bond_idx = 0; bond_idx < bonds.length; bond_idx++) {
    const site_1 = bond_site_1(bonds, bond_idx)
    const site_2 = bond_site_2(bonds, bond_idx)
    if (copy_shifts[site_1] === BASE_ONLY && copy_shifts[site_2] === BASE_ONLY) continue
    if (elem_skipped[site_elem_ids[site_1]] || elem_skipped[site_elem_ids[site_2]]) continue
    const bond_shift = bond_cell_shift(bonds, bond_idx) ?? ZERO_SHIFT
    complete_bond(site_1, site_2, bond_shift, 1)
    complete_bond(site_2, site_1, bond_shift, -1)
  }
  return { images, complete_centers, reach }
}

// Return structure with image atoms added (unchanged when none are generated, e.g. for
// scattered trajectory-like data). Once completion read the periodic polyhedra, every site
// carries polyhedron_center, true only on the displayed copies whose polyhedron it completed.
export function get_pbc_image_sites(
  structure: AnyStructure,
  options: ImageAtomOptions,
): AnyStructure {
  const { images, complete_centers, reach } = image_atoms(structure, options)
  if (images.length === 0 && !complete_centers) return structure
  const stamp = (site: Site, site_idx: number, shift: Shift): Site =>
    complete_centers
      ? {
          ...site,
          provenance: {
            ...site.provenance,
            polyhedron_center: complete_centers.has(pack_image_key(site_idx, shift, reach)),
          },
        }
      : site
  const sites = structure.sites.map((site, site_idx) => stamp(site, site_idx, ZERO_SHIFT))
  for (const { site_idx, xyz, abc, is_completion } of images) {
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
    sites.push(stamp(image, site_idx, lattice_shift(abc, orig_site.abc)))
  }
  return { ...structure, sites }
}

// A displayed site as its base site and lattice shift: stable while image sets renumber
export const site_token = ({ sites }: AnyStructure, site_idx: number): string => {
  const { abc, provenance } = sites[site_idx]
  const base_idx = provenance?.image_of
  if (base_idx === undefined) return `${site_idx}`
  return `${base_idx}:${lattice_shift(abc, sites[base_idx].abc)}`
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
    const shift = lattice_shift(cart_to_frac(xyz), sites[base_idx].abc)
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

// Reassemble molecules torn across cell faces by per-atom wrapping. `bonds` is the periodic
// bond graph: a bond (i, j, cell_shift) puts j's image at cell_shift next to i. A breadth-first
// walk of each connected component gives every site the lattice translation placing it beside
// the neighbour that reached it. A component reaching a site again at another translation
// bonds to its own periodic image (chain, layer or network, e.g. a MOF): it stays wrapped.
// Finite fragments then move by whole cells so their unweighted fractional centroid lies in
// [0, 1) per periodic axis, and sites of 2+ site fragments get provenance.whole_molecule (image
// atoms add no lone face copy of them). Moved sites record their translation as
// provenance.unwrap_shift (see shift_bonds_by_unwrap). Site order and properties are kept.
// Returns the input when nothing changes, else the bonds carried over (see carry_bonds) to
// seed the bond memo.
export function unwrap_molecules<Struct extends AnyStructure>(
  structure: Struct,
  bonds: BondPair[] | BondFrame,
): { structure: Struct; bonds: BondPair[] | BondFrame } {
  if (!(`lattice` in structure)) return { structure, bonds }
  const { sites, lattice } = structure
  const n_sites = sites.length
  const neighbors: { site_idx: number; shift: Vec3 }[][] = sites.map(() => [])
  for (let bond_idx = 0; bond_idx < bonds.length; bond_idx++) {
    const site_1 = bond_site_1(bonds, bond_idx)
    const site_2 = bond_site_2(bonds, bond_idx)
    const shift = (bond_cell_shift(bonds, bond_idx) ?? ZERO_SHIFT).map(Math.round) as Vec3
    neighbors[site_1].push({ site_idx: site_2, shift })
    neighbors[site_2].push({ site_idx: site_1, shift: shift.map((val) => -val) as Vec3 })
  }
  const translations = Array.from<Vec3 | undefined>({ length: n_sites })
  const frac_to_cart = math.create_frac_to_cart(lattice.matrix)
  let changed = false
  const new_sites = [...sites]
  const totals = sites.map((): Vec3 => [0, 0, 0])
  for (let anchor = 0; anchor < n_sites; anchor++) {
    if (translations[anchor]) continue
    translations[anchor] = [0, 0, 0]
    const component = [anchor]
    let periodic = false
    // the BFS queue: for...of also visits sites pushed while it runs
    for (const site_idx of component) {
      const own = translations[site_idx] as Vec3
      for (const { site_idx: other, shift } of neighbors[site_idx]) {
        const target = shifted(own, shift)
        const placed = translations[other]
        if (!placed) {
          translations[other] = target
          component.push(other)
        } else if (AXES.some((axis) => placed[axis] !== target[axis])) periodic = true
      }
    }
    if (periodic) continue
    const recenter = AXES.map((axis) => {
      if (!lattice.pbc[axis]) return 0
      const sum = component.reduce(
        (acc, idx) => acc + sites[idx].abc[axis] + (translations[idx] as Vec3)[axis],
        0,
      )
      return -Math.floor(sum / component.length) // centroid into [0, 1)
    }) as Vec3
    const whole = component.length > 1
    for (const site_idx of component) {
      const total = shifted(translations[site_idx] as Vec3, recenter)
      if (!whole && total.every((val) => val === 0)) continue
      changed = true
      totals[site_idx] = total
      const site = sites[site_idx]
      new_sites[site_idx] = {
        ...site,
        abc: shifted(site.abc, total),
        xyz: shifted(site.xyz, frac_to_cart(total)),
        provenance: {
          ...site.provenance,
          ...(whole && { whole_molecule: true }),
          ...(total.some(Boolean) && { unwrap_shift: total }),
        },
      }
    }
  }
  if (!changed) return { structure, bonds }
  // explicit bond metadata (the rows the bond reader keeps) moves with its sites, else a
  // fresh read of it misplaces endpoints
  const explicit = get_explicit_bond_metadata(structure)
  const unwrapped = {
    ...structure,
    sites: new_sites,
    ...(explicit.length > 0 && {
      properties: {
        ...structure.properties,
        bonds: shift_bonds_for_moved_sites(explicit, (site_idx) => totals[site_idx]),
      },
    }),
  }
  return { structure: unwrapped, bonds: carry_bonds(unwrapped, bonds, totals, frac_to_cart) }
}

// Bonds addressed in the wrapped frame (the viewer's saved bond edits) on the sites
// unwrap_molecules moved by provenance.unwrap_shift t: cell_shift s reads s + t_1 - t_2
// (sign 1), and back to the wrapped frame with sign -1. A bond with neither end moved keeps
// its object, and with no moved site the array is returned as is.
export const shift_bonds_by_unwrap = (
  bonds: StructureBond[],
  sites: readonly Site[],
  sign: 1 | -1,
): StructureBond[] =>
  sites.some((site) => site.provenance?.unwrap_shift)
    ? shift_bonds_for_moved_sites(
        bonds,
        (site_idx) =>
          sites[site_idx]?.provenance?.unwrap_shift?.map((val) => sign * val) as
            | Vec3
            | undefined,
      )
    : bonds

// Bonds addressed in one frame's wrapped sites, re-addressed for the next frame of the same
// atoms: each takes the image of site_2 nearest its displacement in the previous frame, so a
// site the next frame wraps across a periodic face keeps its partner (a minimum-image bond stays
// one, an explicit longer image bond keeps its length). Holds while no bond vector changes by
// half a cell between the two frames. Without a lattice the bonds are returned as is.
export const carry_bonds_across_frame = (
  bonds: StructureBond[],
  previous: AnyStructure,
  next: AnyStructure,
): StructureBond[] => {
  if (!(`lattice` in previous) || !(`lattice` in next)) return bonds
  const { pbc } = next.lattice
  return bonds.map((bond) => {
    const { site_idx_1, site_idx_2, cell_shift = ZERO_SHIFT } = bond
    const [prev_1, prev_2] = [previous.sites[site_idx_1].abc, previous.sites[site_idx_2].abc]
    const [next_1, next_2] = [next.sites[site_idx_1].abc, next.sites[site_idx_2].abc]
    const jump = AXES.map((axis) =>
      pbc[axis] ? Math.round(prev_2[axis] - prev_1[axis] - (next_2[axis] - next_1[axis])) : 0,
    ) as Vec3
    if (jump.every((val) => val === 0)) return bond
    const { cell_shift: _old_shift, ...rest } = bond
    const carried = shifted(cell_shift, jump)
    return carried.some(Boolean) ? { ...rest, cell_shift: carried } : rest
  })
}

// Bond cell_shift s after its sites moved by lattice translations: s + t_1 - t_2
const carried_shift = (
  shift: Vec3 | undefined,
  totals: Vec3[],
  site_1: number,
  site_2: number,
) =>
  shifted(
    shifted(shift ?? ZERO_SHIFT, totals[site_1]),
    totals[site_2].map((val) => -val) as Vec3,
  )

// Bonds of a structure whose sites moved by lattice translations `totals`: the same pairs,
// lengths and orders, each cell_shift s becoming s + t_1 - t_2 (site 2's image at x_2 + s next
// to site 1 is at x_2' + s' next to x_1' = x_1 + t_1), in-cell when that is zero.
function carry_bonds(
  structure: AnyStructure,
  bonds: BondPair[] | BondFrame,
  totals: Vec3[],
  frac_to_cart: (frac: Vec3) => Vec3,
): BondPair[] | BondFrame {
  const { sites } = structure
  const placement = (site_1: number, site_2: number, old_shift?: Vec3) => {
    const shift = carried_shift(old_shift, totals, site_1, site_2)
    const in_cell = shift.every((val) => val === 0)
    return {
      cell_shift: in_cell ? undefined : shift,
      pos_2: in_cell ? sites[site_2].xyz : shifted(sites[site_2].xyz, frac_to_cart(shift)),
    }
  }
  if (!(bonds instanceof BondFrame)) {
    return bonds.map(({ cell_shift: old_shift, ...bond }) => {
      const { cell_shift, pos_2 } = placement(bond.site_idx_1, bond.site_idx_2, old_shift)
      return {
        ...bond,
        pos_1: sites[bond.site_idx_1].xyz,
        pos_2,
        ...(cell_shift && { cell_shift }),
      }
    })
  }
  const image_rows: number[] = []
  for (let idx = 0; idx < bonds.length; idx++) {
    const { cell_shift, pos_2 } = placement(
      bond_site_1(bonds, idx),
      bond_site_2(bonds, idx),
      bonds.cell_shift(idx),
    )
    if (cell_shift) image_rows.push(idx, ...pos_2, ...cell_shift)
  }
  return new BondFrame(structure, { ...bonds.columns, images: new Float64Array(image_rows) })
}
