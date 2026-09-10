import { BrillouinZoneControls } from '$lib/brillouin'
import { mount, tick } from 'svelte'
import { DEFAULTS } from '$lib/settings'
import { doc_query } from '../setup'
import { expect, test } from 'vitest'

test(`Brillouin zone edge width readout preserves slider precision and resets authored values`, async () => {
  mount(BrillouinZoneControls, {
    target: document.body,
    props: { controls_open: true, edge_width: 0.019 },
  })

  const width_input = document.querySelector<HTMLInputElement>(
    `input[type="range"][step="0.001"]`,
  )
  expect(width_input?.previousElementSibling?.textContent).toBe(`0.019`)
  doc_query<HTMLButtonElement>(`button[aria-label="Reset edges to defaults"]`).click()
  await tick()
  expect(width_input?.value).toBe(String(DEFAULTS.brillouin.edge_width))
  expect(document.querySelector(`button[aria-label="Reset edges to defaults"]`)).toBeNull()
})
