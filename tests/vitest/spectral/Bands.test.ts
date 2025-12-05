import type { RibbonConfig } from '$lib/spectral/types'
import { describe, expect, it } from 'vitest'

// Mirrors get_ribbon_config logic in Bands.svelte
function get_ribbon_config(
  ribbon_config: RibbonConfig | Record<string, RibbonConfig>,
  label: string,
): RibbonConfig {
  const defaults: RibbonConfig = { opacity: 0.3, max_width: 6, scale: 1 }
  const cfg = ribbon_config as Record<string, unknown>
  const has_primitive = [`opacity`, `max_width`, `scale`, `color`].some(
    (key) => cfg[key] !== undefined && typeof cfg[key] !== `object`,
  )
  if (has_primitive) return { ...defaults, ...ribbon_config }
  return {
    ...defaults,
    ...((ribbon_config as Record<string, RibbonConfig>)[label] ?? {}),
  }
}

describe(`get_ribbon_config`, () => {
  it.each([
    { cfg: {}, label: `any`, expected: { opacity: 0.3, max_width: 6, scale: 1 } },
    {
      cfg: { opacity: 0.5 },
      label: `any`,
      expected: { opacity: 0.5, max_width: 6, scale: 1 },
    },
    {
      cfg: { A: { opacity: 0.4 } },
      label: `A`,
      expected: { opacity: 0.4, max_width: 6, scale: 1 },
    },
    {
      cfg: { A: { opacity: 0.4 } },
      label: `B`,
      expected: { opacity: 0.3, max_width: 6, scale: 1 },
    },
  ])(`$cfg for label "$label" → $expected`, ({ cfg, label, expected }) => {
    expect(get_ribbon_config(cfg, label)).toEqual(expected)
  })

  it(`distinguishes structure named "opacity" from opacity config value`, () => {
    // Bug case: { opacity: {...} } should be per-structure, not single config
    const per_struct = { opacity: { color: `red` }, scale: { color: `blue` } }
    expect(get_ribbon_config(per_struct, `opacity`).color).toBe(`red`)
    expect(get_ribbon_config(per_struct, `scale`).color).toBe(`blue`)
    // Single config has primitive value
    expect(get_ribbon_config({ opacity: 0.5 }, `any`).opacity).toBe(0.5)
  })
})
