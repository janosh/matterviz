// Derived views of a binary-phase-diagram/2: phase fractions along an isopleth, where two
// diagrams disagree on the phase set, and the Gibbs-energy curves with their convex hull

import type { Vec2, Vec3 } from '#lib/math.js'
import type { BinaryPhaseDiagram, DiagramRegion, GibbsEnergyGrid } from './types'
import { calculate_lever_rule, find_isotherm_intersections, find_region_at } from './utils'

// === Isopleth ===

// Phase fractions at one temperature of a vertical (fixed-x) section
export interface IsoplethStep {
  temperature: number
  region: DiagramRegion | null
  fractions: [string, number][] // phase id, molar phase fraction (sum 1 inside a region)
}

// Where the phase set changes along the isopleth, bisected to `t_tol` K (a change of
// composition set, FCC_A1#1 to FCC_A1#2 across a solvus, counts)
export interface IsoplethTransition {
  temperature: number
  above: DiagramRegion | null
  below: DiagramRegion | null
}

export interface Isopleth {
  composition: number
  bin: number // K spanned by each step, centred on its temperature
  steps: IsoplethStep[] // from t_max down to t_min (cooling)
  transitions: IsoplethTransition[]
}

function phase_fractions(
  region: DiagramRegion | null,
  composition: number,
  temperature: number,
): [string, number][] {
  if (!region) return []
  if (region.phases.length === 1) return [[region.phases[0], 1]]
  const lever = calculate_lever_rule(region, composition, temperature)
  if (!lever) return []
  return [
    [lever.left_phase, lever.fraction_left],
    [lever.right_phase, lever.fraction_right],
  ]
}

// Equilibrium cooling path at `composition`: phase fractions at the centres of `n_steps` T bins
// from t_max down (centres, so the window's own edges never read as phase changes), and every
// change of phase set between two centres bisected to `t_tol`. Adjacent polygons of one phase
// set are no change; a field missed by every probe goes unseen.
export function compute_isopleth(
  { regions }: BinaryPhaseDiagram,
  composition: number,
  [t_min, t_max]: Vec2,
  n_steps = 240,
  t_tol = 0.05,
): Isopleth {
  const region_at = (temperature: number) => find_region_at(regions, composition, temperature)
  const phase_set = (region: DiagramRegion | null) => region?.phases.toSorted().join(`+`) ?? ``
  const bin = (t_max - t_min) / n_steps
  const steps: IsoplethStep[] = []
  const transitions: IsoplethTransition[] = []
  for (let idx = 0; idx < n_steps; idx++) {
    const temperature = t_max - (idx + 0.5) * bin
    const region = region_at(temperature)
    const prev = steps.at(-1)
    if (prev && phase_set(prev.region) !== phase_set(region)) {
      // walk the chain of fields between the two centres, each edge bisected in turn
      let [hot, above] = [prev.temperature, prev.region]
      while (phase_set(above) !== phase_set(region)) {
        let cold = temperature
        while (hot - cold > t_tol) {
          const mid = (hot + cold) / 2
          if (phase_set(region_at(mid)) === phase_set(above)) hot = mid
          else cold = mid
        }
        const below = cold === temperature ? region : region_at(cold)
        transitions.push({ temperature: (hot + cold) / 2, above, below })
        ;[hot, above] = [cold, below]
      }
    }
    const fractions = phase_fractions(region, composition, temperature)
    steps.push({ temperature, region, fractions })
  }
  return { composition, bin, steps, transitions }
}

// === Phase-set disagreement ===

// [x_start, x_end, region index] spans of the regions crossing the isotherm
function region_spans(regions: readonly DiagramRegion[], temperature: number) {
  const spans: Vec3[] = []
  regions.forEach(({ vertices }, region_idx) => {
    const crossings = find_isotherm_intersections(vertices, temperature)
    for (let idx = 0; idx + 1 < crossings.length; idx += 2) {
      if (crossings[idx + 1] > crossings[idx]) {
        spans.push([crossings[idx], crossings[idx + 1], region_idx])
      }
    }
  })
  return spans
}

// Index of the region at x among the spans, -1 for none: the last listed region wins, like
// find_region_at
function span_region(spans: readonly Vec3[], x_val: number): number {
  let found = -1
  for (const [x_start, x_end, region_idx] of spans) {
    if (x_start <= x_val && x_val <= x_end && region_idx > found) found = region_idx
  }
  return found
}

// Sorted model phases of each region: composition sets of one model phase match each other
// (FCC_A1#1 is FCC_A1#2's FCC_A1), but how many coexist counts (a gap's FCC_A1+FCC_A1 is not
// the single-phase FCC_A1). `name_of` overrides a phase id's model phase.
function region_keys(
  { phases, regions }: BinaryPhaseDiagram,
  name_of?: (id: string) => string | undefined,
): string[] {
  const model_phase = new Map(phases.map(({ id, model_phase: name }) => [id, name]))
  return regions.map((region) =>
    region.phases
      .map((id) => name_of?.(id) ?? model_phase.get(id) ?? id)
      .toSorted()
      .join(`+`),
  )
}

// Isotherm segments [T, x_start, x_end] at each of `temperatures` where both diagrams have a
// phase field but disagree on its model phases, plus the disagreeing share of the length both
// cover. Exact along x: between consecutive span ends both phase sets are constant.
// `name_of` maps a phase id of `data` to the model phase of `other` it stands in for.
export function phase_disagreement(
  data: BinaryPhaseDiagram,
  other: BinaryPhaseDiagram,
  temperatures: readonly number[],
  name_of?: (id: string) => string | undefined,
): { segments: Vec3[]; fraction: number } {
  const [keys_a, keys_b] = [region_keys(data, name_of), region_keys(other)]
  const segments: Vec3[] = []
  let [covered, differing] = [0, 0]
  for (const temperature of temperatures) {
    const spans_a = region_spans(data.regions, temperature)
    const spans_b = region_spans(other.regions, temperature)
    const cuts = [...spans_a, ...spans_b]
      .flatMap(([x_start, x_end]) => [x_start, x_end])
      .toSorted((cut_a, cut_b) => cut_a - cut_b)
    for (let idx = 0; idx + 1 < cuts.length; idx++) {
      const [x_start, x_end] = [cuts[idx], cuts[idx + 1]]
      if (x_end <= x_start) continue
      const mid = (x_start + x_end) / 2
      const [region_a, region_b] = [span_region(spans_a, mid), span_region(spans_b, mid)]
      if (region_a < 0 || region_b < 0) continue
      covered += x_end - x_start
      if (keys_a[region_a] === keys_b[region_b]) continue
      differing += x_end - x_start
      const last = segments.at(-1)
      if (last?.[0] === temperature && last[2] === x_start) last[2] = x_end
      else segments.push([temperature, x_start, x_end])
    }
  }
  return { segments, fraction: covered > 0 ? differing / covered : 0 }
}

// === Gibbs energy ===

export interface GibbsCurve {
  id: string // model phase
  points: Vec2[] // [x, G in J/mol], finite values only
}

// Each phase's G(x) at `temperature`, linear between the two bracketing grid rows (clamped
// to the grid's T range). On a grid row only that row's values count; between rows a node
// null in either is left out.
export function gibbs_curves(grid: GibbsEnergyGrid, temperature: number): GibbsCurve[] {
  const { temperatures, compositions } = grid
  const t_clamped = Math.min(
    Math.max(temperature, temperatures[0]),
    temperatures[temperatures.length - 1],
  )
  const hi = Math.max(
    1,
    temperatures.findIndex((t_val) => t_val >= t_clamped),
  )
  const lo = hi - 1
  const weight = (t_clamped - temperatures[lo]) / (temperatures[hi] - temperatures[lo])
  return grid.phases.map(({ model_phase: id, values }) => {
    const [row_lo, row_hi] = [values[lo], values[hi]]
    const points: Vec2[] = []
    compositions.forEach((x_val, idx) => {
      const [g_lo, g_hi] = [row_lo[idx], row_hi[idx]]
      const g_val =
        weight === 0
          ? g_lo
          : weight === 1
            ? g_hi
            : g_lo === null || g_hi === null
              ? null
              : g_lo + (g_hi - g_lo) * weight
      if (g_val !== null) points.push([x_val, g_val])
    })
    return { id, points }
  })
}

// A hull vertex: its point, the phase whose curve it lies on and its index in that curve
export interface HullVertex {
  point: Vec2
  id: string
  idx: number
}

// Lower convex hull of the curves' points (monotone chain). Collinear points are dropped, so
// at an invariant T the middle phase's vertex can leave the hull.
export function lower_hull(curves: readonly GibbsCurve[]): HullVertex[] {
  const all = curves
    .flatMap(({ id, points }) => points.map((point, idx) => ({ point, id, idx })))
    .toSorted(({ point: [x_a, g_a] }, { point: [x_b, g_b] }) => x_a - x_b || g_a - g_b)
  const hull: HullVertex[] = []
  for (const entry of all) {
    // a later point at the same x is never lower (sorted by G within x)
    if (hull.at(-1)?.point[0] === entry.point[0]) continue
    while (hull.length >= 2) {
      const [[x_1, g_1], [x_2, g_2]] = [
        hull[hull.length - 2].point,
        hull[hull.length - 1].point,
      ]
      const [x_3, g_3] = entry.point
      // drop the middle point unless the turn is strictly convex from below
      if ((x_2 - x_1) * (g_3 - g_1) - (g_2 - g_1) * (x_3 - x_1) > 0) break
      hull.pop()
    }
    hull.push(entry)
  }
  return hull
}

// Hull edges that are common tangents (tie lines) at that T: ones joining two phases, or
// skipping defined points of one phase's curve (a miscibility gap), on any grid spacing
export const common_tangents = (hull: readonly HullVertex[]) =>
  hull.slice(1).flatMap((end, idx) => {
    const start = hull[idx]
    const is_tangent = start.id !== end.id || end.idx - start.idx > 1
    return is_tangent ? [{ start, end }] : []
  })
