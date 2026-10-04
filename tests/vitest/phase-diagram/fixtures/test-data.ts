import type { Vec2 } from '#lib/math.js'
import type { PhaseHoverInfo } from '#lib/phase-diagram/index.js'

// Vec2 vertices from a flat [x0, y0, x1, y1, ...] list, so polygons stay on one line
export const pts = (...flat: number[]): Vec2[] =>
  Array.from({ length: flat.length / 2 }, (_, idx): Vec2 => [flat[2 * idx], flat[2 * idx + 1]])
export const rect = (x_lo: number, y_lo: number, x_hi: number, y_hi: number): Vec2[] =>
  pts(x_lo, y_lo, x_hi, y_lo, x_hi, y_hi, x_lo, y_hi)

export const create_hover_info = (
  overrides: Partial<PhaseHoverInfo> = {},
): PhaseHoverInfo => ({
  region: { id: `liquid`, name: `Liquid`, vertices: rect(0, 800, 1, 1000) },
  composition: 0.5,
  temperature: 850,
  position: { x: 100, y: 100 },
  ...overrides,
})
