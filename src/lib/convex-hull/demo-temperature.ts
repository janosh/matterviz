import type { PhaseData } from './types'

export const demo_temperatures = Array.from({ length: 13 }, (_, idx) => 300 + idx * 100)

type Composition = Record<string, number>

function seeded_random(seed: number): number {
  const x_val = Math.sin(seed * 9999) * 10000
  return x_val - Math.floor(x_val)
}

export function make_demo_phase(
  composition: Composition,
  seed: number,
  entropy_boost = 0,
): PhaseData {
  const n_elements = Object.keys(composition).length
  const energy = -0.3 * n_elements - seeded_random(seed) * 0.5
  const entropy_coef = 0.5 + n_elements * 0.3 + seeded_random(seed + 1) * 2 +
    entropy_boost
  return {
    composition,
    energy,
    temperatures: demo_temperatures,
    free_energies: demo_temperatures.map((temp_kelvin) =>
      energy + entropy_coef * temp_kelvin * 0.0001 -
      0.00005 * temp_kelvin * Math.log(temp_kelvin)
    ),
  }
}

export function create_temp_ternary_entries_li_fe_o(): PhaseData[] {
  return [
    ...[`Li`, `Fe`, `O`].map((element, idx) => make_demo_phase({ [element]: 1 }, idx)),
    ...[[`Li`, `Fe`], [`Li`, `O`], [`Fe`, `O`]].flatMap(([element_a, element_b], idx) =>
      [0.33, 0.5, 0.67].flatMap((fraction, jdx) => [
        make_demo_phase(
          { [element_a]: fraction, [element_b]: 1 - fraction },
          100 + idx * 10 + jdx,
        ),
        make_demo_phase(
          { [element_a]: fraction, [element_b]: 1 - fraction },
          200 + idx * 10 + jdx,
          3,
        ),
      ])
    ),
    ...[
      { Li: 0.33, Fe: 0.33, O: 0.34 },
      { Li: 0.5, Fe: 0.25, O: 0.25 },
      { Li: 0.25, Fe: 0.5, O: 0.25 },
      { Li: 0.25, Fe: 0.25, O: 0.5 },
    ].flatMap((composition, idx) => [
      make_demo_phase(composition, 300 + idx),
      make_demo_phase(composition, 400 + idx, 4),
    ]),
  ]
}
