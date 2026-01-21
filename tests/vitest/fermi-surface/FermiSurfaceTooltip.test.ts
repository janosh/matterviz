// Tests for FermiSurfaceTooltip component
import FermiSurfaceTooltip from '$lib/fermi-surface/FermiSurfaceTooltip.svelte'
import type { FermiHoverData, FermiTooltipConfig } from '$lib/fermi-surface/types'
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
  test(`renders container with expected structure`, () => {
    mount_tooltip()
    expect(doc_query(`.tooltip-content`)).toBeTruthy()
    expect(doc_query(`.tooltip-title`)).toBeTruthy()
  })

  describe(`band index display`, () => {
    test.each([
      { band_index: 0, expected: `Band 0` },
      { band_index: 3, expected: `Band 3` },
      { band_index: 12, expected: `Band 12` },
    ])(`displays band index $band_index`, ({ band_index, expected }) => {
      mount_tooltip({ hover_data: mock_hover_data({ band_index }) })
      expect(document.body.textContent).toContain(expected)
    })
  })

  describe(`spin display`, () => {
    test.each([`up`, `down`] as const)(`shows spin %s badge`, (spin) => {
      mount_tooltip({ hover_data: mock_hover_data({ spin }) })
      expect(doc_query(`.spin-badge.spin-${spin}`)).toBeTruthy()
      expect(document.body.textContent).toContain(spin)
    })

    test(`hides spin badge when spin is null`, () => {
      mount_tooltip()
      expect(document.querySelector(`.spin-badge`)).toBeNull()
    })
  })

  describe(`coordinate display`, () => {
    test(`displays both Cartesian and fractional when available`, () => {
      mount_tooltip({
        hover_data: mock_hover_data({
          position_cartesian: [1.234, -0.567, 0.891],
          position_fractional: [0.25, -0.125, 0.375],
        }),
      })
      const text = document.body.textContent ?? ``
      expect(text).toContain(`k (Å⁻¹):`)
      expect(text).toContain(`k (frac):`)
      expect(text).toMatch(/1\.234/)
      expect(text).toMatch(/0\.25/)
      expect(document.querySelectorAll(`.coord-row`).length).toBe(2)
    })

    test(`hides fractional row when position_fractional is null`, () => {
      mount_tooltip({
        hover_data: mock_hover_data({ position_fractional: null }),
      })
      const text = document.body.textContent ?? ``
      expect(text).toContain(`k (Å⁻¹):`)
      expect(text).not.toContain(`k (frac):`)
      expect(document.querySelectorAll(`.coord-row`).length).toBe(1)
    })
  })

  describe(`property value display`, () => {
    test(`shows property value with name when available`, () => {
      mount_tooltip({
        hover_data: mock_hover_data({
          property_value: 1.5e6,
          property_name: `velocity`,
        }),
      })
      const text = document.body.textContent ?? ``
      expect(text).toContain(`velocity`)
      expect(text).toContain(`(nearest)`)
    })

    test(`uses default "Property" label when property_name is undefined`, () => {
      mount_tooltip({
        hover_data: mock_hover_data({
          property_value: 42.5,
          property_name: undefined,
        }),
      })
      expect(document.body.textContent).toContain(`Property`)
    })

    test.each([undefined, null])(
      `hides property row when property_value is %s`,
      (property_value) => {
        mount_tooltip({
          hover_data: mock_hover_data({
            property_value: property_value as number | undefined,
          }),
        })
        expect(document.body.textContent).not.toContain(`(nearest)`)
      },
    )
  })

  describe(`tiling info`, () => {
    test(`shows symmetry info when tiled and symmetry_index > 0`, () => {
      mount_tooltip({
        hover_data: mock_hover_data({ is_tiled: true, symmetry_index: 5 }),
      })
      expect(document.body.textContent).toContain(`Symmetry copy #6/48`)
    })

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
      expect(document.body.innerHTML).toContain(html)
      expect(doc_query(class_name)).toBeTruthy()
    })

    test.each([
      {
        key: `prefix`,
        fn: (d: FermiHoverData) => `Band: ${d.band_index}`,
        expected: `Band: 5`,
      },
      {
        key: `suffix`,
        fn: (d: FermiHoverData) => `Spin: ${d.spin}`,
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
