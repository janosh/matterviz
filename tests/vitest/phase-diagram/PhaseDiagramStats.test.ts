import { PhaseDiagramStats } from '$lib/phase-diagram'
import type { PhaseDiagramEntry, PhaseStats } from '$lib/phase-diagram/types'
import { flushSync, mount } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

const mock_stats = (overrides: Partial<PhaseStats> = {}): PhaseStats => ({
  total: 100,
  unary: 3,
  binary: 20,
  ternary: 50,
  quaternary: 27,
  stable: 15,
  unstable: 85,
  elements: 4,
  chemical_system: `Li-Fe-P-O`,
  energy_range: { min: -2.5, max: 0.5, avg: -0.8 },
  hull_distance: { max: 0.4, avg: 0.12 },
  ...overrides,
})

const mock_entry = (overrides: Partial<PhaseDiagramEntry> = {}): PhaseDiagramEntry => ({
  composition: { Li: 1, Fe: 1, P: 1, O: 4 },
  energy: -50,
  e_form_per_atom: -0.5,
  e_above_hull: 0.1,
  is_stable: false,
  is_element: false,
  x: 0.25,
  y: 0.25,
  z: 0.25,
  visible: true,
  ...overrides,
})

type Props = {
  phase_stats: PhaseStats | null
  stable_entries: PhaseDiagramEntry[]
  unstable_entries: PhaseDiagramEntry[]
}
const mount_stats = (props: Partial<Props> = {}) =>
  mount(PhaseDiagramStats, {
    target: document.body,
    props: {
      phase_stats: mock_stats(),
      stable_entries: [],
      unstable_entries: [],
      ...props,
    },
  })

describe(`PhaseDiagramStats`, () => {
  beforeEach(() => vi.clearAllMocks())

  test(`renders header and all phase type counts`, () => {
    mount_stats({
      phase_stats: mock_stats({ unary: 4, binary: 20, ternary: 50, quaternary: 26 }),
    })
    const text = document.body.textContent ?? ``
    expect(doc_query(`h4`).textContent).toContain(`Phase Diagram Stats`)
    for (
      const [type, count] of [[`Unary`, 4], [`Binary`, 20], [`Ternary`, 50], [
        `Quaternary`,
        26,
      ]] as const
    ) {
      expect(text).toContain(`${type} phases`)
      expect(text).toContain(`${count}`)
    }
  })

  test(`displays chemical system, stability counts, energy and hull stats`, () => {
    mount_stats({
      phase_stats: mock_stats({
        chemical_system: `Li-Fe-P-O`,
        total: 150,
        stable: 25,
        unstable: 125,
        energy_range: { min: -2.567, max: 0.123, avg: -1.234 },
        hull_distance: { max: 0.456, avg: 0.089 },
      }),
    })
    const text = document.body.textContent ?? ``
    expect(text).toContain(`Total entries in Li-Fe-P-O`)
    expect(text).toContain(`150`)
    expect(text).toContain(`Stable phases`)
    expect(text).toContain(`25`)
    // Check combined formation energy line: min / avg / max
    expect(text).toContain(`Min / avg / max (eV/atom)`)
    expect(text).toContain(`−2.567 / −1.234 / 0.123`)
    // Check combined hull distance line: max / avg
    expect(text).toContain(`Max / avg (eV/atom)`)
    expect(text).toContain(`0.456 / 0.089`)
  })

  test.each([
    [`click`, (el: HTMLElement) => el.click()],
    [
      `Enter key`,
      (el: HTMLElement) =>
        el.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true })),
    ],
  ])(`copies stat item on %s`, (_, trigger) => {
    mount_stats()
    trigger(doc_query(`[data-testid="pd-total-entries"]`))
    flushSync()
    expect(navigator.clipboard.writeText).toHaveBeenCalled()
  })

  test.each([
    { name: `energy histogram`, entries: [mock_entry({ e_form_per_atom: -0.5 })] },
    { name: `hull histogram`, entries: [mock_entry({ e_above_hull: 0.1 })] },
  ])(`renders $name when entries have data`, ({ entries }) => {
    mount_stats({ stable_entries: entries })
    expect(document.querySelectorAll(`.histogram`).length).toBeGreaterThanOrEqual(1)
  })

  test.each([
    {
      system: `Li-Fe`,
      ternary: 0,
      quaternary: 0,
      shown: [`Binary`],
      hidden: [`Ternary`, `Quaternary`],
    },
    {
      system: `Li-Fe-O`,
      ternary: 10,
      quaternary: 0,
      shown: [`Ternary`],
      hidden: [`Quaternary`],
    },
  ])(
    `conditional phase display for $system system`,
    ({ system, ternary, quaternary, shown, hidden }) => {
      mount_stats({
        phase_stats: mock_stats({ chemical_system: system, ternary, quaternary }),
      })
      const text = document.body.textContent ?? ``
      for (const type of shown) expect(text).toContain(`${type} phases`)
      for (const type of hidden) expect(text).not.toContain(`${type} phases`)
    },
  )

  test(`renders empty stat items when phase_stats is null`, () => {
    mount_stats({ phase_stats: null })
    expect(doc_query(`.phase-diagram-stats`).querySelectorAll(`.stat-item`).length).toBe(
      0,
    )
  })

  test(`energy_per_atom fallback renders both histograms`, () => {
    mount_stats({
      stable_entries: [
        mock_entry({
          e_form_per_atom: undefined,
          energy_per_atom: -0.3,
          e_above_hull: 0.1,
        }),
      ],
    })
    expect(document.querySelectorAll(`.histogram`).length).toBe(2)
  })

  test.each([
    { desc: `zero totals`, stats: { total: 0, stable: 0, unstable: 0 }, entries: [] },
    {
      desc: `missing energy`,
      stats: {},
      entries: [mock_entry({ e_form_per_atom: undefined, energy_per_atom: undefined })],
    },
    {
      desc: `non-finite values`,
      stats: {},
      entries: [
        mock_entry({ e_form_per_atom: NaN }),
        mock_entry({ e_form_per_atom: Infinity }),
      ],
    },
  ])(`handles edge case: $desc`, ({ stats, entries }) => {
    mount_stats({ phase_stats: mock_stats(stats), stable_entries: entries })
    expect(doc_query(`.phase-diagram-stats`)).toBeTruthy()
  })

  test(`stat items have accessibility attributes and copy hint`, () => {
    mount_stats()
    const items = Array.from(document.querySelectorAll(`.stat-item`))
    for (const item of items) {
      expect(item.getAttribute(`role`)).toBe(`button`)
      expect(item.getAttribute(`tabindex`)).toBe(`0`)
    }
    expect(doc_query(`[data-testid="pd-total-entries"]`).getAttribute(`title`)).toContain(
      `Click to copy`,
    )
  })

  test(`passes through HTML attributes`, () => {
    mount(PhaseDiagramStats, {
      target: document.body,
      props: {
        phase_stats: mock_stats(),
        stable_entries: [],
        unstable_entries: [],
        class: `custom-class`,
        style: `background: red;`,
      },
    })
    const container = doc_query(`.phase-diagram-stats`)
    expect(container.classList.contains(`custom-class`)).toBe(true)
    expect(container.getAttribute(`style`)).toContain(`background: red`)
  })
})
