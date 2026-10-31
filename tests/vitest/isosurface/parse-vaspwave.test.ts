import { is_vaspwave_filename, parse_vaspwave_charge } from '#lib/isosurface/parse-vaspwave.js'
import { describe, expect, it } from 'vitest'
import { grid_value, read_binary_test_file } from '../test-fixtures'
import { create_dataset, h5_bytes } from '../trajectory/fixtures'

const VASP_HDF5_FIXTURE_DIR = `tests/vitest/fixtures/vasp-hdf5`
const read_fixture = (filename: string): ArrayBuffer =>
  read_binary_test_file(filename, VASP_HDF5_FIXTURE_DIR)
const parse_fixture = (fixture: string) =>
  parse_vaspwave_charge(read_fixture(fixture), `vaspwave.h5`)

// Synthetic fixture: [nx, ny, nz] = [4, 6, 8] grid stored C-order
// [2, nz, ny, nx] with component 0 value(x, y, z) = x + 10y + 100z and a
// partly negative component 1, plus an embedded Si2 structure in a
// diag(4, 5, 6) lattice. Like CHGCAR, the stored values are rho * V_cell, so the
// parser divides by V = 120 A^3.
const CELL_VOLUME = 4 * 5 * 6
describe(`vaspwave.h5 charge density parsing`, () => {
  it(`parses structure + components, reordering C-order values into (x, y, z) and normalizing by volume`, async () => {
    const { structure, volumes } = await parse_fixture(`vaspwave-si-charge.h5`)

    expect(structure.sites).toHaveLength(2)
    expect(structure.sites.map((site) => site.species[0].element)).toEqual([`Si`, `Si`])
    expect(structure.sites[1].abc).toEqual([0.25, 0.25, 0.25])
    const { a: len_a, b: len_b, c: len_c } = structure.lattice
    expect([len_a, len_b, len_c]).toEqual([4, 5, 6].map((len) => expect.closeTo(len, 6)))
    expect(structure.lattice?.volume).toBeCloseTo(CELL_VOLUME, 9)

    const labels = volumes.map((volume) => volume.label)
    expect(labels).toEqual([`charge density`, `magnetization density`])
    for (const volume of volumes) {
      const { matrix } = structure.lattice
      expect(volume).toMatchObject({ dims: [4, 6, 8], order: `z_fastest`, periodic: true })
      expect(volume.values).toHaveLength(4 * 6 * 8)
      expect(volume.lattice).toEqual(matrix)
    }

    const charge = volumes[0]
    for (const [x_idx, y_idx, z_idx] of [
      [0, 0, 0],
      [3, 0, 0],
      [0, 5, 0],
      [0, 0, 7],
      [2, 3, 5],
    ]) {
      expect(
        grid_value(charge, x_idx, y_idx, z_idx),
        `at (${x_idx},${y_idx},${z_idx})`,
      ).toBeCloseTo((x_idx + 10 * y_idx + 100 * z_idx) / CELL_VOLUME, 12)
    }
    expect(charge.data_range.min).toBe(0)
    expect(charge.data_range.max).toBeCloseTo((3 + 10 * 5 + 100 * 7) / CELL_VOLUME, 12)

    // magnetization component carries negatives (0.5 - z)
    const magnetization = volumes[1]
    expect(grid_value(magnetization, 0, 0, 0)).toBeCloseTo(0.5 / CELL_VOLUME, 12)
    expect(grid_value(magnetization, 0, 0, 7)).toBeCloseTo((0.5 - 7) / CELL_VOLUME, 12)
    expect(magnetization.data_range.min).toBeCloseTo((0.5 - 7) / CELL_VOLUME, 12)
  })

  it.each([
    [`vaspwave-charge-no-structure.h5`, /no embedded structure/],
    // vaspout files have no charge/charge group at all
    [`vaspout-si-relax.h5`, /no charge density/],
  ])(`%s rejects with %s`, async (fixture, expected_error) => {
    await expect(parse_fixture(fixture)).rejects.toThrow(expected_error)
  })

  // noncollinear runs store charge + m_x, m_y, m_z (py4vasp's 4-component density), which threw
  it.each([
    [1, [`charge density`]],
    [
      4,
      [`charge density`, ...[`x`, `y`, `z`].map((axis) => `magnetization density (${axis})`)],
    ],
    [3, `unsupported component count 3`],
  ])(`%i charge components`, async (n_components, expected) => {
    const buffer = await h5_bytes(`spin-vaspwave`, (file) => {
      const charge = file.create_group(`charge`)
      // component c holds c + 1 times V at every point, so each volume reads c + 1
      const values = Array.from(
        { length: n_components * 8 },
        (_, idx) => 24 * (1 + (idx >> 3)),
      )
      create_dataset(charge, `charge`, values, [n_components, 2, 2, 2])
      create_dataset(charge, `grid`, [2, 2, 2], [3])
      const positions = file.create_group(`structure`).create_group(`positions`)
      create_dataset(positions, `lattice_vectors`, [2, 0, 0, 0, 3, 0, 0, 0, 4], [3, 3])
    })
    const parsed = parse_vaspwave_charge(buffer, `vaspwave.h5`)
    if (typeof expected === `string`) await expect(parsed).rejects.toThrow(expected)
    else {
      const { volumes } = await parsed
      expect(volumes.map(({ label }) => label)).toEqual(expected)
      expect(volumes.map(({ values }) => [...new Set(values)])).toEqual(
        expected.map((_, idx) => [idx + 1]),
      )
    }
  })

  // a zero volume skipped the division (raw rho * V_cell), torn/extra/mismatched ion blocks
  // kept or dropped ions silently; a leading step axis ([1, n, 3], like the lattice's) loads
  const cell = [4, 0, 0, 0, 5, 0, 0, 0, 6]
  const flat_cell = [1, 0, 0, 1, 0, 0, 0, 0, 1]
  it.each([
    [`a zero-volume lattice`, flat_cell, [], [], [], `has no volume; cannot`],
    [`torn ion positions`, cell, [`Si`], [2], [1, 3], `holds 1 positions for 2 ions`],
    [`extra ion positions`, cell, [`Si`], [1], [2, 3], `holds 2 positions for 1 ions`],
    [`short position rows`, cell, [`Si`], [2], [2, 2], `row 1 is not an xyz position`],
    [`unmatched ion types`, cell, [`Si`, `O`], [1], [1, 3], `length mismatch`],
    [`a leading step axis`, cell, [`Si`], [2], [1, 2, 3], 2],
  ])(`%s`, async (_label, lattice, ion_types, ion_counts, positions_shape, expected) => {
    const buffer = await h5_bytes(`bad-vaspwave`, (file) => {
      const charge = file.create_group(`charge`)
      create_dataset(charge, `charge`, Array(8).fill(1), [1, 2, 2, 2])
      create_dataset(charge, `grid`, [2, 2, 2], [3])
      const positions = file.create_group(`structure`).create_group(`positions`)
      create_dataset(positions, `lattice_vectors`, lattice, [3, 3])
      if (ion_types.length === 0) return
      positions.create_dataset({ name: `ion_types`, data: ion_types })
      create_dataset(positions, `number_ion_types`, ion_counts, [ion_counts.length])
      const n_values = positions_shape.reduce((product, dim) => product * dim, 1)
      create_dataset(positions, `position_ions`, Array(n_values).fill(0.25), positions_shape)
    })
    const parsed = parse_vaspwave_charge(buffer, `vaspwave.h5`)
    if (typeof expected === `string`) await expect(parsed).rejects.toThrow(expected)
    else expect((await parsed).structure.sites).toHaveLength(expected)
  })
})

describe(`vaspwave filename routing`, () => {
  it.each([
    [`vaspwave.h5`, true],
    [`VASPWAVE.H5`, true],
    [`run-01/vaspwave.h5`, true],
    [`vaspwave_backup.hdf5`, true],
    [`si-relax-vaspwave.h5`, true],
    [`vaspout.h5`, false],
    [`random.h5`, false],
    [`vaspwave.h5.gz`, false],
    [`vaspwave.json`, false],
    // only the file's own name counts, on either path separator
    [`vaspwave_runs/vaspout.h5`, false],
    [`C:\\runs\\vaspwave_test\\vaspout.h5`, false],
  ])(`is_vaspwave_filename(%s) -> %s`, (filename, expected) => {
    expect(is_vaspwave_filename(filename)).toBe(expected)
  })
})
