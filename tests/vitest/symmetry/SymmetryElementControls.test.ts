// Tests for the per-kind symmetry-element visibility toggles (legend + checkboxes)
import type { ShowSymmetryKinds, SymmetryElement } from '$lib/symmetry'
import {
  count_symmetry_elements,
  has_visible_symmetry_overlay,
  SYM_ELEM_COLORS,
  SYM_ELEM_KIND_INFO,
  SYM_ELEMENTS_INPUT_FRAME_NOTE,
  SymmetryElementControls,
} from '$lib/symmetry'
import { type ComponentProps, flushSync, mount } from 'svelte'
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
  locus: `${kind}|${String(overrides.point ?? [0, 0, 0])}`,
  ...overrides,
})

const SAMPLE_ELEMENTS: SymmetryElement[] = [
  make_elem(`rotation`),
  make_elem(`rotation`, { point: [0.5, 0.5, 0] }),
  make_elem(`screw`, { label: `2_1`, translation: [0, 0, 0.5] }),
  make_elem(`rotoinversion`, { order: 4, label: `-4` }),
  make_elem(`mirror`),
  make_elem(`glide`, { label: `a`, translation: [0.5, 0, 0] }),
  make_elem(`inversion`),
  make_elem(`inversion`, { point: [0.5, 0.5, 0.5] }),
  make_elem(`inversion`, { point: [0.5, 0, 0] }),
]

describe(`count_symmetry_elements`, () => {
  // Only present kinds appear as keys (no zero entries), so the legend can iterate them
  test.each([
    [
      `mixed sample`,
      SAMPLE_ELEMENTS,
      { rotation: 2, screw: 1, rotoinversion: 1, mirror: 1, glide: 1, inversion: 3 },
    ],
    [`single kind`, [make_elem(`inversion`)], { inversion: 1 }],
    [`empty input`, [], {}],
  ])(`tallies per present kind: %s`, (_label, elements, expected) => {
    expect(count_symmetry_elements(elements)).toStrictEqual(expected)
  })
})

describe(`has_visible_symmetry_overlay`, () => {
  const inversion_only = [make_elem(`inversion`)]
  test.each([
    // [label, elements, show_kinds, expected]
    [`no elements`, [], { rotation: true }, false],
    [`rotation present + enabled`, SAMPLE_ELEMENTS, { rotation: true }, true],
    // show_kinds omitted → DEFAULT_SHOW_SYM_KINDS (rotation only)
    [`rotation present, default show_kinds`, SAMPLE_ELEMENTS, undefined, true],
    [`mirror-only cell, default show_kinds`, [make_elem(`mirror`)], undefined, false],
    // regression: enabled kind absent from elements must NOT count as visible
    [`rotation-only default on inversion-only cell`, inversion_only, undefined, false],
    [`inversion present + enabled`, inversion_only, { inversion: true }, true],
    [`present kind but all toggles off`, SAMPLE_ELEMENTS, {}, false],
    [`enabled kind not present`, inversion_only, { mirror: true }, false],
  ] as const)(`%s`, (_label, elements, show_kinds, expected) => {
    expect(has_visible_symmetry_overlay(elements, show_kinds)).toBe(expected)
  })
})

describe(`SYM_ELEM_KIND_INFO`, () => {
  // Swatches must show what the overlay renders: planes/centers their exact color, the
  // order-colored axis kinds the whole order palette
  test(`gives every kind a swatch matching the render colors`, () => {
    const hex = /^#[0-9a-f]{6}$/i
    for (const kind of [`mirror`, `glide`, `inversion`] as const) {
      expect(SYM_ELEM_KIND_INFO[kind].color).toBe(SYM_ELEM_COLORS[kind])
      expect(SYM_ELEM_KIND_INFO[kind].color).toMatch(hex)
    }
    for (const kind of [`rotation`, `screw`, `rotoinversion`] as const) {
      const swatch = SYM_ELEM_KIND_INFO[kind].color
      expect(swatch).toMatch(/^linear-gradient\(/)
      for (const color of Object.values(SYM_ELEM_COLORS.axis_by_order)) {
        expect(swatch).toContain(color)
      }
    }
  })
})

// Mount the controls into document.body and flush the first render
const mount_controls = (props: ComponentProps<typeof SymmetryElementControls>) => {
  mount(SymmetryElementControls, { target: document.body, props })
  flushSync()
}

describe(`SymmetryElementControls`, () => {
  test(`renders one checkbox per PRESENT kind with counts, in display order`, () => {
    mount_controls({ elements: SAMPLE_ELEMENTS })
    const labels = [...document.body.querySelectorAll(`label`)]
    // display order = SYM_ELEM_KINDS: axes (rotation, screw, rotoinversion) before planes
    expect(labels.map((lbl) => lbl.textContent?.trim())).toEqual([
      `rotation axes (2)`,
      `screw axes (1)`,
      `rotoinversion axes (1)`,
      `mirror planes (1)`,
      `glide planes (1)`,
      `inversion centers (3)`,
    ])
  })

  test(`default state checks only rotation axes`, () => {
    mount_controls({ elements: SAMPLE_ELEMENTS })
    const checked = [...document.body.querySelectorAll(`input`)].map((inp) => inp.checked)
    // only the first checkbox (rotation axes) is checked by DEFAULT_SHOW_SYM_KINDS
    expect(checked).toEqual([true, false, false, false, false, false])
  })

  test(`toggling a checkbox updates the bound show_kinds (reassigned, not mutated)`, () => {
    const initial: ShowSymmetryKinds = { rotation: true }
    let bound = initial
    mount_controls({
      elements: SAMPLE_ELEMENTS,
      get show_kinds() {
        return bound
      },
      set show_kinds(val: ShowSymmetryKinds) {
        bound = val
      },
    })
    // find the mirror checkbox by its label text (robust to display-order changes)
    const mirror_label = [...document.body.querySelectorAll(`label`)].find((lbl) =>
      lbl.textContent?.includes(`mirror`),
    )
    mirror_label?.querySelector(`input`)?.click()
    flushSync()
    expect(bound).toEqual({ rotation: true, mirror: true })
    expect(bound).not.toBe(initial) // new object so reactive parents update
  })

  test(`renders nothing for empty elements`, () => {
    mount_controls({ elements: [] })
    expect(document.body.querySelector(`.sym-elem-controls`)).toBeNull()
  })

  // The viewer blanks the overlay outside the analyzed (input) cell; the toggles must say so
  // rather than look like they stopped working
  test.each([
    { in_input_frame: true, repeats: 1, reason: null },
    { in_input_frame: false, repeats: 1, reason: SYM_ELEMENTS_INPUT_FRAME_NOTE },
    { in_input_frame: true, repeats: 4001, reason: `exceeds 4000 unique elements` },
  ])(
    `in_input_frame=$in_input_frame, repeats=$repeats explains unavailable toggles`,
    ({ in_input_frame, repeats, reason }) => {
      mount_controls({
        elements: SAMPLE_ELEMENTS,
        in_input_frame,
        lattice: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        tiling: [repeats, 1, 1],
      })
      const inputs = [...document.body.querySelectorAll(`input`)]
      expect(inputs).toHaveLength(6)
      expect(
        inputs.every(
          (inp) => inp.disabled === (!in_input_frame || (repeats > 1 && !inp.checked)),
        ),
      ).toBe(true)
      const note = document.body.querySelector(`.frame-note`)?.textContent ?? null
      if (reason) {
        expect(note).toContain(reason)
        for (const input of inputs) {
          expect(
            document.querySelector(`[id="${input.getAttribute(`aria-describedby`)}"]`)
              ?.textContent,
          ).toContain(reason)
        }
      } else expect(note).toBeNull()
      if (repeats > 1) {
        const checked = inputs.find((input) => input.checked)
        checked?.click()
        flushSync()
        expect(checked?.checked).toBe(false)
      }
    },
  )
})
