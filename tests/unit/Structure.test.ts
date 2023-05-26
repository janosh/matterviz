import { Structure } from '$lib'
import { structures } from '$site'
import { tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '.'

describe(`Structure`, () => {
  test(`open control panel when clicking toggle button`, async () => {
    new Structure({
      target: document.body,
      props: { structure: structures[0] },
    })
    doc_query<HTMLButtonElement>(`button.controls-toggle`).click()
    await tick()

    const form = doc_query<HTMLDivElement>(`div.controls form`)
    expect(form).not.toBe(null)
  })

  test(`reset view button should reset zoom`, async () => {
    const component = new Structure({
      target: document.body,
      props: { structure: structures[0] },
    })

    component.zoom = 0.5

    expect(component.zoom).toBe(0.5)
    doc_query<HTMLButtonElement>(`button.reset-camera`).click()

    expect(component.zoom).toBe(1 / 50)
  })
})
