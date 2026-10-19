import type { PhaseData } from '#lib/convex-hull/types.js'
import type { Vec2 } from '#lib/math.js'
import type {
  SectionHover,
  TernaryDisplay,
  TernaryPhaseDiagram,
  TernaryPhaseHover,
} from '#lib/phase-diagram/index.js'
import {
  compute_section,
  compute_ternary_phase_diagram,
  decompose_composition,
  prepare_diagram,
} from '#lib/phase-diagram/ternary/compute.js'
import IsobaricTernaryPhaseDiagram from '#lib/phase-diagram/ternary/IsobaricTernaryPhaseDiagram.svelte'
import PhaseEventList from '#lib/phase-diagram/ternary/PhaseEventList.svelte'
import PhaseStabilityMap from '#lib/phase-diagram/ternary/PhaseStabilityMap.svelte'
import { TERNARY_COLORS, TERNARY_DISPLAY_DEFAULTS } from '#lib/phase-diagram/ternary/types.js'
import TernaryPhaseDiagramControls from '#lib/phase-diagram/ternary/TernaryPhaseDiagramControls.svelte'
import { compute_ternary_phase_diagram_async } from '#lib/phase-diagram/ternary/async-compute.svelte.js'
import TernarySectionCanvas from '#lib/phase-diagram/ternary/TernarySectionCanvas.svelte'
import { type Component, createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  create_drop_event,
  doc_query,
  expect_shortcuts_in_pane,
  expect_tooltip_paint,
  mock_canvas_context,
  set_input,
} from '../../setup'
import { make_phase } from '../../test-fixtures'
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
const keydown = (target: Element, key: string, shiftKey = false) => {
  const init = { key, shiftKey, bubbles: true, cancelable: true }
  const event = new KeyboardEvent(`keydown`, init)
  target.dispatchEvent(event)
  flushSync()
  return event
}
const press = (key: string, shiftKey = false) =>
  keydown(doc_query(`.ternary-phase-diagram`), key, shiftKey)
const brackets = () =>
  [...document.querySelectorAll<HTMLButtonElement>(`.bracket button`)].map((btn) =>
    btn.disabled ? null : btn.textContent?.trim(),
  )
const diagram = compute_ternary_phase_diagram(toy_entries, { elements: toy_elements })
// Composition xy → px in the mocked 800×600 canvas: the triangle fills the 532 px tall area
// inside the 34 px padding (side 614.3 px, origin 92.85/566)
const SIDE_PX = 532 / (Math.sqrt(3) / 2)
const to_px = ([x_pos, y_pos]: readonly number[]): Vec2 => [
  (800 - SIDE_PX) / 2 + x_pos * SIDE_PX,
  566 - y_pos * SIDE_PX,
]
const pointer_at = (type: string, coords_xy: Vec2) => {
  const [clientX, clientY] = to_px(coords_xy)
  doc_query(`.ternary-section canvas`).dispatchEvent(
    new PointerEvent(type, { clientX, clientY, bubbles: true }),
  )
  flushSync()
}
const move_to = (coords_xy: Vec2) => pointer_at(`pointermove`, coords_xy)

describe(`IsobaricTernaryPhaseDiagram`, () => {
  test(`sweeps in the background, lists transitions, links them to the live section and releases the worker on unmount`, async () => {
    const release = vi.spyOn(compute_ternary_phase_diagram_async, `release`)
    mount_diagram()
    doc_query(`.ternary-section canvas`)
    expect_shortcuts_in_pane(document, `.ternary-phase-diagram-controls-pane`, [
      `viewer`,
      `ternary-phase-diagram`,
    ])
    await wait_for_events()
    expect(release).not.toHaveBeenCalled()
    const items = [...document.querySelectorAll(`.phase-event-list li`)]
    const kinds = items.map((item) => item.classList[0])
    expect(kinds).toEqual([`appear`, `tie_line_flip`, `vanish`])
    expect(text(`.phase-event-list li:last-child`)).toContain(`NaLi→Li+Na`)
    expect(items[1].querySelectorAll(`.reaction`)).toHaveLength(2) // two simultaneous flips
    expect([temp_input().value, text(`.stable-count`)]).toEqual([`300`, `6stable`])
    expect(brackets()).toEqual([null, `400 K →`]) // no transition below 300 K
    items[0].querySelector(`button`)?.click() // jump just above 400 K
    flushSync()
    expect([temp_input().value, text(`.stable-count`)]).toEqual([`401`, `7stable`])
    expect(brackets()).toEqual([`← 400 K`, `850 K →`])
    items[2].querySelector(`button`)?.click()
    flushSync()
    expect([
      text(`.stable-count`),
      doc_query(`.phase-event-list li.active`).classList[0],
    ]).toEqual([`6stable`, `vanish`])
    unmount_all()
    expect(release).toHaveBeenCalledOnce()
  })

  test(`temperature binding is clamped to the sweep, stepped by keyboard, played by space`, async () => {
    const state = $state<{ temperature: number; diagram: TernaryPhaseDiagram | null }>({
      temperature: 5000,
      diagram: null,
    })
    mount_it(
      IsobaricTernaryPhaseDiagram,
      bind_props({ entries: toy_entries, options: { elements: toy_elements } }, state),
    )
    await wait_for_events()
    expect([state.temperature, temp_input().value]).toEqual([1500, `1500`])
    expect(state.diagram?.events).toHaveLength(3)
    press(`ArrowRight`)
    expect(state.temperature).toBe(1500) // clamped at the top of the sweep
    // hovered without focus too, like the other viewers
    doc_query(`.ternary-phase-diagram`).dispatchEvent(new PointerEvent(`pointerenter`))
    expect(keydown(document.body, `ArrowLeft`).defaultPrevented).toBe(true)
    expect(state.temperature).toBe(1488) // 1% of the 1200 K span
    press(`ArrowLeft`, true)
    expect(state.temperature).toBeCloseTo(1299, 0) // just below the 1300 K transition
    press(` `)
    expect(doc_query(`.play-btn`).getAttribute(`aria-label`)).toBe(`Pause heating`)
    press(` `)
    expect(doc_query(`.play-btn`).getAttribute(`aria-label`)).toBe(`Play heating ramp`)
    // Space on a focused button is left to the button (synthetic keys never trigger native
    // activation, so the observable is an unprevented event), not taken by the heating ramp
    const prism_btn = doc_query<HTMLButtonElement>(`.view-toggle button:last-child`)
    prism_btn.focus()
    const space = keydown(prism_btn, ` `)
    expect([space.defaultPrevented, document.activeElement]).toEqual([false, prism_btn])
    expect(doc_query(`.play-btn`).getAttribute(`aria-label`)).toBe(`Play heating ramp`)
    prism_btn.click()
    flushSync()
    expect(prism_btn.getAttribute(`aria-pressed`)).toBe(`true`)
    doc_query<HTMLButtonElement>(`.phase-event-list .phase`).click()
    flushSync()
    expect(document.querySelector(`.phase-event-list .phase.selected`)).not.toBeNull()
    press(`Escape`)
    expect(document.querySelector(`.phase-event-list .phase.selected`)).toBeNull()
  })

  // A hovered phase point's tooltip wears its drawn color; composition probes get the neutral
  // theme chip (was a hard-coded dark card: white on near-white with the light --plot-tooltip-bg).
  // Long rows wrap inside PlotTooltip's default width cap instead of running past the chip.
  test(`section tooltip paints a hovered phase's color, else the neutral chip`, async () => {
    mount_diagram()
    await wait_for_events()
    move_to([1, 0])
    const tip = doc_query(`.ternary-tooltip`)
    expect_tooltip_paint(tip, TERNARY_COLORS.stable)
    expect(getComputedStyle(tip).whiteSpace).toBe(`normal`)
    move_to([0.45, 0.25])
    // composition rows read `<element> = <percent> %`
    expect(doc_query(`.ternary-tooltip`).textContent).toMatch(/[A-Z][a-z]? = \d+(?:\.\d)? %/)
    expect_tooltip_paint(doc_query(`.ternary-tooltip`), null)
  })

  // tooltip=false hides the hover tooltip, a snippet replaces its content
  const kind_snippet = createRawSnippet((hover: () => TernaryPhaseHover) => ({
    render: () => `<b>${hover().kind}</b>`,
  }))
  test.each([
    [`false`, false, null],
    [`snippet`, kind_snippet, `section`],
  ] as const)(`tooltip %s`, async (_label, tooltip, expected_text) => {
    mount_diagram({ tooltip })
    await wait_for_events()
    move_to([1, 0])
    const tooltip_text = document.querySelector(`.ternary-tooltip`)?.textContent?.trim()
    expect(tooltip_text ?? null).toBe(expected_text)
  })

  test(`stability map steps T itself but lets shift+arrows reach the host`, async () => {
    mount_diagram()
    await wait_for_events()
    const map = doc_query(`.phase-stability-map canvas`)
    keydown(map, `ArrowRight`, true)
    expect(temp_input().value).toBe(`401`) // host jumped past the 400 K event at once
    keydown(map, `ArrowRight`)
    expect(temp_input().value).toBe(`401`) // the map's own step is coalesced into one frame
    await vi.waitFor(() => expect(temp_input().value).toBe(`413`)) // +1% of the 1200 K span
  })

  test(`a sweep over other entries is dropped at once; an invalid model clears the diagram`, async () => {
    const state = $state<{ entries: PhaseData[]; diagram: TernaryPhaseDiagram | null }>({
      entries: toy_entries,
      diagram: null,
    })
    const options = { elements: toy_elements }
    mount_it(IsobaricTernaryPhaseDiagram, bind_props({ options }, state))
    await wait_for_events()
    state.entries = [...toy_entries] // same data, new identity: old phase indices are void
    flushSync()
    expect(document.querySelectorAll(`.phase-event-list li`)).toHaveLength(0)
    expect(
      doc_query(`.side-panel.computing .spinner[role="status"]`).textContent?.trim(),
    ).toBe(`Sweeping temperatures…`)
    await wait_for_events()
    state.entries = [...toy_entries, { composition: { Rb: 1 }, energy: 0 }]
    flushSync()
    expect(doc_query(`.error`).textContent).toContain(`outside the Li-Na-K system`)
    expect([state.diagram, document.querySelector(`.ternary-section`)]).toEqual([null, null])
    state.entries = toy_entries
    flushSync()
    await wait_for_events()
    expect(document.querySelector(`.error`)).toBeNull()
  })

  test(`view toggle, hidden panels, gated controls and the empty state`, () => {
    mount_diagram({
      display: { view: `prism`, show_map: false, show_events: false },
      show_controls: false,
    })
    expect(document.querySelector(`.side-panel`)).toBeNull()
    // show_controls false: the chrome renders neither the controls toggle nor fullscreen
    expect(document.querySelector(`.control-buttons`)?.childElementCount).toBe(0)
    // happy-dom has no navigator.gpu, so the prism shows its WebGPU notice instead of a canvas
    expect(doc_query(`.prism-fallback`).textContent).toContain(`WebGPU is required`)
    doc_query<HTMLButtonElement>(`.view-toggle button`).click()
    flushSync()
    doc_query(`.ternary-section canvas`)
    unmount_all()
    mount_diagram({ entries: [] })
    expect(doc_query(`.empty-state[role="status"]`).textContent).toMatch(/Drop a JSON file/)
  })

  test(`a composition click pins it; the pin itself or Escape removes it, as does a new dataset`, () => {
    const state = $state<{
      entries: PhaseData[]
      pinned_composition: Vec2 | null
      selected_phase: number | null
    }>({ entries: toy_entries, pinned_composition: null, selected_phase: null })
    const options = { elements: toy_elements }
    mount_it(IsobaricTernaryPhaseDiagram, bind_props({ options }, state))
    const click_at = (coords_xy: Vec2) => pointer_at(`click`, coords_xy)
    const expect_pin = (expected: Vec2) =>
      expect(state.pinned_composition).toEqual(expected.map((val) => expect.closeTo(val, 12)))
    const pin: Vec2 = [0.4, 0.25]
    click_at(pin)
    expect_pin(pin)
    click_at([pin[0] + 0.01, pin[1]]) // 6 px off, within the 8 px pin radius
    expect(state.pinned_composition).toBeNull()
    click_at(pin)
    click_at([0.5, 0.05]) // elsewhere: the pin moves
    expect_pin([0.5, 0.05])
    // a phase click selects without touching the pin
    const ab_xy = prepare_diagram(toy_entries, { elements: toy_elements }).phases[0].xy
    click_at(ab_xy)
    expect(state.selected_phase).toBe(0)
    expect_pin([0.5, 0.05])
    // Escape clears the selection first, then the pin, then leaves the key to the host
    expect(press(`Escape`).defaultPrevented).toBe(true)
    expect(state.selected_phase).toBeNull()
    expect_pin([0.5, 0.05])
    expect(press(`Escape`).defaultPrevented).toBe(true)
    expect(state.pinned_composition).toBeNull()
    expect(press(`Escape`).defaultPrevented).toBe(false)
    click_at(ab_xy)
    click_at([0.05, 0.8]) // outside the triangle: clears the selection, nothing to pin
    expect([state.selected_phase, state.pinned_composition]).toEqual([null, null])
    click_at(pin)
    state.entries = [...toy_entries]
    flushSync()
    expect(state.pinned_composition).toBeNull()
  })
})

// Hovering the Li corner (xy [1, 0]) must hit the ground state
// even when another Li entry comes first in entry order
test.each([
  {
    desc: `a metastable polymorph listed first`,
    extra: make_phase({ Li: 1 }, 0.2, { entry_id: `Li-hi` }),
    settings: { max_e_above_hull: 0.5 },
  },
  {
    // Negative hull distance but not a hull vertex: with unstable phases hidden it must not be
    // drawn (nor out-rank the true ground state in the hit test)
    desc: `an exclude_from_hull phase below the hull`,
    extra: make_phase({ Li: 1 }, -0.3, { entry_id: `Li-excluded`, exclude_from_hull: true }),
    settings: { show_unstable: false },
  },
])(
  `TernarySectionCanvas: $desc does not take the hit from the stable one`,
  ({ extra, settings }) => {
    const entries = [...toy_entries, extra, make_phase({ Li: 1 }, 0, { entry_id: `Li-gs` })]
    const model = prepare_diagram(entries, { elements: toy_elements })
    const section = compute_section(model, 300)
    const extra_idx = model.phases.findIndex((item) => item.entry.entry_id === extra.entry_id)
    expect(section.stable).not.toContain(extra_idx)
    if (extra.exclude_from_hull) expect(section.e_above_hull[extra_idx]).toBeLessThan(0)
    const hovers: (SectionHover | null)[] = []
    mount_it(TernarySectionCanvas, {
      model,
      section,
      settings: { ...TERNARY_DISPLAY_DEFAULTS, ...settings },
      on_hover: (data: SectionHover | null) => hovers.push(data),
    })
    move_to([1, 0])
    const [hovered] = hovers
    expect(hovered?.kind === `phase` && hovered.phase.entry.entry_id).toBe(`Li-gs`)
  },
)

// Hovering repaints only the overlay canvas: the base (faces, points, labels) is several
// hundred paths and used to be redrawn on every pointer move. clearRect opens every repaint,
// so counting it per layer says which canvas redrew. The hover tint sits above the base's
// labels, so the hovered face's vertex labels are repainted on the overlay (fillText).
test(`TernarySectionCanvas: hover and selection repaint the overlay, not the section`, async () => {
  const clears = { base: 0, overlay: 0 }
  const fills = { base: 0, overlay: 0 }
  const face_tints = { base: 0, overlay: 0 } // draw_face is the overlay's only closePath
  // Endpoints of the last overlay frame's pinned-probe spokes (its [5, 3] dash)
  let overlay_dash = ``
  let pin_spokes: Vec2[] = []
  vi.stubGlobal(
    `Path2D`,
    class {
      arc(): void {}
    },
  )
  const get_context = vi
    .spyOn(HTMLCanvasElement.prototype, `getContext`)
    .mockImplementation(function (this: HTMLCanvasElement) {
      const layer = this.classList.contains(`pulse-overlay`) ? `overlay` : `base`
      return new Proxy({} as CanvasRenderingContext2D, {
        get: (_target, prop) => {
          if (prop === `canvas`) return this
          if (prop === `measureText`) return () => ({ width: 20 })
          if (prop === `clearRect`)
            return () => {
              clears[layer]++
              if (layer === `overlay`) pin_spokes = []
            }
          if (prop === `fillText`) return () => fills[layer]++
          if (prop === `closePath`) return () => face_tints[layer]++
          if (prop === `setLineDash` && layer === `overlay`)
            return (dash: number[]) => (overlay_dash = dash.join(`,`))
          if (prop === `lineTo` && layer === `overlay`)
            return (x_pos: number, y_pos: number) => {
              if (overlay_dash === `5,3`) pin_spokes.push([x_pos, y_pos])
            }
          return vi.fn()
        },
      })
    })
  const let_frames_run = () => new Promise((resolve) => setTimeout(resolve, 40))
  try {
    const model = prepare_diagram(toy_entries, { elements: toy_elements })
    const state = $state({
      selected_phase: null as number | null,
      pinned_composition: null as Vec2 | null,
      section: compute_section(model, 300),
    })
    mount_it(
      TernarySectionCanvas,
      bind_props({ model, settings: TERNARY_DISPLAY_DEFAULTS }, state),
    )
    const update = async (patch: Partial<typeof state>) => {
      Object.assign(state, patch)
      flushSync()
      await let_frames_run()
    }
    await let_frames_run()
    const painted = { ...clears }
    expect(painted.base).toBeGreaterThan(0)
    expect(fills.base).toBeGreaterThan(0)
    // nothing is hovered yet, so the overlay has painted no text
    expect(fills.overlay).toBe(0)
    // 5 hovers over compositions inside the triangle
    const hover = async (xy: Vec2) => {
      move_to(xy)
      flushSync()
      await let_frames_run()
    }
    for (const frac of [0.3, 0.35, 0.4, 0.45, 0.5]) await hover([frac, 0.2])
    // the hovered tie-triangle's vertex labels are repainted above the tint: some text per
    // hover, but less than the base's full label pass (5 hovers < 5 base passes)
    const base_fills = fills.base
    expect(fills.overlay).toBeGreaterThan(0)
    expect(fills.overlay).toBeLessThan(5 * base_fills)
    // one tinted face (closePath) per interior hover; a composition on the AB-AC tie-line
    // decomposes into two phases and tints both neighbouring tie-triangles
    expect(face_tints.overlay).toBe(5)
    const [phase_ab, phase_ac] = [`AB`, `AC`].map((identifier) => {
      const phase = model.phases.find((candidate) => candidate.entry.entry_id === identifier)
      if (!phase) throw new Error(`${identifier} not in the model`)
      return phase.xy
    })
    await hover([(phase_ab[0] + phase_ac[0]) / 2, (phase_ab[1] + phase_ac[1]) / 2])
    expect(face_tints.overlay).toBe(7)
    await update({ selected_phase: 0 })
    // was 7 base repaints (one per hover + the selection) before the overlay split
    expect(clears.base - painted.base).toBe(0)
    expect(clears.overlay - painted.overlay).toBe(7)
    expect(fills.base).toBe(base_fills)
    // A pin near AB keeps spokes to its assemblage, which follows the section: AB-AC-BC at
    // 300 K, Li-Na-ABC once AB has vanished (1300 K)
    const pin: Vec2 = [0.9 * phase_ab[0] + 0.05, 0.9 * phase_ab[1] + 0.1 * (Math.sqrt(3) / 6)]
    const spoke_px = (section: ReturnType<typeof compute_section>) =>
      (decompose_composition(model, section, pin)?.phases ?? []).map((idx) =>
        to_px(model.phases[idx].xy).map((val) => expect.closeTo(val, 9)),
      )
    const [cold, hot] = [state.section, compute_section(model, 1400)]
    expect(decompose_composition(model, cold, pin)?.phases).not.toEqual(
      decompose_composition(model, hot, pin)?.phases,
    )
    await update({ pinned_composition: pin })
    expect(pin_spokes).toEqual(spoke_px(cold))
    await update({ section: hot })
    expect(pin_spokes).toEqual(spoke_px(hot))
  } finally {
    get_context.mockRestore()
    vi.unstubAllGlobals()
  }
})

test(`TernarySectionCanvas: a section change rebuilds entries without mutating the model`, () => {
  // AB is tabulated 300-1500 K: stable at 300 K, undefined (NaN distance) at 2000 K
  const model = prepare_diagram(toy_entries, { elements: toy_elements })
  const ab_idx = model.phases.findIndex((phase) => phase.entry.entry_id === `AB`)
  const entries_before = structuredClone(model.phases.map((phase) => phase.entry))
  const state = $state({ section: compute_section(model, 300) })
  const hovers: (SectionHover | null)[] = []
  const settings = { ...TERNARY_DISPLAY_DEFAULTS, show_unstable: false }
  const on_hover = (data: SectionHover | null) => hovers.push(data)
  mount_it(TernarySectionCanvas, bind_props({ model, settings, on_hover }, state))
  const hover_ab = () => {
    move_to(model.phases[ab_idx].xy)
    return hovers.at(-1)
  }
  const at_300 = hover_ab()
  expect(at_300?.kind === `phase` && at_300.phase.idx).toBe(ab_idx)
  expect(at_300?.kind === `phase` && at_300.e_above_hull).toBe(0)

  state.section = compute_section(model, 2000)
  flushSync()
  expect(state.section.e_above_hull[ab_idx]).toBeNaN()
  // AB has no entry in this section, so the pointer lands on the composition, not the phase
  expect(hover_ab()?.kind).toBe(`composition`)
  // the per-section energy fields never leak into the model's entries
  expect(model.phases.map((phase) => phase.entry)).toEqual(entries_before)
})

describe(`PhaseEventList`, () => {
  test(`formats reactions, marks active and involved events, toggles selection`, () => {
    const state = $state<{ selected_phase: number | null }>({ selected_phase: null })
    mount_it(PhaseEventList, bind_props({ diagram, temperature: 900 }, state))
    const items = [...document.querySelectorAll(`.phase-event-list li`)]
    expect(items[1].className).toContain(`active`) // 850 K flip is the last one at or below 900 K
    expect(text(`.phase-event-list .reaction`)).toBe(`NaLi+KLi+KNa→2KNaLi`)
    // Li takes part in the 850 K flips and the 1300 K decomposition only
    const li_chip = [
      ...document.querySelectorAll<HTMLButtonElement>(`.phase-event-list .phase`),
    ].find((btn) => btn.textContent === `Li`)
    li_chip?.click()
    flushSync()
    expect(state.selected_phase).toBe(4)
    const involved = items.map((item) => item.className.includes(`involved`))
    expect(involved).toEqual([false, true, true])
    li_chip?.click()
    flushSync()
    expect(state.selected_phase).toBeNull()
  })

  test(`empty state names the range`, () => {
    const quiet = compute_ternary_phase_diagram(toy_entries, {
      elements: toy_elements,
      t_range: [500, 700],
      n_samples: 3,
    })
    mount_it(PhaseEventList, { diagram: quiet, temperature: 600 })
    expect(text(`.phase-event-list .empty`)).toBe(`Notransitionsbetween500and700K`)
    unmount_all()
    // an event without balanced reactions counts the tie-lines it replaced
    const [event] = diagram.events
    const events = [1, 2].map((n_edges) => ({
      ...event,
      reactions: [],
      edges_removed: Array.from({ length: n_edges }, (): Vec2 => [0, 1]),
    }))
    mount_it(PhaseEventList, { diagram: { ...diagram, events }, temperature: 600 })
    const reactions = [...document.querySelectorAll(`.phase-event-list .reaction`)]
    expect(reactions.map((node) => node.textContent)).toEqual([
      `1 tie-line replaced`,
      `2 tie-lines replaced`,
    ])
  })
})

describe(`PhaseStabilityMap`, () => {
  // Two extra phases separate the row filters: one 50 meV above the KLi-KNa tie-line (near
  // the hull, never stable), one far above the hull everywhere
  const map_diagram = compute_ternary_phase_diagram(
    [
      ...toy_entries,
      make_phase({ Li: 1, Na: 1, K: 2 }, -0.25),
      make_phase({ Li: 3, Na: 1 }, 0.5),
    ],
    { elements: toy_elements },
  )
  test.each([
    [`stable_ever`, false, 4],
    [`near_hull`, false, 5],
    [`all`, false, 6],
    [`stable_ever`, true, 7],
  ] as const)(`filter=%s elements=%s → %i rows`, (map_filter, show_map_elements, n_rows) => {
    const settings = { ...TERNARY_DISPLAY_DEFAULTS, map_filter, show_map_elements }
    const props = { diagram: map_diagram, settings, temperature: 500, row_height: 10 }
    mount_it(PhaseStabilityMap, props)
    const canvas = doc_query<HTMLCanvasElement>(`.phase-stability-map canvas`)
    expect([
      canvas.getAttribute(`aria-valuenow`),
      canvas.getAttribute(`aria-valuemin`),
    ]).toEqual([`500`, `300`])
    expect(canvas.style.height).toBe(`${4 + n_rows * 10 + 22}px`) // top pad + rows + axis
  })

  test(`pointer: the label gutter selects the row, the plot sets the temperature`, () => {
    const state = $state<{ temperature: number; selected_phase: number | null }>({
      temperature: 300,
      selected_phase: null,
    })
    mount_it(
      PhaseStabilityMap,
      bind_props({ diagram, settings: TERNARY_DISPLAY_DEFAULTS, row_height: 10 }, state),
    )
    const canvas = doc_query(`.phase-stability-map canvas`)
    const down = (clientX: number) => {
      canvas.dispatchEvent(
        new PointerEvent(`pointerdown`, { clientX, clientY: 9, bubbles: true }),
      )
      flushSync()
    }
    down(40) // label gutter of the first row (onset sort: NaLi)
    expect(state.selected_phase).toBe(0)
    down(444) // plot_width = 800 - 96 - 8 = 696 px over 1200 K → 900 K
    expect(state.temperature).toBeCloseTo(900, 6)
  })

  // The cached row layer is keyed on the colors by identity: a JSON key reads every function
  // scheme as `{}`, so swapping one never repainted the rows
  test(`swapping a function color scheme repaints the cached rows`, async () => {
    const fills = new Set<string>()
    Object.defineProperty(mock_canvas_context({ setLineDash: vi.fn() }), `fillStyle`, {
      set: (fill: string) => fills.add(fill),
    })
    const props = $state({
      diagram: map_diagram,
      settings: {
        ...TERNARY_DISPLAY_DEFAULTS,
        color_scale: { scheme: (): string => `#000001` },
      },
      row_height: 10,
    })
    try {
      mount_it(PhaseStabilityMap, props)
      for (const fill of [`#000001`, `#000002`]) {
        props.settings = { ...props.settings, color_scale: { scheme: () => fill } }
        await new Promise((resolve) => setTimeout(resolve, 40))
        expect(fills).toContain(fill)
      }
    } finally {
      vi.mocked(HTMLCanvasElement.prototype.getContext).mockRestore()
    }
  })

  // Centred on their ticks, the 300 K label ran into `T (K)` and the 1500 K one off the canvas
  test(`temperature tick labels stay between the label gutter and the canvas edge`, async () => {
    const labels: { label: string; x: number }[] = []
    mock_canvas_context(
      {
        setLineDash: vi.fn(),
        fillText: (label: string, x: number) => labels.push({ label, x }),
      },
      8, // px per character
    )
    const props = { diagram, settings: TERNARY_DISPLAY_DEFAULTS, row_height: 10 }
    try {
      mount_it(PhaseStabilityMap, props)
      await new Promise((resolve) => setTimeout(resolve, 40))
      const ticks = labels.filter(({ label }) => Number(label) >= 300) // not formula subscripts
      expect(ticks.map(({ label }) => label)).toEqual(expect.arrayContaining([`300`, `1500`]))
      for (const { label, x } of ticks) {
        const half = 4 * label.length
        expect([x - half, x + half], label).toSatisfy(
          ([left, right]: number[]) => left >= 96 && right <= 800,
        )
      }
    } finally {
      vi.mocked(HTMLCanvasElement.prototype.getContext).mockRestore()
    }
  })
})

test(`TernaryPhaseDiagramControls writes display patches, T range and gas pressure`, () => {
  const state = $state<{
    display: TernaryDisplay
    free_energy_mode: string
    t_range: Vec2
    gas_pressures: Record<string, number>
  }>({
    display: { ...TERNARY_DISPLAY_DEFAULTS },
    free_energy_mode: `auto`,
    t_range: [300, 1500],
    gas_pressures: {},
  })
  const mount_controls = (extra: Record<string, unknown>) =>
    mount_it(
      TernaryPhaseDiagramControls,
      bind_props(
        {
          controls_open: true,
          set_display: (patch: Partial<TernaryDisplay>) => {
            state.display = { ...state.display, ...patch }
          },
          ...extra,
        },
        state,
      ),
    )
  mount_controls({ relevant_gases: [] })
  const button = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>(`.toggle-btn`)].find(
      (btn) => btn.textContent?.trim() === label,
    )
  button(`SISSO`)?.click()
  button(`3D prism`)?.click()
  flushSync()
  expect([
    state.free_energy_mode,
    state.display.view,
    button(`SISSO`)?.getAttribute(`aria-pressed`),
  ]).toEqual([`sisso`, `prism`, `true`])
  const grid = [...document.querySelectorAll<HTMLInputElement>(`input[type=checkbox]`)].find(
    (input) => input.closest(`label`)?.textContent?.includes(`Grid`),
  )
  grid?.click()
  flushSync()
  expect(state.display.show_grid).toBe(false)
  // A rejected T edit (min ≥ max) restores the field; a valid one writes the range
  const [t_lo, t_hi] = document.querySelectorAll<HTMLInputElement>(`input[type=number]`)
  const change = (input: HTMLInputElement, value: string) => {
    input.value = value
    input.dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
  }
  change(t_hi, `200`)
  expect([state.t_range, t_hi.value]).toEqual([[300, 1500], `1500`])
  change(t_lo, `500`)
  expect(state.t_range).toEqual([500, 1500])
  expect(document.body.textContent).not.toContain(`Gas atmosphere`)
  unmount_all()
  mount_controls({ relevant_gases: [`O2`], gas_enabled: true })
  expect(document.body.textContent).toContain(`p(O2)`)
  const p_slider = doc_query<HTMLInputElement>(`input[type=range][min="-12"]`)
  expect(Number(p_slider.value)).toBeCloseTo(Math.log10(0.2095), 6)
  // Dragging previews the slider in bar; a full re-sweep commits only on release.
  set_input(p_slider, `-6`)
  flushSync()
  expect(state.gas_pressures.O2).toBeUndefined()
  expect(p_slider.getAttribute(`aria-valuenow`)).toBe(`0.000001`)
  p_slider.dispatchEvent(new Event(`change`, { bubbles: true }))
  flushSync()
  expect(state.gas_pressures.O2).toBeCloseTo(1e-6, 12)
  const p_number = doc_query<HTMLInputElement>(`input[type=number][min="1e-12"]`)
  expect(p_number.valueAsNumber).toBe(1e-6)
  for (const value of [`5`, `0`]) {
    change(p_number, value)
    expect([state.gas_pressures.O2, p_number.value]).toEqual([5, `5`])
  }
  keydown(p_slider, `Home`)
  expect(state.gas_pressures.O2).toBe(1e-12)
})

// Dropped entry arrays replace the shown entries and report through on_file_load
test.each([true, false])(`allow_file_drop=%s gates file drops`, async (allow_file_drop) => {
  const on_file_load = vi.fn()
  mount_diagram({ allow_file_drop, on_file_load })
  const file = new File([JSON.stringify(toy_entries)], `toy.json`)
  doc_query(`.ternary-phase-diagram`).dispatchEvent(create_drop_event(file))
  if (allow_file_drop) {
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    const loaded = { entries: toy_entries, filename: `toy.json`, source_filename: `toy.json` }
    expect(on_file_load).toHaveBeenCalledWith({ ...loaded, file })
  } else {
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(on_file_load).not.toHaveBeenCalled()
  }
})

// A host's on_file_drop takes the raw file instead of the entries parse, and a throwing
// on_file_load is reported as the load's failure, not as unreadable file content
test.each([
  [`on_file_drop`, { on_file_drop: vi.fn() }, null],
  [
    `a throwing on_file_load`,
    {
      on_file_load: () => {
        throw new Error(`host boom`)
      },
    },
    `Failed to load 1 file — toy.json: host boom`,
  ],
])(`dropped entries with %s`, async (_label, props, error) => {
  mount_diagram(props)
  const content = JSON.stringify(toy_entries)
  const file = new File([content], `toy.json`)
  doc_query(`.ternary-phase-diagram`).dispatchEvent(create_drop_event(file))
  if (`on_file_drop` in props) {
    await vi.waitFor(() =>
      expect(props.on_file_drop).toHaveBeenCalledWith(
        content,
        `toy.json`,
        expect.objectContaining({ file }),
      ),
    )
  }
  const banner = () => document.querySelector(`.status-message.error`)?.textContent?.trim()
  await vi.waitFor(() => expect(banner() ?? null).toBe(error))
})
