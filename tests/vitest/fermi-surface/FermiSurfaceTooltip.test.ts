import { SPIN_COLORS } from '#lib/fermi-surface/constants.js'
import FermiSurfaceTooltip from '#lib/fermi-surface/FermiSurfaceTooltip.svelte'
import type { FermiHoverData, FermiTooltipProp } from '#lib/fermi-surface/types.js'
import type { Vec3 } from '#lib/math.js'
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
  props: { hover_data?: FermiHoverData; tooltip?: FermiTooltipProp } = {},
) =>
  mount(FermiSurfaceTooltip, {
    target: document.body,
    props: { hover_data: mock_hover_data(), ...props },
  })

describe(`FermiSurfaceTooltip`, () => {
  // band_index is 0-based; the title counts from 1 like the band structure and BXSF `BAND: n`
  test(`titles the tooltip with the 1-based band number`, () => {
    mount_tooltip({ hover_data: mock_hover_data({ band_index: 12 }) })
    expect(doc_query(`.tooltip-content .tooltip-title`).textContent).toContain(`Band 13`)
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
    expect(text).toContain(`k:`)
    // a real <sup>: fonts set the ⁻ glyph lower than the ¹
    expect(document.querySelector(`.k-coord-row small`)?.textContent).toBe(`Å−1`)
    expect(document.querySelector(`.k-coord-row small sup`)?.textContent).toBe(`−1`)
    expect(document.querySelector(`.k-coord-label`)?.textContent).not.toContain(`Å`)
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

  // the colouring property leads; the others follow, NaN (no value at the vertex) as n/a
  test(`lists the other properties at the vertex below the active one`, () => {
    // a parenthesised suffix is the unit, as in every TooltipValue label
    const property_values = { λ: 0.25, 'Δ (meV)': NaN, v: 3 }
    mount_tooltip({
      hover_data: mock_hover_data({
        property_value: 0.25,
        property_name: `λ`,
        property_values,
      }),
    })
    const text = document.body.textContent ?? ``
    expect(text.match(/λ/g)).toHaveLength(1) // not repeated among the others
    expect(text).toContain(`Δ: n/a meV`)
    expect(text).toContain(`v: 3`)
  })

  // only tiled copies past the identity (index 0) are labelled
  test.each([
    { is_tiled: true, symmetry_index: 5, n_symmetry_ops: 48, expected: `Symmetry copy #6/48` },
    {
      is_tiled: true,
      symmetry_index: 5,
      n_symmetry_ops: undefined,
      expected: `Symmetry copy #6`,
    },
    { is_tiled: false, symmetry_index: 5, n_symmetry_ops: 48, expected: null },
    { is_tiled: true, symmetry_index: 0, n_symmetry_ops: 48, expected: null },
    { is_tiled: true, symmetry_index: undefined, n_symmetry_ops: 48, expected: null },
  ])(
    `tiling info for is_tiled=$is_tiled index=$symmetry_index n_ops=$n_symmetry_ops`,
    ({ expected, ...tiling }) => {
      mount_tooltip({ hover_data: mock_hover_data(tiling) })
      const text = document.querySelector(`.tiling-info`)?.textContent?.trim() ?? null
      expect(text).toBe(expected)
    },
  )

  // TooltipContent's prefix/suffix contract is covered with ConvexHullTooltip; this checks the
  // wiring: functions get the hover data, prefix before the content and suffix after
  test(`custom prefix and suffix wrap the content`, () => {
    const prefix = (data: FermiHoverData) => `<em>Spin: ${data.spin}</em>`
    mount_tooltip({
      hover_data: mock_hover_data({ spin: `up` }),
      tooltip: { prefix, suffix: `END` },
    })
    expect(doc_query(`.tooltip-prefix`).innerHTML).toBe(`<em>Spin: up</em>`)
    const text = document.body.textContent ?? ``
    expect(text.indexOf(`Spin: up`)).toBeLessThan(text.indexOf(`Band`))
    expect(text.indexOf(`END`)).toBeGreaterThan(text.indexOf(`Band`))
  })
})
