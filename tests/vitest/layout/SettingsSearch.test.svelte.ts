import { mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import SettingsSearchHarness from './SettingsSearchHarness.svelte'

const element = (selector: string): HTMLElement => {
  const match = document.querySelector<HTMLElement>(selector)
  if (!match) throw new Error(`Missing element: ${selector}`)
  return match
}
const hidden = (node: HTMLElement): boolean =>
  Boolean(node.hidden) || node.hasAttribute(`data-search-hidden`)
const set_query = async (input: HTMLInputElement, query: string): Promise<void> => {
  input.value = query
  input.dispatchEvent(new Event(`input`, { bubbles: true }))
  await tick()
}

const mounted_search = async (): Promise<{
  input: HTMLInputElement
  appearance: HTMLDetailsElement
  camera: HTMLDetailsElement
}> => {
  mount(SettingsSearchHarness, { target: document.body })
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
  test.each([
    [
      `labels`,
      `radius`,
      `[data-key="atom_radius"]`,
      `[data-key="color_scheme"]`,
      `appearance`,
    ],
    [
      `descriptions`,
      `motion inertia`,
      `[data-key="rotation_damping"]`,
      `[data-key="zoom_speed"]`,
      `camera`,
    ],
    [
      `unkeyed rows`,
      `sphere`,
      `[data-testid="sphere-segments"]`,
      `[data-key="atom_radius"]`,
      `appearance`,
    ],
    [
      `nested unkeyed rows`,
      `nested sphere`,
      `[data-testid="nested-sphere-segments"]`,
      `[data-key="atom_radius"]`,
      `appearance`,
    ],
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

      expect(input.value).toBe(``)
      expect([appearance.open, camera.open]).toEqual([appearance_open, camera_open])
      expect([hidden(appearance), hidden(camera)]).toEqual([false, false])
    },
  )

  test(`preserves caller-hidden rows through idle refresh, search, and clear`, async () => {
    const { input, appearance, camera } = await mounted_search()
    const zoom_speed = element(`[data-key="zoom_speed"]`)
    element(`[data-testid="hide-zoom-speed"]`).click()
    await tick()

    // Trigger the observer while idle: search must not replay a stale visibility baseline.
    element(`[data-key="rotation_damping"]`).append(document.createComment(``))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(zoom_speed.hidden).toBe(true)

    await set_query(input, `zoom speed`)
    expect([hidden(appearance), hidden(camera)]).toEqual([true, true])
    expect(element(`[role="status"]`).textContent).toContain(`No settings match “zoom speed”.`)

    element(`.clear-search`).click()
    await tick()
    expect(input.value).toBe(``)
    expect(document.querySelector(`[role="status"]`)).toBeNull()
    expect(zoom_speed.hidden).toBe(true)
  })

  test(`preserves a caller-hidden row changed during search`, async () => {
    const { input } = await mounted_search()
    const zoom_speed = element(`[data-key="zoom_speed"]`)
    await set_query(input, `damping`)
    element(`[data-testid="hide-zoom-speed"]`).click()
    await tick()

    await set_query(input, `zoom speed`)
    expect(zoom_speed.hidden).toBe(true)
    await set_query(input, ``)
    expect(zoom_speed.hidden).toBe(true)
  })
})
