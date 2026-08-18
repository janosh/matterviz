import { THZ_TO_INVERSE_CM } from '$lib/constants'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import type { TrajectorySpectroscopyResult } from './trajectory-spectroscopy'
import type {
  VibrationalReferenceEntry,
  VibrationalReferenceMode,
} from './spectroscopy-reference'

export type FrequencyComparisonMode = `absolute` | `spacing` | `scaled`

export interface BenchmarkMatch {
  predicted_peak_idx: number
  reference_mode_id: string
}

export interface FrequencyScale {
  factor: number
  source: string
  fitted_mode_ids?: string[]
}

export interface SpectroscopyBenchmarkOptions {
  comparison?: FrequencyComparisonMode
  matches?: BenchmarkMatch[]
  scale?: FrequencyScale
  fit_scale_mode_ids?: string[]
  unmatched_penalty_cm1?: number
  activity_mismatch_penalty_cm1?: number
}

export interface BenchmarkModeResult {
  predicted_peak_idx: number
  reference_mode_id: string
  predicted_cm1: number
  reference_cm1: number
  raw_error_cm1: number
  spacing_error_cm1: number
  scaled_cm1: number
  scaled_error_cm1: number
  resolution_cm1: number
  ir_activity_matches: boolean | null
  raman_activity_matches: boolean | null
}

export interface BenchmarkMetrics {
  mean_signed_error_cm1: number
  mae_cm1: number
  rmse_cm1: number
  mape_percent: number
}

export interface ActivityConfusionCounts {
  correct: number
  compared: number
  true_active: number
  false_active: number
  true_inactive: number
  false_inactive: number
}

export interface SpectroscopyBenchmarkResult {
  reference_id: string
  comparison: FrequencyComparisonMode
  matches: BenchmarkModeResult[]
  unmatched_predicted_peak_indices: number[]
  unmatched_reference_mode_ids: string[]
  absolute: BenchmarkMetrics | null
  spacing_mae_cm1: number | null
  scaled: BenchmarkMetrics | null
  scale: FrequencyScale
  scale_is_in_sample: boolean
  ir_activity: ActivityConfusionCounts
  raman_activity: ActivityConfusionCounts
}

const frequency_to_cm1 = (
  frequency: number,
  unit: TrajectorySpectroscopyResult[`frequency_unit`],
): number => {
  if (unit === `cm^-1`) return frequency
  if (unit === `THz`) return frequency * THZ_TO_INVERSE_CM
  throw new Error(
    `benchmark_spectroscopy: cannot benchmark a 1/frame spectrum against cm^-1 references`,
  )
}

const metrics = (errors: number[], references: number[]): BenchmarkMetrics | null => {
  if (errors.length === 0) return null
  return {
    mean_signed_error_cm1: errors.reduce((total, value) => total + value, 0) / errors.length,
    mae_cm1: errors.reduce((total, value) => total + Math.abs(value), 0) / errors.length,
    rmse_cm1: Math.sqrt(
      errors.reduce((total, value) => total + value * value, 0) / errors.length,
    ),
    mape_percent:
      (100 *
        errors.reduce((total, value, idx) => total + Math.abs(value / references[idx]), 0)) /
      errors.length,
  }
}

const activity_cost = (
  predicted: TrajectorySpectroscopyResult[`peaks`][number],
  reference: VibrationalReferenceMode,
  penalty: number,
): number => {
  let cost = 0
  for (const channel of [`ir_activity`, `raman_activity`] as const) {
    if (
      predicted[channel] !== `unknown` &&
      reference[channel] !== `unknown` &&
      predicted[channel] !== reference[channel]
    ) {
      cost += penalty
    }
  }
  return cost
}

const count_labels = (labels: (string | undefined)[]): SvelteMap<string, number> => {
  const counts = new SvelteMap<string, number>()
  for (const label of labels) {
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return counts
}

// Monotonic dynamic-programming assignment. It skips spurious predicted peaks and missing
// references instead of forcing every mode into a misleading nearest-frequency match.
const assign_modes = (
  result: TrajectorySpectroscopyResult,
  references: VibrationalReferenceMode[],
  unmatched_penalty: number,
  activity_penalty: number,
): BenchmarkMatch[] => {
  const predicted_label_counts = count_labels(result.peaks.map(({ mode_label }) => mode_label))
  const reference_label_counts = count_labels(references.map(({ label }) => label))
  const reference_by_label = new SvelteMap(
    references
      .filter(({ label }) => reference_label_counts.get(label) === 1)
      .map((mode) => [mode.label, mode]),
  )
  const label_matches: BenchmarkMatch[] = []
  const label_predicted = new SvelteSet<number>()
  const label_references = new SvelteSet<string>()
  for (const [peak_idx, peak] of result.peaks.entries()) {
    if (!peak.mode_label || predicted_label_counts.get(peak.mode_label) !== 1) continue
    const mode = reference_by_label.get(peak.mode_label)
    if (!mode) continue
    label_matches.push({ predicted_peak_idx: peak_idx, reference_mode_id: mode.mode_id })
    label_predicted.add(peak_idx)
    label_references.add(mode.mode_id)
  }
  const predicted = result.peaks
    .map(({ frequency }, peak_idx) => ({
      peak_idx,
      frequency: frequency_to_cm1(frequency, result.frequency_unit),
    }))
    .filter(({ peak_idx }) => !label_predicted.has(peak_idx))
    .toSorted((left, right) => left.frequency - right.frequency)
  const sorted_references = references
    .filter(({ mode_id }) => !label_references.has(mode_id))
    .toSorted((left, right) => left.wavenumber_cm1 - right.wavenumber_cm1)
  const rows = predicted.length + 1
  const cols = sorted_references.length + 1
  const costs = Array.from({ length: rows }, () => Array(cols).fill(Number.POSITIVE_INFINITY))
  const choices = Array.from({ length: rows }, () =>
    Array<`match` | `skip_predicted` | `skip_reference` | null>(cols).fill(null),
  )
  costs[0][0] = 0
  for (let predicted_idx = 0; predicted_idx <= predicted.length; predicted_idx++) {
    for (let reference_idx = 0; reference_idx <= sorted_references.length; reference_idx++) {
      const current = costs[predicted_idx][reference_idx]
      if (!Number.isFinite(current)) continue
      if (
        predicted_idx < predicted.length &&
        current + unmatched_penalty < costs[predicted_idx + 1][reference_idx]
      ) {
        costs[predicted_idx + 1][reference_idx] = current + unmatched_penalty
        choices[predicted_idx + 1][reference_idx] = `skip_predicted`
      }
      if (
        reference_idx < sorted_references.length &&
        current + unmatched_penalty < costs[predicted_idx][reference_idx + 1]
      ) {
        costs[predicted_idx][reference_idx + 1] = current + unmatched_penalty
        choices[predicted_idx][reference_idx + 1] = `skip_reference`
      }
      if (predicted_idx < predicted.length && reference_idx < sorted_references.length) {
        const predicted_peak = result.peaks[predicted[predicted_idx].peak_idx]
        const reference_mode = sorted_references[reference_idx]
        const match_cost =
          current +
          Math.abs(predicted[predicted_idx].frequency - reference_mode.wavenumber_cm1) +
          activity_cost(predicted_peak, reference_mode, activity_penalty)
        if (match_cost < costs[predicted_idx + 1][reference_idx + 1]) {
          costs[predicted_idx + 1][reference_idx + 1] = match_cost
          choices[predicted_idx + 1][reference_idx + 1] = `match`
        }
      }
    }
  }
  const matches: BenchmarkMatch[] = []
  let predicted_idx = predicted.length
  let reference_idx = sorted_references.length
  while (predicted_idx > 0 || reference_idx > 0) {
    const choice = choices[predicted_idx][reference_idx]
    if (choice === `match`) {
      matches.push({
        predicted_peak_idx: predicted[predicted_idx - 1].peak_idx,
        reference_mode_id: sorted_references[reference_idx - 1].mode_id,
      })
      predicted_idx--
      reference_idx--
    } else if (choice === `skip_predicted`) predicted_idx--
    else if (choice === `skip_reference`) reference_idx--
    else throw new Error(`benchmark_spectroscopy: failed to reconstruct mode assignment`)
  }
  return [...label_matches, ...matches.toReversed()].toSorted(
    (left, right) => left.predicted_peak_idx - right.predicted_peak_idx,
  )
}

// Compare detected trajectory peaks with a curated reference while retaining raw,
// shift-independent, and scaled metrics side by side.
export function benchmark_spectroscopy(
  result: TrajectorySpectroscopyResult,
  reference: VibrationalReferenceEntry,
  options: SpectroscopyBenchmarkOptions = {},
): SpectroscopyBenchmarkResult {
  const comparison = options.comparison ?? `absolute`
  if (!([`absolute`, `spacing`, `scaled`] as const).includes(comparison)) {
    throw new Error(`benchmark_spectroscopy: comparison '${comparison}' is not supported`)
  }
  const unmatched_penalty = options.unmatched_penalty_cm1 ?? 250
  if (!Number.isFinite(unmatched_penalty) || unmatched_penalty < 0) {
    throw new Error(`benchmark_spectroscopy: unmatched_penalty_cm1 must be finite and >= 0`)
  }
  const activity_penalty = options.activity_mismatch_penalty_cm1 ?? Number.POSITIVE_INFINITY
  if (Number.isNaN(activity_penalty) || activity_penalty < 0) {
    throw new Error(`benchmark_spectroscopy: activity_mismatch_penalty_cm1 must be >= 0`)
  }
  if (options.scale && options.fit_scale_mode_ids !== undefined) {
    throw new Error(
      `benchmark_spectroscopy: provide either scale or fit_scale_mode_ids, not both`,
    )
  }
  const matches =
    options.matches ??
    assign_modes(result, reference.modes, unmatched_penalty, activity_penalty)
  const reference_by_id = new SvelteMap(reference.modes.map((mode) => [mode.mode_id, mode]))
  const used_predicted = new SvelteSet<number>()
  const used_reference = new SvelteSet<string>()
  const base_rows = matches.map(({ predicted_peak_idx, reference_mode_id }) => {
    const peak = result.peaks[predicted_peak_idx]
    const mode = reference_by_id.get(reference_mode_id)
    if (!peak)
      throw new Error(
        `benchmark_spectroscopy: predicted peak ${predicted_peak_idx} does not exist`,
      )
    if (!mode)
      throw new Error(
        `benchmark_spectroscopy: reference mode '${reference_mode_id}' does not exist`,
      )
    if (used_predicted.has(predicted_peak_idx) || used_reference.has(reference_mode_id)) {
      throw new Error(`benchmark_spectroscopy: mode matching must be one-to-one`)
    }
    used_predicted.add(predicted_peak_idx)
    used_reference.add(reference_mode_id)
    return {
      predicted_peak_idx,
      reference_mode_id,
      predicted_cm1: frequency_to_cm1(peak.frequency, result.frequency_unit),
      reference_cm1: mode.wavenumber_cm1,
      peak,
      mode,
    }
  })
  let scale = options.scale
  if (!scale && options.fit_scale_mode_ids) {
    const calibration_ids = new SvelteSet(options.fit_scale_mode_ids)
    const matched_ids = new SvelteSet(
      base_rows.map(({ reference_mode_id }) => reference_mode_id),
    )
    const missing_ids = [...calibration_ids].filter((mode_id) => !matched_ids.has(mode_id))
    if (missing_ids.length > 0) {
      throw new Error(
        `benchmark_spectroscopy: scale calibration modes are unmatched or unknown: ${missing_ids.join(`, `)}`,
      )
    }
    const calibration = base_rows.filter(({ reference_mode_id }) =>
      calibration_ids.has(reference_mode_id),
    )
    if (calibration.length === 0)
      throw new Error(`benchmark_spectroscopy: scale calibration subset is empty`)
    const numerator = calibration.reduce(
      (total, row) => total + row.predicted_cm1 * row.reference_cm1,
      0,
    )
    const denominator = calibration.reduce(
      (total, row) => total + row.predicted_cm1 * row.predicted_cm1,
      0,
    )
    scale = {
      factor: numerator / denominator,
      source: `least-squares fit through origin`,
      fitted_mode_ids: calibration.map(({ reference_mode_id }) => reference_mode_id),
    }
  }
  scale ??= { factor: 1, source: `identity (unscaled)` }
  if (!(scale.factor > 0) || !Number.isFinite(scale.factor) || !scale.source.trim()) {
    throw new Error(`benchmark_spectroscopy: scale needs a positive finite factor and source`)
  }
  const raw_errors = base_rows.map((row) => row.predicted_cm1 - row.reference_cm1)
  const absolute = metrics(
    raw_errors,
    base_rows.map(({ reference_cm1 }) => reference_cm1),
  )
  const spacing_shift = absolute?.mean_signed_error_cm1 ?? 0
  const selected_raman = result.raman
    ? (result.raman[result.raman.selected_channel] ?? null)
    : null
  const resolution_cm1 = Math.max(
    frequency_to_cm1(result.vdos.rayleigh_resolution, result.frequency_unit),
    result.ir ? frequency_to_cm1(result.ir.rayleigh_resolution, result.frequency_unit) : 0,
    selected_raman
      ? frequency_to_cm1(selected_raman.rayleigh_resolution, result.frequency_unit)
      : 0,
  )
  const rows: BenchmarkModeResult[] = base_rows.map((row, row_idx) => {
    const ir_comparable =
      row.peak.ir_activity !== `unknown` && row.mode.ir_activity !== `unknown`
    const raman_comparable =
      row.peak.raman_activity !== `unknown` && row.mode.raman_activity !== `unknown`
    const scaled_cm1 = row.predicted_cm1 * scale.factor
    return {
      predicted_peak_idx: row.predicted_peak_idx,
      reference_mode_id: row.reference_mode_id,
      predicted_cm1: row.predicted_cm1,
      reference_cm1: row.reference_cm1,
      raw_error_cm1: raw_errors[row_idx],
      spacing_error_cm1: raw_errors[row_idx] - spacing_shift,
      scaled_cm1,
      scaled_error_cm1: scaled_cm1 - row.reference_cm1,
      resolution_cm1,
      ir_activity_matches: ir_comparable
        ? row.peak.ir_activity === row.mode.ir_activity
        : null,
      raman_activity_matches: raman_comparable
        ? row.peak.raman_activity === row.mode.raman_activity
        : null,
    }
  })
  const scaled = metrics(
    rows.map(({ scaled_error_cm1 }) => scaled_error_cm1),
    rows.map(({ reference_cm1 }) => reference_cm1),
  )
  const activity_summary = (
    channel: `ir_activity` | `raman_activity`,
  ): ActivityConfusionCounts => {
    const counts: ActivityConfusionCounts = {
      correct: 0,
      compared: 0,
      true_active: 0,
      false_active: 0,
      true_inactive: 0,
      false_inactive: 0,
    }
    for (const { peak, mode } of base_rows) {
      const predicted = peak[channel]
      const expected = mode[channel]
      if (predicted === `unknown` || expected === `unknown`) continue
      counts.compared++
      if (predicted === expected) counts.correct++
      if (predicted === `active` && expected === `active`) counts.true_active++
      else if (predicted === `active`) counts.false_active++
      else if (expected === `inactive`) counts.true_inactive++
      else counts.false_inactive++
    }
    return counts
  }
  const fitted_ids = new SvelteSet(scale.fitted_mode_ids ?? [])
  return {
    reference_id: reference.id,
    comparison,
    matches: rows,
    unmatched_predicted_peak_indices: result.peaks
      .map((_, idx) => idx)
      .filter((idx) => !used_predicted.has(idx)),
    unmatched_reference_mode_ids: reference.modes
      .map(({ mode_id }) => mode_id)
      .filter((mode_id) => !used_reference.has(mode_id)),
    absolute,
    spacing_mae_cm1:
      rows.length > 0
        ? rows.reduce((total, row) => total + Math.abs(row.spacing_error_cm1), 0) / rows.length
        : null,
    scaled,
    scale,
    scale_is_in_sample: rows.some(({ reference_mode_id }) =>
      fitted_ids.has(reference_mode_id),
    ),
    ir_activity: activity_summary(`ir_activity`),
    raman_activity: activity_summary(`raman_activity`),
  }
}
