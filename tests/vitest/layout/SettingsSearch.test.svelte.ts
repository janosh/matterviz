import { mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import SettingsSearchHarness from './SettingsSearchHarness.svelte'

const element = (selector: string): HTMLElement => {
  const match = document.querySelector<HTMLElement>(selector)
  if (!match) throw new Error(`Missing element: ${selector}`)
  return match
}
const hidden = (node: HTMLElement): boolean =>
  Boolean(node.closest(`[hidden], [data-search-hidden]`))
const set_query = async (input: HTMLInputElement, query: string): Promise<void> => {
  input.value = query
  input.dispatchEvent(new Event(`input`, { bubbles: true }))
  await tick()
}
const settle_observer = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const atom_radius = `[data-key="atom_radius"]`
const color_scheme = `[data-key="color_scheme"]`
const rotation_damping = `[data-key="rotation_damping"]`
const zoom_speed = `[data-key="zoom_speed"]`
const sphere_segments = `[data-testid="sphere-segments"]`
const nested_sphere_segments = `[data-testid="nested-sphere-segments"]`

const mounted_search = async (): Promise<{
  input: HTMLInputElement
  appearance: HTMLDetailsElement
  camera: HTMLDetailsElement
}> => {
  mount(SettingsSearchHarness, { target: document.body })
  await tick()
  element(`.open-search`).click()
  await tick()
  const input = document.querySelector<HTMLInputElement>(`input[type="search"]`)
  const [appearance, camera] = [
    ...document.querySelectorAll<HTMLDetailsElement>(`details.settings-group`),
  ]
  if (!input || !appearance || !camera)
    throw new Error(`Settings search harness failed to mount`)
  return { input, appearance, camera }
}

describe(`SettingsSearch`, () => {
  test(`expands from an icon, focuses the field, and collapses on Escape`, async () => {
    mount(SettingsSearchHarness, { target: document.body })
    await tick()
    expect(document.querySelector(`input[type="search"]`)).toBeNull()

    element(`.open-search`).click()
    await tick()
    const input = document.querySelector<HTMLInputElement>(`input[type="search"]`)
    expect(document.activeElement).toBe(input)

    input?.dispatchEvent(
      new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true, cancelable: true }),
    )
    await tick()
    expect(document.querySelector(`input[type="search"]`)).toBeNull()
    expect(document.activeElement).toBe(element(`.open-search`))
  })

  test(`preserves focus when mounted with a prefilled query`, async () => {
    const focus_target = document.createElement(`button`)
    document.body.append(focus_target)
    focus_target.focus()
    mount(SettingsSearchHarness, { target: document.body, props: { query: `radius` } })
    await tick()

    expect(document.querySelector<HTMLInputElement>(`input[type="search"]`)?.value).toBe(
      `radius`,
    )
    expect(document.activeElement).toBe(focus_target)
  })

  test.each([
    [`labels`, `radius`, atom_radius, color_scheme, `appearance`],
    [`descriptions`, `motion inertia`, rotation_damping, zoom_speed, `camera`],
    [`unkeyed rows`, `sphere`, sphere_segments, atom_radius, `appearance`],
    [
      `nested unkeyed rows`,
      `nested sphere`,
      nested_sphere_segments,
      atom_radius,
      `appearance`,
    ],
    [
      `nested descriptions`,
      `fine tessellation`,
      nested_sphere_segments,
      atom_radius,
      `appearance`,
    ],
    [
      `matched containers`,
      `nested control collection`,
      nested_sphere_segments,
      atom_radius,
      `appearance`,
    ],
    [`section titles`, `pointer sensitivity`, rotation_damping, atom_radius, `camera`],
    [`group titles`, `camera`, rotation_damping, atom_radius, `camera`],
  ] as const)(`matches $0`, async (_name, query, matched, hidden_selector, group) => {
    const { input, appearance, camera } = await mounted_search()
    const matching_group = group === `appearance` ? appearance : camera
    const other_group = group === `appearance` ? camera : appearance

    await set_query(input, query)
    expect([hidden(matching_group), hidden(other_group)]).toEqual([false, true])
    expect([hidden(element(matched)), hidden(element(hidden_selector))]).toEqual([false, true])
    if (_name.includes(`unkeyed`))
      expect(element(matched).hasAttribute(`data-key`)).toBe(false)
  })

  // Section headings carry Explain/Reset buttons. Folding a heading into its rows' search text
  // must not drag those labels along, or either word would match every row in the section.
  test.each([[`explain`], [`reset`]])(
    `treats the %s heading button as chrome, not searchable text`,
    async (query) => {
      const { input, appearance, camera } = await mounted_search()
      await set_query(input, query)
      expect([hidden(appearance), hidden(camera)]).toEqual([true, true])
      expect(document.body.textContent).toContain(`No settings match`)
    },
  )

  test.each([
    [`default states via Escape`, true, false, `damping`, `damp`, true],
    [`caller choices via query clear`, false, true, `radius`, `radiu`, false],
  ] as const)(
    `restores $0`,
    async (_name, appearance_open, camera_open, query, continued_query, escape) => {
      const { input, appearance, camera } = await mounted_search()
      appearance.open = appearance_open
      camera.open = camera_open
      const matched_group = query === `damping` ? camera : appearance

      await set_query(input, query)
      await set_query(input, continued_query)
      expect(matched_group.open).toBe(true)
      if (escape) {
        input.dispatchEvent(
          new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true, cancelable: true }),
        )
        await tick()
      } else await set_query(input, ``)

      expect(document.querySelector(`.open-search`)).not.toBeNull()
      expect([appearance.open, camera.open]).toEqual([appearance_open, camera_open])
      expect([hidden(appearance), hidden(camera)]).toEqual([false, false])
    },
  )

  test(`preserves caller-hidden rows through idle refresh, search, and clear`, async () => {
    const { input, appearance, camera } = await mounted_search()
    const zoom_speed_row = element(zoom_speed)
    element(`[data-testid="hide-zoom-speed"]`).click()
    await tick()

    // Trigger the observer while idle: search must not replay a stale visibility baseline.
    element(rotation_damping).append(document.createComment(``))
    await settle_observer()
    expect(zoom_speed_row.hidden).toBe(true)

    await set_query(input, `zoom speed`)
    expect([hidden(appearance), hidden(camera)]).toEqual([true, true])
    expect(element(`[role="status"]`).textContent).toContain(`No settings match “zoom speed”.`)

    element(`.clear-search`).click()
    await tick()
    expect(document.querySelector(`input[type="search"]`)).toBeNull()
    expect(document.querySelector(`[role="status"]`)).toBeNull()
    expect(zoom_speed_row.hidden).toBe(true)
  })

  test(`refreshes matches when caller visibility or text changes`, async () => {
    const { input, appearance } = await mounted_search()
    const parent_row = element(`[data-key="sphere-container"]`)
    await set_query(input, `fine tessellation`)

    parent_row.hidden = true
    await settle_observer()
    expect(hidden(appearance)).toBe(true)
    expect(document.querySelector(`[role="status"]`)).not.toBeNull()

    parent_row.hidden = false
    await settle_observer()
    expect(hidden(appearance)).toBe(false)

    await set_query(input, `renamed radius`)
    const radius_text = element(`${atom_radius} span`).firstChild
    if (!radius_text) throw new Error(`Atom radius text node is missing`)
    radius_text.textContent = `Renamed radius`
    await settle_observer()
    expect(hidden(appearance)).toBe(false)
  })

  test(`preserves a caller-hidden row changed during search`, async () => {
    const { input } = await mounted_search()
    const zoom_speed_row = element(zoom_speed)
    await set_query(input, `damping`)
    element(`[data-testid="hide-zoom-speed"]`).click()
    await tick()

    await set_query(input, `zoom speed`)
    expect(zoom_speed_row.hidden).toBe(true)
    await set_query(input, ``)
    expect(zoom_speed_row.hidden).toBe(true)
  })

  test(`keeps its mutation observer while the query changes`, async () => {
    const { input } = await mounted_search()
    const disconnect = vi.spyOn(MutationObserver.prototype, `disconnect`)
    try {
      await set_query(input, `radius`)
      await set_query(input, `damping`)
      await set_query(input, ``)
      expect(disconnect).not.toHaveBeenCalled()
    } finally {
      disconnect.mockRestore()
    }
  })
})
