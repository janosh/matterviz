import { marching_cubes } from '#lib/marching-cubes.js'
import {
  compute_isosurface_geometries,
  geometry_input_bytes,
} from '#lib/isosurface/geometry.js'
import { GeometryMemoryBudget, GeometryMemoryError } from '#lib/isosurface/memory.js'
import { extract_volume_range, UNIT_CELL_RANGE } from '#lib/isosurface/sampling.js'
import { make_volume } from '#lib/isosurface/types.js'
import { expect, test, vi } from 'vitest'

const lattice: [[number, number, number], [number, number, number], [number, number, number]] =
  [
    [2, 0, 0],
    [0.4, 2, 0],
    [0, 0.2, 2],
  ]
const volume = () =>
  make_volume(Float64Array.from([-1, 1, -1, 1, -1, 1, -1, 1]), [2, 2, 2], {
    id: `density`,
    lattice,
    origin: [0, 0, 0],
    periodic: false,
  })

test.each([false, true])(
  `mesh limit includes scratch, buffer growth and trimming (normals %s)`,
  (normals) => {
    const grid = volume()
    const unlimited = new GeometryMemoryBudget()
    const expected = marching_cubes(grid, 0.5, lattice, {
      periodic: false,
      normals,
      memory_budget: unlimited,
    })
    expect(unlimited.used).toBe(
      expected.positions.byteLength +
        expected.indices.byteLength +
        expected.normals.byteLength,
    )
    expect(unlimited.peak).toBeGreaterThan(unlimited.used)
    const admitted = new GeometryMemoryBudget(unlimited.peak)
    expect(
      marching_cubes(grid, 0.5, lattice, {
        periodic: false,
        normals,
        memory_budget: admitted,
      }),
    ).toEqual(expected)
    const refused = new GeometryMemoryBudget(unlimited.peak - 1)
    expect(() =>
      marching_cubes(grid, 0.5, lattice, { periodic: false, normals, memory_budget: refused }),
    ).toThrow(GeometryMemoryError)
    expect(refused.used).toBe(0)
    expect(grid.values).toEqual(volume().values)
  },
)

test(`range preparation refuses before allocating an expanded field`, () => {
  const source = { ...volume(), periodic: true }
  const allocations = vi.spyOn(globalThis, `Float64Array`)
  try {
    expect(() =>
      extract_volume_range(
        source,
        [
          [0, 100],
          [0, 100],
          [0, 100],
        ],
        Infinity,
        new GeometryMemoryBudget(1024),
      ),
    ).toThrow(GeometryMemoryError)
    expect(allocations).not.toHaveBeenCalled()
  } finally {
    allocations.mockRestore()
  }
  const memory = new GeometryMemoryBudget()
  const prepared = extract_volume_range(source, UNIT_CELL_RANGE, Infinity, memory)
  expect(memory.used).toBe(prepared.values.byteLength)
})

test(`one request accounts for all signed surfaces and permits a retry`, () => {
  const source = volume()
  const job = {
    token: 1,
    volume: source,
    range: null,
    surfaces: [{ token: `positive`, isovalue: 0.5 }],
  }
  const run = (bytes: number, both: boolean) =>
    compute_isosurface_geometries({
      memory_budget_bytes: bytes,
      volumes: [
        {
          ...job,
          surfaces: both
            ? [...job.surfaces, { token: `negative`, isovalue: -0.5 }]
            : job.surfaces,
        },
      ],
    })
  // Find the actual acceptance boundary, independent of allocator capacity constants.
  let low = 0,
    high = 100_000
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    try {
      run(mid, false)
      high = mid
    } catch (error) {
      expect(error).toBeInstanceOf(GeometryMemoryError)
      low = mid + 1
    }
  }
  expect(run(high, false).volumes[0].surfaces).toHaveLength(1)
  expect(() => run(high, true)).toThrow(GeometryMemoryError)
  expect(run(100_000, true).volumes[0].surfaces).toHaveLength(2)
  expect(source.values).toEqual(volume().values)
})

test(`input admission counts backing stores once, including bytes outside subviews`, () => {
  const backing = new Float64Array(1024)
  const source = volume()
  const jobs = [0, 8].map((offset, token) => ({
    token,
    volume: { ...source, values: backing.subarray(offset, offset + 8) },
    range: null,
    surfaces: [],
  }))
  expect(geometry_input_bytes({ volumes: jobs })).toBe(backing.byteLength)
  expect(() =>
    compute_isosurface_geometries({
      volumes: jobs,
      memory_budget_bytes: backing.byteLength - 1,
    }),
  ).toThrow(GeometryMemoryError)
})

test.each([-1, NaN, 0.5])(`rejects invalid budget %s`, (bytes) => {
  expect(() => new GeometryMemoryBudget(bytes)).toThrow(RangeError)
})
