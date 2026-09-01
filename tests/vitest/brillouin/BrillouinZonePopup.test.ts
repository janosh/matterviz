import BrillouinZonePopup from '$lib/brillouin/BrillouinZonePopup.svelte'
import type { Matrix3x3 } from '$lib/math'
import { type ComponentProps, flushSync, mount } from 'svelte'
import { expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

// The dismissal/drag shell is covered by tests/vitest/overlays/FloatingPopup.test.ts
// cubic reciprocal lattice, |b| = 1: the zone is a unit cube
const k_lattice: Matrix3x3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]
const points: ComponentProps<typeof BrillouinZonePopup>[`points`] = [
  { label: `K`, frac_coords: [3 / 8, 3 / 8, 3 / 4], position: [0.5, 0.5, 0] },
  { label: `U`, frac_coords: [5 / 8, 1 / 4, 5 / 8], position: [0, 0.5, 0.5] },
  // repeated label: the list must not be keyed by label
  { label: `U`, frac_coords: [1 / 4, 5 / 8, 5 / 8], position: [0.5, 0, 0.5] },
]

test(`lists every marked point and closes from its own button`, () => {
  const on_close = vi.fn()
  mount(BrillouinZonePopup, {
    target: document.body,
    props: { k_lattice, points, on_close, width: 200, height: 150, class: `custom` },
  })
  flushSync()

  const popup = doc_query(`.bz-popup`)
  expect(popup.classList.contains(`floating-popup`)).toBe(true)
  expect(popup.classList.contains(`custom`)).toBe(true)

  // one entry per point sharing the clicked x (a K | U discontinuity label)
  const stats = doc_query(`.bz-popup-stats`)
  expect([...stats.querySelectorAll(`strong`)].map((el) => el.textContent)).toEqual([
    `K`,
    `U`,
    `U`,
  ])
  // Cartesian and fractional rows come from the shared KCoords tooltip rows
  expect(stats.querySelectorAll(`.k-coord-row`)).toHaveLength(6)
  expect(stats.textContent).toContain(`(0.5, 0.5, 0)`)
  expect(stats.textContent).toContain(`(0.375, 0.375, 0.75)`)

  // the zone is built from the k lattice alone: no structure, no file-drop empty state
  expect(document.querySelector(`.bz-popup .brillouin-zone .empty-state`)).toBeNull()
  const bz_style = doc_query(`.bz-popup .brillouin-zone`).style
  expect(bz_style.getPropertyValue(`--bz-width`)).toBe(`200px`)
  expect(bz_style.getPropertyValue(`--bz-height`)).toBe(`150px`)

  doc_query<HTMLButtonElement>(`.bz-popup-close .close-btn`).click()
  expect(on_close).toHaveBeenCalledOnce()
})

test(`a singular reciprocal lattice shows the error where the zone would be`, () => {
  const on_close = vi.fn()
  // parsers only check for finite entries, so a degenerate lattice can reach the popup
  const singular: Matrix3x3 = [
    [1, 0, 0],
    [2, 0, 0],
    [0, 0, 1],
  ]
  mount(BrillouinZonePopup, {
    target: document.body,
    props: { k_lattice: singular, points, on_close },
  })
  flushSync()
  expect(document.querySelector(`.bz-popup .brillouin-zone`)).toBeNull()
  expect(doc_query(`.bz-popup-error`).textContent).toMatch(/singular|lattice/i)
  // the point list and close button still work
  expect(doc_query(`.bz-popup-stats`).querySelectorAll(`strong`)).toHaveLength(3)
  doc_query<HTMLButtonElement>(`.bz-popup-close .close-btn`).click()
  expect(on_close).toHaveBeenCalledOnce()
})
