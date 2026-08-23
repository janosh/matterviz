import type { PhaseHoverInfo, PhaseRegion } from '$lib/phase-diagram'

// Helper to create hover info for testing
export function create_hover_info(overrides: Partial<PhaseHoverInfo> = {}): PhaseHoverInfo {
  const default_region: PhaseRegion = {
    id: `liquid`,
    name: `Liquid`,
    vertices: [
      [0, 800],
      [1, 800],
      [1, 1000],
      [0, 1000],
    ],
  }
  return {
    region: default_region,
    composition: 0.5,
    temperature: 850,
    position: { x: 100, y: 100 },
    ...overrides,
  }
}
