// Build a surface slab: cleave an oriented bulk cell at a chosen termination, stack it to
// the requested thickness and open up vacuum along the surface normal.
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Crystal, Site } from '$lib/structure'
import { wrap_frac_coord } from '$lib/structure/pbc'
import {
  assemble_crystal,
  in_plane_reduction_multiples,
  make_oriented_bulk,
} from './lattice-basis'
import { detect_layers, layer_spacings, terminations_of_oriented_bulk } from './terminations'
import {
  MAX_SLAB_SITES,
  SLAB_DEFAULT_THICKNESS,
  SLAB_DEFAULT_VACUUM,
  SLAB_LAYER_TOLERANCE,
} from './types'
import type { Slab, SlabOptions } from './types'

function assert_non_negative(value: number, name: string): void {
  if (Number.isFinite(value) && value >= 0) return
  throw new Error(`${name} must be a non-negative finite number, got ${value}`)
}

// Generate a surface slab of `crystal` cut along the (hkl) planes.
//
// Conventions:
// - `min_slab_thickness` is the distance between the outermost atomic planes, grown in
//   whole repeats of the oriented bulk cell.
// - `min_vacuum_thickness` is the empty distance between the top of the slab and the
//   bottom of its periodic image; the cell is sized to hit it exactly.
// - c is not periodic (pbc = [true, true, false]), so fractional c is left outside [0, 1)
//   where the slab reaches past a cell face rather than being folded into the vacuum.
export function make_slab(
  crystal: Crystal,
  miller_indices: Vec3,
  options: SlabOptions = {},
): Slab {
  const {
    min_slab_thickness = SLAB_DEFAULT_THICKNESS,
    min_vacuum_thickness = SLAB_DEFAULT_VACUUM,
    termination_idx = 0,
    center_slab = true,
    reorient_lattice = true,
    primitive_in_plane = true,
    layer_tolerance = SLAB_LAYER_TOLERANCE,
  } = options
  assert_non_negative(min_slab_thickness, `min_slab_thickness`)
  assert_non_negative(min_vacuum_thickness, `min_vacuum_thickness`)

  const bulk = make_oriented_bulk(crystal, miller_indices, { primitive_in_plane })
  const layers = detect_layers(bulk, layer_tolerance)
  const terminations = terminations_of_oriented_bulk(bulk, layers)
  if (!Number.isInteger(termination_idx) || !terminations[termination_idx]) {
    throw new Error(
      `termination_idx ${termination_idx} is out of range: (${bulk.miller_indices.join(`,`)}) ` +
        `has ${terminations.length} distinct termination(s)`,
    )
  }
  const termination = terminations[termination_idx]

  const bulk_matrix = bulk.crystal.lattice.matrix
  const height_c = math.cell_heights(bulk_matrix)[2]
  // Put the cleavage plane at the bottom: the chosen layer moves to c = 0 and everything
  // above it stacks on top, so the gap below that layer becomes the surface.
  const shift_c = layers[termination.layer_idx].frac_c_start
  const shifted_frac = bulk.crystal.sites.map((site) => wrap_frac_coord(site.abc[2] - shift_c))
  const period_extent = shifted_frac.reduce((top, frac) => Math.max(top, frac), 0) * height_c

  // Thickness is measured between the outermost atomic planes, so the first repeat only
  // contributes the spread of one cell's atoms, each further repeat a full c period.
  const extra_repeats = Math.ceil((min_slab_thickness - period_extent - math.EPS) / height_c)
  const n_repeats = Math.max(1, 1 + extra_repeats)
  const n_sites = n_repeats * bulk.crystal.sites.length
  if (n_sites > MAX_SLAB_SITES) {
    throw new Error(
      `Slab would need ${n_sites} sites (${n_repeats} repeats of ` +
        `${bulk.crystal.sites.length}); raise MAX_SLAB_SITES or lower ` +
        `min_slab_thickness=${min_slab_thickness} Å`,
    )
  }
  const slab_thickness = (n_repeats - 1) * height_c + period_extent
  if (slab_thickness + min_vacuum_thickness <= 0) {
    throw new Error(
      `Slab cell would have zero height: a single-layer slab needs min_vacuum_thickness > 0, ` +
        `got ${min_vacuum_thickness}`,
    )
  }

  // Vacuum goes along the normal only, so the cell height is exactly the slab thickness
  // plus the requested vacuum. In-plane, c keeps the stacking registry of the bulk,
  // reduced against a and b so the box stays as close to orthogonal as possible.
  // The oriented cell is right-handed, so its normal already points along +c.
  const [in_plane_a, in_plane_b] = bulk_matrix
  const { normal } = bulk
  const stacked_c = math.scale(bulk_matrix[2], n_repeats)
  const grow_c = slab_thickness + min_vacuum_thickness - n_repeats * height_c
  const raw_c = math.add(stacked_c, math.scale(normal, grow_c))
  const [mult_a, mult_b] = in_plane_reduction_multiples(raw_c, in_plane_a, in_plane_b)
  const shift_ab = math.add(math.scale(in_plane_a, mult_a), math.scale(in_plane_b, mult_b))
  const slab_matrix: Matrix3x3 = [in_plane_a, in_plane_b, math.subtract(raw_c, shift_ab)]

  // Rebuilding the matrix from its own lattice parameters puts a along +x, b in the xy
  // plane and hence the surface normal along +z, leaving fractional coordinates intact.
  const cell = math.calc_lattice_params(slab_matrix)
  const final_matrix = reorient_lattice
    ? math.cell_to_lattice_matrix(cell.a, cell.b, cell.c, cell.alpha, cell.beta, cell.gamma)
    : slab_matrix
  const final_normal = reorient_lattice ? ([0, 0, 1] as Vec3) : normal
  const surface_area = Math.hypot(...math.cross_3d(final_matrix[0], final_matrix[1]))

  // Vacuum split evenly above and below when centering, all of it above otherwise
  const bottom_offset = center_slab ? min_vacuum_thickness / 2 : 0
  // Fractional coordinates come from the unrotated frame the bulk vectors live in; xyz is
  // then recomputed from them so the two agree to machine precision in the final frame
  const cart_to_frac = math.create_cart_to_frac(slab_matrix)
  const frac_to_cart = math.create_frac_to_cart(final_matrix)
  const sites: Site[] = []
  for (let repeat_idx = 0; repeat_idx < n_repeats; repeat_idx++) {
    for (const [site_idx, site] of bulk.crystal.sites.entries()) {
      const cart = math.add(
        math.scale(in_plane_a, site.abc[0]),
        math.scale(in_plane_b, site.abc[1]),
        math.scale(bulk_matrix[2], shifted_frac[site_idx] + repeat_idx),
        math.scale(normal, bottom_offset),
      )
      // a and b stay periodic, so wrapping them keeps the slab inside the box; c must
      // not be wrapped or the top of the slab would fold into the vacuum
      const [frac_a, frac_b, frac_c] = cart_to_frac(cart)
      const abc: Vec3 = [wrap_frac_coord(frac_a), wrap_frac_coord(frac_b), frac_c]
      sites.push({ ...site, abc, xyz: frac_to_cart(abc) })
    }
  }

  // `charge` is dropped: the bulk figure is the charge of a stoichiometric periodic cell,
  // and cleaving a surface out of it breaks exactly the neutrality that made it meaningful
  // — a cleaved slab is not charge-neutral by construction, so any number here would be
  // an assertion the builder cannot back up.
  const slab = assemble_crystal(
    bulk.crystal,
    final_matrix,
    sites,
    [true, true, false],
    undefined,
  )
  return {
    ...slab,
    slab_info: {
      miller_indices: bulk.miller_indices,
      transform: bulk.transform,
      d_hkl: bulk.d_hkl,
      n_layers: layers.length * n_repeats,
      n_repeats,
      // rebased at the cleaved layer: the slab was shifted so termination.layer_idx sits
      // at the bottom, so its gaps are the cell's list rotated by that same amount
      layer_spacings: layer_spacings(layers, bulk.d_hkl, termination.layer_idx),
      min_layer_gap: Math.min(...layers.map((layer) => layer.gap_below)),
      slab_thickness,
      vacuum_thickness: min_vacuum_thickness,
      surface_area,
      normal: final_normal,
      termination,
      terminations,
    },
  }
}
