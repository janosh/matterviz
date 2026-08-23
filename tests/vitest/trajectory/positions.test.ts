// Kernels shared by MSD, VACF, spectroscopy and the trajectory trails; each consumer's own
// suite covers its numerics, this one pins the contracts they all lean on.
import type { ElementSymbol } from '$lib/element'
import {
  curve_slots,
  lag_range,
  resolve_lag_time_unit,
  validate_position_stream_layout,
} from '$lib/trajectory/positions'
import type { TrajectoryPositionStream } from '$lib/trajectory'
import { describe, expect, it } from 'vitest'
import { make_position_stream } from '../setup'

describe(`curve_slots`, () => {
  it.each([
    // a lone species adds nothing over the total, so only the total slot is reported
    [[`Li`], [{ label: `Total`, slot: 1 }]],
    [
      // total first, then elements alphabetically, each pointing at its first-seen group id
      [`O`, `Li`, `Si`],
      [
        { label: `Total`, slot: 3 },
        { label: `Li`, slot: 1 },
        { label: `O`, slot: 0 },
        { label: `Si`, slot: 2 },
      ],
    ],
  ])(`orders %j as total first then sorted elements`, (labels, expected) => {
    expect(curve_slots(labels)).toEqual(expected)
  })
})

describe(`resolve_lag_time_unit`, () => {
  it.each([
    [undefined, undefined, `frame`],
    [undefined, `frame`, `frame`],
    [0.5, `fs`, `fs`],
  ])(`dt=%s time_unit=%s labels the lag axis %s`, (dt, time_unit, expected) => {
    expect(resolve_lag_time_unit(`calc_msd`, dt, time_unit, `fs`)).toBe(expected)
  })

  it.each([
    [0, `fs`, /calc_msd: dt must be positive, got 0/],
    [-1, `fs`, /dt must be positive, got -1/],
    [Number.NaN, `fs`, /dt must be positive, got NaN/],
    [0.5, undefined, /dt was supplied \(0\.5\) without time_unit; pass e.g. time_unit: 'fs'/],
    [0.5, ``, /without time_unit/],
    [0.5, `frame`, /time_unit 'frame' cannot be combined with dt/],
  ])(`rejects dt=%s with time_unit=%s`, (dt, time_unit, expected) => {
    expect(() => resolve_lag_time_unit(`calc_msd`, dt, time_unit, `fs`)).toThrow(expected)
  })
})

describe(`lag_range`, () => {
  it.each([
    [11, 0.5, 5],
    [11, 1, 10],
    // never below one lag, however short the run or small the fraction
    [2, 0.1, 1],
    [1, 1, 1],
  ])(`%d frames at fraction %s give %d lags`, (n_frames, fraction, expected) => {
    expect(lag_range(`calc_vacf`, n_frames, fraction)).toBe(expected)
  })

  it.each([0, -0.5, 1.5, Number.NaN])(`rejects max_lag_fraction %s`, (fraction) => {
    expect(() => lag_range(`calc_vacf`, 10, fraction)).toThrow(
      `calc_vacf: max_lag_fraction must be in (0, 1], got ${fraction}`,
    )
  })
})

describe(`validate_position_stream_layout`, () => {
  const two_atoms = (n_frames: number, overrides: Partial<TrajectoryPositionStream> = {}) =>
    make_position_stream(
      Array.from({ length: n_frames }, () => [
        [0, 0, 0],
        [1, 1, 1],
      ]),
      [`Li`, `O`] as ElementSymbol[],
      overrides,
    )

  it(`accepts a consistent stream, with or without lattices`, () => {
    expect(() => validate_position_stream_layout(two_atoms(3), `calc_msd`, 2)).not.toThrow()
    expect(() =>
      validate_position_stream_layout(
        two_atoms(3, { lattice_matrices: null, pbc: null }),
        `calc_msd`,
        2,
      ),
    ).not.toThrow()
  })

  it.each([
    [`too few frames`, two_atoms(1), /calc_msd: need at least 2 frames, got 1/],
    [`no atoms`, two_atoms(3, { n_atoms: 0 }), /need at least 1 atom, got 0/],
    [
      `element count`,
      two_atoms(3, { elements: [`Li`] }),
      /got 1 element labels for 2 atoms; atom order is the atom identity/,
    ],
    [
      `buffer length`,
      two_atoms(3, { positions: new Float64Array(17) }),
      /positions has 17 entries but 3 frames x 2 atoms x 3 requires 18/,
    ],
    [
      `lattice count`,
      two_atoms(3, { lattice_matrices: [null] }),
      /got 1 lattice matrices for 3 frames/,
    ],
  ])(`rejects %s`, (_label, stream, expected) => {
    expect(() => validate_position_stream_layout(stream, `calc_msd`, 2)).toThrow(expected)
  })
})
