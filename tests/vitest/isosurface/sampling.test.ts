// Tests for world-coordinate volume sampling, grid compatibility checks, and
// fractional display-range extraction
import {
  compute_isosurface_geometries,
  MAX_SURFACE_TRIANGLES,
} from '#lib/isosurface/geometry.js'
import {
  compare_volume_grids,
  create_volume_sampler,
  extract_volume_range,
  prepare_geometry_grid,
  range_sample_counts,
  resolve_volume_window,
  sample_volume_at_positions,
  sanitize_display_range,
  trilinear_interpolate,
  UNIT_CELL_RANGE,
} from '#lib/isosurface/sampling.js'
import type { DisplayRange, VolumeWindow } from '#lib/isosurface/sampling.js'
import type { VolumetricData } from '#lib/isosurface/types.js'
import { marching_cubes } from '#lib/marching-cubes.js'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import {
  create_cart_to_frac,
  create_frac_to_cart,
  cross_3d,
  det_3x3,
  dot,
  subtract,
} from '#lib/math.js'
import { diagonal_matrix } from '#lib/structure/supercell.js'
import { describe, expect, test } from 'vite-plus/test'
import {
  cubic_matrix,
  grid_value,
  make_grid,
  make_linear_volume as linear_volume,
  make_volume,
} from '../test-fixtures'

// Grid whose value is a linear function of fractional coordinates — trilinear
// interpolation reproduces linear fields exactly, so samples have closed forms.
// Non-periodic grids place point i at frac i/(n-1); periodic at i/n.
const cubic = cubic_matrix(10)
// Hexagonal-like non-orthogonal lattice (60° between a and b)
// oxfmt-ignore
const hexagonal: Matrix3x3 = [[4, 0, 0], [2, 2 * Math.sqrt(3), 0], [0, 0, 6]]

describe(`create_volume_sampler`, () => {
  test.each([
    [`orthogonal`, cubic, [0, 0, 0]],
    [`orthogonal`, cubic, [0.5, 0, 0]],
    [`orthogonal`, cubic, [0, 0.5, 0]],
    [`orthogonal`, cubic, [0, 0, 0.5]],
    [`orthogonal`, cubic, [1, 1, 1]],
    [`non-orthogonal`, hexagonal, [0.25, 0.5, 0.75]],
    [`non-orthogonal`, hexagonal, [0.1, 0.9, 0.3]],
    [`non-orthogonal`, hexagonal, [0.6, 0.2, 0.5]],
  ] as [string, Matrix3x3, Vec3][])(`exact on %s lattice at %j`, (_label, lattice, frac) => {
    const sample = create_volume_sampler(linear_volume(11, lattice, false))
    const expected = frac[0] + 2 * frac[1] + 4 * frac[2]
    expect(sample(create_frac_to_cart(lattice)(frac))).toBeCloseTo(expected, 10)
  })

  test(`wraps periodically outside the cell and stays continuous across the boundary`, () => {
    const linear = create_volume_sampler(linear_volume(10, cubic, true))
    const inside = linear([2.5, 5, 7.5])
    // One lattice vector away in each direction must give identical values
    expect(linear([12.5, 5, 7.5])).toBeCloseTo(inside, 10)
    expect(linear([2.5, -5, 7.5])).toBeCloseTo(inside, 10)
    expect(linear([2.5, 5, 27.5])).toBeCloseTo(inside, 10)

    // Smooth periodic field: cos(2π fx)
    const n_pts = 32
    const grid = make_grid(n_pts, n_pts, n_pts, (idx_x) =>
      Math.cos((2 * Math.PI * idx_x) / n_pts),
    )
    const cos = create_volume_sampler(make_volume(grid, { lattice: cubic, periodic: true }))
    expect(Math.abs(cos([9.999, 5, 5]) - cos([0.001, 5, 5]))).toBeLessThan(0.01)

    // Wrapping retains the rounding of the two-remainder formula, including fractions
    // whose addition to 1 rounds up to 2 and non-finite coordinates.
    const volume = linear_volume(10, cubic_matrix(1), true)
    const sample = create_volume_sampler(volume)
    // oxfmt-ignore
    const coords = [
      -Infinity, -100.25, -1, -Number.EPSILON, -Number.MIN_VALUE, -0, 0, Number.MIN_VALUE,
      Number.EPSILON, 0.123, 1 - Number.EPSILON / 2, 1, 1 + Number.EPSILON, 2, 100.25, Infinity, NaN,
    ]
    for (const coord of coords) {
      const wrapped = ((coord % 1) + 1) % 1
      expect(sample([coord, coord, coord])).toBe(
        trilinear_interpolate(volume, wrapped, wrapped, wrapped, true),
      )
    }
  })

  // x clamps to 1 or 0; y=z=0.5 contribute 1 + 2 = 3
  test.each([
    [[15, 5, 5], 4],
    [[-3, 5, 5], 3],
  ] as [Vec3, number][])(`clamp policy samples nearest edge at %j`, (position, expected) => {
    const sample = create_volume_sampler(linear_volume(11, cubic, false), {
      out_of_bounds: `clamp`,
    })
    expect(sample(position)).toBeCloseTo(expected, 10)
  })

  test(`fallback policy returns NaN out of bounds, values inside, and tolerates tiny overshoot`, () => {
    const sample = create_volume_sampler(linear_volume(11, cubic, false), {
      out_of_bounds: `fallback`,
    })
    expect(sample([15, 5, 5])).toBeNaN()
    expect(sample([5, -1, 5])).toBeNaN()
    expect(sample([5, 5, 5])).toBeCloseTo(3.5, 10)
    // Within ~1e-6 frac overshoot still samples; beyond falls back
    expect(sample([10 + 1e-7, 10, 10])).toBeCloseTo(7, 6)
    expect(sample([-1e-7, 0, 0])).toBeCloseTo(0, 6)
    // Just outside the boundary tolerance (frac overshoot > 1e-6) falls back
    expect(sample([10 + 1e-4, 10, 10])).toBeNaN()
    expect(sample([-1e-4, 0, 0])).toBeNaN()
  })
})

describe(`sample_volume_at_positions`, () => {
  test(`matches scalar sampling, applies an offset, reuses output and keeps NaN markers`, () => {
    const origin: Vec3 = [2, 3, 4]
    const vol = linear_volume(11, hexagonal, false, origin)
    const positions = new Float64Array([2, 1, 3, 0, 0, 0, -10, 0, 0])
    const output = new Float32Array(3)
    const scalars = sample_volume_at_positions(vol, positions, {
      out_of_bounds: `fallback`,
      position_offset: origin,
      out: output,
    })
    const sample = create_volume_sampler(vol, { out_of_bounds: `fallback` })

    expect(scalars).toBe(output)
    expect(scalars[2]).toBeNaN() // [-10, 0, 0] lies outside the finite grid
    for (let point_idx = 0; point_idx < positions.length / 3; point_idx++) {
      const position_idx = point_idx * 3
      const expected = sample([
        positions[position_idx] + origin[0],
        positions[position_idx + 1] + origin[1],
        positions[position_idx + 2] + origin[2],
      ])
      if (Number.isNaN(expected)) expect(scalars[point_idx]).toBeNaN()
      else expect(scalars[point_idx]).toBeCloseTo(expected, 5)
    }
  })

  test.each([
    [`empty dims`, [], [1, 2, 3, 4, 5, 6], [0, 0]],
    [`singleton cell`, [[[42]]], [0, 0, 0, 5, 5, 5], [42, 42]],
  ] as [string, number[][][], number[], number[]][])(
    `handles %s grids`,
    (_label, grid, positions, expected) => {
      const vol = make_volume(grid, { lattice: cubic, periodic: false })
      expect([...sample_volume_at_positions(vol, new Float32Array(positions))]).toEqual(
        expected,
      )
    },
  )
})

// Every read of a $state volume runs a proxy trap, so reads must not scale with sample count
test(`samplers read the volume a fixed number of times, not once per sample`, () => {
  let n_reads = 0
  const counted = new Proxy(linear_volume(11, cubic, false), {
    get: (target, key, receiver) => {
      n_reads++
      return Reflect.get(target, key, receiver)
    },
  })
  const sampler = create_volume_sampler(counted)
  const reads_at_creation = n_reads
  for (let idx = 0; idx < 1000; idx++) sampler([idx % 10, 5, 5])
  expect(n_reads).toBe(reads_at_creation)
})

describe(`create_volume_sampler reads the current volume fields`, () => {
  // Pin lattice, origin, and periodic so a future cache keyed on volume identity that misses
  // one of them fails a test. Every point starts at frac (0.5, 0.5, 0.5), i.e. 3.5.
  test.each([
    // a doubled cell halves the fractions: frac (0.25, 0.25, 0.25)
    [`lattice`, false, [5, 5, 5], { lattice: cubic_matrix(20) }, 1.75],
    // an anisotropic origin also pins its axis order: Cartesian [5, 5, 5] → frac (0.2, 0.7, 0)
    [`origin`, false, [5, 5, 5], { origin: [3, -2, 5] }, 1.6],
    // frac (1.5, .5, .5) wraps to (.5, .5, .5); once finite it clamps to index (9, 4.5, 4.5)
    [`periodic`, true, [15, 5, 5], { periodic: false }, 3.6],
  ] as [string, boolean, Vec3, Partial<VolumetricData>, number][])(
    `follows a %s change on the same volume object`,
    (_field, periodic, point, patch, after) => {
      const vol = linear_volume(periodic ? 10 : 11, cubic, periodic)
      expect(create_volume_sampler(vol)(point)).toBeCloseTo(3.5, 10)
      Object.assign(vol, patch)
      expect(create_volume_sampler(vol)(point)).toBeCloseTo(after, 10)
    },
  )
})

describe(`compare_volume_grids`, () => {
  const base = () => linear_volume(11, cubic, false)

  test.each([
    [11, false],
    [10, true],
  ] as const)(`matching size=%i periodic=%s grids are compatible`, (size, periodic) => {
    expect(
      compare_volume_grids(
        linear_volume(size, cubic, periodic),
        linear_volume(size, cubic, periodic),
      ),
    ).toBeNull()
  })

  test.each([
    [`grid dimensions`, linear_volume(12, cubic, false)],
    [`origins`, linear_volume(11, cubic, false, [0.5, 0, 0])],
    [`voxel vectors`, linear_volume(11, [[12, 0, 0], cubic[1], cubic[2]], false)],
    [`boundary modes`, linear_volume(11, cubic, true)],
  ])(`rejects mismatched %s with diagnostic`, (label, other) => {
    expect(compare_volume_grids(base(), other)).toMatch(`${label} differ`)
  })

  test(`origin and voxel tolerances use per-voxel distance`, () => {
    const near_origin = linear_volume(11, cubic, false, [1e-6, 0, 0])
    expect(compare_volume_grids(base(), near_origin)).toBeNull()
    expect(compare_volume_grids(base(), near_origin, { tolerance: 1e-8 })).toMatch(/origins/)

    // 11 finite points → divisor 10: a 5e-4 lattice delta is a 5e-5 voxel delta
    // (within the 1e-4 tolerance), while 2e-3 → 2e-4 exceeds it
    const stretched = (lattice_a: number) =>
      linear_volume(11, [[lattice_a, 0, 0], cubic[1], cubic[2]], false)
    expect(compare_volume_grids(base(), stretched(10.0005))).toBeNull()
    expect(compare_volume_grids(base(), stretched(10.002))).toMatch(/voxel vectors/)
  })
})

// oxfmt-ignore
test.each([
  [`invalid axes → [0,1], keep valid`, [[NaN, 2], [0.5, 0.5], [-0.15, 2.15]], true, [[0, 1], [0, 1], [-0.15, 2.15]]],
  [`non-periodic clamps to [0,1]`, [[-0.5, 1.5], [0.2, 0.8], [0, 1]], false, [[0, 1], [0.2, 0.8], [0, 1]]],
  [`finite ranges entirely outside → [0,1]`, [[2, 3], [-3, -2], [0.2, 0.8]], false, [[0, 1], [0, 1], [0.2, 0.8]]],
] as [string, DisplayRange, boolean, DisplayRange][])(`sanitize_display_range: %s`, (_label, range, periodic, expected) => {
  expect(sanitize_display_range(range, periodic)).toEqual(expected)
})

// A periodic diagonal supercell becomes an endpoint-inclusive base-fraction box, any other
// supercell [0, 1]³ in its own frame (halo / |M_i| per axis); an explicit range overrides the
// supercell and adds the halo; finite volumes ignore the supercell but crop to [0, 1]
const diag_2_3_1 = diagonal_matrix([2, 3, 1])
const sheared: Matrix3x3 = [
  [1, 1, 0],
  [-1, 1, 0],
  [0, 0, 1],
]
const sheared_pad = 0.1 / Math.SQRT2
// oxfmt-ignore
test.each([
  [`periodic diagonal supercell`, true, { supercell: diag_2_3_1 }, { range: [[0, 2], [0, 3], [0, 1]] }],
  [`periodic diagonal supercell + halo`, true, { supercell: diag_2_3_1, halo: 0.1 }, { range: [[-0.1, 2.1], [-0.1, 3.1], [-0.1, 1.1]] }],
  [`periodic sheared supercell + halo`, true, { supercell: sheared, halo: 0.1 }, { range: [[-sheared_pad, 1 + sheared_pad], [-sheared_pad, 1 + sheared_pad], [-0.1, 1.1]], frame: sheared }],
  [`periodic explicit range + halo`, true, { display_range: [[-0.15, 2.15], [0, 1], [0.25, 0.75]], supercell: sheared, halo: 0.1 }, { range: [[-0.25, 2.25], [-0.1, 1.1], [0.15, 0.85]] }],
  [`finite supercell`, false, { supercell: diag_2_3_1 }, null],
  [`finite explicit crop`, false, { display_range: [[-1, 0.8], [0.2, 2], [0, 1]], supercell: sheared, halo: 0.1 }, { range: [[0, 0.8], [0.2, 1], [0, 1]] }],
] as [string, boolean, Parameters<typeof resolve_volume_window>[1], ReturnType<typeof resolve_volume_window>][])(`resolve_volume_window: %s`, (_label, periodic, options, expected) => {
  const volume = linear_volume(periodic ? 10 : 11, cubic, periodic)
  expect(resolve_volume_window(volume, options)).toEqual(expected)
})

describe(`extract_volume_range`, () => {
  // Periodic 10-point grid: value at grid index ix (iy=iz=0) is ix/10
  const periodic_vol = () => linear_volume(10, cubic, true)
  // fractional window [min, max] along x over the full y and z extent
  // oxfmt-ignore
  const x_window = (min: number, max: number): DisplayRange => [[min, max], [0, 1], [0, 1]]

  test(`integer range reproduces tiled values on aligned sample points`, () => {
    const extracted = extract_volume_range(periodic_vol(), x_window(0, 2))
    // width 2 at density 10 → 21 inclusive points at exactly the grid positions
    expect(extracted.dims).toEqual([21, 11, 11])
    // Sample 13 sits at fx = 1.3 → wraps to grid index 3 → exact value 0.3
    expect(grid_value(extracted, 13, 0, 0)).toBeCloseTo(0.3, 10)
    // Lattice spans the range; origin unchanged for a range starting at 0
    expect(extracted.lattice[0][0]).toBeCloseTo(20)
    expect(extracted.origin).toEqual([0, 0, 0])
    expect(extracted.periodic).toBe(false)
  })

  // Smooth periodic 8³ field without mirror symmetry along any axis
  const wave_volume = () => {
    const phase = (2 * Math.PI) / 8
    const grid = make_grid(
      8,
      8,
      8,
      (idx_x, idx_y, idx_z) =>
        Math.sin(idx_x * phase) +
        0.35 * Math.cos(idx_y * phase) +
        0.2 * Math.sin(idx_z * phase),
    )
    return make_volume(grid, { lattice: cubic, periodic: true })
  }
  const surface = (grid: ReturnType<typeof extract_volume_range>, isovalue: number) =>
    marching_cubes(grid, isovalue, grid.lattice, {
      periodic: false,
      normals: false,
      position_offset: grid.origin,
    }).positions

  test(`self-sampling an integer-supercell surface recovers its isovalue`, () => {
    const volume = wave_volume()
    const extracted = extract_volume_range(volume, x_window(0, 2))
    const isovalue = 0.15
    const positions = surface(extracted, isovalue)
    const sample = create_volume_sampler(volume)
    expect(positions.length).toBeGreaterThan(0)
    for (let idx = 0; idx < positions.length; idx += 3) {
      const vertex: Vec3 = [positions[idx], positions[idx + 1], positions[idx + 2]]
      // Float32 vertex rounding (~1e-7) times the field gradient (≤ ~0.8/Å) stays under 1e-5
      expect(sample(vertex)).toBeCloseTo(isovalue, 4)
    }
  })

  // the isovalue's surface of a window as the Isosurface component extracts it
  const window_surface = (volume: VolumetricData, window: VolumeWindow, isovalue: number) => {
    const job = {
      ...prepare_geometry_grid(volume, window),
      surfaces: [{ token: ``, isovalue }],
    }
    return compute_isosurface_geometries({ volumes: [job] }).surfaces[0]
  }

  // the window's halo of 0.1/√2 supercell fractions is checked by the resolve_volume_window table
  test(`a sheared supercell frame fills its parallelepiped plus halo with true colors`, () => {
    const volume = wave_volume()
    const frame = sheared
    const window = resolve_volume_window(volume, { supercell: frame, halo: 0.1 })
    if (!window) throw new Error(`periodic volume got no window`)
    const { range } = window
    // marching cubes runs on the unit cell, the 8³ source voxels themselves, tiled over the
    // 36 of the 4 x 4 x 3 cells around the window whose bounding boxes meet it
    const { grid, clip } = prepare_geometry_grid(volume, window)
    expect(clip).toEqual({ frame, range, cells: expect.any(Array) })
    expect(clip?.cells).toHaveLength(36)
    expect(grid.values).toBe(volume.values)
    const { positions } = window_surface(volume, window, 0.15)
    expect(positions.length).toBeGreaterThan(0)
    const sample = create_volume_sampler(volume)
    const to_super_frac = create_cart_to_frac(dot(frame, volume.lattice))
    // Color volume not periodic with the geometry cell: a finite linear field f_a + 2f_b + 4f_c
    // over a box enclosing the supercell, which trilinear interpolation reproduces exactly
    const color_vol = linear_volume(11, cubic_matrix(25), false, [-12, -2, -2])
    const colors = sample_volume_at_positions(color_vol, positions, {
      out_of_bounds: `fallback`,
    })
    const to_color_frac = create_cart_to_frac(color_vol.lattice)
    let min_frac_a = Infinity
    let n_clipped = 0
    for (let idx = 0; idx < positions.length; idx += 3) {
      const vertex: Vec3 = [positions[idx], positions[idx + 1], positions[idx + 2]]
      const super_frac = to_super_frac(vertex)
      min_frac_a = Math.min(min_frac_a, super_frac[0])
      super_frac.forEach((frac, axis) => {
        expect(frac).toBeGreaterThanOrEqual(range[axis][0] - 1e-6)
        expect(frac).toBeLessThanOrEqual(range[axis][1] + 1e-6)
      })
      // marching-cubes vertices hold the isovalue (f32 rounding x gradient <= ~1e-5); points
      // the clip adds on a face lie on a triangle edge, within the mesh's chord error of it
      const on_face = super_frac.some((frac, axis) =>
        range[axis].some((bound) => Math.abs(frac - bound) < 1e-6),
      )
      if (on_face) n_clipped++
      else expect(sample(vertex)).toBeCloseTo(0.15, 4)
      const [frac_a, frac_b, frac_c] = to_color_frac(
        vertex.map((val, axis) => val - color_vol.origin[axis]) as Vec3,
      )
      expect(colors[idx / 3]).toBeCloseTo(frac_a + 2 * frac_b + 4 * frac_c, 5)
    }
    expect(n_clipped).toBeGreaterThan(0)
    // the halo is drawn: some vertices lie beyond the parallelepiped's a faces
    expect(min_frac_a).toBeLessThan(0)
  })

  // One-voxel slab peaks that resampling stepped over: in the sheared frame, on the b = 0 face
  // of a' = a + 2b each a step moved 2 voxels in y; with a halo, even a box window's
  // round(width · n) + 1 samples fell off the source voxels. The slab's field depends on one base fraction alone, so its surface is planes at
  // base fraction k + (1 +- 0.1) / n there and every vertex (clip points included) holds the
  // isovalue. Each window face those planes cross must carry surface vertices.
  // oxfmt-ignore
  test.each<[Vec3, number, Matrix3x3, number[]]>([
    [[32, 24, 16], 0, [[1, 1, 0], [0, 1, 0], [0, 0, 1]], [0, 0.1, 0.15, 0.2, 0.25, 0.5]],
    [[8, 8, 8], 2, [[1, 1, 0], [0, 1, 0], [0, 0, 1]], [0, 0.1]],
    [[8, 8, 8], 1, [[1, 2, 0], [0, 1, 0], [0, 0, 1]], [0, 0.1]],
    [[8, 8, 8], 0, diagonal_matrix([1, 1, 1]), [0.1, 0.15]],
    [[8, 8, 8], 0, diagonal_matrix([2, 1, 1]), [0.1]],
    [[64, 64, 64], 2, [[1, 16, 0], [0, 1, 0], [0, 0, 1]], [0, 0.1]],
  ])(
    `%j grid, peak on axis %i, frame %j: every face crossing survives`,
    (dims, axis, frame, halos) => {
      const grid = make_grid(...dims, (...idx) => (idx[axis] === 1 ? 1 : 0))
      const volume = make_volume(grid, { lattice: cubic, periodic: true })
      const sample = create_volume_sampler(volume)
      for (const halo of halos) {
        const window = resolve_volume_window(volume, { supercell: frame, halo })
        if (!window) throw new Error(`periodic volume got no window`)
        // a diagonal window is a box in base fractions
        const window_frame = window.frame ?? diagonal_matrix([1, 1, 1])
        const to_super_frac = create_cart_to_frac(dot(window_frame, volume.lattice))
        const { positions } = window_surface(volume, window, 0.9)
        expect(positions.length, `halo ${halo}`).toBeGreaterThan(0)
        const verts = Array.from({ length: positions.length / 3 }, (_, idx): Vec3 => [
          positions[3 * idx],
          positions[3 * idx + 1],
          positions[3 * idx + 2],
        ])
        for (const vertex of verts) expect(sample(vertex)).toBeCloseTo(0.9, 5)
        const fracs = verts.map((vertex) => to_super_frac(vertex))
        // base fraction of the peak axis at a window corner (s · M column `axis`)
        const base_at = (super_frac: number[]) =>
          super_frac.reduce((sum, frac, row) => sum + frac * window_frame[row][axis], 0)
        for (const face_axis of [0, 1, 2])
          for (const bound of window.range[face_axis]) {
            const corners = [0, 1, 2, 3].map((mask) => {
              const others = [0, 1, 2].filter((other) => other !== face_axis)
              const corner = [0, 0, 0]
              corner[face_axis] = bound
              others.forEach(
                (other, bit) => (corner[other] = window.range[other][(mask >> bit) & 1]),
              )
              return base_at(corner)
            })
            const [lo, hi] = [Math.min(...corners), Math.max(...corners)]
            const n_pts = dims[axis]
            const crosses = Array.from(
              { length: Math.ceil(hi) - Math.floor(lo) + 1 },
              (_, idx) => [0.9, 1.1].map((offset) => Math.floor(lo) + idx + offset / n_pts),
            )
              .flat()
              .some((plane) => plane > lo + 1e-9 && plane < hi - 1e-9)
            if (!crosses) continue
            const on_face = fracs.some((frac) => Math.abs(frac[face_axis] - bound) < 1e-6)
            expect(on_face, `halo ${halo}, face ${face_axis} = ${bound}`).toBe(true)
          }
      }
    },
  )

  // A tiled window must be the unit-cell surface |det M| times over (halo 0): seams welded
  // (open edges only on window faces), no cell repeated (no edge shared by 3+ triangles) or
  // missing (area), no clip slivers (f32-coincident corners). Rows cover shears, det -1, -2
  // and 3, a negative isovalue, an isovalue equal to grid values (coincident vertices on
  // different edges stay apart), a box window, and the origins and cell sizes where f32
  // positions defeated a position-hash weld.
  const gyroid = (n_pts: number, levels = 0) =>
    make_grid(n_pts, n_pts, n_pts, (...idx) => {
      const val = idx.reduce((sum, coord) => sum + Math.cos((2 * Math.PI * coord) / n_pts), 0)
      return levels ? Math.round(val * levels) / levels : val
    })
  // oxfmt-ignore
  const triclinic = (scale: number): Matrix3x3 => [[scale, 0.1 * scale, 0.05 * scale], [0.3 * scale, 0.95 * scale, 0], [0.2 * scale, 0.3 * scale, 0.93 * scale]]
  type WindowCase = [
    string,
    Matrix3x3,
    number,
    { levels?: number; lattice?: Matrix3x3; origin?: Vec3 },
  ]
  // oxfmt-ignore
  const window_cases: WindowCase[] = [
    [`shear`, [[1, 4, 0], [0, 1, 0], [0, 0, 1]], 0.37, {}],
    [`shear, negative isovalue`, sheared, -0.37, {}],
    [`swap, det -1`, [[0, 1, 0], [1, 0, 0], [0, 0, 1]], 0.37, {}],
    [`det -2`, [[1, 1, 0], [1, -1, 0], [0, 0, 1]], -0.37, {}],
    [`det 3`, [[2, 1, 0], [-1, 1, 0], [0, 0, 1]], 0.37, {}],
    [`fcc, det 2, isovalue on grid values`, [[0, 1, 1], [1, 0, 1], [1, 1, 0]], 0.5, { levels: 2 }],
    [`2x1x2 box, origin 5`, diagonal_matrix([2, 1, 2]), 0.37, { lattice: triclinic(10), origin: [5, 5, 5] }],
    [`shear, 300 Å cell at origin 300`, [[1, 1, 0], [0, 1, 0], [0, 0, 1]], 0.37, { lattice: triclinic(300), origin: [300, 300, 300] }],
  ]
  test.each(window_cases)(
    `%s: the window is |det M| watertight unit-cell surfaces`,
    (_label, frame, isovalue, { levels, lattice = cubic, origin = [0, 0, 0] }) => {
      const volume = make_volume(gyroid(12, levels), { lattice, origin, periodic: true })
      const window = resolve_volume_window(volume, { supercell: frame })
      if (!window) throw new Error(`periodic volume got no window`)
      // area and shortest triangle edge
      const measure = ({
        positions,
        indices,
      }: {
        positions: Float32Array
        indices: Uint32Array
      }) => {
        let [area, min_edge] = [0, Infinity]
        for (let tri = 0; tri < indices.length; tri += 3) {
          const [vert_a, vert_b, vert_c] = [0, 1, 2].map((corner): Vec3 => {
            const start = 3 * indices[tri + corner]
            return [positions[start], positions[start + 1], positions[start + 2]]
          })
          area +=
            Math.hypot(...cross_3d(subtract(vert_b, vert_a), subtract(vert_c, vert_a))) / 2
          for (const [from, to] of [
            [vert_a, vert_b],
            [vert_b, vert_c],
            [vert_c, vert_a],
          ])
            min_edge = Math.min(min_edge, Math.hypot(...subtract(to, from)))
        }
        return { area, min_edge }
      }
      // reference: finite marching cubes on the endpoint-inclusive unit cell, no tiling
      const cell = extract_volume_range(volume, UNIT_CELL_RANGE)
      const unit = marching_cubes(cell, isovalue, cell.lattice, {
        periodic: false,
        normals: false,
        position_offset: cell.origin,
      })
      const mesh = window_surface(volume, window, isovalue)
      const { area, min_edge } = measure(mesh)
      // measured ≤ 1.4e-8 (f32 positions); a missing or repeated cell is off by 1 / |det M|
      expect(area / measure(unit).area / Math.abs(det_3x3(frame))).toBeCloseTo(1, 6)
      // measured ≥ 4e-4 Å; unsnapped cuts left 0 (corners equal in f32)
      if (!levels) expect(min_edge).toBeGreaterThan(1e-5)
      const window_frame = window.frame ?? diagonal_matrix([1, 1, 1])
      const to_window = create_cart_to_frac(dot(window_frame, lattice))
      // indices 2 * axis + side of the window faces a vertex lies on, -1 elsewhere
      const faces_of = (vert: number) => {
        const cart = [0, 1, 2].map((col) => mesh.positions[3 * vert + col] - origin[col])
        const frac = to_window(cart as Vec3)
        return window.range.flatMap((bounds, axis) =>
          bounds.map((bound, side) =>
            Math.abs(frac[axis] - bound) < 1e-6 ? 2 * axis + side : -1,
          ),
        )
      }
      const uses = new Map<string, number>()
      for (let tri = 0; tri < mesh.indices.length; tri += 3)
        for (const corner of [0, 1, 2]) {
          const vert_a = mesh.indices[tri + corner]
          const vert_b = mesh.indices[tri + ((corner + 1) % 3)]
          const key = `${Math.min(vert_a, vert_b)},${Math.max(vert_a, vert_b)}`
          uses.set(key, (uses.get(key) ?? 0) + 1)
        }
      expect(Math.max(...uses.values())).toBe(2)
      const open_off_faces = [...uses].filter(([key, count]) => {
        if (count !== 1) return false
        const [faces_a, faces_b] = key.split(`,`).map((vert) => faces_of(Number(vert)))
        return !faces_a.some((face) => face >= 0 && faces_b.includes(face))
      })
      expect(open_off_faces).toEqual([])
    },
  )

  test(`a window too wide to count is rejected, not looped on`, () => {
    // oxfmt-ignore
    const huge: DisplayRange = [[0, 1e308], [0, 1], [0, 1]]
    expect(() => range_sample_counts(periodic_vol(), huge)).toThrow(/needs Infinity x 11 x 11/)
    expect(() => extract_volume_range(periodic_vol(), huge)).toThrow(RangeError)
    expect(() => prepare_geometry_grid(periodic_vol(), { range: huge })).toThrow(
      /covers 1e\+308 cells/,
    )
  })

  // an over-budget source (100³ = 1M points) keeps its resolution in a crop that fits: the
  // one-voxel peak at x index 1 vanished when the whole cell was coarsened to 79³ first, and
  // in crops starting between voxels resampled at 0.5/1.5/2.5 voxels (max 0.5, 0.6)
  test.each([
    [0, 0.1],
    [0.005, 0.025],
    [0.004, 0.104],
  ])(
    `a [%f, %f] x crop of an over-budget periodic grid meshes the source voxels`,
    (lower, upper) => {
      const grid = make_grid(100, 100, 100, (idx_x) => (idx_x === 1 ? 1 : 0))
      const volume = make_volume(grid, { lattice: cubic, periodic: true })
      // oxfmt-ignore
      const range = [[lower, upper], [0, 0.1], [0, 0.1]] as DisplayRange
      const { positions } = window_surface(volume, { range }, 0.9)
      expect(positions.length).toBeGreaterThan(0)
      const sample = create_volume_sampler(volume)
      const to_frac = create_cart_to_frac(volume.lattice)
      for (let idx = 0; idx < positions.length; idx += 3) {
        const vertex: Vec3 = [positions[idx], positions[idx + 1], positions[idx + 2]]
        expect(sample(vertex)).toBeCloseTo(0.9, 5)
        // clipped to the crop, not the whole voxels around it
        to_frac(vertex).forEach((frac, axis) => {
          expect(frac).toBeGreaterThanOrEqual(range[axis][0] - 1e-6)
          expect(frac).toBeLessThanOrEqual(range[axis][1] + 1e-6)
        })
      }
    },
  )

  // 1000 full-resolution copies of the 7616-triangle unit surface would be 7.6M
  test(`a large tiled window coarsens its unit grid to the triangle budget`, () => {
    const volume = make_volume(gyroid(32), { lattice: cubic, periodic: true })
    const window = resolve_volume_window(volume, { supercell: diagonal_matrix([10, 10, 10]) })
    if (!window) throw new Error(`periodic volume got no window`)
    const n_tris = window_surface(volume, window, 0.37).indices.length / 3
    expect(n_tris).toBeGreaterThan(MAX_SURFACE_TRIANGLES / 2)
    expect(n_tris).toBeLessThanOrEqual(MAX_SURFACE_TRIANGLES)
  })

  test(`fractional bounds clip exactly at the requested coordinates`, () => {
    const vol = { ...periodic_vol(), origin: [3, -2, 5] as Vec3 }
    const extracted = extract_volume_range(vol, x_window(-0.15, 2.15))
    expect(extracted.dims[0]).toBe(24) // round(2.3 * 10) + 1
    // First plane sits at fx = -0.15 → wraps to 0.85, last at fx = 2.15 → wraps to 0.15
    expect(grid_value(extracted, 0, 0, 0)).toBeCloseTo(0.85, 10)
    expect(grid_value(extracted, 23, 0, 0)).toBeCloseTo(0.15, 10)
    // Origin shifts by range_min·lattice on top of the source origin; lattice row spans the width
    expect(extracted.origin).toEqual([expect.closeTo(3 - 1.5, 12), -2, 5])
    expect(extracted.lattice[0][0]).toBeCloseTo(23)
    // data_range recomputed over the extracted block
    expect(extracted.data_range.min).toBeGreaterThanOrEqual(0)
    expect(extracted.data_range.max).toBeLessThanOrEqual(7)
  })

  test(`caps output resolution at the point budget`, () => {
    // oxfmt-ignore
    const extracted = extract_volume_range(periodic_vol(), [[0, 5], [0, 5], [0, 5]], 1000)
    const [size_x, size_y, size_z] = extracted.dims
    expect(size_x * size_y * size_z).toBeLessThanOrEqual(1000)
    expect(Math.min(size_x, size_y, size_z)).toBeGreaterThanOrEqual(2)
    // Lattice still spans the full requested range despite reduced resolution
    expect(extracted.lattice[0][0]).toBeCloseTo(50)
  })

  test(`non-periodic volumes are cropped, never repeated`, () => {
    const extracted = extract_volume_range(linear_volume(11, cubic, false), [
      [-1, 3],
      [0, 0.5],
      [0, 1],
    ])
    // x clamps to [0, 1]; y crops to half the cell
    expect(extracted.lattice[0][0]).toBeCloseTo(10)
    expect(extracted.lattice[1][1]).toBeCloseTo(5)
    expect(grid_value(extracted, 0, 0, 0)).toBeCloseTo(0, 10)
    expect(extracted.dims).toEqual([11, 6, 11])
    // Endpoint values match the source field at the crop bounds
    expect(grid_value(extracted, 10, 0, 0)).toBeCloseTo(1, 10)
    expect(grid_value(extracted, 0, 5, 0)).toBeCloseTo(1, 10) // 2 * 0.5
  })
})
