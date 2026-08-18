import {
  complex_mode_displacement_frames,
  match_trajectory_modes_to_harmonic,
  trajectory_mode_trajectory,
  type Complex,
  type HarmonicAtomMapping,
  type PhononModeData,
  type TrajectorySpectroscopyResult,
} from '$lib/spectral'
import { describe, expect, it } from 'vitest'

const zero_curve = {
  frequencies: [0, 1, 2],
  power: [0, 1, 0],
  normalized_power: [0, 1, 0],
  frequency_unit: `THz` as const,
  n_fft: 4,
  n_samples: 4,
  sample_interval: 1,
  frequency_spacing: 1,
  rayleigh_resolution: 0.25,
  nyquist: 2,
  window: `hann` as const,
}

const make_result = (displacement: Complex[][]): TrajectorySpectroscopyResult => ({
  vdos: zero_curve,
  ir: null,
  raman: null,
  peaks: [
    {
      frequency: 2,
      ir_activity: `unknown`,
      raman_activity: `unknown`,
      ir_score: null,
      raman_score: null,
      vdos_prominence: 1,
      ir_prominence: 0,
      raman_prominence: 0,
      potentially_mixed: false,
      displacement,
    },
  ],
  frequency_unit: `THz`,
  preprocessing: `raw`,
  velocity_source: `stored`,
  reference_positions: displacement.map((_value, atom_idx) => [atom_idx, 0, 0]),
  elements: displacement.map(() => `H`),
  masses: displacement.map(() => 1),
  pbc: [false, false, false],
  reference_lattice: null,
  n_trajectories: 1,
  n_segments: 1,
  metadata: {},
})

const cartesian_mode = (axis: 0 | 1 | 2): Complex[][] => [
  ([0, 1, 2] as const).map((component) => (component === axis ? [1, 0] : [0, 0])),
]
const gamma_x = { frequency: 2, eigenvector: cartesian_mode(0) }

const harmonic_data = (modes: PhononModeData[`qpoints`][number][`modes`]): PhononModeData => ({
  n_atoms: 1,
  atoms: [{ symbol: `H`, mass: 1, coordinates: [0, 0, 0] }],
  lattice: null,
  reciprocal_lattice: null,
  qpoints: [{ q_position: [0, 0, 0], distance: null, modes }],
  path_segments: [],
})

describe(`trajectory_mode_trajectory`, () => {
  it(`rejects malformed complex coefficients and temporal conventions`, () => {
    const malformed_displacement = cartesian_mode(0)
    malformed_displacement[0][0][0] = Number.POSITIVE_INFINITY
    expect(() =>
      complex_mode_displacement_frames(malformed_displacement, {
        amplitude: 1,
        n_frames: 4,
      }),
    ).toThrow(/component 0 must contain two finite values/)

    const options = {
      amplitude: 1,
      n_frames: 4,
      time_dependence: `exp_negative_i_phase`,
    } as const
    Reflect.set(options, `time_dependence`, `clockwise`)
    expect(() => complex_mode_displacement_frames(cartesian_mode(0), options)).toThrow(
      /unsupported time dependence 'clockwise'/,
    )
  })

  it(`animates real and imaginary coefficients in quadrature with normalized display amplitude`, () => {
    const result = make_result([
      [
        [1, 0],
        [0, 1],
        [0, 0],
      ],
    ])
    const trajectory = trajectory_mode_trajectory(result, 0, { amplitude: 1, n_frames: 4 })
    const first = trajectory.frames[0].structure.sites[0].properties.spectroscopy_displacement
    const quarter =
      trajectory.frames[1].structure.sites[0].properties.spectroscopy_displacement
    if (!Array.isArray(first) || !Array.isArray(quarter)) {
      throw new TypeError(`Expected spectroscopy displacement vectors`)
    }
    expect(first).toEqual([1, 0, 0])
    expect(quarter[0]).toBeCloseTo(0, 14)
    expect(quarter[1]).toBeCloseTo(-1, 14)
    expect(result.peaks[0].displacement).toEqual([
      [
        [1, 0],
        [0, 1],
        [0, 0],
      ],
    ])
  })

  it(`does not animate or harmonically project a peak without position-band motion`, () => {
    const result = make_result(cartesian_mode(0))
    delete result.peaks[0].displacement
    result.peaks[0].displacement_unavailable_reason = `Mode exceeds the position Nyquist frequency`
    expect(() => trajectory_mode_trajectory(result, 0)).toThrow(
      /exceeds the position Nyquist frequency/,
    )
    const matched = match_trajectory_modes_to_harmonic(result, harmonic_data([gamma_x]))
    expect(matched.peaks[0].harmonic_matches).toBeUndefined()
  })
})

describe(`match_trajectory_modes_to_harmonic`, () => {
  it.each([
    [`adjacent frequencies`, [2, 2.005, 3] as const, [0, 1]],
    [`unsorted frequencies`, [2, 3, 2.005] as const, [0, 2]],
  ])(`combines a degenerate subspace from %s`, (_label, frequencies, mode_indices) => {
    const component = 1 / Math.sqrt(2)
    const eigenvectors: Record<number, Complex[][]> = {
      2: cartesian_mode(0),
      2.005: cartesian_mode(1),
      3: cartesian_mode(2),
    }
    const matched = match_trajectory_modes_to_harmonic(
      make_result([
        [
          [component, 0],
          [component, 0],
          [0, 0],
        ],
      ]),
      harmonic_data(
        frequencies.map((frequency) => ({ frequency, eigenvector: eigenvectors[frequency] })),
      ),
      { degeneracy_tolerance_thz: 0.01 },
    )
    expect(matched.peaks[0].harmonic_matches?.[0].mode_indices).toEqual(mode_indices)
    expect(matched.peaks[0].harmonic_matches?.[0].overlap).toBeCloseTo(1, 14)
    expect(matched.peaks[0].harmonic_matches?.[0].accepted).toBe(true)
  })

  it(`does not chain modes whose full frequency span exceeds the degeneracy tolerance`, () => {
    const eigenvectors = [cartesian_mode(0), cartesian_mode(1), cartesian_mode(2)]
    const matched = match_trajectory_modes_to_harmonic(
      make_result(cartesian_mode(0)),
      harmonic_data(
        [2, 2.009, 2.018].map((frequency, mode_idx) => ({
          frequency,
          eigenvector: eigenvectors[mode_idx],
        })),
      ),
      { degeneracy_tolerance_thz: 0.01 },
    )
    expect(matched.peaks[0].harmonic_matches?.map(({ mode_indices }) => mode_indices)).toEqual(
      [[0, 1], [2]],
    )
  })

  it.each([
    [`duplicate`, cartesian_mode(0)],
    [
      `nearly dependent`,
      [
        [
          [1, 0],
          [1e-8, 0],
          [0, 0],
        ],
      ] satisfies Complex[][],
    ],
  ])(`rejects %s eigenvectors in a degenerate harmonic subspace`, (_label, second) => {
    expect(() =>
      match_trajectory_modes_to_harmonic(
        make_result(cartesian_mode(0)),
        harmonic_data([
          { frequency: 2, eigenvector: cartesian_mode(0) },
          { frequency: 2.005, eigenvector: second },
        ]),
        { degeneracy_tolerance_thz: 0.01 },
      ),
    ).toThrow(/not orthogonal.*orthonormalize/)
  })

  it(`applies Bloch phases for an explicit commensurate supercell mapping`, () => {
    const result = make_result([
      [
        [1, 0],
        [0, 0],
        [0, 0],
      ],
      [
        [-1, 0],
        [0, 0],
        [0, 0],
      ],
    ])
    const harmonic = harmonic_data([gamma_x])
    harmonic.qpoints[0].q_position = [0.5, 0, 0]
    const matched = match_trajectory_modes_to_harmonic(result, harmonic, {
      atom_mapping: [
        { primitive_atom_idx: 0, cell_translation: [0, 0, 0] },
        { primitive_atom_idx: 0, cell_translation: [1, 0, 0] },
      ],
    })
    expect(matched.peaks[0].harmonic_matches?.[0].overlap).toBeCloseTo(1, 14)
  })

  it(`matches a non-self-conjugate q=1/3 mode using the forward-DFT convention`, () => {
    const phase = (cell_idx: number): Complex => [
      Math.cos((-2 * Math.PI * cell_idx) / 3),
      Math.sin((-2 * Math.PI * cell_idx) / 3),
    ]
    const result = make_result(
      Array.from({ length: 3 }, (_unused, cell_idx) => [phase(cell_idx), [0, 0], [0, 0]]),
    )
    const harmonic = harmonic_data([gamma_x])
    harmonic.qpoints[0].q_position = [1 / 3, 0, 0]
    const matched = match_trajectory_modes_to_harmonic(result, harmonic, {
      atom_mapping: Array.from({ length: 3 }, (_unused, cell_idx) => ({
        primitive_atom_idx: 0,
        cell_translation: [cell_idx, 0, 0],
      })),
    })
    expect(matched.peaks[0].harmonic_matches?.[0].overlap).toBeCloseTo(1, 14)
  })

  it(`keeps harmonic overlap invariant under a global MD phase`, () => {
    const harmonic = harmonic_data([gamma_x])
    const real = match_trajectory_modes_to_harmonic(make_result(cartesian_mode(0)), harmonic)
    const imaginary = match_trajectory_modes_to_harmonic(
      make_result([
        [
          [0, 1],
          [0, 0],
          [0, 0],
        ],
      ]),
      harmonic,
    )
    expect(real.peaks[0].harmonic_matches?.[0].overlap).toBeCloseTo(1, 14)
    expect(imaginary.peaks[0].harmonic_matches?.[0].overlap).toBeCloseTo(1, 14)
  })

  it(`infers a uniquely identifiable diagonal supercell mapping`, () => {
    const result = make_result([
      [
        [1, 0],
        [0, 0],
        [0, 0],
      ],
      [
        [-1, 0],
        [0, 0],
        [0, 0],
      ],
    ])
    result.reference_lattice = [
      [2, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    result.pbc = [true, true, true]
    const harmonic = harmonic_data([gamma_x])
    harmonic.lattice = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    harmonic.qpoints[0].q_position = [0.5, 0, 0]
    const matched = match_trajectory_modes_to_harmonic(result, harmonic)
    expect(matched.peaks[0].harmonic_matches?.[0].overlap).toBeCloseTo(1, 14)
  })

  it(`rejects ambiguous automatic supercell mappings`, () => {
    const result = make_result(Array.from({ length: 4 }, () => cartesian_mode(0)[0]))
    result.reference_positions = [
      [0, 0, 0],
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
    ]
    result.reference_lattice = [
      [2, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    const harmonic = harmonic_data([])
    harmonic.n_atoms = 2
    harmonic.atoms = [
      { symbol: `H`, mass: 1, coordinates: [0, 0, 0] },
      { symbol: `H`, mass: 1, coordinates: [0, 0, 0] },
    ]
    harmonic.lattice = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    expect(() => match_trajectory_modes_to_harmonic(result, harmonic)).toThrow(
      /mapping is ambiguous.*explicit atom_mapping/,
    )
  })

  it(`rejects atom-order mismatches without an explicit mapping`, () => {
    const result = make_result(cartesian_mode(0))
    result.elements = [`O`]
    expect(() => match_trajectory_modes_to_harmonic(result, harmonic_data([gamma_x]))).toThrow(
      /provide an explicit atom_mapping/,
    )
  })

  it.each([
    [`negative overlap`, { minimum_overlap: -0.1 }, /minimum_overlap/],
    [`overlap above one`, { minimum_overlap: 1.1 }, /minimum_overlap/],
    [`negative degeneracy tolerance`, { degeneracy_tolerance_thz: -0.1 }, /degeneracy/],
  ])(`rejects %s`, (_label, options, expected) => {
    expect(() =>
      match_trajectory_modes_to_harmonic(
        make_result(cartesian_mode(0)),
        harmonic_data([]),
        options,
      ),
    ).toThrow(expected)
  })

  it(`rejects sparse and mass-incompatible explicit mappings`, () => {
    const result = make_result(Array.from({ length: 2 }, () => cartesian_mode(0)[0]))
    const harmonic = harmonic_data([])
    const malformed_mapping = [
      { primitive_atom_idx: 0, cell_translation: [0, 0, 0] },
      { primitive_atom_idx: 0, cell_translation: [1, 0, 0] },
    ] satisfies HarmonicAtomMapping[]
    Reflect.set(malformed_mapping[0], `cell_translation`, [0, 0])
    expect(() =>
      match_trajectory_modes_to_harmonic(result, harmonic, {
        atom_mapping: malformed_mapping,
      }),
    ).toThrow(/exactly three integer cell translations/)
    expect(() =>
      match_trajectory_modes_to_harmonic(result, harmonic, {
        atom_mapping: [
          { primitive_atom_idx: 0, cell_translation: [0, 0, 0] },
          { primitive_atom_idx: 0, cell_translation: [2, 0, 0] },
        ],
      }),
    ).toThrow(/complete diagonal supercell/)
    result.masses[1] = 2
    expect(() =>
      match_trajectory_modes_to_harmonic(result, harmonic, {
        atom_mapping: [
          { primitive_atom_idx: 0, cell_translation: [0, 0, 0] },
          { primitive_atom_idx: 0, cell_translation: [1, 0, 0] },
        ],
      }),
    ).toThrow(/MD mass 2 but harmonic mass 1/)
  })
})
