// Tests for FermiSurfaceTooltip component
import { SPIN_COLORS } from '$lib/fermi-surface/constants'
import FermiSurfaceTooltip from '$lib/fermi-surface/FermiSurfaceTooltip.svelte'
import type { FermiHoverData, FermiTooltipConfig } from '$lib/fermi-surface/types'
import type { Vec3 } from '$lib/math'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

const mock_hover_data = (overrides: Partial<FermiHoverData> = {}): FermiHoverData => ({
  band_index: 0,
  spin: null,
  position_cartesian: [0.5, -0.3, 0.8],
  position_fractional: [0.1, -0.05, 0.15],
  screen_position: { x: 100, y: 200 },
  ...overrides,
})

const mount_tooltip = (
  props: { hover_data?: FermiHoverData; tooltip?: FermiTooltipConfig } = {},
) =>
  mount(FermiSurfaceTooltip, {
    target: document.body,
    props: { hover_data: mock_hover_data(), ...props },
  })

describe(`FermiSurfaceTooltip`, () => {
  test(`titles the tooltip with the band index`, () => {
    mount_tooltip({ hover_data: mock_hover_data({ band_index: 12 }) })
    expect(doc_query(`.tooltip-content .tooltip-title`).textContent).toContain(`Band 12`)
  })

  // the badge takes its colour from SPIN_COLORS, the same source as the surface tint
  test.each([`up`, `down`, null] as const)(`spin=%s badge`, (spin) => {
    mount_tooltip({ hover_data: mock_hover_data({ spin }) })
    if (spin === null) expect(document.querySelector(`.spin-badge`)).toBeNull()
    else {
      const badge = doc_query(`.spin-badge`)
      expect(badge.textContent?.trim()).toBe(spin)
      expect(badge.style.backgroundColor).toBe(SPIN_COLORS[spin])
    }
  })

  test.each([
    { position_fractional: [0.25, -0.125, 0.375] as Vec3, n_rows: 2 },
    { position_fractional: null, n_rows: 1 }, // fractional row hidden when the lattice inverse failed
  ])(`coordinate rows: fractional=$position_fractional`, ({ position_fractional, n_rows }) => {
    mount_tooltip({
      hover_data: mock_hover_data({
        position_cartesian: [1.234, -0.567, 0.891],
        position_fractional,
      }),
    })
    const text = document.body.textContent ?? ``
    expect(text).toContain(`k (Å⁻¹):`)
    expect(text).toMatch(/1\.23/)
    expect(text.includes(`k (frac):`)).toBe(n_rows === 2)
    if (n_rows === 2) expect(text).toMatch(/0\.25/)
    expect(document.querySelectorAll(`.k-coord-row`)).toHaveLength(n_rows)
  })

  test.each([
    { property_value: 1.5e6, property_name: `velocity`, expected: `velocity` },
    { property_value: 42.5, property_name: undefined, expected: `Property` }, // default label
    { property_value: undefined, property_name: undefined, expected: null },
    { property_value: null as unknown as undefined, property_name: undefined, expected: null },
  ])(
    `property row: value=$property_value name=$property_name`,
    ({ property_value, property_name, expected }) => {
      mount_tooltip({ hover_data: mock_hover_data({ property_value, property_name }) })
      const text = document.body.textContent ?? ``
      expect(text.includes(`(nearest)`)).toBe(expected !== null)
      if (expected) expect(text).toContain(expected)
    },
  )

  describe(`tiling info`, () => {
    test.each([
      { n_symmetry_ops: 48, expected: `Symmetry copy #6/48` },
      { n_symmetry_ops: undefined, expected: `Symmetry copy #6` },
    ])(
      `shows symmetry info when tiled and symmetry_index > 0 (n_ops=$n_symmetry_ops)`,
      ({ n_symmetry_ops, expected }) => {
        mount_tooltip({
          hover_data: mock_hover_data({ is_tiled: true, symmetry_index: 5, n_symmetry_ops }),
        })
        expect(document.body.textContent).toContain(expected)
        if (!n_symmetry_ops) expect(document.body.textContent).not.toContain(`#6/`)
      },
    )

    test.each([
      { is_tiled: false, symmetry_index: 5, reason: `not tiled` },
      { is_tiled: true, symmetry_index: 0, reason: `identity (index=0)` },
      { is_tiled: true, symmetry_index: undefined, reason: `undefined index` },
    ])(`hides tiling info when $reason`, ({ is_tiled, symmetry_index }) => {
      mount_tooltip({ hover_data: mock_hover_data({ is_tiled, symmetry_index }) })
      expect(document.body.textContent).not.toContain(`Symmetry`)
    })
  })

  describe(`custom tooltip config`, () => {
    test.each([
      { key: `prefix`, html: `<em>Header</em>`, class_name: `.tooltip-prefix` },
      { key: `suffix`, html: `<strong>Footer</strong>`, class_name: `.tooltip-suffix` },
    ])(`renders $key as static HTML`, ({ key, html, class_name }) => {
      mount_tooltip({ tooltip: { [key]: html } })
      expect(doc_query(class_name).innerHTML).toBe(html)
    })

    test.each([
      {
        key: `prefix`,
        fn: (data: FermiHoverData) => `Band: ${data.band_index}`,
        expected: `Band: 5`,
      },
      {
        key: `suffix`,
        fn: (data: FermiHoverData) => `Spin: ${data.spin}`,
        expected: `Spin: up`,
      },
    ])(`renders $key as function`, ({ key, fn, expected }) => {
      const hover_data = mock_hover_data({ band_index: 5, spin: `up` })
      mount_tooltip({ hover_data, tooltip: { [key]: fn } })
      expect(document.body.textContent).toContain(expected)
    })

    test(`prefix appears before content, suffix after`, () => {
      mount_tooltip({ tooltip: { prefix: `PREFIX`, suffix: `SUFFIX` } })
      const text = document.body.textContent ?? ``
      const prefix_idx = text.indexOf(`PREFIX`)
      const suffix_idx = text.indexOf(`SUFFIX`)
      const band_idx = text.indexOf(`Band`)
      expect(prefix_idx).toBeLessThan(band_idx)
      expect(suffix_idx).toBeGreaterThan(band_idx)
    })
  })
})
