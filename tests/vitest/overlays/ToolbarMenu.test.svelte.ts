import ToolbarMenu from '$lib/overlays/ToolbarMenu.svelte'
import { createRawSnippet, mount, tick, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import { doc_query } from '../setup'

test(`outside presses close only open menus and leave option actions intact`, async () => {
  const state = $state({ open: false })
  const set_open = vi.fn((value: boolean) => (state.open = value))
  const choose_option = vi.fn()
  const component = mount(ToolbarMenu, {
    target: document.body,
    props: {
      label: `Display mode`,
      get open() {
        return state.open
      },
      set open(value: boolean) {
        set_open(value)
      },
      button: createRawSnippet(() => ({ render: () => `<span>Display</span>` })),
      children: createRawSnippet(() => ({
        render: () => `<button type="button" class="view-mode-option">Scatter</button>`,
        setup: (element) => {
          element.addEventListener(`click`, choose_option)
          return () => element.removeEventListener(`click`, choose_option)
        },
      })),
    },
  })
  onTestFinished(() => unmount(component))
  await tick()
  const press = async (element: Element) => {
    element.dispatchEvent(new PointerEvent(`pointerdown`, { bubbles: true }))
    await tick()
  }

  await press(document.body)
  expect(set_open).not.toHaveBeenCalled()
  doc_query<HTMLButtonElement>(`button[aria-label="Display mode"]`).click()
  await tick()
  const option = doc_query<HTMLButtonElement>(`.view-mode-option`)
  await press(option)
  option.click()
  expect(choose_option).toHaveBeenCalledOnce()
  expect(state.open).toBe(true)
  expect(set_open.mock.calls).toEqual([[true]])

  await press(document.body)
  expect(state.open).toBe(false)
  expect(document.querySelector(`.view-mode-dropdown`)).toBeNull()
  await press(document.body)
  expect(set_open.mock.calls).toEqual([[true], [false]])
})
