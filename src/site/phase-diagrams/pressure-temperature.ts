// Demo pressure-temperature phase diagrams. Illustrative only: smooth curves through
// literature-like triple points with made-up standard errors that grow with extrapolation
// distance, the way propagated free-energy errors do. Not for research use.

import type { Vec2 } from '#lib/math.js'
import type { PtBoundary, PtPhaseDiagramData } from '#lib/phase-diagram/index.js'

const linspace = (start: number, stop: number, count: number): number[] =>
  Array.from({ length: count }, (_, idx) => start + ((stop - start) * idx) / (count - 1))

// Boundary `a-b` sampled from T(P) at `count` pressures, with per-point standard errors
const curve = (
  phases: [string, string],
  [p_start, p_end]: Vec2,
  temp_of: (pressure: number) => number,
  {
    t: sigma_t,
    p: sigma_p,
  }: { t?: (pressure: number) => number; p?: (pressure: number) => number },
  count = 16,
): PtBoundary => {
  const pressures = linspace(p_start, p_end, count)
  const sample = (fn: (pressure: number) => number, digits: number) =>
    pressures.map((pressure) => Number(fn(pressure).toFixed(digits)))
  const temps = sample(temp_of, 1)
  return {
    id: phases.join(`-`),
    phases,
    points: pressures.map((pressure, idx) => [Number(pressure.toFixed(3)), temps[idx]]),
    ...(sigma_t && { sigma_t: sample(sigma_t, 1) }),
    ...(sigma_p && { sigma_p: sample(sigma_p, 2) }),
  }
}

// Straight line in (P, T) through two points, as T(P)
const through =
  ([p_a, t_a]: Vec2, [p_b, t_b]: Vec2) =>
  (pressure: number): number =>
    t_a + ((t_b - t_a) * (pressure - p_a)) / (p_b - p_a)

// Simon-Glatzel melting curve T = T0 (1 + (P - P0) / a)^(1 / c) through (P0, T0) and,
// with the exponent c solved for, through (P1, T1)
const simon = ([p_0, t_0]: Vec2, [p_1, t_1]: Vec2, scale: number) => {
  const inv_exponent = Math.log(t_1 / t_0) / Math.log(1 + (p_1 - p_0) / scale)
  return (pressure: number): number => t_0 * (1 + (pressure - p_0) / scale) ** inv_exponent
}

// Iron-like single-component system: four solids (bcc α and δ, fcc γ, hcp ε) and the liquid
const fe_triple = { aeg: [10.5, 770], gdl: [5.2, 1991], gel: [90, 2950] } satisfies Record<
  string,
  Vec2
>
const gamma_melting = simon(fe_triple.gdl, fe_triple.gel, 27)
const eps_melting = simon(fe_triple.gel, [150, 3600], 160)

export const iron_pt_diagram: PtPhaseDiagramData = {
  system: `Fe`,
  title: `Fe (illustrative)`,
  pressure_unit: `GPa`,
  temperature_unit: `K`,
  pressure_range: [0, 150],
  temperature_range: [300, 4000],
  phases: [
    { id: `alpha`, name: `α-Fe`, description: `bcc, ferromagnetic below 1043 K` },
    { id: `gamma`, name: `γ-Fe`, description: `fcc` },
    { id: `delta`, name: `δ-Fe`, description: `bcc` },
    { id: `epsilon`, name: `ε-Fe`, description: `hcp` },
    { id: `liquid`, name: `Liquid` },
  ],
  boundaries: [
    curve([`alpha`, `gamma`], [0, fe_triple.aeg[0]], through([0, 1185], fe_triple.aeg), {
      t: (pressure) => 12 + 2.5 * pressure,
    }),
    // near-vertical, so its error is a pressure error at fixed temperature
    // oxfmt-ignore
    { id: `alpha-epsilon`, phases: [`alpha`, `epsilon`], points: [[13, 300], [12.4, 420], [11.8, 540], [11.1, 660], [10.5, 770]], sigma_p: [0.9, 0.8, 0.7, 0.6, 0.5] },
    curve(
      [`gamma`, `epsilon`],
      [fe_triple.aeg[0], fe_triple.gel[0]],
      (pressure) =>
        through(fe_triple.aeg, fe_triple.gel)(pressure) +
        180 * Math.sin((Math.PI * (pressure - 10.5)) / 79.5),
      { t: (pressure) => 25 + 1.1 * pressure, p: (pressure) => 0.4 + 0.03 * pressure },
    ),
    curve(
      [`gamma`, `delta`],
      [0, fe_triple.gdl[0]],
      through([0, 1667], fe_triple.gdl),
      {
        t: () => 15,
      },
      6,
    ),
    curve(
      [`delta`, `liquid`],
      [0, fe_triple.gdl[0]],
      through([0, 1811], fe_triple.gdl),
      {
        t: () => 20,
      },
      6,
    ),
    curve([`gamma`, `liquid`], [fe_triple.gdl[0], fe_triple.gel[0]], gamma_melting, {
      t: (pressure) => 20 + 1.3 * pressure,
    }),
    curve(
      [`epsilon`, `liquid`],
      [fe_triple.gel[0], 150],
      eps_melting,
      {
        t: (pressure) => 60 + 1.4 * (pressure - 60),
      },
      10,
    ),
  ],
  // oxfmt-ignore
  special_points: [
    { id: `tp-aeg`, type: `triple`, position: fe_triple.aeg, phases: [`alpha`, `gamma`, `epsilon`], sigma_t: 35, sigma_p: 0.6, label: `α–γ–ε` },
    { id: `tp-gdl`, type: `triple`, position: fe_triple.gdl, phases: [`gamma`, `delta`, `liquid`], sigma_t: 25, sigma_p: 0.4 },
    { id: `tp-gel`, type: `triple`, position: fe_triple.gel, phases: [`gamma`, `epsilon`, `liquid`], sigma_t: 140, sigma_p: 4, label: `γ–ε–L` },
  ],
}

// Water-like system in Pa: ice Ih, liquid, vapor and the supercritical fluid beyond the
// critical point. Liquid and vapor join around the critical point, so the boundaries alone
// can't split them into regions: this diagram passes explicit regions.
const h2o_triple: Vec2 = [611.657, 273.16]
const h2o_critical: Vec2 = [22.064e6, 647.096]
const p_floor = 1
const p_ceiling = 2e8
// Clausius-Clapeyron: ln P linear in 1/T between two anchor points
const clapeyron =
  ([p_a, t_a]: Vec2, [p_b, t_b]: Vec2) =>
  (temp: number): number =>
    p_a * Math.exp((Math.log(p_b / p_a) * (1 / temp - 1 / t_a)) / (1 / t_b - 1 / t_a))
const sample_by_temp = (temps: number[], pressure_of: (temp: number) => number): Vec2[] =>
  temps.map((temp) => [Number(pressure_of(temp).toPrecision(5)), Number(temp.toFixed(2))])

const vaporization = sample_by_temp(
  linspace(h2o_triple[1], h2o_critical[1], 14),
  clapeyron(h2o_triple, h2o_critical),
)
const sublimation = sample_by_temp(
  linspace(190, h2o_triple[1], 8),
  clapeyron(h2o_triple, [0.0323, 190]),
)
// Ice Ih melts at lower temperature under pressure (negative Clapeyron slope)
const melting: Vec2[] = linspace(Math.log10(h2o_triple[0]), Math.log10(p_ceiling), 10).map(
  (log_p) => {
    const pressure = 10 ** log_p
    return [
      Number(pressure.toPrecision(5)),
      Number((273.16 - 7.4e-8 * pressure - 1.5e-16 * pressure ** 2).toFixed(2)),
    ]
  },
)
const [t_min, t_max] = [190, 800]

export const water_pt_diagram: PtPhaseDiagramData = {
  system: `H2O`,
  title: `H2O (illustrative)`,
  pressure_unit: `Pa`,
  temperature_unit: `K`,
  pressure_range: [p_floor, p_ceiling],
  temperature_range: [t_min, t_max],
  phases: [
    { id: `ice-ih`, name: `Ice Ih`, color: `#a5d8ff` },
    { id: `liquid`, name: `Liquid`, color: `#4dabf7` },
    { id: `vapor`, name: `Vapor`, color: `#ffd8a8` },
    { id: `supercritical`, name: `Supercritical fluid`, color: `#e599f7` },
  ],
  // oxfmt-ignore
  boundaries: [
    { id: `sublimation`, phases: [`ice-ih`, `vapor`], points: sublimation, sigma_t: sublimation.map(() => 1.5) },
    { id: `vaporization`, phases: [`liquid`, `vapor`], points: vaporization, sigma_t: vaporization.map((_, idx) => 1 + idx * 0.6) },
    { id: `melting`, phases: [`ice-ih`, `liquid`], points: melting, sigma_t: melting.map((_, idx) => 0.5 + idx * 0.3) },
  ],
  // oxfmt-ignore
  regions: [
    { phase: `vapor`, vertices: [[p_floor, t_min], ...sublimation, ...vaporization, [h2o_critical[0], t_max], [p_floor, t_max]] },
    { phase: `ice-ih`, vertices: [[p_floor, t_min], ...sublimation, ...melting, [p_ceiling, t_min]] },
    { phase: `liquid`, vertices: [...melting, [p_ceiling, h2o_critical[1]], ...vaporization.toReversed()] },
    { phase: `supercritical`, vertices: [h2o_critical, [p_ceiling, h2o_critical[1]], [p_ceiling, t_max], [h2o_critical[0], t_max]] },
  ],
  // oxfmt-ignore
  special_points: [
    { id: `triple`, type: `triple`, position: h2o_triple, phases: [`ice-ih`, `liquid`, `vapor`], label: `Triple point` },
    { id: `critical`, type: `critical`, position: h2o_critical, phases: [`liquid`, `vapor`], sigma_t: 2, sigma_p: 0.4e6, label: `Critical point` },
  ],
}
