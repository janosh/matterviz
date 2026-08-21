import type { Vec3 } from '$lib/math'
import { create_cart_to_frac, create_frac_to_cart } from '$lib/math'
import {
  is_commensurate_phonon_supercell,
  PHONON_VECTOR_KEY,
  phonon_band_structure_from_modes,
  phonon_mode_trajectory as create_phonon_mode_run,
  parse_phonon_modes,
  type Complex,
  type PhononModeData,
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
    expect(Math.max(...frame_bonds.flat().map(({ bond_length }) => bond_length))).toBeLessThan(
      4,
    )
    expect(frame_bonds[1].map(({ bond_length }) => bond_length)).not.toEqual(
      frame_bonds[0].map(({ bond_length }) => bond_length),
    )
  })

  it.each([
    [`zero amplitude`, { amplitude: 0 }, /amplitude must be a positive/],
    [`one frame`, { n_frames: 1 }, /at least 2 integer frames/],
    [`invalid supercell`, { supercell: [1, 0, 1] as Vec3 }, /positive integers/],
    [
      `oversized trajectory`,
      { supercell: [400, 400, 1] as Vec3 },
      /would generate 160000 sites × 48 frames.*exceeding the 500000 limit/,
    ],
    [
      `oversized face-closed trajectory`,
      { supercell: [2, 2, 2] as Vec3, n_frames: 62_500 },
      /would generate 27 sites × 62500 frames.*exceeding the 500000 limit/,
    ],
  ])(`rejects $name`, (_name, options, error) => {
    expect(() =>
      phonon_mode_trajectory(make_mode_data(), { qpoint_idx: 0, mode_idx: 0 }, options),
    ).toThrow(error)
  })

  it.each([
    [{ qpoint_idx: 1, mode_idx: 0 }, /q-point index 1 is outside/],
    [{ qpoint_idx: 0, mode_idx: 1 }, /mode index 1 is outside/],
  ])(`rejects an invalid selection`, (selection, error) => {
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
