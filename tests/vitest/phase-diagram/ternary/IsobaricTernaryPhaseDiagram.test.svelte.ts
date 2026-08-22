import {
  compute_ternary_phase_diagram,
  IsobaricTernaryPhaseDiagram,
  PhaseEventList,
  PhaseStabilityMap,
  TERNARY_DISPLAY_DEFAULTS,
  TernaryPhaseDiagramControls,
  type TernaryDisplay,
  type TernaryPhaseDiagram,
} from '$lib/phase-diagram'
import { type Component, flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '../../setup'
import { toy_elements, toy_entries } from './fixtures'

// Toy system transitions: 400 K (ABC appears), 850 K (two tie-line flips), 1300 K (AB vanishes)
const mounted: ReturnType<typeof mount>[] = []
const unmount_all = () => {
  for (const component of mounted.splice(0)) void unmount(component)
  document.body.innerHTML = ``
}
afterEach(unmount_all)
// eslint-disable-next-line typescript/no-explicit-any -- mount() wants each component's exact props type
const mount_it = (component: Component<any>, props: Record<string, unknown>) => {
  mounted.push(mount(component, { target: document.body, props }))
  flushSync()
}
const mount_diagram = (props: Record<string, unknown> = {}) =>
  mount_it(IsobaricTernaryPhaseDiagram, {
    entries: toy_entries,
    options: { elements: toy_elements },
    ...props,
  })
const wait_for_events = () =>
  vi.waitFor(() => expect(document.querySelectorAll(`.phase-event-list li`)).toHaveLength(3))
const temp_input = () =>
  doc_query<HTMLInputElement>(`input[aria-label="Temperature in Kelvin"]`)
const text = (selector: string) => doc_query(selector).textContent?.replaceAll(/\s+/g, ``)
const press = (key: string, shiftKey = false) => {
  doc_query(`.ternary-phase-diagram`).dispatchEvent(
    new KeyboardEvent(`keydown`, { key, shiftKey, bubbles: true }),
  )
  flushSync()
}
const diagram = compute_ternary_phase_diagram(toy_entries, { elements: toy_elements })

describe(`IsobaricTernaryPhaseDiagram`, () => {
  test(`sweeps in the background, lists transitions and links them to the live section`, async () => {
    mount_diagram()
    expect(doc_query(`.ternary-section canvas`)).toBeInstanceOf(HTMLCanvasElement)
    await wait_for_events()
    const items = [...document.querySelectorAll(`.phase-event-list li`)]
    expect(items.map((item) => item.classList[0])).toEqual([
      `appear`,
      `tie_line_flip`,
      `vanish`,
    ])
    expect(text(`.phase-event-list li:last-child`)).toContain(`NaLi→Li+Na`)
    expect(items[1].querySelectorAll(`.reaction`)).toHaveLength(2) // two simultaneous flips
    expect([temp_input().value, text(`.stable-count`)]).toEqual([`300`, `6stable`])
    items[0].querySelector(`button`)?.click() // jump just above 400 K
    flushSync()
    expect([temp_input().value, text(`.stable-count`)]).toEqual([`401`, `7stable`])
    items[2].querySelector(`button`)?.click()
    flushSync()
    expect([
      text(`.stable-count`),
      doc_query(`.phase-event-list li.active`).classList[0],
    ]).toEqual([`6stable`, `vanish`])
  })

  test(`temperature binding is clamped to the sweep and stepped by keyboard`, async () => {
    const state = $state<{ temperature: number; diagram: TernaryPhaseDiagram | null }>({
      temperature: 5000,
      diagram: null,
    })
    // Getters/setters stand in for bind: (spreading them would snapshot the values)
    mount_it(IsobaricTernaryPhaseDiagram, {
      entries: toy_entries,
      options: { elements: toy_elements },
      get temperature() {
        return state.temperature
      },
      set temperature(value: number) {
        state.temperature = value
      },
      get diagram() {
        return state.diagram
      },
      set diagram(value: TernaryPhaseDiagram | null) {
        state.diagram = value
      },
    })
    await wait_for_events()
    expect([state.temperature, temp_input().value]).toEqual([1500, `1500`])
    expect(state.diagram?.events).toHaveLength(3)
    press(`ArrowLeft`)
    expect(state.temperature).toBe(1488) // 1% of the 1200 K span
    press(`ArrowLeft`, true)
    expect(state.temperature).toBeCloseTo(1299, 0) // just below the 1300 K transition
    // Space on a focused button must activate the button, not the heating ramp
    doc_query(`.view-toggle button`).dispatchEvent(
      new KeyboardEvent(`keydown`, { key: ` `, bubbles: true }),
    )
    flushSync()
    expect(document.querySelector(`[aria-label="Pause heating"]`)).toBeNull()
    doc_query<HTMLButtonElement>(`.phase-event-list .phase`).click()
    flushSync()
    expect(document.querySelector(`.phase-event-list .phase.selected`)).not.toBeNull()
    press(`Escape`)
    expect(document.querySelector(`.phase-event-list .phase.selected`)).toBeNull()
  })

  test.each([
    [[toy_entries[0]], {}, `exactly 3 elements`],
    [
      [...toy_entries, { composition: { Rb: 1 }, energy: 0 }],
      { elements: toy_elements },
      `outside the Li-Na-K system`,
    ],
  ])(`surfaces model errors instead of rendering (%#)`, (entries, options, message) => {
    mount_diagram({ entries, options })
    expect(doc_query(`.error`).textContent).toContain(message)
    expect(document.querySelector(`.ternary-section`)).toBeNull()
  })

  test(`view toggle, hidden panels, gated controls and the empty state`, async () => {
    mount_diagram({
      display: { view: `prism`, show_map: false, show_events: false },
      show_controls: false,
    })
    await vi.waitFor(() => expect(document.querySelector(`.side-panel`)).toBeNull())
    expect(document.querySelector(`.header-controls`)).toBeNull()
    // happy-dom has no navigator.gpu, so the prism shows its WebGPU notice instead of a canvas
    expect(doc_query(`.prism-fallback`).textContent).toContain(`WebGPU is required`)
    doc_query<HTMLButtonElement>(`.view-toggle button`).click()
    flushSync()
    expect(doc_query(`.ternary-section canvas`)).toBeInstanceOf(HTMLCanvasElement)
    unmount_all()
    mount_diagram({ entries: [] })
    expect(doc_query(`.empty`).textContent).toMatch(/Drop a JSON file/)
  })
})

test(`PhaseEventList formats reactions, marks the active event and selects phases`, () => {
  const state = $state<{ selected_phase: number | null }>({ selected_phase: null })
  mount_it(PhaseEventList, {
    diagram,
    temperature: 900,
    get selected_phase() {
      return state.selected_phase
    },
    set selected_phase(value: number | null) {
      state.selected_phase = value
    },
  })
  const items = document.querySelectorAll(`.phase-event-list li`)
  expect(items[1].className).toContain(`active`) // 850 K flip is the last one at or below 900 K
  expect(text(`.phase-event-list .reaction`)).toBe(`NaLi+KLi+KNa→2KNaLi`)
  const chip = doc_query<HTMLSpanElement>(`.phase-event-list .phase`)
  chip.click()
  flushSync()
  expect([state.selected_phase, items[0].className.includes(`involved`)]).toEqual([0, true])
  chip.click()
  flushSync()
  expect(state.selected_phase).toBeNull()
})

test.each([
  [`stable_ever`, false, 4],
  [`stable_ever`, true, 7],
  [`all`, false, 4],
] as const)(
  `PhaseStabilityMap filter=%s elements=%s → %i rows`,
  (map_filter, show_map_elements, n_rows) => {
    const settings = { ...TERNARY_DISPLAY_DEFAULTS, map_filter, show_map_elements }
    mount_it(PhaseStabilityMap, { diagram, settings, temperature: 500, row_height: 10 })
    const canvas = doc_query<HTMLCanvasElement>(`.phase-stability-map canvas`)
    expect([
      canvas.getAttribute(`aria-valuenow`),
      canvas.getAttribute(`aria-valuemin`),
    ]).toEqual([`500`, `300`])
    expect(canvas.style.height).toBe(`${4 + n_rows * 10 + 22}px`) // top pad + rows + axis
  },
)

test(`TernaryPhaseDiagramControls writes display patches and gates gas controls`, () => {
  const state = $state<{ display: TernaryDisplay; mode: string }>({
    display: { ...TERNARY_DISPLAY_DEFAULTS },
    mode: `auto`,
  })
  const props = {
    controls_open: true,
    get display() {
      return state.display
    },
    set_display: (patch: Partial<TernaryDisplay>) => {
      state.display = { ...state.display, ...patch }
    },
    get free_energy_mode() {
      return state.mode
    },
    set free_energy_mode(value: string) {
      state.mode = value
    },
  }
  mount_it(TernaryPhaseDiagramControls, Object.assign(props, { relevant_gases: [] }))
  const button = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>(`.toggle-btn`)].find(
      (btn) => btn.textContent?.trim() === label,
    )
  button(`SISSO`)?.click()
  button(`3D prism`)?.click()
  flushSync()
  expect([state.mode, state.display.view, button(`SISSO`)?.className]).toEqual([
    `sisso`,
    `prism`,
    expect.stringContaining(`active`),
  ])
  const grid = [...document.querySelectorAll<HTMLInputElement>(`input[type=checkbox]`)].find(
    (input) => input.closest(`label`)?.textContent?.includes(`Grid`),
  )
  grid?.click()
  flushSync()
  expect(state.display.show_grid).toBe(false)
  expect(document.body.textContent).not.toContain(`Gas atmosphere`)
  unmount_all()
  mount_it(
    TernaryPhaseDiagramControls,
    Object.assign(props, { relevant_gases: [`O2`], gas_enabled: true }),
  )
  expect(document.body.textContent).toContain(`p(O2)`)
  expect(
    Number(doc_query<HTMLInputElement>(`input[type=range][min="-12"]`).value),
  ).toBeCloseTo(Math.log10(0.2095), 6)
})
