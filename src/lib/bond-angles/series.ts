import { plot_color } from '$lib/colors'
import type { BarSeries } from '$lib/plot/core/types'
import type { BondAngleData } from './calc-bond-angles'
import type { BondAngleNormalizeMode, BondAngleSplitMode } from './index'

// All fields optional so the type stays mutually assignable with Record<string, unknown>,
// which BarPlot's snippet and handler props require. Readers fall back to the prop.
export type BondAngleMetadata = {
  triplet?: string
  structure_label?: string
  bin_width?: number
} & Record<string, unknown>

// In density mode each structure contributes a unit-area distribution, the only way cells
// with different atom counts are comparable. by_structure plots those distributions side by
// side; the merged modes (by_triplet, none) additionally average over structures so the union
// of the plotted series still integrates to 1 over degrees rather than to the structure count.
export function to_angle_bar_series(
  entries: readonly { label: string; color?: string; data: BondAngleData }[],
  split_mode: BondAngleSplitMode,
  normalize: BondAngleNormalizeMode,
): BarSeries<BondAngleMetadata>[] {
  if (entries.length === 0) return []
  // Every structure is binned with the same options, so one shared x axis
  const { bin_centers, bin_width } = entries[0].data
  const shared = { x: bin_centers, bar_width: bin_width, visible: true }
  const is_density = normalize === `density`
  const weight_of = ({ n_angles }: BondAngleData) =>
    is_density && n_angles > 0 ? 1 / (n_angles * bin_width) : 1

  if (split_mode === `by_structure`) {
    return entries.map((entry, idx) => ({
      ...shared,
      y: entry.data.total.counts.map((count) => count * weight_of(entry.data)),
      label: entry.label,
      color: entry.color ?? plot_color(idx),
      metadata: { structure_label: entry.label, bin_width },
    }))
  }

  // by_triplet keys on the triplet label, none on the single TOTAL_TRIPLET_LABEL series
  const merged = new Map<string, number[]>()
  for (const entry of entries) {
    const weight = weight_of(entry.data) * (is_density ? 1 / entries.length : 1)
    for (const { triplet, counts } of split_mode === `by_triplet`
      ? entry.data.by_triplet
      : [entry.data.total]) {
      let target = merged.get(triplet)
      if (!target) merged.set(triplet, (target = Array.from(bin_centers, () => 0)))
      for (const [bin_idx, count] of counts.entries()) target[bin_idx] += count * weight
    }
  }
  return Array.from(merged.entries())
    .toSorted(([label_a], [label_b]) => label_a.localeCompare(label_b))
    .map(([label, counts], idx) => ({
      ...shared,
      y: counts,
      label,
      color: plot_color(idx),
      metadata: { bin_width, ...(split_mode === `by_triplet` && { triplet: label }) },
    }))
}
