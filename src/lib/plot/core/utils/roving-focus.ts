import type { SelectedMark } from '#lib/plot/core/types'

export const roving_key = (series_idx: number, mark_idx: number): string =>
  `${series_idx}:${mark_idx}`

// A chart's `selection` as roving keys: a Set, as the membership test runs per drawn mark
export const mark_keys = (marks: readonly SelectedMark[]): Set<string> =>
  new Set(marks.map(({ series_idx, point_idx }) => roving_key(series_idx, point_idx)))
