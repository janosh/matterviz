// Setyawan–Curtarolo k-paths checked against pymatgen's HighSymmKpath on its own standard
// primitive cells. Fixture: pymatgen 2026.7.31 KPathSetyawanCurtarolo(prim).kpath with
// prim = SpacegroupAnalyzer(Structure.from_spacegroup(...)).get_primitive_standard_structure(
// international_monoclinic=False), labels rewritten as Γ/Σ and subscript digits.
import { high_symmetry_kpath, kpath_to_k_path_data } from '#lib/brillouin/kpath'
import type { Matrix3x3, Vec3 } from '#lib/math'
import * as math from '#lib/math'
import { analyze_structure_symmetry, point_group_rotations } from '#lib/symmetry/analyze'
import { beforeAll, describe, expect, test } from 'vite-plus/test'
import { init_moyo_for_tests, load_json, make_crystal } from '../test-fixtures'

type RefEntry = {
  case: string
  sc_name: string
  lattice: Matrix3x3
  species: string[]
  frac_coords: Vec3[]
  kpoints: Record<string, Vec3>
  path: string[][]
}
const ref_entries = load_json<RefEntry[]>(
  `${import.meta.dirname}/../fixtures/kpath/pymatgen-setyawan-curtarolo.json.gz`,
)

beforeAll(init_moyo_for_tests)

const kpath_of = async (lattice: Matrix3x3, species: string[], frac_coords: Vec3[]) => {
  const crystal = make_crystal(
    lattice,
    species.map((element, idx) => ({ element, abc: frac_coords[idx] })),
  )
  const sym_data = await analyze_structure_symmetry(crystal)
  return { kpath: high_symmetry_kpath(lattice, sym_data), sym_data }
}

// input-basis reciprocal coords in the path's primitive basis: f_prim = P·f_input (rows P)
const in_prim = ({ primitive }: { primitive: Matrix3x3 }, frac: Vec3) =>
  math.mul_3x3_vec3(primitive, frac)
const max_abs_diff = (left: Vec3, right: Vec3): number =>
  Math.max(...left.map((val, idx) => Math.abs(val - right[idx])))

describe(`high_symmetry_kpath`, () => {
  test(`fixture covers every lattice family and the SC variants with separate tables`, () => {
    const variants = new Set(ref_entries.map(({ sc_name }) => sc_name))
    const expected = `CUB FCC BCC TET BCT1 BCT2 ORC ORCF1 ORCF2 ORCI ORCC HEX RHL1 RHL2 MCL`
    for (const variant of `${expected} MCLC1 MCLC3 MCLC5 TRI1a TRI1b`.split(` `))
      expect(variants).toContain(variant)
  })

  test.each(ref_entries.map((entry) => [entry.case, entry] as const))(
    `%s matches pymatgen's labels, path and coordinates`,
    async (_case, { sc_name, lattice, species, frac_coords, kpoints, path }) => {
      const { kpath } = await kpath_of(lattice, species, frac_coords)
      expect(kpath.variant).toBe(sc_name)
      expect(kpath.path).toEqual(path)
      expect(Object.keys(kpath.kpoints).toSorted()).toEqual(Object.keys(kpoints).toSorted())
      for (const [label, ref_coords] of Object.entries(kpoints))
        expect(
          max_abs_diff(kpath.kpoints[label], in_prim(kpath, ref_coords)),
          label,
        ).toBeLessThan(1e-6)
    },
  )

  // Same lattice in another basis (a shear plus an axis cycle, det 1): the path must be the
  // reference one up to one crystal point-group operation (or its negative, k ~ -k) and
  // reciprocal lattice vectors, now in the new cell's reciprocal basis
  // oxfmt-ignore
  const basis_change: Matrix3x3 = [[0, 1, 0], [0, 1, 1], [1, 1, 0]]
  test.each(ref_entries.map((entry) => [entry.case, entry] as const))(
    `%s in a sheared, permuted basis gives a symmetry-equivalent path`,
    async (_case, { lattice, species, frac_coords, kpoints, sc_name }) => {
      expect(Math.abs(math.det_3x3(basis_change))).toBe(1)
      // rows a'_i = M·a, fractional x' = x·M⁻¹ (rows), reciprocal fractional f' = f·Mᵀ
      const new_lattice = math.dot(basis_change, lattice)
      const inv_change = math.inverse_3x3(basis_change)
      const new_frac = frac_coords.map((abc) =>
        math.mul_3x3_vec3(math.transpose_3x3(inv_change), abc),
      )
      const { kpath, sym_data } = await kpath_of(new_lattice, species, new_frac)
      expect(kpath.variant).toBe(sc_name)
      const ref_in_new = Object.fromEntries(
        Object.entries(kpoints).map(([label, frac]) => [
          label,
          math.mul_3x3_vec3(basis_change, frac),
        ]),
      )
      // reciprocal fractional coords transform as f → f·W⁻¹ under x → W·x
      const off_lattice = (val: number) => Math.abs(val - Math.round(val))
      const matches = point_group_rotations(sym_data.operations).some((rotation) => {
        const inv_rot_t = math.transpose_3x3(math.inverse_3x3(rotation))
        return [1, -1].some((sign) =>
          Object.entries(ref_in_new).every(([label, frac]) => {
            const image = math.scale(math.mul_3x3_vec3(inv_rot_t, frac), sign)
            const diff = math.subtract(kpath.kpoints[label], in_prim(kpath, image))
            return diff.every((val) => off_lattice(val) < 1e-6)
          }),
        )
      })
      expect(matches).toBe(true)
    },
  )

  test(`throws on an unrecognized centering letter`, () => {
    const sym_data = {
      number: 225,
      hm_symbol: `Q m -3 m`,
      std_linear: [1, 0, 0, 0, 1, 0, 0, 0, 1] as [...Vec3, ...Vec3, ...Vec3],
      operations: [],
    }
    expect(() => high_symmetry_kpath(math.IDENTITY_3X3, sym_data)).toThrow(
      `Unrecognized centering in Hermann-Mauguin symbol "Q m -3 m"`,
    )
  })
})

describe(`kpath_to_k_path_data`, () => {
  test(`lays stretches out as consecutive branches of Cartesian points`, () => {
    const k_lattice: Matrix3x3 = [
      [2, 0, 0],
      [0, 3, 0],
      [0, 0, 4],
    ]
    const k_path = kpath_to_k_path_data({
      kpoints: { Γ: [0, 0, 0], X: [0.5, 0, 0], Y: [0, 0.5, 0], Z: [0, 0, 0.5] },
      path: [
        [`Γ`, `X`, `Y`],
        [`Z`, `Γ`],
      ],
      k_lattice,
    })
    expect(k_path.labels).toEqual([`Γ`, `X`, `Y`, `Z`, `Γ`])
    expect(k_path.points).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1.5, 0],
      [0, 0, 2],
      [0, 0, 0],
    ])
    expect(k_path.branches).toEqual([
      [0, 2],
      [3, 4],
    ])
  })

  test(`throws on a path label without a k-point`, () => {
    expect(() =>
      kpath_to_k_path_data({
        kpoints: { Γ: [0, 0, 0] },
        path: [[`Γ`, `X`]],
        k_lattice: math.IDENTITY_3X3,
      }),
    ).toThrow(`k-path label X has no k-point`)
  })
})
