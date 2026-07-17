import type { Vec3 } from '$lib'
import type { BondPair } from '$lib/structure'
import { electroneg_ratio, is_spectator_center } from '$lib/structure/bonding'
import { get_pbc_image_sites } from '$lib/structure/pbc'
import {
  build_adjacency,
  compute_polyhedra,
  convex_hull_3d,
  merge_polyhedra_buffers,
} from '$lib/structure/polyhedra'
import type { Polyhedron } from '$lib/structure/polyhedra'
import { make_supercell } from '$lib/structure/supercell'
import { describe, expect, test } from 'vitest'
import { make_crystal } from '../setup'

// Minimal BondPair stub (only fields polyhedra code reads)
const make_bond = (site_idx_1: number, site_idx_2: number): BondPair => ({
  pos_1: [0, 0, 0],
  pos_2: [0, 0, 0],
  site_idx_1,
  site_idx_2,
  bond_length: 1,
  strength: 1,
  transform_matrix: new Float32Array(16),
})
// Bonds from a center site to each listed neighbor site
const bonds_from = (center: number, neighbor_idxs: number[]): BondPair[] =>
  neighbor_idxs.map((idx) => make_bond(center, idx))

const add_vec = (origin: Vec3, off: readonly number[]): Vec3 => [
  origin[0] + off[0],
  origin[1] + off[1],
  origin[2] + off[2],
]
// Unit-normal of triangle (a, b, c) - not normalized (only signs/ratios are used)
const tri_normal = ([vert_a, vert_b, vert_c]: Vec3[]): Vec3 => [
  (vert_b[1] - vert_a[1]) * (vert_c[2] - vert_a[2]) -
    (vert_b[2] - vert_a[2]) * (vert_c[1] - vert_a[1]),
  (vert_b[2] - vert_a[2]) * (vert_c[0] - vert_a[0]) -
    (vert_b[0] - vert_a[0]) * (vert_c[2] - vert_a[2]),
  (vert_b[0] - vert_a[0]) * (vert_c[1] - vert_a[1]) -
    (vert_b[1] - vert_a[1]) * (vert_c[0] - vert_a[0]),
]
const dot = (vec_a: Vec3, vec_b: Vec3): number =>
  vec_a[0] * vec_b[0] + vec_a[1] * vec_b[1] + vec_a[2] * vec_b[2]
const face_verts = (hull: { vertices: Vec3[] }, face: number[]): Vec3[] =>
  face.map((idx) => hull.vertices[idx])

const octahedron_points: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]
const cube_points = (side: number): Vec3[] =>
  [0, 1].flatMap((x) =>
    [0, 1].flatMap((y) => [0, 1].map((z): Vec3 => [x * side, y * side, z * side])),
  )

// `center` site at `origin` surrounded by an octahedron of `vertex` sites at `dist`
const octahedron_sites = (center: string, vertex: string, origin: Vec3, dist: number) => [
  { element: center, xyz: origin },
  ...octahedron_points.map((off) => ({
    element: vertex,
    xyz: add_vec(origin, [off[0] * dist, off[1] * dist, off[2] * dist]),
  })),
]
// `center` at `origin` with 4 `vertex` sites at tetrahedral positions `dist` away
const tetrahedron_sites = (center: string, vertex: string, origin: Vec3, dist: number) => {
  const off = dist / Math.sqrt(3)
  return [
    { element: center, xyz: origin },
    ...[
      [off, off, off],
      [-off, -off, off],
      [-off, off, -off],
      [off, -off, -off],
    ].map((offset) => ({ element: vertex, xyz: add_vec(origin, offset) })),
  ]
}

describe(`convex_hull_3d`, () => {
  test(`tetrahedron: 4 faces, correct volume`, () => {
    const hull = convex_hull_3d([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ])
    expect(hull.faces).toHaveLength(4)
    expect(hull.vertices).toHaveLength(4)
    expect(hull.volume).toBeCloseTo(1 / 6, 10)
  })

  test(`octahedron: 8 faces, volume 4/3`, () => {
    const hull = convex_hull_3d(octahedron_points)
    expect(hull.faces).toHaveLength(8)
    expect(hull.vertices).toHaveLength(6)
    expect(hull.volume).toBeCloseTo(4 / 3, 10)
  })

  test(`cube: 12 triangles, volume = side^3`, () => {
    const hull = convex_hull_3d(cube_points(2.5))
    expect(hull.faces).toHaveLength(12)
    expect(hull.vertices).toHaveLength(8)
    expect(hull.volume).toBeCloseTo(2.5 ** 3, 8)
  })

  test(`interior points are excluded from hull`, () => {
    const hull = convex_hull_3d([...octahedron_points, [0, 0, 0], [0.1, 0.1, 0.1]])
    expect(hull.vertices).toHaveLength(6)
    expect(hull.volume).toBeCloseTo(4 / 3, 10)
  })

  test.each([
    [
      `fewer than 4 points`,
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ] as Vec3[],
    ],
    [
      `coplanar square`,
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ] as Vec3[],
    ],
    [
      `collinear points`,
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ] as Vec3[],
    ],
    [
      `duplicate points only`,
      [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ] as Vec3[],
    ],
  ])(`degenerate input: %s -> no faces, zero volume`, (_label, points) => {
    const hull = convex_hull_3d(points)
    expect(hull.faces).toHaveLength(0)
    expect(hull.volume).toBe(0)
  })

  test(`near-duplicate points are deduped`, () => {
    // 2nd point duplicates the first within eps
    const hull = convex_hull_3d([
      [0, 0, 0],
      [1e-9, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ])
    expect(hull.vertices).toHaveLength(4)
    expect(hull.volume).toBeCloseTo(1 / 6, 8)
  })

  test(`random point clouds satisfy Euler formula and outward normals`, () => {
    // Deterministic pseudo-random points (LCG, glibc parameters)
    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let trial = 0; trial < 20; trial++) {
      const points = Array.from(
        { length: 4 + Math.floor(rand() * 12) },
        () => [rand() * 10 - 5, rand() * 10 - 5, rand() * 10 - 5] as Vec3,
      )
      const hull = convex_hull_3d(points)
      if (hull.faces.length === 0) continue // degenerate by chance (unlikely)

      // Euler: V - E + F = 2 (triangulated closed surface: E = 3F/2)
      const edges = new Set(
        hull.faces.flatMap(([vert_a, vert_b, vert_c]) =>
          [
            [vert_a, vert_b],
            [vert_b, vert_c],
            [vert_c, vert_a],
          ].map(([from, to]) => (from < to ? `${from}-${to}` : `${to}-${from}`)),
        ),
      )
      expect(hull.vertices.length - edges.size + hull.faces.length).toBe(2)
      expect(edges.size).toBe((3 * hull.faces.length) / 2)

      const centroid = hull.vertices
        .reduce<Vec3>((acc, vertex) => add_vec(acc, vertex), [0, 0, 0])
        .map((coord) => coord / hull.vertices.length) as Vec3
      for (const face of hull.faces) {
        const verts = face_verts(hull, face)
        const normal = tri_normal(verts)
        // face normal points away from the centroid
        const centroid_to_vert = add_vec(
          verts[0],
          centroid.map((coord) => -coord),
        )
        expect(dot(normal, centroid_to_vert)).toBeGreaterThan(0)
        // every input point is inside or on the hull (within eps of each face plane)
        const norm_len = Math.hypot(...normal)
        const neg_vert = verts[0].map((coord) => -coord) as Vec3
        for (const point of points) {
          expect(dot(normal, add_vec(point, neg_vert)) / norm_len).toBeLessThan(1e-6)
        }
      }
    }
  })
})

describe(`build_adjacency`, () => {
  test(`symmetric adjacency from bond pairs`, () => {
    const adjacency = build_adjacency([make_bond(0, 1), make_bond(1, 2), make_bond(0, 2)])
    expect(adjacency.get(0)).toEqual(new Set([1, 2]))
    expect(adjacency.get(1)).toEqual(new Set([0, 2]))
    expect(adjacency.get(2)).toEqual(new Set([0, 1]))
  })

  test(`ignores self-bonds and dedupes repeated pairs`, () => {
    const adjacency = build_adjacency([make_bond(0, 0), make_bond(0, 1), make_bond(1, 0)])
    expect(adjacency.get(0)).toEqual(new Set([1]))
    expect(adjacency.get(0)?.has(0)).toBe(false)
  })
})

// Na octahedrally coordinated by 6 Cl (rocksalt-like local environment)
const make_nacl_cluster = () => make_crystal(10, octahedron_sites(`Na`, `Cl`, [5, 5, 5], 2))
const octahedral_bonds = bonds_from(0, [1, 2, 3, 4, 5, 6])

// Conventional rocksalt NaCl cell (4 Na + 4 Cl)
const make_rocksalt = () =>
  make_crystal(5.64, [
    { element: `Na`, abc: [0, 0, 0] },
    { element: `Na`, abc: [0.5, 0.5, 0] },
    { element: `Na`, abc: [0.5, 0, 0.5] },
    { element: `Na`, abc: [0, 0.5, 0.5] },
    { element: `Cl`, abc: [0.5, 0, 0] },
    { element: `Cl`, abc: [0, 0.5, 0] },
    { element: `Cl`, abc: [0, 0, 0.5] },
    { element: `Cl`, abc: [0.5, 0.5, 0.5] },
  ])

describe(`compute_polyhedra`, () => {
  test(`NaCl cluster: Na center forms octahedron, Cl does not`, () => {
    const structure = make_nacl_cluster()
    const polyhedra = compute_polyhedra(structure, octahedral_bonds)
    expect(polyhedra).toHaveLength(1)
    const [poly] = polyhedra
    expect(poly.center_element).toBe(`Na`)
    expect(poly.center_site_idx).toBe(0)
    expect(poly.faces).toHaveLength(8)
    expect(poly.volume).toBeCloseTo((4 / 3) * 2 ** 3, 6)
    // vertex_site_idxs maps each hull vertex to the site at that exact position
    expect([...poly.vertex_site_idxs].toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
    for (const [v_idx, site_idx] of poly.vertex_site_idxs.entries()) {
      expect(poly.vertices[v_idx]).toEqual(structure.sites[site_idx].xyz)
    }
  })

  test(`SiO4 tetrahedron detected with Si center`, () => {
    const structure = make_crystal(10, tetrahedron_sites(`Si`, `O`, [5, 5, 5], 1.6))
    const polyhedra = compute_polyhedra(structure, bonds_from(0, [1, 2, 3, 4]))
    expect(polyhedra).toHaveLength(1)
    expect(polyhedra[0].center_element).toBe(`Si`)
    expect(polyhedra[0].faces).toHaveLength(4)
  })

  test(`methane: C is more electronegative than H, no polyhedron`, () => {
    const structure = make_crystal(10, tetrahedron_sites(`C`, `H`, [5, 5, 5], 1.09))
    expect(compute_polyhedra(structure, bonds_from(0, [1, 2, 3, 4]))).toHaveLength(0)
  })

  test(`min_neighbors threshold filters low-coordination centers`, () => {
    const structure = make_nacl_cluster()
    const count = (min_neighbors: number) =>
      compute_polyhedra(structure, octahedral_bonds, { min_neighbors }).length
    expect(count(7)).toBe(0)
    expect(count(6)).toBe(1)
  })

  test(`excluded_center_elements removes matching centers`, () => {
    const polyhedra = compute_polyhedra(make_nacl_cluster(), octahedral_bonds, {
      excluded_center_elements: [`Na`],
    })
    expect(polyhedra).toHaveLength(0)
  })

  test(`electronegativity_margin tightens the cation test`, () => {
    // Na (0.93) vs Cl (3.16): margin of 3 exceeds the EN gap, so Na no longer qualifies
    const polyhedra = compute_polyhedra(make_nacl_cluster(), octahedral_bonds, {
      electronegativity_margin: 3,
    })
    expect(polyhedra).toHaveLength(0)
  })

  test(`coplanar square-planar coordination yields no polyhedron`, () => {
    const structure = make_crystal(10, [
      { element: `Pt`, xyz: [5, 5, 5] },
      ...octahedron_points.slice(0, 4).map((off) => ({
        element: `Cl`,
        xyz: add_vec([5, 5, 5], [off[0] * 2, off[1] * 2, off[2] * 2]),
      })),
    ])
    expect(compute_polyhedra(structure, bonds_from(0, [1, 2, 3, 4]))).toHaveLength(0)
  })

  test(`boundary completeness: truncated supercell copies are skipped`, () => {
    // Rocksalt NaCl conventional cell -> real bonding -> 3x3x3 supercell without
    // image atoms: interior Na atoms keep CN 6, boundary copies are truncated
    const supercell = make_supercell(make_rocksalt(), [3, 3, 3])
    const bonds = electroneg_ratio(supercell)
    const polyhedra = compute_polyhedra(supercell, bonds)

    expect(polyhedra.length).toBeGreaterThan(0)
    // Every rendered polyhedron must be a full octahedron (CN 6), never truncated
    for (const poly of polyhedra) {
      expect(poly.center_element).toBe(`Na`)
      expect(poly.vertex_site_idxs).toHaveLength(6)
      expect(poly.faces).toHaveLength(8)
    }
    // Truncation check: boundary Na sites exist but don't render
    const adjacency = build_adjacency(bonds)
    const is_truncated_na = (idx: number) =>
      supercell.sites[idx].species[0].element === `Na` && (adjacency.get(idx)?.size ?? 0) < 6
    expect(supercell.sites.some((_site, idx) => is_truncated_na(idx))).toBe(true)
    const rendered = new Set(polyhedra.map((poly) => poly.center_site_idx))
    for (const idx of supercell.sites.keys()) {
      if (is_truncated_na(idx)) expect(rendered.has(idx)).toBe(false)
    }
  })

  test(`single unit cell with PBC images: base Na get full octahedra with real-atom corners`, () => {
    // Bond-completing image atoms (find_image_atoms phase 2) provide every
    // boundary neighbor as a real displayed atom, so all base Na render complete
    // octahedra and every polyhedron corner coincides with a displayed site.
    const with_images = get_pbc_image_sites(make_rocksalt())
    const polyhedra = compute_polyhedra(with_images, electroneg_ratio(with_images))

    // all 4 base Na sites render complete octahedra
    const base_na_polyhedra = polyhedra.filter((poly) => poly.center_orig_idx < 4)
    expect(base_na_polyhedra.length).toBeGreaterThanOrEqual(4)
    for (const poly of base_na_polyhedra) {
      expect(poly.center_element).toBe(`Na`)
      expect(poly.vertex_site_idxs).toHaveLength(6)
      expect(poly.faces).toHaveLength(8)
    }
    // every polyhedron corner is a displayed atom (no phantom vertices)
    for (const poly of polyhedra) {
      for (const [v_idx, site_idx] of poly.vertex_site_idxs.entries()) {
        expect(poly.vertices[v_idx]).toEqual(with_images.sites[site_idx].xyz)
      }
    }
  })

  test(`duplicate center positions are deduped`, () => {
    // Two sites at the same position (base + fake image) must yield one polyhedron
    const structure = make_nacl_cluster()
    structure.sites.push({ ...structure.sites[0], properties: { orig_site_idx: 0 } })
    const bonds = [...octahedral_bonds, ...bonds_from(7, [1, 2, 3, 4, 5, 6])]
    expect(compute_polyhedra(structure, bonds)).toHaveLength(1)
  })

  test(`empty inputs return no polyhedra`, () => {
    expect(compute_polyhedra(make_nacl_cluster(), [])).toHaveLength(0)
    expect(compute_polyhedra({ sites: [] }, octahedral_bonds)).toHaveLength(0)
  })

  test(`recomputes when same structure coordinates mutate`, () => {
    const structure = make_nacl_cluster()
    expect(compute_polyhedra(structure, octahedral_bonds)).toHaveLength(1)

    structure.sites[1].xyz = [100, 100, 100] as Vec3
    structure.sites[2].xyz = [-100, -100, -100] as Vec3
    structure.sites[3].xyz = [100, -100, 100] as Vec3
    expect(compute_polyhedra(structure, octahedral_bonds)).toHaveLength(0)
  })

  test(`performance: 10x10x10 rocksalt supercell (8000 sites) stays fast`, () => {
    const supercell = make_supercell(make_rocksalt(), [10, 10, 10])
    const bonds = electroneg_ratio(supercell)

    const detect_start = performance.now()
    const polyhedra = compute_polyhedra(supercell, bonds)
    const detect_elapsed = performance.now() - detect_start
    expect(polyhedra.length).toBeGreaterThan(500) // most interior Na render
    expect(detect_elapsed).toBeLessThan(250) // ~25ms locally, 10x slack for CI

    const merge_start = performance.now()
    const buffers = merge_polyhedra_buffers(polyhedra, () => `#ff0000`)
    const merge_elapsed = performance.now() - merge_start
    expect(buffers.triangle_count).toBeGreaterThan(0)
    expect(merge_elapsed).toBeLessThan(150) // ~10ms locally, generous CI slack
  })
})

describe(`VESTA-style detection rules`, () => {
  test(`distance trim: over-long bonds don't inflate PO4 tetrahedra`, () => {
    const structure = make_crystal(12, [
      ...tetrahedron_sites(`P`, `O`, [6, 6, 6], 1.55),
      // two spurious long bonds at 2.5 Å that a noisy bond graph might contain
      { element: `O`, xyz: [8.5, 6, 6] as Vec3 },
      { element: `O`, xyz: [6, 8.5, 6] as Vec3 },
    ])
    const polyhedra = compute_polyhedra(structure, bonds_from(0, [1, 2, 3, 4, 5, 6]))
    expect(polyhedra).toHaveLength(1)
    // trimmed to the true tetrahedron
    expect([...polyhedra[0].vertex_site_idxs].toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4])
    expect(polyhedra[0].faces).toHaveLength(4)
  })

  test(`cation-cation bonds don't contaminate vertices (Ti-Ba in perovskites)`, () => {
    const sites = [
      ...octahedron_sites(`Ti`, `O`, [8, 8, 8], 1.95),
      // 8 Ba neighbors that a noisy bond graph might connect to Ti
      ...[-3.4, 3.4].flatMap((x) =>
        [-3.4, 3.4].flatMap((y) =>
          [-3.4, 3.4].map((z) => ({ element: `Ba`, xyz: add_vec([8, 8, 8], [x, y, z]) })),
        ),
      ),
    ]
    const structure = make_crystal(16, sites)
    const polyhedra = compute_polyhedra(
      structure,
      bonds_from(
        0,
        Array.from({ length: 14 }, (_, idx) => idx + 1),
      ),
    )
    expect(polyhedra).toHaveLength(1)
    expect(polyhedra[0].center_element).toBe(`Ti`)
    expect(polyhedra[0].vertex_site_idxs).toHaveLength(6) // only the O vertices
    expect(polyhedra[0].faces).toHaveLength(8)
  })

  test(`spectator cations hidden when framework cations exist, kept when sole`, () => {
    // Fe octahedron + Li octahedron -> only Fe renders
    const structure = make_crystal(18, [
      ...octahedron_sites(`Fe`, `O`, [4, 4, 4], 2.0),
      ...octahedron_sites(`Li`, `O`, [12, 12, 12], 2.1),
    ])
    const bonds = [
      ...bonds_from(0, [1, 2, 3, 4, 5, 6]),
      ...bonds_from(7, [8, 9, 10, 11, 12, 13]),
    ]
    const polyhedra = compute_polyhedra(structure, bonds)
    expect(polyhedra.map((poly) => poly.center_element)).toEqual([`Fe`])

    // force-include restores Li
    const with_li = compute_polyhedra(structure, bonds, {
      included_center_elements: [`Li`],
    })
    expect(with_li.map((poly) => poly.center_element).toSorted()).toEqual([`Fe`, `Li`])

    // Li as the only cation (e.g. Li2O-like) keeps its polyhedra
    const li_only = make_crystal(18, octahedron_sites(`Li`, `O`, [4, 4, 4], 2.1))
    expect(compute_polyhedra(li_only, bonds_from(0, [1, 2, 3, 4, 5, 6]))).toHaveLength(1)
  })

  test(`spectator suppression is composition-based, not candidate-based`, () => {
    // Fe present but truncated (1 bond only): Li still hidden so boundary
    // truncation doesn't promote alkali clutter
    const structure = make_crystal(18, [
      ...octahedron_sites(`Li`, `O`, [4, 4, 4], 2.1),
      { element: `Fe`, xyz: [12, 12, 12] as Vec3 },
      { element: `O`, xyz: [14, 12, 12] as Vec3 },
    ])
    const bonds = [...bonds_from(0, [1, 2, 3, 4, 5, 6]), make_bond(7, 8)]
    expect(compute_polyhedra(structure, bonds)).toHaveLength(0)
  })

  test(`max_neighbors caps high-CN polyhedra (BaO12 cuboctahedra)`, () => {
    // Ba with 12 O neighbors (cuboctahedron) - exceeds the default cap of 8
    const half = 2.85 / Math.sqrt(2)
    // 12 cuboctahedron vertices: all (±h, ±h, 0) permutations
    const cubo_offsets = [-half, half].flatMap((off_a) =>
      [-half, half].flatMap((off_b) => [
        [off_a, off_b, 0],
        [off_a, 0, off_b],
        [0, off_a, off_b],
      ]),
    )
    const structure = make_crystal(16, [
      { element: `Ba`, xyz: [8, 8, 8] as Vec3 },
      ...cubo_offsets.map((off) => ({ element: `O`, xyz: add_vec([8, 8, 8], off) })),
    ])
    const bonds = bonds_from(
      0,
      Array.from({ length: 12 }, (_, idx) => idx + 1),
    )
    expect(compute_polyhedra(structure, bonds)).toHaveLength(0)
    const uncapped = compute_polyhedra(structure, bonds, { max_neighbors: 12 })
    expect(uncapped).toHaveLength(1)
    expect(uncapped[0].vertex_site_idxs).toHaveLength(12)

    // force-include bypasses the CN cap (explicit user request beats heuristic)
    const included = compute_polyhedra(structure, bonds, {
      included_center_elements: [`Ba`],
    })
    expect(included).toHaveLength(1)
    expect(included[0].center_element).toBe(`Ba`)
  })

  test(`weakly-bound centers hidden when a strong framework exists (lone-pair Bi)`, () => {
    // Zr-O at 2.0 Å (norm ~0.83, strong) + Bi-O at 2.7 Å (norm ~1.26, weak)
    const structure = make_crystal(18, [
      ...octahedron_sites(`Zr`, `O`, [4, 4, 4], 2.0),
      ...octahedron_sites(`Bi`, `O`, [12, 12, 12], 2.7),
    ])
    const bonds = [
      ...bonds_from(0, [1, 2, 3, 4, 5, 6]),
      ...bonds_from(7, [8, 9, 10, 11, 12, 13]),
    ]
    const polyhedra = compute_polyhedra(structure, bonds)
    expect(polyhedra.map((poly) => poly.center_element)).toEqual([`Zr`])

    // Bi alone (no strong species) keeps its polyhedra
    const bi_only = make_crystal(18, octahedron_sites(`Bi`, `O`, [4, 4, 4], 2.7))
    expect(compute_polyhedra(bi_only, bonds_from(0, [1, 2, 3, 4, 5, 6]))).toHaveLength(1)
  })

  test(`is_spectator_center classifies alkali + heavy alkaline earths`, () => {
    for (const elem of [`Li`, `Na`, `K`, `Cs`, `Ca`, `Sr`, `Ba`]) {
      expect(is_spectator_center(elem), elem).toBe(true)
    }
    for (const elem of [`Mg`, `Be`, `Fe`, `Ti`, `P`, `Si`, `O`, `Bi`]) {
      expect(is_spectator_center(elem), elem).toBe(false)
    }
  })
})

describe(`merge_polyhedra_buffers`, () => {
  const uniform_red = () => `#ff0000`
  const poly_from_hull = (points: Vec3[]): Polyhedron => {
    const hull = convex_hull_3d(points)
    return {
      center_site_idx: 0,
      center_orig_idx: 0,
      center_element: `Na`,
      vertices: hull.vertices,
      vertex_site_idxs: hull.input_idxs.map((idx) => idx + 1),
      faces: hull.faces,
      volume: hull.volume,
    }
  }

  test(`buffer sizes match triangle and edge counts`, () => {
    const buffers = merge_polyhedra_buffers(
      [poly_from_hull(octahedron_points), poly_from_hull(octahedron_points)],
      uniform_red,
    )
    expect(buffers.triangle_count).toBe(16)
    expect(buffers.positions).toHaveLength(16 * 9)
    expect(buffers.colors).toHaveLength(16 * 9)
    // Octahedron has 12 real edges, none coplanar
    expect(buffers.edge_count).toBe(24)
    expect(buffers.edge_positions).toHaveLength(24 * 6)
  })

  test(`uniform vertex color fills the whole color buffer`, () => {
    const buffers = merge_polyhedra_buffers(
      [poly_from_hull(octahedron_points)],
      () => `#00ff00`,
    )
    for (let idx = 0; idx < buffers.colors.length; idx += 3) {
      expect([buffers.colors[idx], buffers.colors[idx + 1], buffers.colors[idx + 2]]).toEqual([
        0, 1, 0,
      ])
    }
  })

  test(`per-vertex colors land on the matching corner positions`, () => {
    const poly = poly_from_hull(octahedron_points)
    // color the hull vertex at [1, 0, 0] red, everything else blue
    const target_idx = poly.vertices.findIndex(
      (vert) => vert[0] === 1 && vert[1] === 0 && vert[2] === 0,
    )
    const buffers = merge_polyhedra_buffers([poly], (_poly, vertex_idx) =>
      vertex_idx === target_idx ? `#ff0000` : `#0000ff`,
    )
    for (let tri_vert = 0; tri_vert < buffers.triangle_count * 3; tri_vert++) {
      const off = tri_vert * 3
      const is_target =
        buffers.positions[off] === 1 &&
        buffers.positions[off + 1] === 0 &&
        buffers.positions[off + 2] === 0
      expect(buffers.colors[off]).toBe(is_target ? 1 : 0) // red channel
      expect(buffers.colors[off + 2]).toBe(is_target ? 0 : 1) // blue channel
    }
  })

  test(`cube wireframe omits coplanar quad diagonals`, () => {
    // A cube has 12 edges; its 12 triangles have 18 undirected edges (6 diagonals)
    const buffers = merge_polyhedra_buffers([poly_from_hull(cube_points(1))], uniform_red)
    expect(buffers.edge_count).toBe(12)
  })

  test(`empty input yields empty buffers`, () => {
    const buffers = merge_polyhedra_buffers([], uniform_red)
    expect(buffers.triangle_count).toBe(0)
    expect(buffers.positions).toHaveLength(0)
    expect(buffers.edge_count).toBe(0)
  })
})
