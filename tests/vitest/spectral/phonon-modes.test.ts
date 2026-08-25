import type { Vec3 } from '$lib/math'
import { create_cart_to_frac, create_frac_to_cart } from '$lib/math'
import type { Complex, PhononModeData } from '$lib/spectral'
import {
  is_commensurate_phonon_supercell,
  PHONON_VECTOR_KEY,
  phonon_band_structure_from_modes,
  phonon_mode_character,
  phonon_mode_pattern,
  phonon_mode_run,
  phonon_mode_trajectory as create_phonon_mode_run,
  phonon_supercell,
  parse_phonon_modes,
} from '$lib/spectral'
import { get_structure_vector_keys } from '$lib/structure'
import { compute_bonds, get_bond_key } from '$lib/structure/bonding'
import { SvelteSet } from 'svelte/reactivity'
import { describe, expect, it } from 'vitest'
import nacl_band_yaml from '$site/phonons/ir-raman/NaCl-Gamma-X-band.yaml?raw'
import { IDENTITY_MATRIX3 } from '../setup'

const phonon_mode_trajectory = (...args: Parameters<typeof create_phonon_mode_run>) => {
  const run = create_phonon_mode_run(...args)
  const frames = Array.from({ length: run.frame_count }, (_unused, frame_idx) => {
    const frame = run.read_frame(frame_idx)
    if (frame instanceof Promise) throw new Error(`Phonon mode runs must be synchronous`)
    return frame
  })
  return Object.assign(run, { frames })
}

const real_x: Complex[][] = [
  [
    [1, 0],
    [0, 0],
    [0, 0],
  ],
]

function make_mode_data(
  eigenvector: Complex[][] = real_x,
  q_position: Vec3 = [0, 0, 0],
  masses = [1],
): PhononModeData {
  return {
    n_atoms: masses.length,
    atoms: masses.map((mass, atom_idx) => ({
      symbol: atom_idx === 0 ? `H` : `He`,
      mass,
      coordinates: [atom_idx / 2, 0, 0],
    })),
    lattice: IDENTITY_MATRIX3,
    qpoints: [
      {
        q_position,
        distance: null,
        modes: [{ frequency: 2, eigenvector }],
      },
    ],
    path_segments: [],
  }
}

const displacement_at = (data: PhononModeData, frame_idx: number, site_idx: number): Vec3 => {
  const trajectory = phonon_mode_trajectory(
    data,
    { qpoint_idx: 0, mode_idx: 0 },
    {
      amplitude: 1,
      supercell: [1, 1, 1],
      n_frames: 4,
    },
  )
  return trajectory.frames[frame_idx].structure.sites[site_idx].properties
    .phonon_displacement as Vec3
}

describe(`phonon_mode_trajectory`, () => {
  it(`defaults to a 3x3x2 supercell with a 0.3 A excursion`, () => {
    const trajectory = phonon_mode_trajectory(make_mode_data(), {
      qpoint_idx: 0,
      mode_idx: 0,
    })
    const displacement = trajectory.frames[0].structure.sites[0].properties
      .phonon_displacement as Vec3
    expect(trajectory.metadata).toMatchObject({ amplitude: 0.3, supercell: [3, 3, 2] })
    expect(
      trajectory.frames[0].structure.sites.filter(
        ({ properties }) => properties.orig_site_idx === undefined,
      ),
    ).toHaveLength(18)
    expect(Math.hypot(...displacement)).toBeCloseTo(0.3, 14)
  })

  it(`undoes mass weighting while preserving relative eigenvector amplitudes`, () => {
    const component = 1 / Math.sqrt(2)
    const data = make_mode_data(
      [
        [
          [component, 0],
          [0, 0],
          [0, 0],
        ],
        [
          [component, 0],
          [0, 0],
          [0, 0],
        ],
      ],
      [0, 0, 0],
      [1, 4],
    )
    expect(displacement_at(data, 0, 0)).toEqual([1, 0, 0])
    expect(displacement_at(data, 0, 1)).toEqual([0.5, 0, 0])
  })

  it(`turns complex quadrature components into orthogonal phase motion`, () => {
    const component = 1 / Math.sqrt(2)
    const data = make_mode_data([
      [
        [component, 0],
        [0, component],
        [0, 0],
      ],
    ])
    expect(displacement_at(data, 0, 0)[0]).toBeCloseTo(1, 14)
    expect(displacement_at(data, 0, 0)[1]).toBeCloseTo(0, 14)
    expect(displacement_at(data, 1, 0)[0]).toBeCloseTo(0, 14)
    expect(displacement_at(data, 1, 0)[1]).toBeCloseTo(1, 14)
  })

  it(`applies Bloch phase to translated supercell images`, () => {
    const trajectory = phonon_mode_trajectory(
      make_mode_data(real_x, [0.5, 0, 0]),
      { qpoint_idx: 0, mode_idx: 0 },
      { amplitude: 1, supercell: [2, 1, 1], n_frames: 4 },
    )
    const sites = trajectory.frames[0].structure.sites
    expect(sites[0].properties.phonon_displacement).toEqual([1, 0, 0])
    expect(sites[1].properties.phonon_displacement).toEqual([-1, 0, 0])
  })

  it(`applies Bloch phase to positive-face copies in noncommensurate cells`, () => {
    const trajectory = phonon_mode_trajectory(
      make_mode_data(real_x, [0.375, 0, 0]),
      { qpoint_idx: 0, mode_idx: 0 },
      { amplitude: 1, supercell: [3, 1, 1], n_frames: 4 },
    )
    const positive_x_image = trajectory.frames[0].structure.sites.find(
      ({ abc, properties }) =>
        typeof properties.orig_site_idx === `number` &&
        abc[0] > 1 &&
        abc.slice(1).every((coordinate) => coordinate === 0),
    )
    if (!positive_x_image) throw new Error(`Expected a positive x-face image atom`)
    const displacement = positive_x_image.properties.phonon_displacement as Vec3
    expect(displacement[0]).toBeCloseTo(Math.SQRT1_2, 14)
    expect(displacement.slice(1)).toEqual([0, 0])
    expect(get_structure_vector_keys(trajectory.frames[0].structure)).toEqual([
      PHONON_VECTOR_KEY,
    ])
  })

  it(`removes arbitrary global complex phase`, () => {
    const real = phonon_mode_trajectory(make_mode_data(real_x), { qpoint_idx: 0, mode_idx: 0 })
    const imaginary = phonon_mode_trajectory(
      make_mode_data([
        [
          [0, 1],
          [0, 0],
          [0, 0],
        ],
      ]),
      { qpoint_idx: 0, mode_idx: 0 },
    )
    const real_positions = real.frames.flatMap((frame) => frame.structure.sites[0].xyz)
    const imaginary_positions = imaginary.frames.flatMap(
      (frame) => frame.structure.sites[0].xyz,
    )
    const max_abs_error = Math.max(
      ...real_positions.map((value, value_idx) =>
        Math.abs(value - imaginary_positions[value_idx]),
      ),
    )
    expect(max_abs_error).toBeLessThanOrEqual(2 * Number.EPSILON)
  })

  it(`sets the requested excursion and keeps Cartesian/fractional coordinates consistent`, () => {
    const trajectory = phonon_mode_trajectory(
      make_mode_data(),
      { qpoint_idx: 0, mode_idx: 0 },
      {
        amplitude: 0.3,
        supercell: [2, 1, 1],
        n_frames: 8,
      },
    )
    const first_displacement = trajectory.frames[0].structure.sites[0].properties
      .phonon_displacement as Vec3
    expect(Math.hypot(...first_displacement)).toBeCloseTo(0.3, 14)
    const last_displacement = trajectory.frames.at(-1)?.structure.sites[0].properties
      .phonon_displacement as Vec3
    expect(last_displacement).not.toEqual(first_displacement)
    expect(
      trajectory.frames.some(({ structure }) =>
        structure.sites.some(({ abc }) => abc.some((coord) => coord < 0 || coord >= 1)),
      ),
    ).toBe(true)
    for (const { structure } of trajectory.frames) {
      if (!(`lattice` in structure)) throw new Error(`Expected a crystal trajectory frame`)
      expect(structure.lattice.pbc).toEqual([false, false, false])
      const frac_to_cart = create_frac_to_cart(structure.lattice.matrix)
      for (const site of structure.sites) {
        site.xyz.forEach((value, axis) =>
          expect(frac_to_cart(site.abc)[axis]).toBeCloseTo(value, 14),
        )
      }
    }
    const cyclic_steps = trajectory.frames.map(({ structure }, frame_idx) => {
      const next_structure =
        trajectory.frames[(frame_idx + 1) % trajectory.frames.length].structure
      return Math.max(
        ...structure.sites.flatMap((site, site_idx) =>
          site.xyz.map((coordinate, axis) =>
            Math.abs(coordinate - next_structure.sites[site_idx].xyz[axis]),
          ),
        ),
      )
    })
    expect(cyclic_steps.at(-1)).toBeLessThanOrEqual(Math.max(...cyclic_steps.slice(0, -1)))
  })

  it(`keeps base-structure bond topology fixed while atoms vibrate`, () => {
    const trajectory = phonon_mode_trajectory(
      parse_phonon_modes(nacl_band_yaml),
      { qpoint_idx: 0, mode_idx: 3 },
      { amplitude: 0.6, supercell: [3, 3, 2], n_frames: 12 },
    )
    const frame_bonds = trajectory.frames.map(({ structure }) =>
      compute_bonds(structure, `explicit_only`),
    )
    const first_structure = trajectory.frames[0].structure
    if (!(`lattice` in first_structure)) throw new Error(`Expected a crystal frame`)
    const bonded_site_indices = new SvelteSet(
      frame_bonds[0].flatMap(({ site_idx_1, site_idx_2 }) => [site_idx_1, site_idx_2]),
    )
    const cart_to_frac = create_cart_to_frac(first_structure.lattice.matrix)
    const equilibrium_abc = (site: (typeof first_structure.sites)[number]): Vec3 => {
      const displacement = site.properties.phonon_displacement as Vec3
      return cart_to_frac(
        site.xyz.map((coordinate, axis) => coordinate - displacement[axis]) as Vec3,
      )
    }
    const unbonded_sites = first_structure.sites.filter(
      (_, site_idx) => !bonded_site_indices.has(site_idx),
    )
    expect(unbonded_sites).toHaveLength(2)
    for (const site of unbonded_sites) {
      expect(
        equilibrium_abc(site).every(
          (coordinate) => Math.abs(coordinate) < 1e-12 || Math.abs(coordinate - 1) < 1e-12,
        ),
      ).toBe(true)
    }
    expect(bonded_site_indices.size / first_structure.sites.length).toBeGreaterThan(0.95)
    const image_sites = first_structure.sites.filter(
      ({ properties }) => typeof properties.orig_site_idx === `number`,
    )
    expect(image_sites.length).toBeGreaterThan(0)
    for (const site of image_sites) {
      const abc = equilibrium_abc(site)
      expect(abc.every((coordinate) => coordinate >= -1e-12 && coordinate <= 1 + 1e-12)).toBe(
        true,
      )
      expect(abc.some((coordinate) => Math.abs(coordinate - 1) < 1e-12)).toBe(true)
    }
    const bond_keys = frame_bonds.map((bonds) =>
      bonds.map(({ site_idx_1, site_idx_2, cell_shift }) =>
        get_bond_key(site_idx_1, site_idx_2, cell_shift),
      ),
    )
    expect(bond_keys).toEqual(trajectory.frames.map(() => bond_keys[0]))
    expect(frame_bonds.flat().every(({ cell_shift }) => cell_shift === undefined)).toBe(true)
    expect(frame_bonds[1].map(({ bond_length }) => bond_length)).not.toEqual(
      frame_bonds[0].map(({ bond_length }) => bond_length),
    )
  })

  it.each([
    [`zero amplitude`, { amplitude: 0 }, /amplitude must be a positive/],
    [`one frame`, { n_frames: 1 }, /at least 2 integer frames/],
    [`invalid supercell`, { supercell: [1, 0, 1] as Vec3 }, /positive integers/],
    [
      `oversized supercell`,
      { supercell: [500, 500, 1] as Vec3 },
      /would display 502002 sites.*exceeding the 200000 limit/,
    ],
  ])(`rejects %s`, (_name, options, error) => {
    expect(() =>
      phonon_mode_trajectory(make_mode_data(), { qpoint_idx: 0, mode_idx: 0 }, options),
    ).toThrow(error)
  })

  it.each([
    [{ qpoint_idx: 1, mode_idx: 0 }, /q-point index 1 is outside/],
    [{ qpoint_idx: 0, mode_idx: 1 }, /mode index 1 is outside/],
  ])(`rejects an invalid selection %j`, (selection, error) => {
    expect(() => phonon_mode_trajectory(make_mode_data(), selection)).toThrow(error)
  })

  it.each([
    [[0.5, 0, 0], [2, 1, 1], true],
    [[0.5, 0, 0], [3, 1, 1], false],
    [[1 / 3, 0.25, 0], [3, 4, 1], true],
  ] as [Vec3, Vec3, boolean][])(
    `detects q-point/supercell commensurability`,
    (q_position, supercell, expected) => {
      expect(is_commensurate_phonon_supercell(q_position, supercell)).toBe(expected)
    },
  )

  it(`rejects missing eigenvectors and invalid typed masses`, () => {
    const missing_eigenvector = make_mode_data()
    missing_eigenvector.qpoints[0].modes[0].eigenvector = null
    expect(() =>
      phonon_mode_trajectory(missing_eigenvector, { qpoint_idx: 0, mode_idx: 0 }),
    ).toThrow(/has no eigenvector/)

    const invalid_mass = make_mode_data()
    invalid_mass.atoms[0].mass = 0
    expect(() => phonon_mode_trajectory(invalid_mass, { qpoint_idx: 0, mode_idx: 0 })).toThrow(
      /invalid mass 0/,
    )
  })
})

describe(`staged phonon runs`, () => {
  const data = parse_phonon_modes(nacl_band_yaml)

  it(`shares one supercell across modes and synthesises frames on read`, () => {
    const cell = phonon_supercell(data, [2, 2, 2])
    const [pattern_a, pattern_b] = [3, 4].map((mode_idx) =>
      phonon_mode_pattern(cell, { qpoint_idx: 0, mode_idx }),
    )
    expect(pattern_a.supercell).toBe(cell)
    expect(pattern_b.supercell).toBe(cell)
    expect(pattern_a.displacements).toHaveLength(cell.structure.sites.length * 6)
    // Normalised pattern: the largest cyclic excursion is exactly 1 Å
    const excursions = Array.from({ length: 360 }, (_unused, deg) => {
      const phase = (deg * Math.PI) / 180
      let max_sq = 0
      for (let site = 0; site < cell.structure.sites.length; site++) {
        let norm_sq = 0
        for (let axis = 0; axis < 3; axis++) {
          const re_part = pattern_a.displacements[site * 6 + axis * 2]
          const im_part = pattern_a.displacements[site * 6 + axis * 2 + 1]
          norm_sq += (re_part * Math.cos(phase) + im_part * Math.sin(phase)) ** 2
        }
        max_sq = Math.max(max_sq, norm_sq)
      }
      return Math.sqrt(max_sq)
    })
    expect(Math.max(...excursions)).toBeCloseTo(1, 6)

    const short_run = phonon_mode_run(pattern_a, { amplitude: 0.5, n_frames: 4 })
    const long_run = phonon_mode_run(pattern_a, { amplitude: 0.5, n_frames: 4000 })
    expect(long_run.frame_count).toBe(4000)
    expect(long_run.properties.rows).toHaveLength(4000)
    // Frame 1000 of 4000 is a quarter cycle, like frame 1 of 4; sites are the shared cell's
    const quarter_a = short_run.read_frame(1)
    const quarter_b = long_run.read_frame(1000)
    if (quarter_a instanceof Promise || quarter_b instanceof Promise) throw new Error(`sync`)
    for (const [site_idx, { xyz }] of quarter_b.structure.sites.entries()) {
      xyz.forEach((coord, axis) =>
        expect(coord).toBeCloseTo(quarter_a.structure.sites[site_idx].xyz[axis], 12),
      )
    }
    expect(quarter_a.structure.sites[0].species).toBe(cell.structure.sites[0].species)
    expect(
      Math.hypot(
        ...(quarter_a.structure.sites[0].xyz.map(
          (coord, axis) => coord - cell.structure.sites[0].xyz[axis],
        ) as Vec3),
      ),
    ).toBeLessThanOrEqual(0.5 + 1e-12)
    expect(() => short_run.read_frame(4)).toThrow(RangeError)
  })

  it(`reports mass-weighted mode character per element`, () => {
    const optical = data.qpoints[0].modes[3].eigenvector
    if (!optical) throw new Error(`fixture mode has no eigenvector`)
    const { element_weights, participation_ratio } = phonon_mode_character(data, optical)
    expect(element_weights.map(([symbol]) => symbol).toSorted()).toEqual([`Cl`, `Na`])
    expect(element_weights.reduce((sum, [, weight]) => sum + weight, 0)).toBeCloseTo(1, 12)
    expect(element_weights[0][1]).toBeGreaterThanOrEqual(element_weights[1][1])
    expect(participation_ratio).toBeGreaterThan(0.5)
    expect(participation_ratio).toBeLessThanOrEqual(1)
    const lone = phonon_mode_character(make_mode_data(real_x), real_x)
    expect(lone).toEqual({ element_weights: [[`H`, 1]], participation_ratio: 1 })
  })
})

describe(`phonon band helpers`, () => {
  it(`parses the real NaCl Gamma-X demo with complex eigenvectors`, () => {
    const data = parse_phonon_modes(nacl_band_yaml)
    expect(data.qpoints).toHaveLength(5)
    expect(data.path_segments).toEqual([
      { start_index: 0, end_index: 4, start_label: `GAMMA`, end_label: `X` },
    ])
    expect(data.qpoints[1].modes[0].eigenvector?.[0][2][1]).not.toBe(0)
    expect(phonon_band_structure_from_modes(data).bands).toHaveLength(6)
  })

  it(`matches Phonopy 4.4 modulation displacements for a nondegenerate NaCl X mode`, () => {
    const data = parse_phonon_modes(nacl_band_yaml)
    const trajectory = phonon_mode_trajectory(
      data,
      { qpoint_idx: 4, mode_idx: 2 },
      {
        amplitude: 1,
        supercell: [2, 1, 2],
        n_frames: 4,
      },
    )
    // Reference from phonopy.run_modulations([2,1,2], [[[0.5,0,0.5],2,1,0]]) using
    // the published full-precision phonopy_params.yaml, reordered to MatterViz cell-major
    // site order and scaled so the maximum atomic excursion is one Å.
    const expected = [
      [7.612926876151339e-16, 1, -2.520799638457289e-16],
      [-3.7333168018089856e-16, 0.7797043412834651, -2.203338894676433e-16],
      [-7.612926876151339e-16, -1, 2.520799638457289e-16],
      [3.7333168018089856e-16, -0.7797043412834651, 2.203338894676433e-16],
      [-7.612926876151339e-16, -1, 2.520799638457289e-16],
      [3.7333168018089856e-16, -0.7797043412834651, 2.203338894676433e-16],
      [7.612926876151339e-16, 1, -2.520799638457289e-16],
      [-3.7333168018089856e-16, 0.7797043412834651, -2.203338894676433e-16],
    ]
    const actual = trajectory.frames[0].structure.sites
      .filter(({ properties }) => properties.orig_site_idx === undefined)
      .map((site) => site.properties.phonon_displacement as Vec3)
    const absolute_errors = actual.flatMap((vector, site_idx) =>
      vector.map((value, axis) => Math.abs(value - expected[site_idx][axis])),
    )
    const relative_errors = actual.flatMap((vector, site_idx) =>
      vector.flatMap((value, axis) => {
        const reference = expected[site_idx][axis]
        return Math.abs(reference) > 1e-12 ? [Math.abs((value - reference) / reference)] : []
      }),
    )
    // The fixture stores 14 decimal places. Measured errors are 7.66e-15 absolute and
    // 9.82e-15 relative (about 35 and 44 f64 eps), so 1e-12 leaves margin for serialization.
    expect(Math.max(...absolute_errors)).toBeLessThan(1e-12)
    expect(Math.max(...relative_errors)).toBeLessThan(1e-12)
  })

  it(`transposes modes and preserves normalized path branches and labels`, () => {
    const data = make_mode_data()
    data.qpoints = [
      { q_position: [0, 0, 0], distance: 0, modes: [{ frequency: 1, eigenvector: real_x }] },
      { q_position: [0.5, 0, 0], distance: 1, modes: [{ frequency: 2, eigenvector: real_x }] },
    ]
    data.path_segments = [
      { start_index: 0, end_index: 1, start_label: `GAMMA`, end_label: `X` },
    ]
    const bands = phonon_band_structure_from_modes(data)
    expect(bands.bands).toEqual([[1, 2]])
    expect(bands.branches).toEqual([
      { start_index: 0, end_index: 1, name: `GAMMA-X`, is_discontinuity: false },
    ])
    expect(bands.qpoints.map(({ label }) => label)).toEqual([`GAMMA`, `X`])
    expect(bands.labels_dict).toEqual({ GAMMA: [0, 0, 0], X: [0.5, 0, 0] })
  })

  it(`rejects band conversion without path metadata`, () => {
    expect(() => phonon_band_structure_from_modes(make_mode_data())).toThrow(
      /no band path metadata/,
    )
  })
})
