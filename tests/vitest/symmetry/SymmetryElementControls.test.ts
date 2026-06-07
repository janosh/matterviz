// Tests for the per-kind symmetry-element visibility toggles (legend + checkboxes)
import type { ShowSymmetryKinds, SymmetryElement } from '$lib/symmetry'
import {
  count_symmetry_elements,
  DEFAULT_SHOW_SYM_KINDS,
  has_visible_symmetry_overlay,
  SYM_ELEM_KIND_INFO,
  SYM_ELEM_KINDS,
  SymmetryElementControls,
} from '$lib/symmetry'
import { flushSync, mount } from 'svelte'
import { describe, expect, test } from 'vitest'

const make_elem = (
  kind: SymmetryElement[`kind`],
  overrides: Partial<SymmetryElement> = {},
): SymmetryElement => ({
  kind,
  order: kind === `inversion` ? 1 : 2,
  label: kind === `inversion` ? `-1` : `2`,
  axis: kind === `inversion` ? null : [0, 0, 1],
  point: [0, 0, 0],
  translation: null,
  ...overrides,
})

const SAMPLE_ELEMENTS: SymmetryElement[] = [
  make_elem(`rotation`),
  make_elem(`rotation`, { point: [0.5, 0.5, 0] }),
  make_elem(`mirror`),
  make_elem(`glide`, { label: `a`, translation: [0.5, 0, 0] }),
  make_elem(`inversion`),
  make_elem(`inversion`, { point: [0.5, 0.5, 0.5] }),
  make_elem(`inversion`, { point: [0.5, 0, 0] }),
]

describe(`count_symmetry_elements`, () => {
  test(`tallies per kind and omits absent kinds`, () => {
    const counts = count_symmetry_elements(SAMPLE_ELEMENTS)
    expect(counts).toEqual({ rotation: 2, mirror: 1, glide: 1, inversion: 3 })
    expect(counts.screw).toBeUndefined()
    expect(counts.rotoinversion).toBeUndefined()
  })

  test(`empty input gives empty record`, () => {
    expect(count_symmetry_elements([])).toEqual({})
  })
})

describe(`has_visible_symmetry_overlay`, () => {
  const inversion_only = [make_elem(`inversion`)]
  test.each([
    // [label, elements, show_kinds, expected]
    [`no elements`, [], { rotation: true }, false],
    [`rotation present + enabled`, SAMPLE_ELEMENTS, { rotation: true }, true],
    // regression: enabled kind absent from elements must NOT count as visible
    [`rotation-only default on inversion-only cell`, inversion_only, undefined, false],
    [`inversion present + enabled`, inversion_only, { inversion: true }, true],
    [`present kind but all toggles off`, SAMPLE_ELEMENTS, {}, false],
    [`enabled kind not present`, inversion_only, { mirror: true }, false],
  ] as const)(`%s`, (_label, elements, show_kinds, expected) => {
    expect(has_visible_symmetry_overlay(elements, show_kinds)).toBe(expected)
  })

  test(`defaults to rotation-only when show_kinds omitted`, () => {
    expect(has_visible_symmetry_overlay(SAMPLE_ELEMENTS)).toBe(true) // has rotations
    expect(has_visible_symmetry_overlay([make_elem(`mirror`)])).toBe(false)
  })
})

describe(`DEFAULT_SHOW_SYM_KINDS`, () => {
  test(`shows exactly one kind by default (rotation axes) to avoid overplotting`, () => {
    const enabled = SYM_ELEM_KINDS.filter((kind) => DEFAULT_SHOW_SYM_KINDS[kind])
    expect(enabled).toEqual([`rotation`])
  })
})

describe(`SYM_ELEM_KIND_INFO`, () => {
  test(`covers every kind with label and color`, () => {
    for (const kind of SYM_ELEM_KINDS) {
      expect(SYM_ELEM_KIND_INFO[kind].label.length).toBeGreaterThan(0)
      expect(SYM_ELEM_KIND_INFO[kind].color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

describe(`SymmetryElementControls`, () => {
  test(`renders one checkbox per PRESENT kind with counts, in display order`, () => {
    document.body.innerHTML = ``
    mount(SymmetryElementControls, {
      target: document.body,
      props: { elements: SAMPLE_ELEMENTS },
    })
    flushSync()
    const labels = [...document.body.querySelectorAll(`label`)]
    expect(labels.map((lbl) => lbl.textContent?.trim())).toEqual([
      `rotation axes (2)`,
      `mirror planes (1)`,
      `glide planes (1)`,
      `inversion centers (3)`,
    ])
  })

  test(`default state checks only rotation axes`, () => {
    document.body.innerHTML = ``
    mount(SymmetryElementControls, {
      target: document.body,
      props: { elements: SAMPLE_ELEMENTS },
    })
    flushSync()
    const checked = [...document.body.querySelectorAll(`input`)].map((inp) => inp.checked)
    expect(checked).toEqual([true, false, false, false])
  })

  test(`toggling a checkbox updates the bound show_kinds (reassigned, not mutated)`, () => {
    document.body.innerHTML = ``
    const initial: ShowSymmetryKinds = { rotation: true }
    let bound = initial
    mount(SymmetryElementControls, {
      target: document.body,
      props: {
        elements: SAMPLE_ELEMENTS,
        get show_kinds() {
          return bound
        },
        set show_kinds(val: ShowSymmetryKinds) {
          bound = val
        },
      },
    })
    flushSync()
    const mirror_checkbox = [...document.body.querySelectorAll(`input`)][1]
    mirror_checkbox.click()
    flushSync()
    expect(bound).toEqual({ rotation: true, mirror: true })
    expect(bound).not.toBe(initial) // new object so reactive parents update
  })

  test(`renders nothing for empty elements`, () => {
    document.body.innerHTML = ``
    mount(SymmetryElementControls, { target: document.body, props: { elements: [] } })
    flushSync()
    expect(document.body.querySelector(`.sym-elem-controls`)).toBeNull()
  })
})
