import type { AnyStructure, Vec3 } from '$lib'
import type { BondPair } from '$lib/structure'
import {
  electroneg_ratio,
  is_spectator_center,
  structure_bond_to_bond_pair,
} from '$lib/structure/bonding'
import { get_pbc_image_sites } from '$lib/structure/pbc'
import {
  build_adjacency,
  compute_polyhedra,
  convex_hull_3d,
  merge_polyhedra_buffers,
} from '$lib/structure/polyhedra'
import type { Polyhedron } from '$lib/structure/polyhedra'
import { make_supercell } from '$lib/structure/supercell'
import { Color } from 'three/webgpu'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { make_crystal, make_rocksalt } from '../setup'
// per-test spies: a trailing `warn.mockRestore()` is skipped by the first failing assertion
beforeEach(() => vi.restoreAllMocks())

// Minimal BondPair stub (only fields polyhedra code reads)
const make_bond = (site_idx_1: number, site_idx_2: number): BondPair => ({
  pos_1: [0, 0, 0],
  pos_2: [0, 0, 0],
  site_idx_1,
  site_idx_2,
  bond_length: 1,
})
// Bonds from a center site to each listed neighbor site
const bonds_from = (center: number, neighbor_idxs: number[]): BondPair[] =>
  neighbor_idxs.map((idx) => make_bond(center, idx))

// Real-geometry bond from site 0 to `site_idx`, optionally to a periodic image of it.
// Unlike make_bond above, positions and length come from the structure.
const image_bond = (structure: AnyStructure, site_idx: number, cell_shift?: Vec3): BondPair =>
  structure_bond_to_bond_pair(structure, {
    site_idx_1: 0,
    site_idx_2: site_idx,
    order: 1,
    ...(cell_shift && { cell_shift }),
  })

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
  test.each([
    [
      `tetrahedron`,
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      4,
      4,
      1 / 6,
      10,
    ],
    [`octahedron`, octahedron_points, 8, 6, 4 / 3, 10],
    [`cube (side 2.5)`, cube_points(2.5), 12, 8, 2.5 ** 3, 8],
    // interior points must not survive as hull vertices
    [
      `octahedron + interior points`,
      [...octahedron_points, [0, 0, 0], [0.1, 0.1, 0.1]],
      8,
      6,
      4 / 3,
      10,
    ],
  ] as const)(
    `%s hulls to %i faces / %i vertices`,
    (_name, points, faces, vertices, volume, precision) => {
      const hull = convex_hull_3d(points as [number, number, number][])
      expect(hull.faces).toHaveLength(faces)
      expect(hull.vertices).toHaveLength(vertices)
      expect(hull.volume).toBeCloseTo(volume, precision)
    },
  )

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

// Neighbor site indices of `center`, sorted (adjacency order is bond order)
const neighbor_idxs = (adjacency: ReturnType<typeof build_adjacency>, center: number) =>
  (adjacency.get(center) ?? [])
    .map((neighbor) => neighbor.site_idx)
    .toSorted((idx_a, idx_b) => idx_a - idx_b)

describe(`build_adjacency`, () => {
  test(`symmetric adjacency from bond pairs`, () => {
    const adjacency = build_adjacency([make_bond(0, 1), make_bond(1, 2), make_bond(0, 2)])
    expect(neighbor_idxs(adjacency, 0)).toEqual([1, 2])
    expect(neighbor_idxs(adjacency, 1)).toEqual([0, 2])
    expect(neighbor_idxs(adjacency, 2)).toEqual([0, 1])
    // proximity-perceived bonds carry no cell_shift, so vertices stay at site positions
    expect(adjacency.get(0)?.every((nbr) => nbr.offset === null)).toBe(true)
  })

  test(`ignores self-bonds and dedupes repeated pairs`, () => {
    const adjacency = build_adjacency([make_bond(0, 0), make_bond(0, 1), make_bond(1, 0)])
    expect(neighbor_idxs(adjacency, 0)).toEqual([1])
  })

  test(`same site through different cell shifts counts as separate neighbors`, () => {
    const structure = make_crystal(3.6, [
      { element: `Ti`, abc: [0, 0, 0] },
      { element: `O`, abc: [0.5, 0, 0] },
    ])
    const adjacency = build_adjacency([
      image_bond(structure, 1),
      image_bond(structure, 1, [-1, 0, 0]),
    ])
    expect(neighbor_idxs(adjacency, 0)).toEqual([1, 1])
    // Ti (at x=0) sees the in-cell O at +1.8 Å (no offset) and its image at -1.8 Å
    expect(adjacency.get(0)?.map((nbr) => nbr.offset)).toEqual([null, [-1.8, 0, 0]])
    // reverse direction negates the displacement, so O (at x=1.8) sees a Ti at +3.6 Å
    expect(adjacency.get(1)?.map((nbr) => nbr.offset)).toEqual([null, [1.8, 0, 0]])
  })
})

// Na octahedrally coordinated by 6 Cl (rocksalt-like local environment)
const make_nacl_cluster = () => make_crystal(10, octahedron_sites(`Na`, `Cl`, [5, 5, 5], 2))
const octahedral_bonds = bonds_from(0, [1, 2, 3, 4, 5, 6])

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
      supercell.sites[idx].species[0].element === `Na` && (adjacency.get(idx)?.length ?? 0) < 6
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

  test(`explicit bonds with cell_shift close polyhedra across the cell boundary`, () => {
    // Ti near the x=0 face, octahedrally coordinated by 6 O at 1.8 Å. The 6th O sits in
    // the -x neighbor cell, reachable only through a bond cell_shift. Placing that vertex
    // at the in-cell O instead put it 4.2 Å away, which skewed the octahedron into a
    // lopsided hull of the wrong volume.
    const structure = make_crystal(6, [
      { element: `Ti`, abc: [0.1, 0.5, 0.5] },
      { element: `O`, abc: [0.4, 0.5, 0.5] },
      { element: `O`, abc: [0.1, 0.8, 0.5] },
      { element: `O`, abc: [0.1, 0.2, 0.5] },
      { element: `O`, abc: [0.1, 0.5, 0.8] },
      { element: `O`, abc: [0.1, 0.5, 0.2] },
      { element: `O`, abc: [0.8, 0.5, 0.5] },
    ])
    const bonds = [1, 2, 3, 4, 5, 6].map((site_idx) =>
      image_bond(structure, site_idx, site_idx === 6 ? [-1, 0, 0] : undefined),
    )
    for (const bond of bonds) expect(bond.bond_length).toBeCloseTo(1.8, 12)

    const [poly, ...rest] = compute_polyhedra(structure, bonds)
    expect(rest).toHaveLength(0)
    expect(poly.vertices).toHaveLength(6)
    expect(poly.faces).toHaveLength(8)
    expect(poly.volume).toBeCloseTo((4 / 3) * 1.8 ** 3, 12) // regular octahedron
    // the 6th corner sits at the -x image of site 6, not at its in-cell position
    expect(poly.vertices).toContainEqual([-1.2, 3, 3].map((val) => expect.closeTo(val, 12)))
  })

  // Degeneracy is a fraction of the hull's own extent cubed, not an absolute A^3 volume, so it
  // measures flatness at any coordinate scale: a CN-6 ring puckered by 2 mA across 3.6 A is
  // 0.022 A^3 (20x the old absolute 1e-3) yet fills 4.8e-4 of its bounding cube.
  test.each([
    [0, 1, 0], // exactly coplanar (square-planar PtCl4 and friends)
    [0.002, 1, 0], // near-planar
    [0.005, 1, 1], // the same ring puckered 2.5x further
    [0.002, 0.01, 0], // both verdicts survive a 100x shrink
    [0.005, 0.01, 1],
  ])(`CN-6 ring puckered %s at scale %s -> %i polyhedra`, (pucker, scale, n_polyhedra) => {
    const [radius, pucker_z] = [1.8 * scale, pucker * scale]
    const ring = Array.from({ length: 6 }, (_un, idx) => ({
      element: `O`,
      xyz: [
        radius * Math.cos((idx * Math.PI) / 3),
        radius * Math.sin((idx * Math.PI) / 3),
        idx % 2 ? pucker_z : -pucker_z,
      ] as Vec3,
    }))
    const structure = make_crystal(20, [{ element: `Ti`, xyz: [0, 0, 0] as Vec3 }, ...ring])
    const bonds = [1, 2, 3, 4, 5, 6].map((site_idx) => image_bond(structure, site_idx))
    expect(compute_polyhedra(structure, bonds)).toHaveLength(n_polyhedra)
  })

  test(`one neighbor site bonded through two cell shifts counts twice`, () => {
    // Rocksalt-like: Ti at the origin has CN 6 via only 3 O sites, each bonded twice
    // (in-cell at +a/2 and through the -1 image at -a/2). Collapsing the two bonds onto
    // one neighbor left CN 3, below min_neighbors, so nothing rendered at all.
    const structure = make_crystal(3.6, [
      { element: `Ti`, abc: [0, 0, 0] },
      { element: `O`, abc: [0.5, 0, 0] },
      { element: `O`, abc: [0, 0.5, 0] },
      { element: `O`, abc: [0, 0, 0.5] },
    ])
    // each O bonded twice: in-cell, then through the -1 image along its own axis
    const bonds = [1, 2, 3].flatMap((site_idx) => [
      image_bond(structure, site_idx),
      image_bond(
        structure,
        site_idx,
        [0, 1, 2].map((axis) => (axis === site_idx - 1 ? -1 : 0)) as Vec3,
      ),
    ])
    for (const bond of bonds) expect(bond.bond_length).toBeCloseTo(1.8, 12)

    const [poly, ...rest] = compute_polyhedra(structure, bonds)
    expect(rest).toHaveLength(0)
    expect(poly.vertices).toHaveLength(6)
    expect(poly.volume).toBeCloseTo((4 / 3) * 1.8 ** 3, 12)
  })

  test(`one physical neighbor reached twice is counted once`, () => {
    // The proximity search finds a boundary Na-Cl bond against an appended image atom;
    // a file's bond block can state the same bond as a cell_shift against the BASE Cl.
    // Both land on one position, so the hull dedupes the vertex - but counting it twice
    // inflated the CN that gates max_neighbors and the boundary-completeness check.
    const structure = get_pbc_image_sites(make_rocksalt())
    const bonds = electroneg_ratio(structure)
    // site 0 is Na at the origin; site 4 is the Cl at +a/2 along x, restated as its -x image
    const dupe = image_bond(structure, 4, [-1, 0, 0])
    expect(dupe.bond_length).toBeCloseTo(2.82, 12) // same 2.82 Å bond, not a new neighbor

    // max_neighbors 6 exposes the intermediate count: an inflated 7 trips the cap and
    // the octahedron vanishes, so both bond lists must give the same CN-6 polyhedron
    const at_cap = (bond_list: BondPair[]) =>
      compute_polyhedra(structure, bond_list, { max_neighbors: 6 }).find(
        (poly) => poly.center_site_idx === 0,
      )
    expect(at_cap(bonds)?.vertices).toHaveLength(6)
    expect(at_cap([...bonds, dupe])?.vertices).toHaveLength(6)
    expect(at_cap([...bonds, dupe])?.volume).toBeCloseTo(at_cap(bonds)?.volume ?? 0, 12)
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
    expect(compute_polyhedra(structure, octahedral_bonds)[0].volume).toBeCloseTo(
      (4 / 3) * 8,
      12,
    )

    // stretch the +x Cl to 4 Å: a square bipyramid with apices 4 and 2 above/below the base
    structure.sites[1].xyz = [9, 5, 5] as Vec3
    const [poly] = compute_polyhedra(structure, octahedral_bonds)
    expect(poly.volume).toBeCloseTo((1 / 3) * 8 * (4 + 2), 12)
    expect(poly.vertices).toContainEqual([9, 5, 5])
  })

  // Timing lives in perf-baselines.test.ts (its 2x band on the 8000-site detect also catches a
  // quadratic blow-up); a wall-clock ratio here failed under CPU contention from parallel workers
  test(`10x10x10 rocksalt supercell (8000 sites) detects and merges at scale`, () => {
    const supercell = make_supercell(make_rocksalt(), [10, 10, 10])
    const polyhedra = compute_polyhedra(supercell, electroneg_ratio(supercell))
    expect(polyhedra.length).toBeGreaterThan(500) // most interior Na render
    expect(merge_polyhedra_buffers(polyhedra, () => `#ff0000`).triangle_count).toBeGreaterThan(
      0,
    )
  })
})

describe(`VESTA-style detection rules`, () => {
  test(`every bonded anion is a vertex, even a long one (tetragonal BaTiO3 Ti-O)`, () => {
    // Ferroelectric BaTiO3 has Ti off-center in its octahedron: 5 O at 1.83-2.0 Å and the
    // 6th at 2.39 Å (1.31x the shortest). The bond detector keeps that bond, so the
    // polyhedron must close into an octahedron rather than a square pyramid - a 30%
    // distance trim used to drop the 6th vertex and halve the volume.
    const structure = make_crystal(12, [
      { element: `Ti`, xyz: [6, 6, 6] as Vec3 },
      { element: `O`, xyz: [6, 6, 4.17] as Vec3 }, // 1.83 Å
      { element: `O`, xyz: [8, 6, 6] as Vec3 }, // 2.0 Å
      { element: `O`, xyz: [4, 6, 6] as Vec3 },
      { element: `O`, xyz: [6, 8, 6] as Vec3 },
      { element: `O`, xyz: [6, 4, 6] as Vec3 },
      { element: `O`, xyz: [6, 6, 8.39] as Vec3 }, // 2.39 Å
    ])
    const [poly, ...rest] = compute_polyhedra(structure, bonds_from(0, [1, 2, 3, 4, 5, 6]))
    expect(rest).toHaveLength(0)
    expect([...poly.vertex_site_idxs].toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
    expect(poly.faces).toHaveLength(8)
    // square base of side 2*sqrt(2) with apices 1.83 and 2.39 above/below it
    expect(poly.volume).toBeCloseTo((1 / 3) * 8 * (1.83 + 2.39), 10)
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

  // A batch of disjoint triangles is what convex_hull_3d produces when it fails to close a
  // manifold, which the 3F/2 edge budget assumes: N of them need 3N edges on a ceil(1.5 N) pool
  // oxfmt-ignore
  const loose_triangles = (n_tri: number): Polyhedron => ({
    center_site_idx: 7, center_orig_idx: 7, center_element: `Fe`, volume: 0,
    vertices: Array.from({ length: n_tri * 3 }, (_un, idx) => [idx, (idx % 3) ** 2, 0] as Vec3),
    vertex_site_idxs: Array.from({ length: n_tri * 3 }, (_un, idx) => idx),
    faces: Array.from({ length: n_tri }, (_un, idx): [number, number, number] => [idx * 3, idx * 3 + 1, idx * 3 + 2]),
  })

  // Placed FIRST, so what follows can only land at the rewound offset 0: a bad hull costs its
  // own polyhedron, not the whole scene render. And the budget check must count the edges the
  // write loop emits, not every undirected edge, or a hull that fits is dropped and blamed on
  // the budget - silent, and green without the second row.
  test.each([
    // 10 loose need 30 edges on ceil(1.5 * 18) = 27; the octahedron's 12 real edges survive
    [`overflowing hull is dropped whole`, 10, octahedron_points, 8, 12, true],
    // 2 loose take 6 of ceil(1.5 * 14) = 21, leaving 15: the cube's 12 drawn edges fit (its 6
    // coplanar quad diagonals are skipped), the 18 an over-count would charge do not
    [`hull that fits is kept`, 2, cube_points(1), 14, 18, false],
  ])(`%s`, (_label, n_loose, hull_pts, n_triangles, n_edges, warns) => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const buffers = merge_polyhedra_buffers(
      [loose_triangles(n_loose), poly_from_hull(hull_pts)],
      uniform_red,
    )
    expect(buffers.triangle_count).toBe(n_triangles)
    expect(buffers.positions).toHaveLength(n_triangles * 9)
    expect(buffers.colors).toHaveLength(n_triangles * 9)
    expect(buffers.edge_count).toBe(n_edges)
    expect(buffers.edge_positions).toHaveLength(n_edges * 6)
    expect(warn.mock.calls.map(([msg]) => msg)).toEqual(
      warns ? [expect.stringContaining(`site 7`)] : [],
    )
  })

  test(`fills the color buffer with linear CSS color`, () => {
    // same oracle as geometry.test.ts: three's own conversion, not numbers pinned from a run
    const expected_rgb = new Color(`#57178f`).toArray()
    const { colors } = merge_polyhedra_buffers(
      [poly_from_hull(octahedron_points)],
      () => `#57178f`,
    )
    for (let idx = 0; idx < colors.length; idx++) {
      expect(colors[idx]).toBeCloseTo(expected_rgb[idx % 3], 6)
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

  test(`empty input yields empty buffers`, () => {
    const buffers = merge_polyhedra_buffers([], uniform_red)
    expect(buffers.triangle_count).toBe(0)
    expect(buffers.positions).toHaveLength(0)
    expect(buffers.edge_count).toBe(0)
  })
})
