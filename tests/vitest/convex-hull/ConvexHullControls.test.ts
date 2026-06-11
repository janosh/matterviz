// Tests for ConvexHullControls category filter toggles (magnetic orderings by default)
import ConvexHullControls from '$lib/convex-hull/ConvexHullControls.svelte'
import { default_controls } from '$lib/convex-hull/index'
import type { ConvexHullEntry, PhaseData } from '$lib/convex-hull/types'
import { flushSync, mount } from 'svelte'
import { beforeEach, describe, expect, test } from 'vitest'

const mock_entry = (overrides: Partial<PhaseData> = {}): ConvexHullEntry => ({
  composition: { Fe: 1, O: 1 },
  energy: -1,
  x: 0.5,
  y: -0.5,
  z: 0,
  is_element: false,
  ...overrides,
})

const mount_controls = (
  props: {
    stable_entries?: ConvexHullEntry[]
    unstable_entries?: ConvexHullEntry[]
    hidden_categories?: string[]
  } = {},
) =>
  mount(ConvexHullControls, {
    target: document.body,
    props: {
      controls_open: true,
      stable_entries: [],
      unstable_entries: [],
      merged_controls: default_controls,
      ...props,
    },
  })

const magnetic_toggles = () => [
  ...document.querySelectorAll<HTMLElement>(`.category-filters .legend-item`),
]

describe(`ConvexHullControls category filters (magnetic default)`, () => {
  beforeEach(() => {
    document.body.innerHTML = ``
  })

  test(`hides category row when no entry has magnetic ordering data`, () => {
    mount_controls({ stable_entries: [mock_entry()], unstable_entries: [mock_entry()] })
    expect(document.querySelector(`.category-filters`)).toBeNull()
    expect(document.body.textContent).not.toContain(`Magnetic`)
  })

  test(`shows one toggle per ordering present in data with counts and shape swatches`, () => {
    mount_controls({
      stable_entries: [
        mock_entry({ magnetic_ordering: `FM` }),
        mock_entry({ magnetic_ordering: `AFM` }),
      ],
      unstable_entries: [
        mock_entry({ magnetic_ordering: `FM` }),
        mock_entry(), // entry without ordering shouldn't produce a toggle
      ],
    })
    const toggles = magnetic_toggles()
    expect(toggles.map((toggle) => toggle.textContent?.trim())).toEqual([`FM (2)`, `AFM (1)`])
    // Each toggle renders a non-empty SVG marker shape swatch (d3 paths start with M).
    // NB: don't assert via toBeTruthy() -- oxlint auto-rewrites it to toBe(true), which
    // always fails against getAttribute's string|null return
    for (const toggle of toggles) {
      expect(toggle.querySelector(`svg path`)?.getAttribute(`d`)).toMatch(/^M/)
    }
    // FiM/NM absent from data -> no toggles
    expect(document.body.textContent).not.toContain(`FiM`)
    expect(document.body.textContent).not.toContain(`NM`)
  })

  test(`clicking a toggle hides/shows that ordering`, () => {
    mount_controls({
      stable_entries: [
        mock_entry({ magnetic_ordering: `FM` }),
        mock_entry({ magnetic_ordering: `NM` }),
      ],
    })
    const [fm_toggle] = magnetic_toggles()
    expect(fm_toggle.classList.contains(`active`)).toBe(true)
    expect(fm_toggle.getAttribute(`aria-pressed`)).toBe(`true`)
    expect(fm_toggle.textContent?.trim()).toBe(`FM (1)`)

    fm_toggle.click()
    flushSync()
    expect(fm_toggle.classList.contains(`inactive`)).toBe(true)
    expect(fm_toggle.getAttribute(`aria-pressed`)).toBe(`false`)
    expect(fm_toggle.textContent?.trim()).toBe(`FM (0/1)`) // hidden -> shown/total format

    fm_toggle.click()
    flushSync()
    expect(fm_toggle.classList.contains(`active`)).toBe(true)
    expect(fm_toggle.textContent?.trim()).toBe(`FM (1)`)
  })

  test.each([
    { key: `Enter`, expect_toggled: true },
    { key: ` `, expect_toggled: true }, // Space must toggle AND not scroll the page
    { key: `a`, expect_toggled: false },
  ])(
    `keydown '$key' on category toggle: toggled=$expect_toggled`,
    ({ key, expect_toggled }) => {
      mount_controls({ stable_entries: [mock_entry({ magnetic_ordering: `FM` })] })
      const [fm_toggle] = magnetic_toggles()
      const event = new KeyboardEvent(`keydown`, { key, bubbles: true, cancelable: true })
      fm_toggle.dispatchEvent(event)
      flushSync()
      // preventDefault stops Space from scrolling the page on keyboard activation
      expect(event.defaultPrevented).toBe(expect_toggled)
      expect(fm_toggle.classList.contains(`inactive`)).toBe(expect_toggled)
    },
  )

  test(`Space key also activates the stable/unstable legend toggles`, () => {
    mount_controls({ stable_entries: [mock_entry()] })
    // Points row (stability mode) renders stable + unstable toggles outside .category-filters
    const stable_toggle = [...document.querySelectorAll<HTMLElement>(`.legend-item`)].find(
      (item) => item.textContent?.includes(`Stable`),
    )
    if (!stable_toggle) throw new Error(`Stable legend toggle not found`)
    expect(stable_toggle.getAttribute(`aria-pressed`)).toBe(`true`)
    const event = new KeyboardEvent(`keydown`, { key: ` `, bubbles: true, cancelable: true })
    stable_toggle.dispatchEvent(event)
    flushSync()
    expect(event.defaultPrevented).toBe(true)
    expect(stable_toggle.getAttribute(`aria-pressed`)).toBe(`false`)
  })

  test(`initially hidden orderings render as inactive`, () => {
    mount_controls({
      stable_entries: [
        mock_entry({ magnetic_ordering: `FM` }),
        mock_entry({ magnetic_ordering: `AFM` }),
      ],
      hidden_categories: [`AFM`],
    })
    const [fm_toggle, afm_toggle] = magnetic_toggles()
    expect(fm_toggle.classList.contains(`active`)).toBe(true)
    expect(afm_toggle.classList.contains(`inactive`)).toBe(true)
  })
})
