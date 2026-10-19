// Stack a film slab on a substrate slab: build both coincidence supercells, strain the film
// onto the substrate's in-plane lattice and pile the two up along the substrate's normal.
import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import { assemble_crystal } from '#lib/slab/lattice-basis.js'
import { MAX_SLAB_SITES } from '#lib/slab/types.js'
import type { Crystal, Site } from '#lib/structure/index.js'
import { wrap_frac_coord } from '#lib/structure/pbc.js'
import { det2, match_of_matrices, mul2, surface_frame, unit_cell_match } from './lattice-match'
import type {
  Heterostructure,
  InterfaceOptions,
  InterfaceRole,
  Matrix2x2,
  SurfaceFrame,
} from './types'
import { INTERFACE_DEFAULTS } from './types'

// Integer in-plane supercell of a slab (or any crystal): a', b' = M · [a, b], c unchanged.
// The |det M| lattice points n of the old cell inside the new one are found exactly: n lies
// in it iff its new fractional coordinates n · M⁻¹ = n · adj(M) / det are in [0, 1), i.e.
// iff sgn(det) · n · adj(M) has integer components in [0, |det|). The corners of the new
// cell bound the search box, so no epsilon enters anywhere.
export function in_plane_supercell(crystal: Crystal, matrix: Matrix2x2): Crystal {
  const [[m00, m01], [m10, m11]] = matrix
  const det = det2(matrix)
  if (!matrix.flat().every(Number.isInteger) || det === 0) {
    throw new Error(
      `In-plane supercell matrix must be integer with non-zero determinant, ` +
        `got ${JSON.stringify(matrix)} (det ${det})`,
    )
  }
  const n_cells = Math.abs(det)
  const { sites, lattice } = crystal
  if (n_cells * sites.length > MAX_SLAB_SITES) {
    throw new Error(
      `${JSON.stringify(matrix)} supercell would hold ${n_cells * sites.length} sites ` +
        `(${n_cells} × ${sites.length}), above MAX_SLAB_SITES=${MAX_SLAB_SITES}`,
    )
  }
  const sign = Math.sign(det)
  const [lo_0, hi_0] = math.array_extent([0, m00, m10, m00 + m10])
  const [lo_1, hi_1] = math.array_extent([0, m01, m11, m01 + m11])
  const offsets: Vec2[] = []
  for (let n_0 = lo_0; n_0 <= hi_0; n_0++) {
    for (let n_1 = lo_1; n_1 <= hi_1; n_1++) {
      const coef_0 = sign * (n_0 * m11 - n_1 * m10)
      const coef_1 = sign * (n_1 * m00 - n_0 * m01)
      if (coef_0 >= 0 && coef_0 < n_cells && coef_1 >= 0 && coef_1 < n_cells) {
        offsets.push([n_0, n_1])
      }
    }
  }

  const [vec_a, vec_b, vec_c] = lattice.matrix
  const super_matrix: Matrix3x3 = [
    math.add(math.scale(vec_a, m00), math.scale(vec_b, m01)),
    math.add(math.scale(vec_a, m10), math.scale(vec_b, m11)),
    vec_c,
  ]
  const frac_to_cart = math.create_frac_to_cart(super_matrix)
  const new_sites = sites.flatMap((site) => {
    const [frac_a, frac_b, frac_c] = site.abc
    return offsets.map(([n_0, n_1]): Site => {
      const [old_a, old_b] = [frac_a + n_0, frac_b + n_1]
      const abc: Vec3 = [
        wrap_frac_coord((old_a * m11 - old_b * m10) / det),
        wrap_frac_coord((old_b * m00 - old_a * m01) / det),
        frac_c,
      ]
      return { ...site, abc, xyz: frac_to_cart(abc) }
    })
  })
  const charge = crystal.charge === undefined ? undefined : crystal.charge * n_cells
  return assemble_crystal(crystal, super_matrix, new_sites, lattice.pbc, charge)
}

type StackedSlab = {
  cell: Crystal
  // In-plane fractional coordinates of each site's projection onto the surface (unwrapped)
  coords: Vec2[]
  // Distance above the slab's lowest site along its normal, Å
  heights: number[]
  thickness: number
}

// `slab` with sites moved by whole c vectors so their fractional c is contiguous. A slab read
// from a file can straddle the cell's c boundary, which would put its vacuum mid-slab: the
// slab's bottom is the site just above the largest cyclic gap in fractional c. Only abc moves,
// since in_plane_supercell recomputes xyz from it.
function unwrap_along_c(slab: Crystal): Crystal {
  const floors = slab.sites.map(({ abc }) => Math.floor(abc[2]))
  const fracs = slab.sites.map(({ abc }, idx) => abc[2] - floors[idx])
  const sorted = fracs.toSorted((frac_1, frac_2) => frac_1 - frac_2)
  let [bottom, max_gap] = [sorted[0], sorted[0] + 1 - sorted[sorted.length - 1]]
  for (let idx = 1; idx < sorted.length; idx++) {
    const gap = sorted[idx] - sorted[idx - 1]
    if (gap > max_gap) [bottom, max_gap] = [sorted[idx], gap]
  }
  const sites = slab.sites.map((site, idx): Site => {
    const shift = (fracs[idx] < bottom ? 1 : 0) - floors[idx]
    const [frac_a, frac_b, frac_c] = site.abc
    return shift === 0 ? site : { ...site, abc: [frac_a, frac_b, frac_c + shift] }
  })
  return { ...slab, sites }
}

// Supercell of `slab` split into heights along its normal and fractional coordinates of the
// in-plane projection. Projecting, rather than reading abc[0..1], keeps the in-plane offset a
// tilted c carries (e.g. the ABC registry of fcc(111) layers).
function stack_slab(
  slab: Crystal,
  { basis, axes }: SurfaceFrame,
  matrix: Matrix2x2,
): StackedSlab {
  const cell = in_plane_supercell(unwrap_along_c(slab), matrix)
  // projected (x, y) = (s, t) · B for super-lattice rows B, so (s, t) = (x, y) · adj(B) / det
  const super_basis = mul2(matrix, basis)
  const [[b00, b01], [b10, b11]] = super_basis
  const det = det2(super_basis)
  const [axis_x, axis_y, normal] = axes
  const raw_heights = cell.sites.map(({ xyz }) => math.dot(xyz, normal))
  const coords = cell.sites.map(({ xyz }): Vec2 => {
    const [pos_x, pos_y] = [math.dot(xyz, axis_x), math.dot(xyz, axis_y)]
    return [(pos_x * b11 - pos_y * b10) / det, (pos_y * b00 - pos_x * b01) / det]
  })
  const [bottom, top] = math.array_extent(raw_heights)
  const heights = raw_heights.map((height) => height - bottom)
  return { cell, coords, heights, thickness: top - bottom }
}

const describe_mesh = ({ lattice: { a, b, gamma } }: Crystal): string =>
  `a=${a.toFixed(4)} Å, b=${b.toFixed(4)} Å, γ=${gamma.toFixed(2)}°`

// Stack `film` on `substrate` (slabs whose lattice rows a, b span the surface). Output cell:
// the substrate supercell a', b' and c = n̂ · (substrate + gap + film + vacuum) along the
// substrate normal n̂, pbc [true, true, false]. The substrate's lowest site sits at height 0,
// the film's at substrate thickness + gap. Film sites keep the fractional in-plane coordinates
// they have in the film supercell, now on the substrate supercell (+ shift): that is the
// match's strain and rotation.
//
// Without `match`, the primitive meshes are stacked 1×1 (a onto a, b onto b) if they agree
// within INTERFACE_DEFAULTS.length_tol and angle_tol. Larger mismatches throw rather than
// silently straining the film by more than any match_lattices result would.
export function make_interface(
  substrate: Crystal,
  film: Crystal,
  options: InterfaceOptions = {},
): Heterostructure {
  const {
    gap = INTERFACE_DEFAULTS.gap,
    vacuum = INTERFACE_DEFAULTS.vacuum,
    shift = [0, 0],
  } = options
  math.assert_non_negative(gap, `gap`)
  math.assert_non_negative(vacuum, `vacuum`)
  if (!shift.every(Number.isFinite)) {
    throw new Error(`shift must be finite, got ${JSON.stringify(shift)}`)
  }
  for (const [name, slab] of [
    [`substrate`, substrate],
    [`film`, film],
  ] as const) {
    if (slab.sites.length === 0) throw new Error(`${name} slab has no sites`)
  }
  const sub_frame = surface_frame(substrate)
  const film_frame = surface_frame(film)
  const match = options.match
    ? match_of_matrices(sub_frame.basis, film_frame.basis, options.match)
    : unit_cell_match(sub_frame.basis, film_frame.basis, INTERFACE_DEFAULTS)
  if (!match) {
    throw new Error(
      `Film mesh (${describe_mesh(film)}) does not fit substrate mesh ` +
        `(${describe_mesh(substrate)}) 1×1 within length_tol=` +
        `${INTERFACE_DEFAULTS.length_tol} and angle_tol=${INTERFACE_DEFAULTS.angle_tol}; ` +
        `pass a match from match_lattices`,
    )
  }
  const { film_matrix, substrate_matrix } = match
  if (!(match.n_film_cells > 0 && match.n_substrate_cells > 0)) {
    throw new Error(
      `match matrices must have positive determinants (right-handed), got film ` +
        `${JSON.stringify(film_matrix)} and substrate ${JSON.stringify(substrate_matrix)}`,
    )
  }

  const sub_stack = stack_slab(substrate, sub_frame, substrate_matrix)
  const film_stack = stack_slab(film, film_frame, film_matrix)
  const film_bottom = sub_stack.thickness + gap
  const height = film_bottom + film_stack.thickness + vacuum
  if (!(height > 0)) {
    throw new Error(
      `Interface cell would have zero height: two monolayers need gap or vacuum > 0`,
    )
  }
  const [vec_a, vec_b] = sub_stack.cell.lattice.matrix
  const matrix: Matrix3x3 = [vec_a, vec_b, math.scale(sub_frame.axes[2], height)]
  const frac_to_cart = math.create_frac_to_cart(matrix)
  const place = (
    { cell, coords, heights }: StackedSlab,
    [shift_a, shift_b]: Vec2,
    bottom: number,
    interface_role: InterfaceRole,
  ): Site[] =>
    cell.sites.map((site, idx) => {
      const abc: Vec3 = [
        wrap_frac_coord(coords[idx][0] + shift_a),
        wrap_frac_coord(coords[idx][1] + shift_b),
        (bottom + heights[idx]) / height,
      ]
      const properties = { ...site.properties, interface_role }
      return { ...site, abc, xyz: frac_to_cart(abc), properties }
    })
  const sites = [
    ...place(sub_stack, [0, 0], 0, `substrate`),
    ...place(film_stack, shift, film_bottom, `film`),
  ]

  const { charge: sub_charge } = sub_stack.cell
  const { charge: film_charge } = film_stack.cell
  const charge =
    sub_charge === undefined || film_charge === undefined
      ? undefined
      : sub_charge + film_charge
  // the substrate's id would misname the stack, its crystal-level properties carry over
  const { id: _id, ...source } = substrate
  return {
    ...assemble_crystal(source, matrix, sites, [true, true, false], charge),
    interface_info: {
      match,
      gap,
      vacuum,
      shift,
      substrate_thickness: sub_stack.thickness,
      film_thickness: film_stack.thickness,
      n_substrate_sites: sub_stack.cell.sites.length,
      n_film_sites: film_stack.cell.sites.length,
    },
  }
}
