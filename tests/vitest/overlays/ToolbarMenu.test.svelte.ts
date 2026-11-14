import ToolbarMenu from '#lib/overlays/ToolbarMenu.svelte'
import { createRawSnippet, flushSync, mount, tick, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vite-plus/test'
import { dismiss_popover, doc_query } from '../setup'

test.each([`light dismiss`, `Escape`, `unmount`, `state`] as const)(
  `opens a native popover menu that %s closes`,
  async (closer) => {
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
    onTestFinished(async () => {
      if (closer !== `unmount`) await unmount(component)
    })
    await tick()
    doc_query<HTMLButtonElement>(`button[aria-label="Display mode"]`).click()
    await tick()
    const menu = doc_query(`.view-mode-dropdown`)
    expect(menu.getAttribute(`popover`)).toBe(`auto`)
    doc_query<HTMLButtonElement>(`.view-mode-option`).click()
    expect(choose_option).toHaveBeenCalledOnce()
    expect(set_open.mock.calls).toEqual([[true]])

    // happy-dom lacks the popover API: report the menu open and close it as the browser would
    const matches = menu.matches.bind(menu)
    let shown = true
    vi.spyOn(menu, `matches`).mockImplementation((selector) =>
      selector === `:popover-open` ? shown : matches(selector),
    )
    const connected_at_hide: boolean[] = []
    const hide = vi.spyOn(menu, `hidePopover`).mockImplementation(() => {
      connected_at_hide.push(menu.isConnected)
      shown = false
      dismiss_popover(menu)
    })
    if (closer === `state`) {
      // a picked option closes it through `open`: hidden while still in the DOM (Chromium kept
      // stale :hover on the host when an open top-layer element was removed under the pointer),
      // and silently, as the caller already knows
      state.open = false
      flushSync()
      expect(connected_at_hide).toEqual([true])
      expect(document.querySelector(`.view-mode-dropdown`)).toBeNull()
      expect(set_open.mock.calls).toEqual([[true]])
      return
    }
    if (closer === `unmount`) {
      // closes silently: an attachment re-run (new anchor or callback) must not report a close
      await unmount(component)
      expect(hide).toHaveBeenCalledOnce()
      expect(set_open.mock.calls).toEqual([[true]])
      return
    }
    if (closer === `Escape`) {
      // a host viewer's own Escape handling must not see it (or cancel the close)
      const host_keydown = vi.fn()
      document.body.addEventListener(`keydown`, host_keydown)
      onTestFinished(() => document.body.removeEventListener(`keydown`, host_keydown))
      const option = doc_query<HTMLButtonElement>(`.view-mode-option`)
      option.focus()
      option.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }))
      expect(host_keydown).not.toHaveBeenCalled()
      expect(hide).toHaveBeenCalled()
      expect(document.activeElement?.getAttribute(`aria-label`)).toBe(`Display mode`)
    } else dismiss_popover(menu)
    await tick()
    expect(document.querySelector(`.view-mode-dropdown`)).toBeNull()
    expect(set_open.mock.calls).toEqual([[true], [false]])
  },
)
