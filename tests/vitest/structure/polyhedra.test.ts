import type { Vec3 } from '$lib'
import type { BondPair } from '$lib/structure'
import { electroneg_ratio } from '$lib/structure/bonding'
import { get_pbc_image_sites } from '$lib/structure/pbc'
import {
  build_adjacency,
  compute_polyhedra,
  convex_hull_3d,
  is_spectator_center,
  merge_polyhedra_buffers,
  parse_color_to_rgb,
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

const octahedron_points: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

describe(`convex_hull_3d`, () => {
  test(`tetrahedron: 4 faces, correct volume`, () => {
    const points: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    const hull = convex_hull_3d(points)
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
    const side = 2.5
    const points: Vec3[] = []
    for (const x_coord of [0, side]) {
      for (const y_coord of [0, side]) {
        for (const z_coord of [0, side]) points.push([x_coord, y_coord, z_coord])
      }
    }
    const hull = convex_hull_3d(points)
    expect(hull.faces).toHaveLength(12)
    expect(hull.vertices).toHaveLength(8)
    expect(hull.volume).toBeCloseTo(side ** 3, 8)
  })

  test(`interior points are excluded from hull`, () => {
    const points: Vec3[] = [...octahedron_points, [0, 0, 0], [0.1, 0.1, 0.1]]
    const hull = convex_hull_3d(points)
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
    const points: Vec3[] = [
      [0, 0, 0],
      [1e-9, 0, 0], // duplicate of first within eps
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    const hull = convex_hull_3d(points)
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
      const n_faces = hull.faces.length
      const edges = new Set(
        hull.faces.flatMap(([idx_a, idx_b, idx_c]) =>
          [
            [idx_a, idx_b],
            [idx_b, idx_c],
            [idx_c, idx_a],
          ].map(([from, to]) => (from < to ? `${from}-${to}` : `${to}-${from}`)),
        ),
      )
      expect(hull.vertices.length - edges.size + n_faces).toBe(2)
      expect(edges.size).toBe((3 * n_faces) / 2)

      // All face normals point away from the centroid
      const centroid = hull.vertices
        .reduce(
          (acc, vert) => [acc[0] + vert[0], acc[1] + vert[1], acc[2] + vert[2]],
          [0, 0, 0],
        )
        .map((coord) => coord / hull.vertices.length) as Vec3
      for (const [idx_a, idx_b, idx_c] of hull.faces) {
        const [pt_a, pt_b, pt_c] = [idx_a, idx_b, idx_c].map((idx) => hull.vertices[idx])
        const normal = [
          (pt_b[1] - pt_a[1]) * (pt_c[2] - pt_a[2]) -
            (pt_b[2] - pt_a[2]) * (pt_c[1] - pt_a[1]),
          (pt_b[2] - pt_a[2]) * (pt_c[0] - pt_a[0]) -
            (pt_b[0] - pt_a[0]) * (pt_c[2] - pt_a[2]),
          (pt_b[0] - pt_a[0]) * (pt_c[1] - pt_a[1]) -
            (pt_b[1] - pt_a[1]) * (pt_c[0] - pt_a[0]),
        ]
        const outward =
          normal[0] * (pt_a[0] - centroid[0]) +
          normal[1] * (pt_a[1] - centroid[1]) +
          normal[2] * (pt_a[2] - centroid[2])
        expect(outward).toBeGreaterThan(0)
      }

      // Every input point is inside or on the hull (no point outside any face)
      for (const point of points) {
        for (const [idx_a, idx_b, idx_c] of hull.faces) {
          const [pt_a, pt_b, pt_c] = [idx_a, idx_b, idx_c].map((idx) => hull.vertices[idx])
          const normal = [
            (pt_b[1] - pt_a[1]) * (pt_c[2] - pt_a[2]) -
              (pt_b[2] - pt_a[2]) * (pt_c[1] - pt_a[1]),
            (pt_b[2] - pt_a[2]) * (pt_c[0] - pt_a[0]) -
              (pt_b[0] - pt_a[0]) * (pt_c[2] - pt_a[2]),
            (pt_b[0] - pt_a[0]) * (pt_c[1] - pt_a[1]) -
              (pt_b[1] - pt_a[1]) * (pt_c[0] - pt_a[0]),
          ]
          const norm_len = Math.hypot(normal[0], normal[1], normal[2])
          const dist =
            (normal[0] * (point[0] - pt_a[0]) +
              normal[1] * (point[1] - pt_a[1]) +
              normal[2] * (point[2] - pt_a[2])) /
            norm_len
          expect(dist).toBeLessThan(1e-6)
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
    expect(adjacency.has(0)).toBe(true)
    expect(adjacency.get(0)?.has(0)).toBe(false)
  })
})

// Na octahedrally coordinated by 6 Cl (rocksalt-like local environment)
const make_nacl_cluster = () =>
  make_crystal(10, [
    { element: `Na`, xyz: [5, 5, 5] },
    { element: `Cl`, xyz: [7, 5, 5] },
    { element: `Cl`, xyz: [3, 5, 5] },
    { element: `Cl`, xyz: [5, 7, 5] },
    { element: `Cl`, xyz: [5, 3, 5] },
    { element: `Cl`, xyz: [5, 5, 7] },
    { element: `Cl`, xyz: [5, 5, 3] },
  ])

const octahedral_bonds = [1, 2, 3, 4, 5, 6].map((idx) => make_bond(0, idx))

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
    expect(poly.neighbor_site_idxs).toHaveLength(6)
    expect(poly.faces).toHaveLength(8)
    expect(poly.volume).toBeCloseTo((4 / 3) * 2 ** 3, 6)
    // vertex_site_idxs maps each hull vertex to the site at that exact position
    expect(poly.vertex_site_idxs).toHaveLength(poly.vertices.length)
    for (const [v_idx, site_idx] of poly.vertex_site_idxs.entries()) {
      expect(poly.vertices[v_idx]).toEqual(structure.sites[site_idx].xyz)
    }
  })

  test(`SiO4 tetrahedron detected with Si center`, () => {
    const dist = 1.6
    const offset = dist / Math.sqrt(3)
    const structure = make_crystal(10, [
      { element: `Si`, xyz: [5, 5, 5] },
      { element: `O`, xyz: [5 + offset, 5 + offset, 5 + offset] },
      { element: `O`, xyz: [5 - offset, 5 - offset, 5 + offset] },
      { element: `O`, xyz: [5 - offset, 5 + offset, 5 - offset] },
      { element: `O`, xyz: [5 + offset, 5 - offset, 5 - offset] },
    ])
    const bonds = [1, 2, 3, 4].map((idx) => make_bond(0, idx))
    const polyhedra = compute_polyhedra(structure, bonds)
    expect(polyhedra).toHaveLength(1)
    expect(polyhedra[0].center_element).toBe(`Si`)
    expect(polyhedra[0].faces).toHaveLength(4)
  })

  test(`methane: C is more electronegative than H, no polyhedron`, () => {
    const offset = 1.09 / Math.sqrt(3)
    const structure = make_crystal(10, [
      { element: `C`, xyz: [5, 5, 5] },
      { element: `H`, xyz: [5 + offset, 5 + offset, 5 + offset] },
      { element: `H`, xyz: [5 - offset, 5 - offset, 5 + offset] },
      { element: `H`, xyz: [5 - offset, 5 + offset, 5 - offset] },
      { element: `H`, xyz: [5 + offset, 5 - offset, 5 - offset] },
    ])
    const bonds = [1, 2, 3, 4].map((idx) => make_bond(0, idx))
    expect(compute_polyhedra(structure, bonds)).toHaveLength(0)
  })

  test(`min_neighbors threshold filters low-coordination centers`, () => {
    const structure = make_nacl_cluster()
    expect(compute_polyhedra(structure, octahedral_bonds, { min_neighbors: 7 })).toHaveLength(
      0,
    )
    expect(compute_polyhedra(structure, octahedral_bonds, { min_neighbors: 6 })).toHaveLength(
      1,
    )
  })

  test(`excluded_center_elements removes matching centers`, () => {
    const structure = make_nacl_cluster()
    const polyhedra = compute_polyhedra(structure, octahedral_bonds, {
      excluded_center_elements: [`Na`],
    })
    expect(polyhedra).toHaveLength(0)
  })

  test(`electronegativity_margin tightens the cation test`, () => {
    const structure = make_nacl_cluster()
    // Na (0.93) vs Cl (3.16): margin of 3 exceeds the EN gap, so Na no longer qualifies
    const polyhedra = compute_polyhedra(structure, octahedral_bonds, {
      electronegativity_margin: 3,
    })
    expect(polyhedra).toHaveLength(0)
  })

  test(`coplanar square-planar coordination yields no polyhedron`, () => {
    const structure = make_crystal(10, [
      { element: `Pt`, xyz: [5, 5, 5] },
      { element: `Cl`, xyz: [7, 5, 5] },
      { element: `Cl`, xyz: [3, 5, 5] },
      { element: `Cl`, xyz: [5, 7, 5] },
      { element: `Cl`, xyz: [5, 3, 5] },
    ])
    const bonds = [1, 2, 3, 4].map((idx) => make_bond(0, idx))
    expect(compute_polyhedra(structure, bonds)).toHaveLength(0)
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
      expect(poly.neighbor_site_idxs).toHaveLength(6)
      expect(poly.faces).toHaveLength(8)
    }
    // Truncation check: boundary Na sites exist but don't render
    const adjacency = build_adjacency(bonds)
    const truncated_na = supercell.sites.filter(
      (site, idx) => site.species[0].element === `Na` && (adjacency.get(idx)?.size ?? 0) < 6,
    )
    expect(truncated_na.length).toBeGreaterThan(0)
    const rendered = new Set(polyhedra.map((poly) => poly.center_site_idx))
    for (const [idx, site] of supercell.sites.entries()) {
      if (site.species[0].element === `Na` && (adjacency.get(idx)?.size ?? 0) < 6) {
        expect(rendered.has(idx)).toBe(false)
      }
    }
  })

  test(`single unit cell with PBC images: base Na get full octahedra with real-atom corners`, () => {
    // Bond-completing image atoms (find_image_atoms phase 2) provide every
    // boundary neighbor as a real displayed atom, so all base Na render complete
    // octahedra and every polyhedron corner coincides with a displayed site.
    const with_images = get_pbc_image_sites(make_rocksalt())
    const bonds = electroneg_ratio(with_images)
    const polyhedra = compute_polyhedra(with_images, bonds)

    // all 4 base Na sites render complete octahedra
    const base_na_polyhedra = polyhedra.filter((poly) => poly.center_orig_idx < 4)
    expect(base_na_polyhedra.length).toBeGreaterThanOrEqual(4)
    for (const poly of base_na_polyhedra) {
      expect(poly.center_element).toBe(`Na`)
      expect(poly.neighbor_site_idxs).toHaveLength(6)
      expect(poly.faces).toHaveLength(8)
    }

    // every polyhedron corner is a displayed atom (no phantom vertices)
    for (const poly of polyhedra) {
      const neighbor_positions = poly.neighbor_site_idxs.map(
        (idx) => with_images.sites[idx].xyz,
      )
      for (const vertex of poly.vertices) {
        const has_atom = neighbor_positions.some(
          (pos) =>
            Math.hypot(pos[0] - vertex[0], pos[1] - vertex[1], pos[2] - vertex[2]) < 1e-6,
        )
        expect(has_atom).toBe(true)
      }
    }
  })

  test(`duplicate center positions are deduped`, () => {
    // Two sites at the same position (base + fake image) must yield one polyhedron
    const structure = make_nacl_cluster()
    structure.sites.push({
      ...structure.sites[0],
      properties: { orig_site_idx: 0 },
    })
    const bonds = [...octahedral_bonds, ...[1, 2, 3, 4, 5, 6].map((idx) => make_bond(7, idx))]
    const polyhedra = compute_polyhedra(structure, bonds)
    expect(polyhedra).toHaveLength(1)
  })

  test(`empty inputs return no polyhedra`, () => {
    const structure = make_nacl_cluster()
    expect(compute_polyhedra(structure, [])).toHaveLength(0)
    expect(compute_polyhedra({ sites: [] }, octahedral_bonds)).toHaveLength(0)
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
  // Octahedron of `element` neighbors at `dist` around a center at `origin`
  const octahedron_sites = (
    center: string,
    vertex: string,
    origin: [number, number, number],
    dist: number,
  ) => [
    { element: center, xyz: origin },
    ...[
      [dist, 0, 0],
      [-dist, 0, 0],
      [0, dist, 0],
      [0, -dist, 0],
      [0, 0, dist],
      [0, 0, -dist],
    ].map((off) => ({
      element: vertex,
      xyz: [origin[0] + off[0], origin[1] + off[1], origin[2] + off[2]] as [
        number,
        number,
        number,
      ],
    })),
  ]

  test(`distance trim: over-long bonds don't inflate PO4 tetrahedra`, () => {
    const offset = 1.55 / Math.sqrt(3)
    const structure = make_crystal(12, [
      { element: `P`, xyz: [6, 6, 6] },
      { element: `O`, xyz: [6 + offset, 6 + offset, 6 + offset] },
      { element: `O`, xyz: [6 - offset, 6 - offset, 6 + offset] },
      { element: `O`, xyz: [6 - offset, 6 + offset, 6 - offset] },
      { element: `O`, xyz: [6 + offset, 6 - offset, 6 - offset] },
      // two spurious long bonds at 2.5 Å that a noisy bond graph might contain
      { element: `O`, xyz: [8.5, 6, 6] },
      { element: `O`, xyz: [6, 8.5, 6] },
    ])
    const bonds = [1, 2, 3, 4, 5, 6].map((idx) => make_bond(0, idx))
    const polyhedra = compute_polyhedra(structure, bonds)
    expect(polyhedra).toHaveLength(1)
    expect(polyhedra[0].neighbor_site_idxs).toEqual([1, 2, 3, 4]) // trimmed to true tetrahedron
    expect(polyhedra[0].faces).toHaveLength(4)
  })

  test(`cation-cation bonds don't contaminate vertices (Ti-Ba in perovskites)`, () => {
    const sites = [
      ...octahedron_sites(`Ti`, `O`, [8, 8, 8], 1.95),
      // 8 Ba neighbors that a noisy bond graph might connect to Ti
      ...[
        [3.4, 3.4, 3.4],
        [-3.4, 3.4, 3.4],
        [3.4, -3.4, 3.4],
        [3.4, 3.4, -3.4],
        [-3.4, -3.4, 3.4],
        [-3.4, 3.4, -3.4],
        [3.4, -3.4, -3.4],
        [-3.4, -3.4, -3.4],
      ].map((off) => ({
        element: `Ba`,
        xyz: [8 + off[0], 8 + off[1], 8 + off[2]] as [number, number, number],
      })),
    ]
    const structure = make_crystal(16, sites)
    const bonds = Array.from({ length: 14 }, (_, idx) => make_bond(0, idx + 1))
    const polyhedra = compute_polyhedra(structure, bonds)
    expect(polyhedra).toHaveLength(1)
    expect(polyhedra[0].center_element).toBe(`Ti`)
    expect(polyhedra[0].neighbor_site_idxs).toHaveLength(6) // only the O vertices
    expect(polyhedra[0].faces).toHaveLength(8)
  })

  test(`spectator cations hidden when framework cations exist, kept when sole`, () => {
    // Fe octahedron + Li octahedron -> only Fe renders
    const sites = [
      ...octahedron_sites(`Fe`, `O`, [4, 4, 4], 2.0),
      ...octahedron_sites(`Li`, `O`, [12, 12, 12], 2.1),
    ]
    const structure = make_crystal(18, sites)
    const bonds = [
      ...[1, 2, 3, 4, 5, 6].map((idx) => make_bond(0, idx)),
      ...[8, 9, 10, 11, 12, 13].map((idx) => make_bond(7, idx)),
    ]
    const polyhedra = compute_polyhedra(structure, bonds)
    expect(polyhedra.map((poly) => poly.center_element)).toEqual([`Fe`])

    // force-include restores Li
    const with_li = compute_polyhedra(structure, bonds, {
      included_center_elements: [`Li`],
    })
    expect(with_li.map((poly) => poly.center_element).sort()).toEqual([`Fe`, `Li`])

    // Li as the only cation (e.g. Li2O-like) keeps its polyhedra
    const li_only = make_crystal(18, octahedron_sites(`Li`, `O`, [4, 4, 4], 2.1))
    const li_bonds = [1, 2, 3, 4, 5, 6].map((idx) => make_bond(0, idx))
    expect(compute_polyhedra(li_only, li_bonds)).toHaveLength(1)
  })

  test(`spectator suppression is composition-based, not candidate-based`, () => {
    // Fe present but truncated (2 bonds only): Li still hidden so boundary
    // truncation doesn't promote alkali clutter
    const sites = [
      ...octahedron_sites(`Li`, `O`, [4, 4, 4], 2.1),
      { element: `Fe`, xyz: [12, 12, 12] as [number, number, number] },
      { element: `O`, xyz: [14, 12, 12] as [number, number, number] },
    ]
    const structure = make_crystal(18, sites)
    const bonds = [...[1, 2, 3, 4, 5, 6].map((idx) => make_bond(0, idx)), make_bond(7, 8)]
    expect(compute_polyhedra(structure, bonds)).toHaveLength(0)
  })

  test(`max_neighbors caps high-CN polyhedra (BaO12 cuboctahedra)`, () => {
    // Ba with 12 O neighbors (cuboctahedron) - exceeds the default cap of 8
    const dist = 2.85
    const half = dist / Math.sqrt(2)
    const cubo_offsets = [
      [half, half, 0],
      [half, -half, 0],
      [-half, half, 0],
      [-half, -half, 0],
      [half, 0, half],
      [half, 0, -half],
      [-half, 0, half],
      [-half, 0, -half],
      [0, half, half],
      [0, half, -half],
      [0, -half, half],
      [0, -half, -half],
    ]
    const sites = [
      { element: `Ba`, xyz: [8, 8, 8] as [number, number, number] },
      ...cubo_offsets.map((off) => ({
        element: `O`,
        xyz: [8 + off[0], 8 + off[1], 8 + off[2]] as [number, number, number],
      })),
    ]
    const structure = make_crystal(16, sites)
    const bonds = Array.from({ length: 12 }, (_, idx) => make_bond(0, idx + 1))
    expect(compute_polyhedra(structure, bonds)).toHaveLength(0)
    const uncapped = compute_polyhedra(structure, bonds, {
      max_neighbors: 12,
    })
    expect(uncapped).toHaveLength(1)
    expect(uncapped[0].neighbor_site_idxs).toHaveLength(12)

    // force-include bypasses the CN cap (explicit user request beats heuristic)
    const included = compute_polyhedra(structure, bonds, {
      included_center_elements: [`Ba`],
    })
    expect(included).toHaveLength(1)
    expect(included[0].center_element).toBe(`Ba`)
  })

  test(`weakly-bound centers hidden when a strong framework exists (lone-pair Bi)`, () => {
    // Zr-O at 2.0 Å (norm ~0.83, strong) + Bi-O at 2.7 Å (norm ~1.26, weak)
    const sites = [
      ...octahedron_sites(`Zr`, `O`, [4, 4, 4], 2.0),
      ...octahedron_sites(`Bi`, `O`, [12, 12, 12], 2.7),
    ]
    const structure = make_crystal(18, sites)
    const bonds = [
      ...[1, 2, 3, 4, 5, 6].map((idx) => make_bond(0, idx)),
      ...[8, 9, 10, 11, 12, 13].map((idx) => make_bond(7, idx)),
    ]
    const polyhedra = compute_polyhedra(structure, bonds)
    expect(polyhedra.map((poly) => poly.center_element)).toEqual([`Zr`])

    // Bi alone (no strong species) keeps its polyhedra
    const bi_only = make_crystal(18, octahedron_sites(`Bi`, `O`, [4, 4, 4], 2.7))
    const bi_bonds = [1, 2, 3, 4, 5, 6].map((idx) => make_bond(0, idx))
    expect(compute_polyhedra(bi_only, bi_bonds)).toHaveLength(1)
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
  const make_octahedron_poly = (): Polyhedron => {
    const hull = convex_hull_3d(octahedron_points)
    return {
      center_site_idx: 0,
      center_orig_idx: 0,
      center_element: `Na`,
      neighbor_site_idxs: [1, 2, 3, 4, 5, 6],
      vertices: hull.vertices,
      vertex_site_idxs: hull.input_idxs.map((idx) => idx + 1),
      faces: hull.faces,
      volume: hull.volume,
    }
  }

  test(`buffer sizes match triangle and edge counts`, () => {
    const buffers = merge_polyhedra_buffers(
      [make_octahedron_poly(), make_octahedron_poly()],
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
    const buffers = merge_polyhedra_buffers([make_octahedron_poly()], () => `#00ff00`)
    for (let idx = 0; idx < buffers.colors.length; idx += 3) {
      expect(buffers.colors[idx]).toBe(0)
      expect(buffers.colors[idx + 1]).toBe(1)
      expect(buffers.colors[idx + 2]).toBe(0)
    }
  })

  test(`per-vertex colors land on the matching corner positions`, () => {
    const poly = make_octahedron_poly()
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
    const points: Vec3[] = []
    for (const x_coord of [0, 1]) {
      for (const y_coord of [0, 1]) {
        for (const z_coord of [0, 1]) points.push([x_coord, y_coord, z_coord])
      }
    }
    const hull = convex_hull_3d(points)
    const poly: Polyhedron = {
      center_site_idx: 0,
      center_orig_idx: 0,
      center_element: `Cs`,
      neighbor_site_idxs: [],
      vertices: hull.vertices,
      vertex_site_idxs: hull.input_idxs,
      faces: hull.faces,
      volume: hull.volume,
    }
    // A cube has 12 edges; its 12 triangles have 18 undirected edges (6 diagonals)
    expect(merge_polyhedra_buffers([poly], uniform_red).edge_count).toBe(12)
  })

  test(`empty input yields empty buffers`, () => {
    const buffers = merge_polyhedra_buffers([], uniform_red)
    expect(buffers.triangle_count).toBe(0)
    expect(buffers.positions).toHaveLength(0)
    expect(buffers.edge_count).toBe(0)
  })
})

describe(`parse_color_to_rgb`, () => {
  test.each([
    [`#ff0000`, [1, 0, 0]],
    [`#00FF00`, [0, 1, 0]],
    [`#fff`, [1, 1, 1]],
    [`rgb(255, 0, 0)`, [1, 0, 0]],
    [`rgba(0, 255, 0, 0.5)`, [0, 1, 0]],
    [`rgb(127.5, 0, 255)`, [0.5, 0, 1]],
    [`not-a-color`, [0.5, 0.5, 0.5]],
  ])(`%s -> %j`, (input, expected) => {
    const [red, green, blue] = parse_color_to_rgb(input)
    expect(red).toBeCloseTo(expected[0], 2)
    expect(green).toBeCloseTo(expected[1], 2)
    expect(blue).toBeCloseTo(expected[2], 2)
  })
})
