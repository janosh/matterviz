// Tests for ConvexHullControls category filter toggles (magnetic orderings by default)
import ConvexHullControls from '$lib/convex-hull/ConvexHullControls.svelte'
import { default_controls } from '$lib/convex-hull/index'
import type { ConvexHullEntry } from '$lib/convex-hull/types'
import type { ComponentProps } from 'svelte'
import { flushSync, mount } from 'svelte'
import { beforeEach, describe, expect, test } from 'vitest'

const mag = (magnetic_ordering?: string): ConvexHullEntry => ({
  composition: { Fe: 1, O: 1 },
  energy: -1,
  x: 0.5,
  y: -0.5,
  z: 0,
  is_element: false,
  magnetic_ordering,
})

const mount_controls = (props: Partial<ComponentProps<typeof ConvexHullControls>> = {}) =>
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
const press = (toggle: HTMLElement, key: string): KeyboardEvent => {
  const event = new KeyboardEvent(`keydown`, { key, bubbles: true, cancelable: true })
  toggle.dispatchEvent(event)
  flushSync()
  return event
}

describe(`ConvexHullControls category filters (magnetic default)`, () => {
  beforeEach(() => {
    document.body.innerHTML = ``
  })

  test(`hides category row when no entry has magnetic ordering data`, () => {
    mount_controls({ stable_entries: [mag()], unstable_entries: [mag()] })
    expect(document.querySelector(`.category-filters`)).toBeNull()
    expect(document.body.textContent).not.toContain(`Magnetic`)
  })

  test(`shows one toggle per ordering in data with counts, swatches, initial hidden state`, () => {
    mount_controls({
      stable_entries: [mag(`FM`), mag(`AFM`)],
      unstable_entries: [mag(`FM`), mag()], // ordering-less entry -> no toggle
      hidden_categories: [`AFM`], // initially hidden -> inactive + 0/total count
    })
    const toggles = magnetic_toggles()
    expect(toggles.map((toggle) => toggle.textContent?.trim())).toEqual([
      `FM (2)`,
      `AFM (0/1)`,
    ])
    expect(toggles.map((toggle) => toggle.classList.contains(`active`))).toEqual([true, false])
    // Each toggle renders a non-empty SVG shape swatch (d3 paths start with M). NB: don't
    // assert via toBeTruthy() -- oxlint rewrites it to toBe(true), failing on string|null
    for (const toggle of toggles) {
      expect(toggle.querySelector(`svg path`)?.getAttribute(`d`)).toMatch(/^M/)
    }
    // FiM/NM absent from data -> no toggles
    expect(document.body.textContent).not.toContain(`FiM`)
    expect(document.body.textContent).not.toContain(`NM`)
  })

  test(`clicking a toggle hides/shows that ordering`, () => {
    mount_controls({ stable_entries: [mag(`FM`), mag(`NM`)] })
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

  // preventDefault stops Space from scrolling the page on keyboard activation
  test.each([
    [`Enter`, true],
    [` `, true],
    [`a`, false],
  ])(`keydown '%s' on category toggle: toggled=%s`, (key, expect_toggled) => {
    mount_controls({ stable_entries: [mag(`FM`)] })
    const [fm_toggle] = magnetic_toggles()
    const event = press(fm_toggle, key)
    expect(event.defaultPrevented).toBe(expect_toggled)
    expect(fm_toggle.classList.contains(`inactive`)).toBe(expect_toggled)
  })

  test(`Space key also activates the stable/unstable legend toggles`, () => {
    mount_controls({ stable_entries: [mag()] })
    // Points row (stability mode) renders stable + unstable toggles outside .category-filters
    const stable_toggle = [...document.querySelectorAll<HTMLElement>(`.legend-item`)].find(
      (item) => item.textContent?.includes(`Stable`),
    )
    if (!stable_toggle) throw new Error(`Stable legend toggle not found`)
    expect(stable_toggle.getAttribute(`aria-pressed`)).toBe(`true`)
    const event = press(stable_toggle, ` `)
    expect(event.defaultPrevented).toBe(true)
    expect(stable_toggle.getAttribute(`aria-pressed`)).toBe(`false`)
  })
})
