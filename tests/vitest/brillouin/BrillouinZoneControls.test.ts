import { BrillouinZoneControls } from '$lib/brillouin'
import { mount } from 'svelte'
import { expect, test } from 'vitest'

test(`Brillouin zone edge width readout preserves slider precision`, () => {
  mount(BrillouinZoneControls, {
    target: document.body,
    props: { controls_open: true, edge_width: 0.019 },
  })

  const width_input = document.querySelector<HTMLInputElement>(
    `input[type="range"][step="0.001"]`,
  )
  expect(width_input?.previousElementSibling?.textContent).toBe(`0.019`)
})
