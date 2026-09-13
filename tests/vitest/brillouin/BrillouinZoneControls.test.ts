import { BrillouinZoneControls } from '$lib/brillouin'
import { mount, tick } from 'svelte'
import { DEFAULTS } from '$lib/settings'
import { doc_query } from '../setup'
import { expect, test } from 'vitest'

test(`Brillouin zone controls preserve slider precision, edit hex colors and reset values`, async () => {
  mount(BrillouinZoneControls, {
    target: document.body,
    props: { controls_open: true, edge_width: 0.019, show_ibz: true },
  })

  const width_input = doc_query<HTMLInputElement>(`input[type="range"][step="0.001"]`)
  expect(width_input.previousElementSibling?.textContent).toBe(`0.019`)
  doc_query<HTMLButtonElement>(`button[aria-label="Reset edges to defaults"]`).click()
  await tick()
  expect(width_input.value).toBe(String(DEFAULTS.brillouin.edge_width))
  expect(document.querySelector(`button[aria-label="Reset edges to defaults"]`)).toBeNull()
  for (const label of [`Surface color`, `Edge color`, `IBZ color`]) {
    const hex = doc_query<HTMLInputElement>(`input[aria-label="${label} hex"]`)
    const picker = doc_query<HTMLInputElement>(`input[aria-label="${label}"]`)
    const initial = picker.value
    hex.value = `#wrong`
    hex.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()
    expect(hex.getAttribute(`aria-invalid`)).toBe(`true`)
    expect(picker.value).toBe(initial)
    hex.value = `#abc`
    hex.dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
    expect([hex.value, picker.value]).toEqual([`#aabbcc`, `#aabbcc`])
  }
})
