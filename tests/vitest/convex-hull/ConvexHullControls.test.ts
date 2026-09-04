import ConvexHullControls from '$lib/convex-hull/ConvexHullControls.svelte'
import { hull_style_css } from '$lib/convex-hull/helpers'
import { default_controls } from '$lib/convex-hull/index'
import type { ConvexHullEntry } from '$lib/convex-hull/types'
import { flushSync, mount, type ComponentProps } from 'svelte'
import { describe, expect, test } from 'vitest'
import { bind_props, doc_query } from '../setup'

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

  // camera rows are data-driven per dimensionality: ternary tilts in degrees, quaternary in radians
  test.each([
    [
      { elevation: 30.4, azimuth: -15.6, zoom: 1, center_x: 0, center_y: 0 },
      `Elev°|30|5|false;Azim°|-16|15|false`,
      `elevation`,
    ],
    [
      { rotation_x: 0.456, rotation_y: -0.123, zoom: 1, center_x: 0, center_y: 0 },
      `φ|0.46|0.1|true;θ|-0.12|0.1|false`,
      `rotation_x`,
    ],
  ] as const)(`camera rows render and write back`, (camera, expected, key) => {
    const state = { ...camera }
    mount_controls({ camera: state })
    const camera_row = [...document.querySelectorAll<HTMLElement>(`.setting`)].find(
      (row) => row.querySelector(`.control-label`)?.textContent === `Camera`,
    )
    const inputs = [...(camera_row?.querySelectorAll<HTMLInputElement>(`input`) ?? [])]
    expect(
      inputs
        .map((input) =>
          [
            input.closest(`label`)?.textContent?.replaceAll(/\s/g, ``),
            input.value,
            input.step,
            input.hasAttribute(`min`),
          ].join(`|`),
        )
        .join(`;`),
    ).toBe(expected)
    const [first_input] = inputs
    if (!first_input) throw new Error(`missing ${expected.split(`|`)[0]} camera input`)
    first_input.value = `12`
    first_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    expect(state).toMatchObject({ [key]: 12 })
    first_input.value = ``
    first_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    expect(state).toMatchObject({ [key]: 12 })
  })

  test(`legend swatches read the CSS vars that hull_style_css defines on the wrapper`, () => {
    // Same wiring as the hull components: hull_style_css goes on the wrapper, the controls
    // render inside it, so each swatch must pick up its colour through the inherited var
    const wrapper = document.createElement(`div`)
    wrapper.setAttribute(`style`, hull_style_css({ stable: `#111`, unstable: `#222` }))
    document.body.append(wrapper)
    mount(ConvexHullControls, {
      target: wrapper,
      props: {
        controls_open: true,
        stable_entries: [mag()],
        unstable_entries: [mag()],
        merged_controls: default_controls,
      },
    })
    const swatch_background = (kind: string) =>
      getComputedStyle(doc_query(`.marker.${kind}`)).background
    expect(swatch_background(`stable`)).toBe(`#111`)
    expect(swatch_background(`unstable`)).toBe(`#222`)
  })

  test(`legend toggles and threshold inputs preserve valid display settings`, () => {
    const state = { max_hull_dist_show_phases: 0.1 }
    mount(ConvexHullControls, {
      target: document.body,
      props: bind_props(
        {
          controls_open: true,
          stable_entries: [mag()],
          unstable_entries: [mag(), mag()],
          merged_controls: default_controls,
        },
        state,
      ),
    })
    // Points row (stability mode) renders stable + unstable toggles outside .category-filters
    const point_toggles = [...document.querySelectorAll<HTMLElement>(`.legend-item`)]
    const labels = () => point_toggles.map((item) => item.textContent?.trim())
    expect(labels()).toEqual([`Stable (1)`, `Above hull (2/2)`])
    expect(
      [`stable`, `unstable`].map((marker, idx) =>
        point_toggles[idx].querySelector(`.marker`)?.classList.contains(marker),
      ),
    ).toEqual([true, true])
    const [stable_toggle, unstable_toggle] = point_toggles
    expect(stable_toggle.getAttribute(`aria-pressed`)).toBe(`true`)
    const event = press(stable_toggle, ` `)
    expect(event.defaultPrevented).toBe(true)
    expect(stable_toggle.getAttribute(`aria-pressed`)).toBe(`false`)
    unstable_toggle.click()
    flushSync()
    // hidden stable keeps its total, hidden unstable shows 0/total
    expect(labels()).toEqual([`Stable (1)`, `Above hull (0/2)`])

    const threshold = doc_query<HTMLInputElement>(
      `input[aria-label="Points threshold (eV/atom)"][type="number"]`,
    )
    for (const [draft, committed] of [
      [`0.2`, 0.2],
      [``, 0.2],
      [`-1`, 0.2],
      [`0.6`, 0.2],
      [`0`, 0],
    ] as const) {
      threshold.value = draft
      threshold.dispatchEvent(new Event(`input`, { bubbles: true }))
      flushSync()
      expect(state.max_hull_dist_show_phases).toBe(committed)
      threshold.dispatchEvent(new Event(`change`, { bubbles: true }))
      flushSync()
      expect(threshold.value).toBe(String(committed))
    }
  })

  test(`face color buttons follow hull_face_color_mode and show the swatch only for uniform`, () => {
    const buttons = () => [
      ...document.querySelectorAll<HTMLButtonElement>(`.face-color-mode-buttons button`),
    ]
    const swatch = () => document.querySelector(`input[type="color"]`)
    mount_controls({ show_hull_faces: true, hull_face_color_mode: `dominant_element` })
    expect(
      buttons().map((btn) => [btn.textContent?.trim(), btn.classList.contains(`active`)]),
    ).toEqual([
      [`Uniform`, false],
      [`Energy`, false],
      [`Element`, true],
      [`Index`, false],
    ])
    expect(swatch()).toBeNull()
    buttons()[0].click()
    flushSync()
    expect(buttons().map((btn) => btn.classList.contains(`active`))).toEqual([
      true,
      false,
      false,
      false,
    ])
    expect(swatch()).not.toBeNull()
  })

  test(`color mode buttons swap the Points legend for the color scale picker`, () => {
    mount_controls({ stable_entries: [mag()] })
    const mode_button = (text: string) =>
      [...document.querySelectorAll<HTMLButtonElement>(`.toggle-btn`)].find(
        (btn) => btn.textContent?.trim() === text,
      )
    expect(mode_button(`Stability`)?.classList.contains(`active`)).toBe(true)
    expect(document.querySelector(`.color-scale-row`)).toBeNull()
    mode_button(`Energy`)?.click()
    flushSync()
    expect(mode_button(`Energy`)?.classList.contains(`active`)).toBe(true)
    expect(document.querySelector(`.color-scale-row`)).not.toBeNull()
    expect(document.querySelector(`.legend-item`)).toBeNull()
  })
})
