// Shared axis defaults across plot components (single source of truth)
export const AXIS_DEFAULTS = {
  format: ``,
  scale_type: `linear` as const,
  ticks: 5,
  label_shift: { x: 0, y: 0 },
  tick: { label: { shift: { x: 0, y: 0 }, inside: false } },
  range: [null, null] as [number | null, number | null],
}
