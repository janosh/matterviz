// Tests for ConvexHullTooltip component
import ConvexHullTooltip from '$lib/convex-hull/ConvexHullTooltip.svelte'
import type { PolymorphStats } from '$lib/convex-hull/helpers'
import type { TooltipConfig } from '$lib/convex-hull/index'
import type { PhaseData } from '$lib/convex-hull/types'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

const mock_entry = (overrides: Partial<PhaseData> = {}): PhaseData => ({
  composition: { Fe: 1, O: 1 },
  energy: -10,
  e_form_per_atom: -0.5,
  e_above_hull: 0.1,
  ...overrides,
})

type TooltipProps = {
  entry: PhaseData
  polymorph_stats_map?: Map<string, PolymorphStats>
  highlight_style?: { color?: string }
  show_fractional?: boolean
  tooltip?: TooltipConfig<PhaseData>
}

const mount_tooltip = (props: Partial<TooltipProps> = {}) =>
  mount(ConvexHullTooltip, {
    target: document.body,
    props: { entry: mock_entry(), ...props },
  })

describe(`ConvexHullTooltip`, () => {
  test(`renders container with expected structure`, () => {
    mount_tooltip()
    expect(doc_query(`.tooltip-content`)).toBeTruthy()
    expect(doc_query(`.tooltip-title`)).toBeTruthy()
  })

  test.each([
    { e_above_hull: 0.123, e_form_per_atom: -0.567, expected: [`0.123`, `−0.567`] },
    { e_above_hull: 0, e_form_per_atom: 0, expected: [`0 eV/atom`] },
    { e_above_hull: undefined, e_form_per_atom: undefined, expected: [`0 eV/atom`] },
  ])(
    `displays energy values: $expected`,
    ({ e_above_hull, e_form_per_atom, expected }) => {
      mount_tooltip({ entry: mock_entry({ e_above_hull, e_form_per_atom }) })
      const text = document.body.textContent ?? ``
      for (const val of expected) expect(text).toContain(val)
    },
  )

  describe(`entry identification`, () => {
    test(`displays entry_id when available`, () => {
      mount_tooltip({ entry: mock_entry({ entry_id: `mp-12345` }) })
      expect(document.body.textContent).toContain(`mp-12345`)
    })

    test(`displays both entry_id and formula for non-unary entries`, () => {
      mount_tooltip({
        entry: mock_entry({ entry_id: `mp-12345`, composition: { Fe: 1, O: 2 } }),
      })
      expect(document.body.textContent).toContain(`mp-12345`)
      expect(document.body.innerHTML).toMatch(/Fe.*O/)
    })

    test(`displays formula when entry_id is not available`, () => {
      mount_tooltip({
        entry: mock_entry({ entry_id: undefined, composition: { Li: 2, O: 1 } }),
      })
      expect(document.body.innerHTML).toMatch(/Li.*O/)
    })

    test.each([
      // Element name only shown in parentheses after entry_id for unary entries
      { composition: { Fe: 1 }, entry_id: undefined, expect_name: false },
      { composition: { Fe: 1 }, entry_id: `mp-13`, expect_name: true },
      { composition: { Fe: 1, O: 2 }, entry_id: `mp-14`, expect_name: false },
    ])(
      `element name for $composition with entry_id=$entry_id`,
      ({ composition, entry_id, expect_name }) => {
        mount_tooltip({ entry: mock_entry({ composition, entry_id }) })
        const text = document.body.textContent ?? ``
        if (expect_name) expect(text).toContain(`Iron`)
        else expect(text).not.toContain(`Iron`)
      },
    )
  })

  describe(`highlight badge`, () => {
    test(`shows badge with color when highlight_style provided`, () => {
      mount_tooltip({ highlight_style: { color: `#00ff00` } })
      expect(doc_query(`.highlight-badge`).textContent).toContain(`★ Highlighted`)
      expect(doc_query(`.tooltip-content`).style.getPropertyValue(`--highlight-color`))
        .toBe(`#00ff00`)
    })

    test(`hides badge without highlight_style`, () => {
      mount_tooltip()
      expect(document.querySelector(`.highlight-badge`)).toBeNull()
    })
  })

  describe(`fractional composition`, () => {
    test(`displays with subscripts for binary+ entries`, () => {
      mount_tooltip({ entry: mock_entry({ composition: { Fe: 1, O: 2 } }) })
      const html = document.body.innerHTML
      expect(html).toContain(`Fractional:`)
      expect(html).toMatch(/Fe<sub>0\.33<\/sub>/)
      expect(html).toMatch(/O<sub>0\.67<\/sub>/)
    })

    test(`uses plain decimals not unicode fractions`, () => {
      mount_tooltip({ entry: mock_entry({ composition: { Li: 1, Fe: 1 } }) })
      const html = document.body.innerHTML
      expect(html).toContain(`0.5`)
      expect(html).not.toMatch(/[½⅓⅔]/)
    })

    test.each([
      { desc: `unary entry`, composition: { Fe: 1 }, show_fractional: true },
      {
        desc: `show_fractional=false`,
        composition: { Fe: 1, O: 2 },
        show_fractional: false,
      },
    ])(`hides fractional for $desc`, ({ composition, show_fractional }) => {
      mount_tooltip({ entry: mock_entry({ composition }), show_fractional })
      expect(document.body.textContent).not.toContain(`Fractional:`)
    })

    test(`filters out zero-amount elements`, () => {
      mount_tooltip({ entry: mock_entry({ composition: { Fe: 1, O: 2, Li: 0 } }) })
      const fractional = (document.body.textContent ?? ``).split(`Fractional:`)[1] ?? ``
      expect(fractional).toContain(`Fe`)
      expect(fractional).not.toContain(`Li`)
    })
  })

  describe(`polymorph stats`, () => {
    const make_stats = (entry_id: string, stats: PolymorphStats) =>
      new Map([[entry_id, stats]])

    test(`displays stats with arrows and titles`, () => {
      mount_tooltip({
        entry: mock_entry({ entry_id: `mp-123` }),
        polymorph_stats_map: make_stats(`mp-123`, {
          total: 5,
          higher: 2,
          lower: 1,
          equal: 2,
        }),
      })
      const text = document.body.textContent ?? ``
      expect(text).toContain(`Polymorphs:`)
      expect(text).toContain(`↑2`)
      expect(text).toContain(`↓1`)
      expect(text).toContain(`=2`)
      expect(document.querySelector(`[title="2 higher in energy"]`)).toBeTruthy()
      expect(document.querySelector(`[title="1 lower in energy"]`)).toBeTruthy()
    })

    test(`hides equal count when zero`, () => {
      mount_tooltip({
        entry: mock_entry({ entry_id: `mp-456` }),
        polymorph_stats_map: make_stats(`mp-456`, {
          total: 3,
          higher: 2,
          lower: 1,
          equal: 0,
        }),
      })
      expect(document.body.textContent).not.toContain(`=0`)
    })

    test(`hides arrows when total=0`, () => {
      mount_tooltip({
        entry: mock_entry({ entry_id: `mp-789` }),
        polymorph_stats_map: make_stats(`mp-789`, {
          total: 0,
          higher: 0,
          lower: 0,
          equal: 0,
        }),
      })
      const text = document.body.textContent ?? ``
      expect(text).toContain(`Polymorphs:`)
      expect(text).not.toMatch(/[↑↓]/)
    })

    test.each([
      { desc: `no stats_map`, stats_map: undefined },
      {
        desc: `entry not in map`,
        stats_map: make_stats(`mp-other`, { total: 5, higher: 2, lower: 1, equal: 2 }),
      },
    ])(`hides section when $desc`, ({ stats_map }) => {
      mount_tooltip({
        entry: mock_entry({ entry_id: `mp-123` }),
        polymorph_stats_map: stats_map,
      })
      expect(document.body.textContent).not.toContain(`Polymorphs:`)
    })
  })

  describe(`custom tooltip config`, () => {
    test(`renders prefix_html as static string`, () => {
      mount_tooltip({
        tooltip: { prefix: `<em>Custom prefix</em>` },
      })
      expect(document.body.innerHTML).toContain(`<em>Custom prefix</em>`)
      expect(doc_query(`.tooltip-prefix`)).toBeTruthy()
    })

    test(`renders suffix_html as static string`, () => {
      mount_tooltip({
        tooltip: { suffix: `<strong>Custom suffix</strong>` },
      })
      expect(document.body.innerHTML).toContain(`<strong>Custom suffix</strong>`)
      expect(doc_query(`.tooltip-suffix`)).toBeTruthy()
    })

    test(`renders prefix as function with entry`, () => {
      mount_tooltip({
        entry: mock_entry({ entry_id: `mp-999` }),
        tooltip: { prefix: (entry) => `ID: ${entry.entry_id}` },
      })
      expect(document.body.textContent).toContain(`ID: mp-999`)
    })

    test(`renders suffix as function with entry`, () => {
      mount_tooltip({
        entry: mock_entry({ e_above_hull: 0.05 }),
        tooltip: { suffix: (entry) => `Hull dist: ${entry.e_above_hull}` },
      })
      expect(document.body.textContent).toContain(`Hull dist: 0.05`)
    })

    test(`renders both prefix and suffix together`, () => {
      mount_tooltip({
        tooltip: { prefix: `PREFIX`, suffix: `SUFFIX` },
      })
      const text = document.body.textContent ?? ``
      expect(text).toContain(`PREFIX`)
      expect(text).toContain(`SUFFIX`)
      // Verify ordering: prefix before content, suffix after
      const prefix_idx = text.indexOf(`PREFIX`)
      const suffix_idx = text.indexOf(`SUFFIX`)
      const hull_idx = text.indexOf(`above hull`)
      expect(prefix_idx).toBeLessThan(hull_idx)
      expect(suffix_idx).toBeGreaterThan(hull_idx)
    })
  })
})
