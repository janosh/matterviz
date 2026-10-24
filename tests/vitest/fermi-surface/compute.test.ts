// Tests for Fermi surface computation, analysis and symmetry-tiling functions
import { compute_brillouin_zone } from '#lib/brillouin/compute.js'
import {
  auto_interpolation_factor,
  band_carriers,
  sheet_key,
  compute_fermi_slice,
  detect_irreducible_bz,
  extract_fermi_surface,
  fold_to_wigner_seitz,
  preview_interpolation_factor,
  reciprocal_cell_section,
  sample_slice_energies,
  slice_plane_normal,
  slice_shading_rgba,
  upsample_grid,
} from '#lib/fermi-surface/compute.js'
import { parse_fermi_file } from '#lib/fermi-surface/parse.js'
import { IDENTITY_4x4, lattice_point_group_matrices } from '#lib/fermi-surface/symmetry.js'
import type { SliceEnergyMap } from '#lib/fermi-surface/compute.js'
import type {
  BandEnergyGrid,
  BandGridData,
  FermiIsosurface,
  FermiSurfaceData,
} from '#lib/fermi-surface/types.js'
import { vertex_count } from '#lib/fermi-surface/types.js'
import * as math from '#lib/math.js'
import type { Matrix3x3, Matrix4Tuple, Vec2, Vec3 } from '#lib/math.js'
import { SphereGeometry } from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { describe, expect, test } from 'vitest'
import {
  BOX_TRI_FACES,
  BOX_VERTICES,
  cubic_matrix,
  IDENTITY_MATRIX3,
  make_fermi_isosurface,
  make_fermi_surface,
  read_maybe_gz,
} from '../test-fixtures'

// Vertex `idx` of a typed-array mesh as a Vec3
const vertex_at = ({ positions }: Pick<FermiIsosurface, `positions`>, idx: number): Vec3 => [
  positions[3 * idx],
  positions[3 * idx + 1],
  positions[3 * idx + 2],
]
const vertices_of = (surface: Pick<FermiIsosurface, `positions`>): Vec3[] =>
  Array.from({ length: vertex_count(surface) }, (_, idx) => vertex_at(surface, idx))
// A position rounded to a 1e-5 grid, so coincident but unshared vertices get one key
const pos_key = (point: Vec3) => point.map((coord) => Math.round(coord * 1e5)).join(`,`)
// How many triangles use each edge, with its ends keyed by key_of(vertex index)
const edge_uses = ({ indices }: FermiIsosurface, key_of: (idx: number) => string) => {
  const uses = new Map<string, number>()
  for (const [at, idx] of indices.entries()) {
    const next = indices[at % 3 === 2 ? at - 2 : at + 1]
    const edge = [key_of(idx), key_of(next)].toSorted().join(`|`)
    uses.set(edge, (uses.get(edge) ?? 0) + 1)
  }
  return uses
}

// Area of each triangle of a mesh, and their sum: the marching-cubes accuracy metric used below
const triangle_areas = ({ positions, indices }: FermiIsosurface): number[] => {
  const areas: number[] = []
  for (let tri = 0; tri < indices.length; tri += 3) {
    const [idx0, idx1, idx2] = [indices[tri], indices[tri + 1], indices[tri + 2]]
    const edge = (idx: number): Vec3 => [
      positions[3 * idx] - positions[3 * idx0],
      positions[3 * idx + 1] - positions[3 * idx0 + 1],
      positions[3 * idx + 2] - positions[3 * idx0 + 2],
    ]
    const cross = math.cross_3d(edge(idx1), edge(idx2))
    areas.push(0.5 * Math.hypot(...cross))
  }
  return areas
}
const surface_area = (surface: FermiIsosurface): number =>
  triangle_areas(surface).reduce((sum, area) => sum + area, 0)
const total_area = (data: FermiSurfaceData): number =>
  data.isosurfaces.reduce((sum, surface) => sum + surface_area(surface), 0)

// k_latticeᵀ ≠ k_lattice exposes a missing transpose in cart→frac conversion
const HEXAGONAL: Matrix3x3 = [
  [1, 0, 0],
  [-0.5, Math.sqrt(3) / 2, 0],
  [0, 0, 1],
]

// Flat z-fastest band grid from a per-index function
const make_band_grid = (
  dims: Vec3,
  callback: (idx_x: number, idx_y: number, idx_z: number) => number,
): BandEnergyGrid => {
  const [size_x, size_y, size_z] = dims
  const values = new Float64Array(size_x * size_y * size_z)
  let idx = 0
  for (let idx_x = 0; idx_x < size_x; idx_x++) {
    for (let idx_y = 0; idx_y < size_y; idx_y++) {
      for (let idx_z = 0; idx_z < size_z; idx_z++)
        values[idx++] = callback(idx_x, idx_y, idx_z)
    }
  }
  return { values, dims, order: `z_fastest` }
}

// Single-band grid sampling `energy_fn` at the reduced k of each point, (ix + shift)/denom,
// folded to its minimum image in [−½, ½]: index 0 is Γ, as in BXSF and FRMSF lshift=1 files
const make_band_data = (
  grid_n: number,
  energy_fn: (frac_x: number, frac_y: number, frac_z: number) => number,
  opts: {
    k_lattice?: Matrix3x3
    periodic?: boolean
    grid_shift?: Vec3
    fermi_energy?: number
  } = {},
): BandGridData => {
  const { k_lattice = IDENTITY_MATRIX3, periodic, grid_shift, fermi_energy = 0 } = opts
  const denom = periodic ? grid_n : grid_n - 1
  const dims: Vec3 = [grid_n, grid_n, grid_n]
  const [shift_x, shift_y, shift_z] = grid_shift ?? [0, 0, 0]
  return {
    energies: [
      [
        make_band_grid(dims, (idx_x, idx_y, idx_z) =>
          energy_fn(
            min_image((idx_x + shift_x) / denom),
            min_image((idx_y + shift_y) / denom),
            min_image((idx_z + shift_z) / denom),
          ),
        ),
      ],
    ],
    ...(periodic && { periodic }),
    ...(grid_shift && { grid_shift }),
    k_grid: dims,
    k_lattice,
    fermi_energy,
    n_bands: 1,
    n_spins: 1,
  }
}

const min_image = (frac: number) => frac - Math.round(frac)
// Distance from Γ in reduced units
const sphere = (frac_x: number, frac_y: number, frac_z: number) =>
  Math.hypot(frac_x, frac_y, frac_z)

describe(`extract_fermi_surface`, () => {
  // Band data with a spherical isosurface: energy = distance² from grid center (in index units)
  const create_spherical_band_data = (grid_size: number, fermi_energy: number): BandGridData =>
    make_band_data(
      grid_size,
      (frac_x, frac_y, frac_z) => (sphere(frac_x, frac_y, frac_z) * (grid_size - 1)) ** 2,
      {
        fermi_energy,
      },
    )

  test(`extracts Fermi surface from band data`, () => {
    const band_data = create_spherical_band_data(10, 9) // Fermi level at radius^2 = 9
    const result = extract_fermi_surface(band_data)

    expect(result.isosurfaces).toHaveLength(1)
    expect(result.fermi_energy).toBe(9)
    expect(result.reciprocal_cell).toBe(`parallelepiped`)
    expect(result.metadata).toEqual({ n_bands: 1, n_surfaces: 1 })
    // Radius 3 index units = 3/9 of the unit cell; MC area slightly under 4π(1/3)² = 1.396
    expect(total_area(result)).toBeGreaterThan(1.3)
    expect(total_area(result)).toBeLessThan(1.4)
    // Renderer-ready buffers: one normal per vertex, triangle index triples
    const [iso] = result.isosurfaces
    expect(iso.normals).toHaveLength(iso.positions.length)
    expect(iso.indices.length % 3).toBe(0)
  })

  test(`respects mu offset and returns no isosurfaces when E_F + mu crosses no band`, () => {
    const band_data = create_spherical_band_data(10, 9)
    // mu=0 gives surface at E_F=9 (radius 3); mu=7 at E_F=16 (radius 4): area ratio (4/3)²
    const area_0 = total_area(extract_fermi_surface(band_data, { mu: 0 }))
    const area_7 = total_area(extract_fermi_surface(band_data, { mu: 7 }))
    expect(area_7 / area_0).toBeCloseTo(16 / 9, 1)
    // E_F + mu = 1009 lies above the band maximum (9·√3/2)² ≈ 61 at the cell corner
    const above_band = extract_fermi_surface(band_data, { mu: 1000 })
    expect(above_band.isosurfaces).toHaveLength(0)
    expect(above_band.metadata.n_surfaces).toBe(0)
  })

  test(`extracts every band and spin channel`, () => {
    const band_data = create_spherical_band_data(8, 4)
    band_data.energies[0].push(band_data.energies[0][0]) // duplicate band
    band_data.n_bands = 2
    band_data.energies.push([...band_data.energies[0]])
    band_data.n_spins = 2

    const result = extract_fermi_surface(band_data)
    expect(result.isosurfaces.map((iso) => [iso.spin, iso.band_index])).toEqual([
      [`up`, 0],
      [`up`, 1],
      [`down`, 0],
      [`down`, 1],
    ])
  })
})

describe(`extract_fermi_surface vertex properties`, () => {
  // Smooth periodic field (k-space period 1 per axis) so the min-image fold adds no kink
  const two_pi = 2 * Math.PI
  const field = (frac_x: number, frac_y: number, frac_z: number) =>
    Math.cos(two_pi * frac_x) +
    0.5 * Math.sin(two_pi * frac_y) +
    0.25 * Math.cos(two_pi * frac_z)
  const grid_n = 16
  const with_field = (
    opts: Parameters<typeof make_band_data>[2],
    property = make_band_data(grid_n, field, opts).energies[0][0],
  ): BandGridData => ({
    ...make_band_data(grid_n, sphere, { ...opts, fermi_energy: 0.3 }),
    properties: { field: [[property]] },
  })

  // Trilinear sampling on the raw grid errs by at most Σ amplitude·(2π h)²/8 = 1.75·(2π h)²/8
  // for this field: 0.0337 at h = 1/16 (periodic), 0.0384 at h = 1/15 (endpoint-inclusive).
  // Measured maxima at factor 1 / 2: 0.0135 / 0.0322 (periodic), 0.0131 / 0.0315
  // (half-shifted), 0.0174 / 0.0370 (endpoint-inclusive hexagonal). Sampling half a step off
  // (a wrong shift or Γ-centring roll) errs by ~2π h/2 = 0.2 on the cos(2π k_x) term alone.
  test.each([
    { label: `periodic Γ-centred`, opts: { periodic: true } },
    { label: `periodic half-shifted`, opts: { periodic: true, grid_shift: [0.5, 0.5, 0.5] } },
    { label: `endpoint-inclusive hexagonal`, opts: { k_lattice: HEXAGONAL } },
  ] as const)(`samples the field at each vertex's own k ($label)`, ({ opts }) => {
    const band_data = with_field({
      ...opts,
      grid_shift: opts.grid_shift && [...opts.grid_shift],
    })
    const cart_to_frac = math.matrix_inverse_3x3(
      math.transpose_3x3_matrix(band_data.k_lattice),
    )
    const period = `periodic` in opts ? grid_n : grid_n - 1
    for (const interpolation_factor of [1, 2]) {
      const [surface] = extract_fermi_surface(band_data, { interpolation_factor }).isosurfaces
      const values = surface.properties?.field
      expect(values).toHaveLength(vertex_count(surface))
      const errors = vertices_of(surface).map((vertex, idx) =>
        Math.abs(
          (values?.[idx] ?? NaN) - field(...math.mat3x3_vec3_multiply(cart_to_frac, vertex)),
        ),
      )
      expect(Math.max(...errors)).toBeLessThan((1.75 * (two_pi / period) ** 2) / 8)
    }
  })

  // Grid points outside |k| < 0.35 hold no value; vertices at |k| = 0.3 still get one from
  // their finite corners, and a field with no finite point gives NaN everywhere
  test(`leaves NaN corners out and renormalises the trilinear weights`, () => {
    const windowed = make_band_data(grid_n, (frac_x, frac_y, frac_z) =>
      sphere(frac_x, frac_y, frac_z) < 0.35 ? 2 : NaN,
    ).energies[0][0]
    const [surface] = extract_fermi_surface(with_field({}, windowed)).isosurfaces
    expect(surface.properties?.field.every((value) => value === 2)).toBe(true)
    const empty = make_band_data(grid_n, () => NaN).energies[0][0]
    const [blank] = extract_fermi_surface(with_field({}, empty)).isosurfaces
    expect(blank.properties?.field.every(Number.isNaN)).toBe(true)
    const plain = { ...with_field({}), properties: undefined }
    expect(extract_fermi_surface(plain).isosurfaces[0].properties).toBeUndefined()
  })
})

test(`slice_plane_normal is the normalised h·b₁ + k·b₂ + l·b₃`, () => {
  const normal = slice_plane_normal(HEXAGONAL, [1, 1, 0])
  expect(normal[0]).toBeCloseTo(0.5, 12)
  expect(normal[1]).toBeCloseTo(Math.sqrt(3) / 2, 12)
})

// The basal plane cuts a hexagonal zone in a hexagon but the Γ-centred cell in a parallelogram;
// given zone edges (the drawn zone) replace the computed ones
test(`reciprocal_cell_section cuts the data's cell`, () => {
  const section = (
    reciprocal_cell: `wigner_seitz` | `parallelepiped`,
    zone_edges?: [Vec3, Vec3][],
  ) =>
    reciprocal_cell_section(
      { k_lattice: HEXAGONAL, reciprocal_cell },
      [0, 0, 1],
      0,
      zone_edges,
    )
  expect(section(`wigner_seitz`)).toHaveLength(6)
  expect(section(`parallelepiped`)).toHaveLength(4)
  expect(section(`wigner_seitz`, [])).toEqual([])
})

describe(`slice energy shading`, () => {
  // ε = |k| (reduced units, identity lattice) with E_F = 0.3, plus a band far above E_F
  const band_data = make_band_data(16, sphere, { periodic: true, fermi_energy: 0.3 })
  band_data.energies[0].push(make_band_grid([16, 16, 16], () => 5))
  band_data.n_bands = 2
  // the (001) plane through Γ over x ∈ [−½, ½], y ∈ [−¼, ¼]
  const slice_energies = (data: BandGridData, resolution: number, mu = 0) =>
    sample_slice_energies(data, {
      plane: {
        plane_normal: [0, 0, 1],
        plane_distance: 0,
        in_plane_basis: IDENTITY_MATRIX3.slice(0, 2) as [Vec3, Vec3],
      },
      bounds: { min: [-0.5, -0.25], max: [0.5, 0.25] },
      resolution,
      mu,
    })
  // one-row energy maps with a layer of values per band
  const energy_map = (...layers: number[][]): SliceEnergyMap => ({
    width: layers[0].length,
    height: 1,
    layers: layers.map((values, band_index) => ({
      band_index,
      spin: null,
      values: Float32Array.from(values),
    })),
  })

  // The (001) slice through Γ samples ε − E_F = hypot(x, y) − 0.3. Trilinear sampling of the 16³
  // grid (h = 1/16) measured a max error of 0.0086, largest near the cone tip where |k| is not
  // smooth; sampling the wrong plane, axis or grid offset errs by about a grid step (≥ 0.06)
  test(`samples ε − (E_F + mu) of the crossing bands on the plane`, () => {
    const sampled = slice_energies(band_data, 64)
    expect([sampled.width, sampled.height]).toEqual([64, 32])
    expect(sampled.layers.map(({ band_index }) => band_index)).toEqual([0]) // band 1 never crosses
    // a grid numbering its bands (BXSF `BAND: n`) labels the layers with those absolute indices
    const numbered = slice_energies({ ...band_data, band_indices: [8, 9] }, 8)
    expect(numbered.layers.map(({ band_index }) => band_index)).toEqual([8])
    const [{ values }] = sampled.layers
    const errors = Array.from(values, (value, idx) => {
      const [coord_x, coord_y] = [
        -0.5 + ((idx % 64) + 0.5) / 64,
        0.25 - (Math.floor(idx / 64) + 0.5) / 64,
      ]
      return Math.abs(value - (Math.hypot(coord_x, coord_y) - 0.3))
    })
    expect(Math.max(...errors)).toBeLessThan(0.0125)
    // mu shifts the level: the centre pixel moves from −0.3 to −0.4
    const centre = 16 * 64 + 32
    const shifted = slice_energies(band_data, 64, 0.1).layers[0].values[centre]
    expect(shifted - values[centre]).toBeCloseTo(-0.1, 6)
  })

  test(`occupied and energy modes`, () => {
    // straight-alpha source-over: both bands occupied → α = ½ + ½·½, colour ⅓ red + ⅔ blue
    const occupied = energy_map([-1, 1, 1], [-1, -1, 1])
    const tinted = slice_shading_rgba(occupied, `occupied`, [`#ff0000`, `#0000ff`], {
      opacity: 0.5,
    })
    expect(Array.from(tinted)).toEqual([85, 0, 170, 191, 0, 0, 255, 128, 0, 0, 0, 0])
    // the band nearest E_F decides each pixel: occupied (ε < E_F) red, empty blue, none clear
    const near = energy_map([-0.1, 0.4, NaN], [0.5, 0.2, NaN])
    const pixels = slice_shading_rgba(near, `energy`, [`#000`], { opacity: 0.5 })
    expect(pixels[0]).toBeGreaterThan(pixels[2]) // −0.1 beats 0.5: red
    expect(pixels[6]).toBeGreaterThan(pixels[4]) // 0.2 beats 0.4: blue
    expect(pixels[11]).toBe(0) // NaN everywhere: transparent
  })

  // A band's carrier picks the pocket side: an electron band fills its occupied pixels solid,
  // a hole band its empty ones in diagonal stripes ((row + col) mod 6 < 3)
  test(`pockets mode fills electron bands' occupied side, hole bands' empty side striped`, () => {
    const values = Float32Array.from({ length: 24 }, (_, idx) => (idx % 12 < 6 ? -1 : 1))
    const shaded = (carrier: `electron` | `hole`) => {
      const pocket_map = {
        width: 12,
        height: 2,
        layers: [{ band_index: 0, spin: null, values }],
      }
      const carriers = new Map([[sheet_key(0, null), carrier]])
      const pixels = slice_shading_rgba(pocket_map, `pockets`, [`#f00`], { carriers })
      return Array.from({ length: 24 }, (_, idx) => pixels[4 * idx + 3] > 0)
    }
    const pixels = Array.from({ length: 24 }, (_, idx) => [Math.floor(idx / 12), idx % 12])
    expect(shaded(`electron`)).toEqual(pixels.map(([, col]) => col < 6))
    expect(shaded(`hole`)).toEqual(pixels.map(([row, col]) => col >= 6 && (row + col) % 6 < 3))
  })
})

describe(`pocket classification`, () => {
  // ε = ±|k| with E_F = ±0.3: the (001) slice through Γ is one closed circle, enclosing
  // occupied states (electron pocket) for +|k| and empty ones (hole pocket) for −|k|
  test.each([
    [1, `electron`],
    [-1, `hole`],
  ] as const)(`a closed contour of sign %i encloses an %s pocket`, (sign, carrier) => {
    const band_data = make_band_data(16, (fx, fy, fz) => sign * sphere(fx, fy, fz), {
      periodic: true,
      fermi_energy: sign * 0.3,
    })
    const slice = compute_fermi_slice(extract_fermi_surface(band_data))
    expect(band_carriers(band_data, slice)).toEqual(new Map([[sheet_key(0, null), carrier]]))
    // a zero-area contour has no inside to sample: it casts no vote
    const [isoline] = slice.isolines
    // oxfmt-ignore
    const collapsed = { ...isoline, points_2d: [[0, 0], [0.1, 0.1], [0.2, 0.2], [0.1, 0.1]] as Vec2[] }
    expect(band_carriers(band_data, { ...slice, isolines: [collapsed] })).toEqual(new Map())
  })

  test(`spin channels of one band index get their own carriers`, () => {
    // band 0 is an electron pocket in spin up and a hole pocket in spin down: keyed by band
    // index alone, the two votes cancelled into one `electron` for both
    const [up, down] = [1, -1].map(
      (sign) =>
        make_band_data(16, (fx, fy, fz) => sign * (sphere(fx, fy, fz) - 0.3), {
          periodic: true,
        }).energies[0],
    )
    const band_data = {
      ...make_band_data(16, sphere, { periodic: true }),
      energies: [up, down],
      n_spins: 2,
    }
    const slice = compute_fermi_slice(extract_fermi_surface(band_data))
    expect(band_carriers(band_data, slice)).toEqual(
      new Map([
        [sheet_key(0, `up`), `electron`],
        [sheet_key(0, `down`), `hole`],
      ]),
    )
  })
})

describe(`Wigner-Seitz folding and preview resolution`, () => {
  // fcc reciprocal lattice (bcc-like vectors), whose Wigner-Seitz zone differs from the cell,
  // and the same lattice in the sheared basis (b₁, b₂ + 2b₁, b₃ + 2b₁), where the lattice point
  // nearest to 12% of its Γ-centred cell has an index beyond ±1
  // oxfmt-ignore
  const FCC_RECIPROCAL: Matrix3x3 = [[-1, 1, 1], [1, -1, 1], [1, 1, -1]]
  // oxfmt-ignore
  const SHEARED_FCC: Matrix3x3 = [[-1, 1, 1], [-1, 1, 3], [-1, 3, 1]]
  // a sphere |k| = E_F around every lattice point (ε = distance to the nearest one, so both
  // bases sample the same periodic field), large enough to reach past the hexagonal zone faces
  // (|G|/2 = √3/2)
  const sphere_data = (k_lattice: Matrix3x3, fermi_energy: number) => {
    const converters = math.create_lattice_converters(k_lattice)
    const energy = (frac: Vec3) =>
      Math.hypot(
        ...math.min_image_displacement(
          [0, 0, 0],
          converters.frac_to_cart(frac),
          k_lattice,
          converters,
        ),
      )
    return make_band_data(16, (fx, fy, fz) => energy([fx, fy, fz]), {
      periodic: true,
      k_lattice,
      fermi_energy,
    })
  }

  // Folding moves triangles by lattice vectors and clips those crossing a zone face at it: the
  // area is unchanged, every vertex ends inside the zone (nearer Γ than any other lattice
  // point, checked against n ∈ {−3..3}³), the open edges all lie on zone faces and close into
  // loops, and every cut on face G meets the cut on face −G shifted by G. A cubic lattice's
  // zone is its cell: folding moves nothing.
  test.each([
    [`fcc`, FCC_RECIPROCAL],
    [`sheared fcc`, SHEARED_FCC],
  ])(
    `folds a band-grid surface into the Wigner-Seitz zone (%s basis)`,
    (_basis, k_lattice) => {
      const band_data = sphere_data(k_lattice, 0.9)
      const cell = extract_fermi_surface(band_data)
      const folded = extract_fermi_surface(band_data, { wigner_seitz: true })
      expect([cell.reciprocal_cell, folded.reciprocal_cell]).toEqual([
        `parallelepiped`,
        `wigner_seitz`,
      ])
      // shifted vertices are re-stored as Float32 (relative eps 6e-8): measured 1.7e-9 (fcc),
      // 1.2e-8 (sheared) off; translating in f64 instead preserves the area exactly
      expect(total_area(folded) / total_area(cell)).toBeCloseTo(1, 7)
      const frac_to_cart = math.create_frac_to_cart(k_lattice)
      const others = Array.from({ length: 7 ** 3 }, (_, idx) =>
        frac_to_cart([idx / 49, idx / 7, idx].map((n) => (Math.floor(n) % 7) - 3) as Vec3),
      ).filter((point) => Math.hypot(...point) > 0)
      // signed distance past the zone, |k| − |k − G| for the nearest other lattice point G
      // (0 on the face of G)
      const past_zone = (point: Vec3): { dist: number; face: Vec3 } => {
        const dists = others.map((other) => math.euclidean_dist(point, other))
        const nearest = dists.indexOf(Math.min(...dists))
        return { dist: Math.hypot(...point) - dists[nearest], face: others[nearest] }
      }
      let [n_moved, max_outside, max_off_face, n_unpaired] = [0, -Infinity, 0, 0]
      for (const [surface_idx, surface] of folded.isosurfaces.entries()) {
        if (surface.positions !== cell.isosurfaces[surface_idx].positions) n_moved++
        for (const idx of new Set(surface.indices)) {
          max_outside = Math.max(max_outside, past_zone(vertex_at(surface, idx)).dist)
        }
        // ends of edges used by one triangle, i.e. the face cuts (vertices merged by position,
        // as the cell's periodic seams are not shared)
        const open_degree = new Map<string, number>()
        const uses = edge_uses(surface, (idx) => pos_key(vertex_at(surface, idx)))
        for (const [edge, count] of uses) {
          for (const key of count === 1 ? edge.split(`|`) : []) {
            open_degree.set(key, (open_degree.get(key) ?? 0) + 1)
          }
        }
        expect(open_degree.size).toBeGreaterThan(0) // the sphere crosses the zone faces
        // cuts close into loops: each end is shared by two open edges
        expect([...open_degree.values()].every((degree) => degree % 2 === 0)).toBe(true)
        for (const key of open_degree.keys()) {
          const point = key.split(`,`).map((coord) => Number(coord) / 1e5) as Vec3
          const { dist, face } = past_zone(point)
          max_off_face = Math.max(max_off_face, Math.abs(dist))
          // its periodic image across that face is on the cut there too
          if (!open_degree.has(pos_key(math.subtract(point, face)))) n_unpaired++
        }
      }
      // Clipping runs in f64, storage is Float32 (eps 1.2e-7 at |k| ≤ 1.2): measured 6.5e-8 /
      // 6.6e-8 past the zone (fcc / sheared), where whole-triangle folding left vertices 0.11 / 0.25
      // outside. Open points carry the key rounding (√3·5e-6): measured 1.1e-5 off their face.
      expect(max_outside).toBeLessThan(2e-7)
      expect(max_off_face).toBeLessThan(2e-5)
      expect(n_unpaired).toBe(0)
      expect(n_moved).toBeGreaterThan(0)
      const cubic = make_band_data(12, sphere, { periodic: true, fermi_energy: 0.3 })
      const [cubic_sheet] = extract_fermi_surface(cubic).isosurfaces
      expect(fold_to_wigner_seitz(cubic_sheet, IDENTITY_MATRIX3)).toBe(cubic_sheet)
    },
  )

  // Real sheets as parsed: Float32 vertices exactly on a zone face sit ~1e-8 past it and count
  // as on it, rather than being clipped a rounding error away from themselves into zero-area,
  // non-manifold slivers. MgB2 at mu = 0.3 crosses no face, so folding only moves whole
  // triangles. Slivers drop by height, not area: an area threshold at Float32 scale also drops
  // real small cut triangles (Cu: area off by 1.1e-6 instead of 2.5e-9).
  test.each([
    [`mgb2_vfermi.frmsf`, 0, true],
    [`mgb2_vfermi.frmsf`, 0.3, false],
    [`cu_fs.bxsf`, -0.3, true],
  ])(`folds %s at mu = %s without slivers, conserving area`, (filename, mu, clips) => {
    const path = `src/site/fermi-surfaces/${filename}.gz`
    const band_data = parse_fermi_file(read_maybe_gz(path), filename) as BandGridData
    const cell = extract_fermi_surface(band_data, { mu })
    let [n_degenerate, n_non_manifold, n_clipped, n_orphans, folded_area] = [0, 0, 0, 0, 0]
    for (const sheet of cell.isosurfaces) {
      const folded = fold_to_wigner_seitz(sheet, band_data.k_lattice)
      if (folded.indices.length !== sheet.indices.length) n_clipped++
      // every appended (cut or shifted) vertex is used: a cut at an end already on the face
      // duplicates that end into a sliver whose drop orphans it
      const used = new Set(folded.indices)
      for (let idx = vertex_count(sheet); idx < vertex_count(folded); idx++)
        n_orphans += Number(!used.has(idx))
      folded_area += surface_area(folded)
      n_degenerate += triangle_areas(folded).filter((area) => area === 0).length
      const uses = edge_uses(folded, (idx) => vertex_at(folded, idx).join(`,`))
      n_non_manifold += [...uses.values()].filter((count) => count > 2).length
    }
    // with a 1e-9 face tolerance, MgB2 at mu = 0: 20 zero-area triangles, 20 edges shared by 3+
    expect([n_degenerate, n_non_manifold, n_orphans]).toEqual([0, 0, 0])
    expect(n_clipped > 0).toBe(clips)
    // shifted and cut vertices re-stored as Float32: measured ≤ 1.7e-8 over 11 fixtures
    expect(Math.abs(folded_area / total_area(cell) - 1)).toBeLessThan(1e-7)
  })

  // A closed UV sphere (radius 0.6, generically rotated so no vertex sits on a face) poking
  // through every face of the cubic zone (faces at ±0.5), plus a collinear triangle across one
  // whose zero-height pieces must drop. Normals are radial and properties the input coordinates,
  // so a cut at k on chord AB must carry normal k/|k| and properties k (both linear along AB
  // before normalizing), a lattice vector from its folded position. Cut and shifted vertices
  // are shared by the triangles meeting at them, so open edges agree by index and by position.
  test(`clip cuts interpolate normals and properties, share vertices and drop slivers`, () => {
    const PROP_NAMES = [`k_x`, `k_y`, `k_z`]
    const uv_sphere = new SphereGeometry(0.6, 16, 12).deleteAttribute(`normal`)
    const geometry = mergeVertices(uv_sphere.deleteAttribute(`uv`)).rotateX(0.3).rotateZ(0.7)
    // the collinear triangle first, so sphere vertex indices shift by 3
    const collinear = [0.3, 0.7, 0.45].flatMap((coord) => [coord, 0, 0])
    const positions = Float32Array.from([...collinear, ...geometry.attributes.position.array])
    const points = vertices_of({ positions })
    const sphere_indices = (geometry.index?.array ?? []).map((idx) => idx + 3)
    const sheet = make_fermi_isosurface(points, [], {
      indices: Uint32Array.from([0, 1, 2, ...sphere_indices]),
      normals: Float32Array.from(points.flatMap((point) => math.normalize_vec(point))),
      properties: Object.fromEntries(
        PROP_NAMES.map((name, axis) => [name, positions.filter((_, at) => at % 3 === axis)]),
      ),
    })
    const folded = fold_to_wigner_seitz(sheet, IDENTITY_MATRIX3)
    const [shift_errs, normal_errs]: number[][] = [[], []]
    for (let idx = points.length; idx < vertex_count(folded); idx++) {
      const input = PROP_NAMES.map((name) => folded.properties?.[name][idx] ?? NaN) as Vec3
      const shift = math.subtract(input, vertex_at(folded, idx))
      shift_errs.push(...shift.map((coord) => Math.abs(coord - Math.round(coord))))
      const normal = vertex_at({ positions: folded.normals }, idx)
      normal_errs.push(math.euclidean_dist(normal, math.normalize_vec(input)))
    }
    expect(normal_errs.length).toBeGreaterThan(100) // appended vertices
    // Float32 storage (eps 1.2e-7 at |k| ≤ 0.6): measured 6.4e-8 (normals), 0 (shifts)
    expect(Math.max(...normal_errs)).toBeLessThan(1e-6)
    expect(Math.max(...shift_errs)).toBeLessThan(1e-6)
    expect(Math.min(...triangle_areas(folded))).toBeGreaterThan(0)
    const n_open = (key_of: (idx: number) => string) =>
      [...edge_uses(folded, key_of).values()].filter((count) => count === 1).length
    const n_open_by_pos = n_open((idx) => pos_key(vertex_at(folded, idx)))
    expect(n_open_by_pos).toBeGreaterThan(0)
    expect(n_open(String)).toBe(n_open_by_pos)
  })

  // previews cap the factor at the mesh's auto factor (16 points → 3), never raise it; two
  // upsampled grids per band stay cached, so a preview and the full surface do not evict each
  // other while a third factor evicts the oldest. A cached grid is visible as a surface that
  // ignores later edits to the raw energies.
  test(`preview factor and the two-factor grid cache`, () => {
    const previews = [4, 3, 2, 0].map((factor) =>
      preview_interpolation_factor(sphere_data(FCC_RECIPROCAL, 1), factor),
    )
    expect(previews).toEqual([3, 3, 2, 3])
    const band_data = make_band_data(8, sphere, { periodic: true, fermi_energy: 0.3 })
    const positions = (interpolation_factor: number) =>
      extract_fermi_surface(band_data, { interpolation_factor }).isosurfaces[0].positions
    const cached = [2, 3].map(positions)
    const { values } = band_data.energies[0][0]
    for (const [idx, value] of values.entries()) values[idx] = 1.1 * value
    expect([2, 3].map(positions)).toEqual(cached)
    positions(4)
    expect(positions(3)).toEqual(cached[1])
    expect(positions(2)).not.toEqual(cached[0])
  })
})

describe(`free-electron sphere (numerical verification)`, () => {
  // E(k) = ħ²k²/2m on a simple-cubic reciprocal lattice with |b| = 2π/a; the Fermi sphere
  // k_F = 0.6·π/a sits well inside the zone (|k_i| ≤ π/a). Exact area 4πk_F².
  const HBAR2_OVER_2M = 3.80998 // eV·Å²
  const A_LATT = 4 // Å
  const B_LEN = (2 * Math.PI) / A_LATT
  const K_F = 0.6 * (Math.PI / A_LATT)
  const E_F = HBAR2_OVER_2M * K_F * K_F
  const SPHERE_AREA = 4 * Math.PI * K_F * K_F
  const CUBIC = cubic_matrix(B_LEN)

  // Endpoint-inclusive grids place point i at frac i/(n−1) (BXSF), periodic ones at i/n
  // (FRMSF), both with Γ at index 0, so k = frac·b (make_band_data folds frac to [−½, ½]).
  // `center_x` moves the sphere centre along k_x using the minimum-image distance, so a
  // sphere at the zone-boundary X point wraps across the ±k_x faces.
  const free_electron = (count: number, periodic: boolean, center_x = 0): BandGridData => {
    const k_of = (frac: number) => frac * B_LEN
    const k_min_image = (delta_k: number) => delta_k - B_LEN * Math.round(delta_k / B_LEN)
    return make_band_data(
      count,
      (frac_x, frac_y, frac_z) => {
        const delta_x = k_min_image(k_of(frac_x) - center_x)
        return HBAR2_OVER_2M * (delta_x * delta_x + k_of(frac_y) ** 2 + k_of(frac_z) ** 2)
      },
      { k_lattice: CUBIC, periodic, fermi_energy: E_F },
    )
  }

  // Memoised: the 48³ extraction is reused by several tests below and the result is never
  // mutated
  const sphere_cache = new Map<string, FermiIsosurface>()
  const extract_sphere = (count: number, periodic: boolean, interpolation_factor = 1) => {
    const key = `${count}|${periodic}|${interpolation_factor}`
    const cached = sphere_cache.get(key)
    if (cached) return cached
    const { isosurfaces } = extract_fermi_surface(free_electron(count, periodic), {
      interpolation_factor,
    })
    expect(isosurfaces).toHaveLength(1)
    sphere_cache.set(key, isosurfaces[0])
    return isosurfaces[0]
  }
  const rel_area_error = (iso: FermiIsosurface) =>
    (surface_area(iso) - SPHERE_AREA) / SPHERE_AREA

  // Measured relative area errors (inscribed-polyhedron deficit, O(h²)): N=24 → −8.7e-3,
  // N=48 → −2.1e-3 endpoint-inclusive; −7.9e-3 / −2.0e-3 periodic
  test.each([
    { n: 24, periodic: false, max_rel_err: 1e-2 },
    { n: 48, periodic: false, max_rel_err: 3e-3 },
    { n: 24, periodic: true, max_rel_err: 1e-2 },
    { n: 48, periodic: true, max_rel_err: 3e-3 },
  ])(
    `area ≈ 4πk_F² within $max_rel_err at N=$n (periodic=$periodic)`,
    ({ n: count, periodic, max_rel_err }) => {
      const iso = extract_sphere(count, periodic)
      const rel_err = rel_area_error(iso)
      expect(rel_err).toBeLessThan(0) // marching cubes inscribes the sphere
      expect(Math.abs(rel_err)).toBeLessThan(max_rel_err)
    },
  )

  test.each([false, true])(
    `area error shrinks ~4x from N=24 to N=48 (periodic=%s)`,
    (periodic) => {
      const err_24 = Math.abs(rel_area_error(extract_sphere(24, periodic)))
      const err_48 = Math.abs(rel_area_error(extract_sphere(48, periodic)))
      expect(err_48).toBeLessThan(err_24 / 3)
    },
  )

  // Measured max |‖v‖ − k_F| is 0.018 grid spacings at N=24 (linear edge interpolation of a
  // quadratic is second-order accurate), far below the one-spacing bound a wrong grid
  // convention would blow through
  test.each([
    { n: 24, periodic: false },
    { n: 48, periodic: false },
    { n: 24, periodic: true },
  ])(
    `every vertex lies on the sphere (N=$n, periodic=$periodic)`,
    ({ n: count, periodic }) => {
      const iso = extract_sphere(count, periodic)
      const spacing = B_LEN / (periodic ? count : count - 1)
      let max_dr = 0
      for (const vertex of vertices_of(iso)) {
        max_dr = Math.max(max_dr, Math.abs(Math.hypot(...vertex) - K_F))
      }
      expect(max_dr).toBeLessThan(0.05 * spacing)
    },
  )

  test(`2x tricubic upsampling of N=24 matches the N=48 area error (−2.2e-3 vs −8.7e-3 raw)`, () => {
    const err_raw = Math.abs(rel_area_error(extract_sphere(24, false)))
    const err_up = Math.abs(rel_area_error(extract_sphere(24, false, 2)))
    const err_48 = Math.abs(rel_area_error(extract_sphere(48, false)))
    expect(err_up).toBeLessThan(err_raw / 3)
    expect(err_up).toBeLessThan(1.1 * err_48)
    // Periodic upsampling reproduces the exact periodic quadratic, so it equals N=48 up to
    // Float32 vertex rounding (measured ≤ 2e-6 relative)
    expect(surface_area(extract_sphere(24, true, 2))).toBeCloseTo(
      surface_area(extract_sphere(48, true)),
      4,
    )
  })

  // marching-cubes.ts flips the gradient sign so normals point toward decreasing values:
  // inward (toward Γ) for an E < E_F electron pocket. Measured dot(n, v̂) = −1.0000 everywhere.
  test(`normals point inward (toward decreasing E) for an electron pocket`, () => {
    const iso = extract_sphere(24, false)
    expect(iso.normals).toHaveLength(iso.positions.length)
    let max_dot = -Infinity
    for (let idx = 0; idx < vertex_count(iso); idx++) {
      const vertex = vertex_at(iso, idx)
      const normal = Array.from(iso.normals.subarray(3 * idx, 3 * idx + 3)) as Vec3
      max_dot = Math.max(max_dot, math.dot(normal, vertex) / Math.hypot(...vertex))
    }
    expect(max_dot).toBeLessThan(-0.999)
  })

  test(`periodic and endpoint-inclusive grids agree on the area`, () => {
    const area_bxsf = surface_area(extract_sphere(48, false))
    const area_frmsf = surface_area(extract_sphere(48, true))
    expect(Math.abs(area_bxsf - area_frmsf) / SPHERE_AREA).toBeLessThan(2e-4)
  })

  // A sphere centred on the zone-boundary X point wraps onto both ±k_x faces. Every vertex
  // must stay inside the centred parallelepiped, the two half-spheres must meet each face,
  // and the summed area must still be the full sphere (measured −2.1e-3 / −2.0e-3).
  // Both grids have an even period (48 unique points), so the zone faces at ±½ are grid
  // planes; an odd period can only centre the cell to within half a voxel
  test.each([false, true])(`BZ folding of a sphere at X (periodic=%s)`, (periodic) => {
    const count = periodic ? 48 : 49
    const { isosurfaces } = extract_fermi_surface(free_electron(count, periodic, B_LEN / 2))
    expect(isosurfaces).toHaveLength(1)
    const iso = isosurfaces[0]
    expect(Math.abs(rel_area_error(iso))).toBeLessThan(3e-3)
    let max_coord = 0
    let n_on_pos_face = 0
    let n_on_neg_face = 0
    // Float32 positions: B_LEN/2 ≈ 0.785 rounds to ~6e-8
    for (const vertex of vertices_of(iso)) {
      max_coord = Math.max(max_coord, ...vertex.map(Math.abs))
      if (Math.abs(vertex[0] - B_LEN / 2) < 1e-6) n_on_pos_face++
      if (Math.abs(vertex[0] + B_LEN / 2) < 1e-6) n_on_neg_face++
    }
    expect(max_coord).toBeLessThanOrEqual(B_LEN / 2 + 1e-6)
    expect(n_on_pos_face).toBeGreaterThan(50)
    expect(n_on_neg_face).toBe(n_on_pos_face)
  })
})

describe(`grid/lattice conventions`, () => {
  // A half-step grid shift (FRMSF lshift=2) places point i at (i + ½)/n. Sampling the sphere
  // on that shifted mesh and telling the extractor about the shift must reproduce the same
  // sphere centre; ignoring the shift (the old behaviour) moves the surface by half a voxel.
  test.each([
    { name: `identity`, k_lattice: IDENTITY_MATRIX3 },
    { name: `hexagonal`, k_lattice: HEXAGONAL },
  ])(`grid_shift moves the surface by half a voxel ($name lattice)`, ({ k_lattice }) => {
    const grid_n = 20
    const centroid = (data: BandGridData): Vec3 => {
      const { isosurfaces } = extract_fermi_surface(data, { mu: 0.3 })
      const verts = vertices_of(isosurfaces[0])
      return verts
        .reduce<Vec3>((sum, vec) => math.add(sum, vec), [0, 0, 0])
        .map((val) => val / verts.length) as Vec3
    }
    const unshifted = centroid(make_band_data(grid_n, sphere, { k_lattice, periodic: true }))
    const shifted_data = make_band_data(grid_n, sphere, {
      k_lattice,
      periodic: true,
      grid_shift: [0.5, 0.5, 0.5],
    })
    const shifted = centroid(shifted_data)
    // Both describe a sphere centred on Γ
    for (const axis of [0, 1, 2]) {
      expect(unshifted[axis]).toBeCloseTo(0, 3)
      expect(shifted[axis]).toBeCloseTo(0, 3)
    }
    // Dropping the shift from the same shifted grid displaces the centroid by ½ voxel
    const ignored = centroid({ ...shifted_data, grid_shift: undefined })
    const half_voxel = math.scale(
      k_lattice.reduce<Vec3>((sum, row) => math.add(sum, row), [0, 0, 0]),
      0.5 / grid_n,
    )
    for (const axis of [0, 1, 2]) expect(ignored[axis]).toBeCloseTo(-half_voxel[axis], 3)
  })

  // Sphere of radius 0.3 around Γ must stay centred and keep its radius through extraction
  // and upsampling: a mixed-up grid convention rescales it by ~n/(n−1), and shifting a
  // Γ-started grid by −½(a*+b*+c*) instead of rolling it splits it into corner caps
  const lshift_0 = 0.5 - 20 / 2 // lshift=0 mesh: index 0 already at −½
  test.each<[string, number, boolean, number, Vec3?]>([
    [`endpoint-inclusive (BXSF)`, 20, false, 1],
    [`endpoint-inclusive (BXSF), odd n`, 21, false, 1],
    [`endpoint-inclusive (BXSF), 2x upsampled`, 20, false, 2],
    [`periodic (FRMSF lshift=1)`, 20, true, 1],
    [`periodic (FRMSF lshift=1), odd n`, 21, true, 1],
    [`periodic (FRMSF), 2x upsampled`, 20, true, 2],
    [`endpoint-inclusive (BXSF), auto (2.4x)`, 20, false, 0],
    [`periodic (FRMSF), auto (2.4x)`, 20, true, 0],
    [`periodic (FRMSF lshift=0)`, 20, true, 1, [lshift_0, lshift_0, lshift_0]],
  ])(
    `Γ-centred sphere keeps its radius: %s`,
    (_label, grid_n, periodic, factor, grid_shift) => {
      const band_data = make_band_data(grid_n, sphere, { periodic, grid_shift })
      const { isosurfaces } = extract_fermi_surface(band_data, {
        mu: 0.3,
        interpolation_factor: factor,
      })
      const radii = vertices_of(isosurfaces[0]).map((vertex) => Math.hypot(...vertex))
      for (const radius of radii) expect(radius).toBeCloseTo(0.3, 1)
      expect(radii.reduce((sum, radius) => sum + radius, 0) / radii.length).toBeCloseTo(0.3, 2)
    },
  )

  // longest axis drives auto: slabs and anisotropic meshes must not be over-refined
  test.each<[Vec3, number]>([
    [[17, 17, 17], 48 / 17],
    [[31, 31, 31], 48 / 31],
    [[16, 16, 12], 3],
    [[48, 48, 2], 1],
    [[64, 64, 64], 1],
    [[8, 8, 8], 4],
  ])(`auto_interpolation_factor(%j) = %f`, (k_grid, expected) => {
    expect(auto_interpolation_factor(k_grid)).toBe(expected)
  })

  test(`interpolation_factor 0 extracts exactly what the explicit auto factor does`, () => {
    const band_data = make_band_data(20, sphere, { periodic: true })
    const auto = extract_fermi_surface(band_data, { mu: 0.3, interpolation_factor: 0 })
    const explicit = extract_fermi_surface(band_data, { mu: 0.3, interpolation_factor: 2.4 })
    expect(auto.isosurfaces).toEqual(explicit.isosurfaces)
    expect(auto.isosurfaces[0].positions.length).toBeGreaterThan(
      extract_fermi_surface(band_data, { mu: 0.3 }).isosurfaces[0].positions.length,
    )
  })

  test.each([
    { periodic: false, dims: [10, 4, 6] as Vec3, factor: 2, expected: [19, 7, 11] as Vec3 },
    { periodic: true, dims: [10, 4, 6] as Vec3, factor: 2, expected: [20, 8, 12] as Vec3 },
    { periodic: false, dims: [9, 5, 5] as Vec3, factor: 1.5, expected: [13, 7, 7] as Vec3 },
  ])(
    `upsample_grid keeps the grid convention (periodic=$periodic): $dims x$factor → $expected`,
    ({ periodic, dims, factor, expected }) => {
      // Catmull-Rom reproduces linear fields exactly, so an x-linear grid must resample to
      // ix·period/span wherever the 4-point stencil does not reach the periodic seam
      const grid = make_band_grid(dims, (idx_x) => idx_x)
      const up_vector = upsample_grid(grid, factor, periodic)
      expect(up_vector.dims).toEqual(expected)
      expect(up_vector.order).toBe(`z_fastest`)
      expect(up_vector.values).toHaveLength(expected[0] * expected[1] * expected[2])
      const [new_nx, size_y, size_z] = expected
      const period = periodic ? dims[0] : dims[0] - 1
      const span = periodic ? new_nx : new_nx - 1
      let n_checked = 0
      for (let idx_x = 0; idx_x < new_nx; idx_x++) {
        const src_x = (idx_x * period) / span
        const base = Math.floor(src_x)
        if (base < 1 || base + 2 > period - 1) continue // stencil touches the wrap seam
        for (let idx_y = 0; idx_y < size_y; idx_y++) {
          for (let idx_z = 0; idx_z < size_z; idx_z++) {
            expect(up_vector.values[(idx_x * size_y + idx_y) * size_z + idx_z]).toBeCloseTo(
              src_x,
              12,
            )
          }
        }
        n_checked++
      }
      expect(n_checked).toBeGreaterThan(5)
    },
  )

  test(`upsample_grid with factor ≤ 1 returns the input grid untouched`, () => {
    const grid = make_band_grid([3, 3, 3], (idx_x, idx_y, idx_z) => idx_x + idx_y + idx_z)
    expect(upsample_grid(grid, 1)).toBe(grid)
  })

  // The cost is the upsampled point count (factor³ per band), not the factor: bounding only
  // the factor let a 16³ grid at factor 40 allocate 601³ = 2.17e8 doubles (1.74 GB) from a
  // 4 kB input. The last row is the shipped 31³ cu_fs.bxsf mesh at the UI max of 4x, which
  // the guard must not clip.
  const factor_40_error = /601×601×601 = 2\.17e\+8 points \(1\.74e\+3 MB per band\)/
  test.each([
    [`factor 40 on 16³`, [16, 16, 16] as Vec3, 40, factor_40_error],
    [`a NaN factor`, [8, 8, 8] as Vec3, Number.NaN, /factor NaN/],
    [`31³ at 4x`, [31, 31, 31] as Vec3, 4, null],
  ])(`upsample_grid bounds %s by point count`, (_label, dims, factor, expected) => {
    const grid = make_band_grid(dims, (idx_x) => idx_x)
    if (expected) expect(() => upsample_grid(grid, factor)).toThrow(expected)
    else expect(upsample_grid(grid, factor).dims).toEqual([121, 121, 121])
  })

  test(`single-point endpoint-inclusive axis upsamples without NaN/crash`, () => {
    // [1][n][n] grid: px = 0, so unguarded resampling computes 0/0 = NaN and the
    // tricubic wrap (v % 0) indexes garbage. A single x-plane has no cubes
    // to march, so the expected output is simply no surfaces.
    const grid_n = 6
    const band_data: BandGridData = {
      energies: [
        [
          make_band_grid([1, grid_n, grid_n], (_ix, idx_y, idx_z) =>
            Math.hypot(idx_y / (grid_n - 1) - 0.5, idx_z / (grid_n - 1) - 0.5),
          ),
        ],
      ],
      k_grid: [1, grid_n, grid_n],
      k_lattice: IDENTITY_MATRIX3,
      fermi_energy: 0.3,
      n_bands: 1,
      n_spins: 1,
    }
    expect(extract_fermi_surface(band_data, { interpolation_factor: 2 }).isosurfaces).toEqual(
      [],
    )
  })
})

describe(`compute_fermi_slice`, () => {
  // An odd endpoint-inclusive (BXSF) grid puts a grid plane through the centre, so the Γ slice
  // cuts through on-plane mesh vertices whose edges a strict sign test would drop. The even
  // grid has no on-plane vertex and checks the fix is a no-op there.
  test.each([21, 22, 31])(
    `slices a %i-point grid through Γ, on-plane vertices and all`,
    (count) => {
      const fermi_data = extract_fermi_surface(
        make_band_data(count, sphere, { fermi_energy: 0.25 }),
      )
      const { isolines } = compute_fermi_slice(fermi_data, {
        miller_indices: [0, 0, 1],
        distance: 0,
      })
      // the isosurface is a sphere of radius 0.25, so its central slice is one circle of that radius
      expect(isolines).toHaveLength(1)
      for (const [pixel_x, pixel_y] of isolines[0].points_2d) {
        expect(Math.hypot(pixel_x, pixel_y)).toBeCloseTo(0.25, 2)
      }
    },
  )

  // oxfmt-ignore
  const quad_faces = [
    [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [2, 6, 7, 3], [0, 3, 7, 4], [1, 5, 6, 2],
  ]

  const make_box_fermi_data = (
    faces: number[][] = BOX_TRI_FACES,
    properties?: Record<string, Float32Array>,
  ): FermiSurfaceData =>
    make_fermi_surface([make_fermi_isosurface(BOX_VERTICES, faces, { properties })])

  // Slicing the box at z=0.05 cuts its four side walls: one closed unit-square contour
  test.each([
    [`triangles`, BOX_TRI_FACES],
    [`quads`, quad_faces], // regression: the 4th edge of a quad used to be skipped
  ])(`slices the box walls into one closed unit-square contour (%s)`, (_label, faces) => {
    const slice = compute_fermi_slice(make_box_fermi_data(faces), {
      miller_indices: [0, 0, 1],
      distance: 0.05,
    })

    expect(slice.plane_normal).toEqual([0, 0, 1])
    expect(slice.plane_distance).toBe(0.05)
    expect(slice.metadata).toEqual({ n_lines: 1, has_properties: false })
    const [isoline] = slice.isolines
    expect(isoline.is_closed).toBe(true)
    expect(isoline.band_index).toBe(0)
    // Every contour point lies on the z=0.05 plane on the box perimeter (|x| or |y| = 0.5);
    // box corners are exactly representable in Float32 and 0.05 interpolates within 1e-8
    for (const [pixel_x, pixel_y, pixel_z] of isoline.points) {
      expect(pixel_z).toBeCloseTo(0.05, 7)
      expect(Math.max(Math.abs(pixel_x), Math.abs(pixel_y))).toBeCloseTo(0.5, 12)
    }
    // Consecutive points must be close: contours are traced, not random scribbles
    for (let idx = 0; idx < isoline.points_2d.length - 1; idx++) {
      const [coord_x_1, coord_y_1] = isoline.points_2d[idx]
      const [coord_x, coord_y_2] = isoline.points_2d[idx + 1]
      expect(Math.hypot(coord_x - coord_x_1, coord_y_2 - coord_y_1)).toBeLessThanOrEqual(
        1.0 + 1e-12,
      )
    }
  })

  test(`interpolates per-vertex properties along the contour`, () => {
    // λ = z·10 → every contour point at z=0.05 must carry 0.5
    const lambda = Float32Array.from(BOX_VERTICES, (vertex) => vertex[2] * 10)
    const two_properties = make_box_fermi_data(BOX_TRI_FACES, {
      λ: lambda,
      Δ: Float32Array.from(BOX_VERTICES, () => 7),
    })
    const slice = compute_fermi_slice(two_properties, {
      miller_indices: [0, 0, 1],
      distance: 0.05,
    })
    expect(slice.metadata.has_properties).toBe(true)
    const [isoline] = slice.isolines
    expect(isoline.properties).toHaveLength(isoline.points.length)
    for (const value of isoline.properties ?? []) expect(value).toBeCloseTo(0.5, 6)
    // options.property picks the named property the contours carry (default: the first, λ)
    const contour_values = (property?: string) =>
      compute_fermi_slice(two_properties, { distance: 0.05, property }).isolines[0].properties
    expect(contour_values(`Δ`)?.every((value) => value === 7)).toBe(true)
    expect(contour_values(`missing`)).toBeUndefined()
  })

  const zero_lattice: Matrix3x3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  // oxfmt-ignore
  test.each([
    [`zero miller indices`, IDENTITY_MATRIX3, [0, 0, 0], /Invalid miller indices.*at least one index must be non-zero/],
    [`a degenerate k_lattice`, zero_lattice, [1, 0, 0], /Degenerate plane normal.*zero-length normal/],
  ] as [string, Matrix3x3, Vec3, RegExp][])(`throws for %s`, (_label, k_lattice, miller_indices, pattern) => {
    const fermi_data = { ...make_box_fermi_data(), k_lattice }
    expect(() => compute_fermi_slice(fermi_data, { miller_indices })).toThrow(pattern)
  })
})

describe(`detect_irreducible_bz`, () => {
  const make_data = (...vertex_lists: Vec3[][]): FermiSurfaceData =>
    make_fermi_surface(vertex_lists.map((vertices) => make_fermi_isosurface(vertices, [])))

  // 11 vertices (> IRREDUCIBLE_BZ_MIN_VERTICES), all in the positive octant
  const positive_verts: Vec3[] = Array.from({ length: 11 }, (_, idx) => [
    0.1 + idx * 0.05,
    0.2,
    0.3,
  ])
  // 11 vertices spanning positive and negative octants
  const spanning_verts: Vec3[] = positive_verts.map((vert, idx) =>
    idx % 2 ? vert : [-vert[0], vert[1], vert[2]],
  )

  // A small electron pocket around Gamma in a large supercell spans the full zone, yet every
  // coordinate is inside 0.005 1/A, so the absolute 0.01 1/A tolerance this used to carry read
  // it as a wedge and the surface got tiled 48 times.
  const pocket: Vec3[] = positive_verts.map((_unused_value, idx) => [
    idx % 2 ? 5e-3 : -5e-3,
    4e-3,
    3e-3,
  ])
  // that same supercell's genuine wedge, with round-off pushing one vertex past zero
  const small_wedge: Vec3[] = positive_verts.map((vert, idx) =>
    idx ? (vert.map((val) => val * 0.1) as Vec3) : [-1e-9, 0, 0.05],
  )

  test.each([
    {
      label: `vertices in positive octant only`,
      data: make_data(positive_verts),
      expected: true,
    },
    { label: `vertices spanning full BZ`, data: make_data(spanning_verts), expected: false },
    { label: `a tiny full-zone pocket`, data: make_data(pocket), expected: false },
    { label: `a small wedge dipping past zero`, data: make_data(small_wedge), expected: true },
    { label: `empty isosurfaces`, data: make_data(), expected: false },
    {
      // needs > 10 vertices to be considered valid irreducible data
      label: `too few vertices`,
      data: make_data(positive_verts.slice(0, 2)),
      expected: false,
    },
  ])(`returns $expected for $label`, ({ data, expected }) => {
    expect(detect_irreducible_bz(data)).toBe(expected)
  })
})

describe(`lattice_point_group_matrices`, () => {
  // Real-space lattices (rows) → reciprocal k_lattice via reciprocal_lattice(two_pi)
  const real_lattices = {
    cubic: cubic_matrix(4),
    hexagonal: [
      [3, 0, 0],
      [-1.5, (3 * Math.sqrt(3)) / 2, 0],
      [0, 0, 5],
    ] as Matrix3x3,
    tetragonal: [
      [3, 0, 0],
      [0, 3, 0],
      [0, 0, 5],
    ] as Matrix3x3,
    orthorhombic: [
      [3, 0, 0],
      [0, 4, 0],
      [0, 0, 5],
    ] as Matrix3x3,
    monoclinic: [
      [3, 0, 0],
      [0, 4, 0],
      [1, 0, 5],
    ] as Matrix3x3,
    triclinic: [
      [3, 0, 0],
      [0.5, 4, 0],
      [0.7, 1.1, 5],
    ] as Matrix3x3,
  }
  const k_lattice_of = (name: keyof typeof real_lattices) =>
    math.reciprocal_lattice(real_lattices[name], { two_pi: true })

  // Column-major 4x4 applied to a column vector
  const apply = (mat: Matrix4Tuple, [vector_x, vector_y, vector_z]: Vec3): Vec3 => [
    mat[0] * vector_x + mat[4] * vector_y + mat[8] * vector_z,
    mat[1] * vector_x + mat[5] * vector_y + mat[9] * vector_z,
    mat[2] * vector_x + mat[6] * vector_y + mat[10] * vector_z,
  ]
  // Largest distance from any transformed BZ vertex to the nearest original BZ vertex
  const max_vertex_mismatch = (ops: Matrix4Tuple[], vertices: Vec3[]): number => {
    let worst = 0
    for (const operation of ops) {
      for (const vertex of vertices) {
        const image = apply(operation, vertex)
        const nearest = Math.min(...vertices.map((other) => math.euclidean_dist(other, image)))
        worst = Math.max(worst, nearest)
      }
    }
    return worst
  }
  const det_4x4_rotation = (mat: Matrix4Tuple) =>
    mat[0] * (mat[5] * mat[10] - mat[6] * mat[9]) -
    mat[4] * (mat[1] * mat[10] - mat[2] * mat[9]) +
    mat[8] * (mat[1] * mat[6] - mat[2] * mat[5])

  // Holohedry orders: Oh 48, D6h 24, D4h 16, D2h 8, C2h 4, Ci 2
  test.each([
    [`cubic`, 48],
    [`hexagonal`, 24],
    [`tetragonal`, 16],
    [`orthorhombic`, 8],
    [`monoclinic`, 4],
    [`triclinic`, 2],
  ] as const)(`%s lattice has %i operations that map the BZ onto itself`, (name, n_ops) => {
    const k_lattice = k_lattice_of(name)
    const ops = lattice_point_group_matrices(k_lattice)
    expect(ops).toHaveLength(n_ops)
    expect(
      new Set(ops.map((operation) => operation.map((val) => val.toFixed(9)).join(`,`))).size,
    ).toBe(n_ops)
    for (const [idx, val] of ops[0].entries()) expect(val).toBeCloseTo(IDENTITY_4x4[idx], 12)
    for (const operation of ops)
      expect(Math.abs(det_4x4_rotation(operation))).toBeCloseTo(1, 10)

    // Every operation must permute the Brillouin-zone vertices (measured ≤ 1.2e-15)
    const { vertices } = compute_brillouin_zone(k_lattice)
    expect(max_vertex_mismatch(ops, vertices)).toBeLessThan(1e-8)
    // Cached: the same lattice returns the same array
    expect(lattice_point_group_matrices(k_lattice)).toBe(ops)
  })

  // a hexagonal a = 3.21, c = 5.21 cell written to 4 decimals is off exact hexagonal by
  // 7.2e-6 on the worst Gram entry, which the old fixed 1e-6 rejected: 24 ops fell to 8 and
  // the wedge tiled a third of the zone with no visible symptom
  test(`a hexagonal lattice written to 4 decimals keeps all 24 operations`, () => {
    const rounded = math
      .reciprocal_lattice(
        [
          [3.21, 0, 0],
          [-1.605, (3.21 * Math.sqrt(3)) / 2, 0],
          [0, 0, 5.21],
        ],
        { two_pi: true },
      )
      .map((row) => row.map((val) => Number(val.toFixed(4)))) as Matrix3x3
    const ops = lattice_point_group_matrices(rounded)
    expect(ops).toHaveLength(24)
    expect(lattice_point_group_matrices(rounded, 1e-6)).toHaveLength(8)
    // the accepted operations still tile the zone without visible seams
    const { vertices } = compute_brillouin_zone(rounded)
    expect(max_vertex_mismatch(ops, vertices)).toBeLessThan(1e-3)
  })

  // The cubic ops are exactly the 48 axis permutations × sign flips (Oh in Cartesian space),
  // also when the lattice arrives in a sheared (non-reduced) basis, where the {-1,0,1}
  // integer-matrix search alone finds only 4 of them
  test.each([
    [`reduced`, (k_lattice: Matrix3x3) => k_lattice],
    [
      `sheared`,
      ([value_b_1, value_b_2, value_b_3]: Matrix3x3): Matrix3x3 => [
        value_b_1,
        math.add(math.scale(value_b_1, 5), value_b_2),
        value_b_3,
      ],
    ],
  ])(`cubic operations are the 48 signed axis permutations (%s basis)`, (_name, rebase) => {
    const ops = lattice_point_group_matrices(rebase(k_lattice_of(`cubic`)))
    expect(ops).toHaveLength(48)
    for (const operation of ops) {
      const rotation = [0, 1, 2].map((row) => [0, 1, 2].map((col) => operation[col * 4 + row]))
      for (const line of rotation) {
        expect(line.filter((val) => Math.abs(Math.abs(val) - 1) < 1e-12)).toHaveLength(1)
        expect(line.filter((val) => Math.abs(val) < 1e-12)).toHaveLength(2)
      }
    }
  })

  // Applying the cubic Oh operations in Cartesian space (what tiling used to do for every
  // lattice) does NOT map a non-cubic zone onto itself: measured mismatches 1.19 (hexagonal),
  // 0.59 (tetragonal), 0.59 (orthorhombic) Å⁻¹ — whole spurious copies of the surface
  test.each([`hexagonal`, `tetragonal`, `orthorhombic`] as const)(
    `cubic Oh operations do not preserve the %s Brillouin zone`,
    (name) => {
      const cubic_ops = lattice_point_group_matrices(k_lattice_of(`cubic`))
      const { vertices } = compute_brillouin_zone(k_lattice_of(name))
      expect(max_vertex_mismatch(cubic_ops, vertices)).toBeGreaterThan(0.5)
    },
  )
})
