import { Structure } from '$lib'
import { structures } from '$site'
import { tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '.'

const structure = structures[0]

describe(`Structure`, () => {
  test(`open control panel when clicking toggle button`, async () => {
    new Structure({ target: document.body, props: { structure } })

    const dialog = doc_query<HTMLDialogElement>(`dialog`)
    expect(dialog.open).toBe(false)
    doc_query<HTMLButtonElement>(`button.controls-toggle`).click()
    await tick()

    expect(dialog.open).toBe(true)
  })

  test(`JSON file download when clicking download button`, async () => {
    window.URL.createObjectURL = vi.fn()

    new Structure({
      target: document.body,
      props: { structure },
    })
    const spy = vi.spyOn(document.body, `appendChild`)

    doc_query<HTMLButtonElement>(
      `button[title='Download Structure as JSON']`
    ).click()
    await tick()

    expect(window.URL.createObjectURL).toHaveBeenCalledOnce()
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(spy).toHaveBeenCalledOnce()
    expect(spy).toHaveBeenCalledWith(expect.any(HTMLAnchorElement))

    spy.mockRestore()
    // @ts-expect-error - function is mocked
    window.URL.createObjectURL.mockRestore()
  })
})
