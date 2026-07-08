import { is_vaspwave_filename, parse_vaspwave_charge } from '$lib/isosurface/parse-vaspwave'
import { describe, expect, it } from 'vitest'
import { read_binary_test_file } from '../setup'

const VASP_HDF5_FIXTURE_DIR = `tests/vitest/fixtures/vasp-hdf5`
const read_fixture = (filename: string): ArrayBuffer =>
  read_binary_test_file(filename, VASP_HDF5_FIXTURE_DIR)
const parse_fixture = (fixture: string) =>
  parse_vaspwave_charge(read_fixture(fixture), `vaspwave.h5`)

// Synthetic fixture: [nx, ny, nz] = [4, 6, 8] grid stored C-order
// [2, nz, ny, nx] with component 0 value(x, y, z) = x + 10y + 100z and a
// partly negative component 1, plus an embedded Si2 structure in a
// diag(4, 5, 6) lattice.
describe(`vaspwave.h5 charge density parsing`, () => {
  it(`parses the embedded structure and both density components`, async () => {
    const { structure, volumes } = await parse_fixture(`vaspwave-si-charge.h5`)

    expect(structure.sites).toHaveLength(2)
    expect(structure.sites.map((site) => site.species[0].element)).toEqual([`Si`, `Si`])
    expect(structure.sites[1].abc).toEqual([0.25, 0.25, 0.25])
    expect(structure.lattice?.a).toBeCloseTo(4, 6)
    expect(structure.lattice?.b).toBeCloseTo(5, 6)
    expect(structure.lattice?.c).toBeCloseTo(6, 6)

    expect(volumes).toHaveLength(2)
    expect(volumes.map((volume) => volume.label)).toEqual([
      `charge density`,
      `magnetization density`,
    ])
    for (const volume of volumes) {
      expect(volume.grid_dims).toEqual([4, 6, 8])
      expect(volume.periodic).toBe(true)
      expect(volume.lattice).toEqual(structure.lattice?.matrix)
    }
  })

  it(`reorders C-order [nz, ny, nx] values into grid[x][y][z]`, async () => {
    const { volumes } = await parse_fixture(`vaspwave-si-charge.h5`)

    const charge = volumes[0]
    for (const [x_idx, y_idx, z_idx] of [
      [0, 0, 0],
      [3, 0, 0],
      [0, 5, 0],
      [0, 0, 7],
      [2, 3, 5],
    ]) {
      expect(charge.grid[x_idx][y_idx][z_idx], `at (${x_idx},${y_idx},${z_idx})`).toBe(
        x_idx + 10 * y_idx + 100 * z_idx,
      )
    }
    expect(charge.data_range.min).toBe(0)
    expect(charge.data_range.max).toBe(3 + 10 * 5 + 100 * 7)

    // magnetization component carries negatives (0.5 - z)
    const magnetization = volumes[1]
    expect(magnetization.grid[0][0][0]).toBe(0.5)
    expect(magnetization.grid[0][0][7]).toBe(0.5 - 7)
    expect(magnetization.data_range.min).toBe(0.5 - 7)
  })

  it.each([
    [`vaspwave-charge-no-structure.h5`, /no embedded structure/],
    // vaspout files have no charge/charge group at all
    [`vaspout-si-relax.h5`, /no charge density/],
  ])(`%s rejects with %s`, async (fixture, expected_error) => {
    await expect(parse_fixture(fixture)).rejects.toThrow(expected_error)
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
  ])(`is_vaspwave_filename(%s) -> %s`, (filename, expected) => {
    expect(is_vaspwave_filename(filename)).toBe(expected)
  })
})
