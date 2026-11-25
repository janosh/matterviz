// Surface-energy import (MP and pymatgen JSON), the demo's ?facets= codec and STL/GLB export
import { export_scene_as } from '#lib/scene/export.js'
import type { Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import {
  compute_wulff_shape,
  EV_PER_A2_TO_J_PER_M2,
  parse_surface_energies,
  type WulffFacetInput,
  wulff_model,
} from '#lib/wulff/index.js'
import { decode_facets, encode_facets, oxide_example, wulff_examples } from '#site/wulff.js'
import { describe, expect, test } from 'vite-plus/test'

const [ir, ti] = wulff_examples

describe(`parse_surface_energies`, () => {
  test(`eV/Å² energies convert to MP's J/m² values within MP's own conversion factor`, () => {
    const surfaces = ir.mp.surfaces.map(({ miller_index, surface_energy_EV_PER_ANG2 }) => ({
      miller_index,
      surface_energy_EV_PER_ANG2,
    }))
    const { facets, label } = parse_surface_energies({ ...ir.mp, surfaces })
    expect(label).toBe(`mp-101 Ir`)
    const rel_errors = facets.map(({ energy }, idx) =>
      Math.abs(energy / ir.facets[idx].energy - 1),
    )
    // MP converted with 16.0217656, CODATA 2018 gives 16.02176634: 4.6e-8 apart
    expect(Math.max(...rel_errors)).toBeLessThan(5e-8)
    expect(Math.max(...rel_errors)).toBeGreaterThan(4e-8)
    expect(EV_PER_A2_TO_J_PER_M2 * 1e-20).toBeCloseTo(1.602176634e-19, 30)
  })

  test(`MP's Miller-Bravais (h k i l) become (h k l)`, () => {
    expect(ti.mp.surfaces[6].miller_index).toEqual([2, -1, -1, 2])
    // oxfmt-ignore
    expect(ti.facets.map(({ miller }) => miller)).toEqual([[0, 0, 1], [1, 0, 0], [1, 0, 1], [1, 0, 2], [1, 1, 0], [1, 1, 1], [2, -1, 2], [2, 0, 1], [2, 1, 0], [2, 1, 1], [2, 1, 2], [2, 2, 1]])
  })

  test.each([
    [`an MP API response`, { data: [ir.mp] }],
    [`documents keyed by material id`, { 'mp-101': ir.mp }],
  ])(`reads %s like the bare document`, (_label, json) => {
    expect(parse_surface_energies(json)).toEqual(parse_surface_energies(ir.mp))
  })

  // pymatgen's WulffShape(lattice, miller_list, e_surf_list): holohedry = Fm-3m's point group
  test.each([
    [`a matrix`, ir.lattice],
    [`a Lattice.as_dict()`, { '@module': `pymatgen.core.lattice`, matrix: ir.lattice }],
  ])(`pymatgen fields with the lattice as %s give MP's shape`, (_label, lattice) => {
    const parsed = parse_surface_energies({
      lattice,
      miller_list: ir.facets.map(({ miller }) => miller),
      e_surf_list: ir.facets.map(({ energy }) => energy),
    })
    expect(parsed).toEqual({ facets: ir.facets, lattice: ir.lattice })
    const shape = compute_wulff_shape(ir.lattice, parsed.facets)
    const errors = shape.families.map(({ area_fraction }, idx) =>
      Math.abs(area_fraction - ir.mp.surfaces[idx].area_fraction),
    )
    expect(Math.max(...errors)).toBeLessThan(1e-12)
  })

  const pmg = { lattice: ir.lattice, miller_list: [[1, 0, 0]], e_surf_list: [1] }
  test.each([
    [{ data: [] }, `File holds 0 materials`],
    [{ 'mp-101': ir.mp, 'mp-72': ti.mp }, `File holds 2 materials`],
    [{ surfaces: [{ miller_index: [1, 0, 0, 1], surface_energy: 1 }] }, `i = -(h + k)`],
    [
      { surfaces: [{ miller_index: [1, 0.5, 0], surface_energy: 1 }] },
      `surfaces[0]: expected`,
    ],
    [{ surfaces: [{ miller_index: [1, 0, 0] }] }, `neither surface_energy nor`],
    [{ surfaces: [3] }, `surfaces[0] is not an object`],
    [{ ...pmg, e_surf_list: [1, 2] }, `miller_list has 1 entries but e_surf_list 2`],
    [{ ...pmg, e_surf_list: [`1`] }, `e_surf_list[0] is not a number`],
    [{ ...pmg, lattice: [[1, 0, 0]] }, `lattice must be a 3x3 matrix`],
    [{ structure: {} }, `Unsupported surface-energy JSON`],
  ])(`rejects %j: %s`, (json, message) => {
    expect(() => parse_surface_energies(json)).toThrow(message)
  })
})

describe(`?facets= codec`, () => {
  const { facets: oxide } = oxide_example
  const set_energy = (facets: WulffFacetInput[], idx: number, energy: number) =>
    facets.with(idx, { ...facets[idx], energy })
  // [edit, facets, the example's facets, part of the param]
  test.each([
    [`an edited γ`, set_energy(ir.facets, 2, 2.5), ir.facets, `1.0.0_1.1.0_1.1.1*2.5_`],
    [`a removed family`, ir.facets.toSpliced(1, 1), ir.facets, `1.0.0_1.1.1_`],
    [
      `an added family`,
      [...oxide, { miller: [2, -1, 0] as Vec3, energy: 0.9 }],
      oxide,
      `_2.-1.0*0.9`,
    ],
    [`a reordered list`, oxide.toReversed(), oxide, `1.1.1_0.0.1_`],
    [`a sloped family's γ`, set_energy(oxide, 3, 0.7), oxide, `0.0.1*0.7`],
  ])(`round-trips %s`, (_label, facets, defaults, expected_part) => {
    const encoded = encode_facets(facets, defaults)
    expect(encoded).toContain(expected_part)
    expect(encoded?.length).toBeLessThan(100)
    expect(decode_facets(encoded ?? ``, defaults)).toEqual(facets)
  })

  test(`the example's own facets leave no param`, () => {
    expect(encode_facets(structuredClone(ir.facets), ir.facets)).toBeNull()
  })

  test.each([`1.0*2`, `1.0.0*x`, `1.0.0*0`, `3.3.3`, `1.0.0*1*2`, `a.b.c*1`])(
    `decoding %s fails`,
    (encoded) => {
      expect(() => decode_facets(encoded, ir.facets)).toThrow(`?facets=`)
    },
  )
})

// Binary STL: 80-byte header, uint32 triangle count, then per triangle a normal, 3 corners
// (float32 xyz each) and a uint16 attribute
const stl_triangles = (buffer: ArrayBuffer): Vec3[][] => {
  const view = new DataView(buffer)
  return Array.from({ length: view.getUint32(80, true) }, (_, tri_idx) =>
    [0, 1, 2].map((corner) => {
      const offset = 84 + tri_idx * 50 + 12 + corner * 12
      return [0, 4, 8].map((byte) => view.getFloat32(offset + byte, true)) as Vec3
    }),
  )
}

describe(`STL and GLB export`, () => {
  test.each([
    [`Ir`, compute_wulff_shape(ir.lattice, ir.facets)],
    [`ω-Ti`, compute_wulff_shape(ti.lattice, ti.facets)],
    [
      `oxide, O-poor`,
      compute_wulff_shape(oxide_example.lattice, oxide_example.facets, { delta_mu: -3 }),
    ],
  ])(`%s exports a closed, outward-wound STL with a fan per facet`, async (_label, shape) => {
    const model = wulff_model(
      shape,
      shape.families.map(() => `#888888`),
    )
    expect(model.children).toHaveLength(
      shape.families.filter(({ n_facets }) => n_facets).length,
    )
    const saved: { data: unknown; filename: string }[] = []
    await export_scene_as(model, `stl`, `shape`, (data, filename) => {
      saved.push({ data, filename })
    })
    expect(saved[0].filename).toBe(`shape.stl`)
    const triangles = stl_triangles(saved[0].data as ArrayBuffer)
    const n_expected = shape.facets.reduce(
      (sum, { vertex_indices }) => sum + vertex_indices.length - 2,
      0,
    )
    expect(triangles).toHaveLength(n_expected)
    // closed and consistently wound: every directed edge occurs once and its reverse once
    const key = (vert: Vec3) => vert.map((coord) => coord.toFixed(4)).join(`,`)
    const directed = new Map<string, number>()
    for (const tri of triangles) {
      for (const [idx, from] of tri.entries()) {
        const edge = `${key(from)}>${key(tri[(idx + 1) % 3])}`
        directed.set(edge, (directed.get(edge) ?? 0) + 1)
      }
    }
    for (const [edge, count] of directed) {
      const [from, to] = edge.split(`>`)
      expect([count, directed.get(`${to}>${from}`)]).toEqual([1, 1])
    }
    // outward: each triangle's normal points away from the center, which lies inside
    for (const [vert_a, vert_b, vert_c] of triangles) {
      const normal = math.cross_3d(
        math.subtract(vert_b, vert_a),
        math.subtract(vert_c, vert_a),
      )
      expect(math.dot(normal, vert_a)).toBeGreaterThan(0)
    }
  })

  test(`GLB holds one mesh per family on the shape, named by it`, async () => {
    const shape = compute_wulff_shape(ir.lattice, ir.facets)
    const saved: unknown[] = []
    await export_scene_as(
      wulff_model(
        shape,
        shape.families.map(() => `red`),
      ),
      `glb`,
      `shape`,
      (data) => {
        saved.push(data)
      },
    )
    const bytes = new Uint8Array(saved[0] as ArrayBuffer)
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe(`glTF`)
    const json_len = new DataView(bytes.buffer).getUint32(12, true)
    const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + json_len)))
    expect(gltf.nodes.map(({ name }: { name: string }) => name)).toEqual([
      `Wulff shape`,
      ...shape.families
        .filter(({ n_facets }) => n_facets)
        .map(({ miller }) => `{${miller.join(``)}}`),
    ])
    expect(gltf.meshes).toHaveLength(6)
  })
})
