import BrillouinZone from '#lib/brillouin/BrillouinZone.svelte'
import FermiSurface from '#lib/fermi-surface/FermiSurface.svelte'
import ShortcutsHelp from '#lib/layout/ShortcutsHelp.svelte'
import ScatterPlot3D from '#lib/plot/scatter-3d/ScatterPlot3D.svelte'
import type * as camera_reset from '#lib/scene/camera-reset.js'
import { reset_scene_cameras } from '#lib/scene/camera-reset.js'
import {
  format_shortcut_keys,
  SHORTCUTS,
  shortcut_attrs,
  type ShortcutScope,
  shortcuts_for,
  viewer_keys,
} from '#lib/shortcuts.js'
import { type Component, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { fire } from './setup'

vi.mock(`#lib/scene/camera-reset.js`, async (original) => ({
  ...(await original<typeof camera_reset>()),
  reset_scene_cameras: vi.fn(() => true),
}))

const mounted: ReturnType<typeof mount>[] = []
afterEach(async () => {
  for (const component of mounted.splice(0)) await unmount(component)
  document.body.replaceChildren()
  vi.clearAllMocks()
})

const create_root = (parent: HTMLElement = document.body): HTMLDivElement => {
  const root = document.createElement(`div`)
  parent.append(root)
  return root
}
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = globalThis) =>
  fire(target, new KeyboardEvent(`keydown`, { key, bubbles: true, cancelable: true, ...init }))

describe(`shortcut registry`, () => {
  test.each([
    [SHORTCUTS.reset_camera, `R`],
    [SHORTCUTS.first, `Home / Ctrl+←`],
    [SHORTCUTS.speed, `- / +`],
    [SHORTCUTS.redo, `Ctrl+Y / ⌘+Y / Ctrl+Shift+Z / ⌘+Shift+Z`],
    [SHORTCUTS.jump, `0-9`],
    [SHORTCUTS.help, `?`],
  ])(`formats %j as %s`, (shortcut, expected) => {
    expect(format_shortcut_keys(shortcut)).toBe(expected)
  })

  test(`buttons take aria-keyshortcuts and a title hint from the registry`, () => {
    expect(shortcut_attrs(`reset_camera`)).toEqual({
      'aria-keyshortcuts': `R`,
      title: `Reset camera (R)`,
    })
    expect(shortcut_attrs(`view_mode`, `Plot-only`).title).toBe(`Plot-only (V / Shift+V)`)
  })

  test(`shortcuts_for lists each matching entry once, in registry order`, () => {
    const listed = shortcuts_for([`camera`, `brillouin`, `brillouin`])
    expect(listed).toEqual([SHORTCUTS.reset_camera, SHORTCUTS.info_pane])
    expect(shortcuts_for([])).toEqual([])
  })
})

describe(`viewer_keys`, () => {
  // Keys reach the viewer under the pointer (window keydown) or with focus inside it
  test.each([
    [`hovered plain key`, `x`, {}, `hover`, true],
    [`focused plain key`, `x`, {}, `focus`, true],
    [`uppercase letter`, `X`, {}, `hover`, true],
    [`unhovered viewer`, `x`, {}, `none`, false],
    [`Ctrl chord`, `x`, { ctrlKey: true }, `hover`, false],
    [`Cmd chord`, `x`, { metaKey: true }, `hover`, false],
    [`autorepeat`, `x`, { repeat: true }, `hover`, false],
    [`unbound key`, `y`, {}, `hover`, false],
  ] as const)(`%s`, async (_name, key, init, via, handled) => {
    const root = create_root()
    const button = document.createElement(`button`)
    root.append(button)
    const action = vi.fn()
    const detach = viewer_keys(() => ({ x: action }))(root)
    if (via === `hover`) root.dispatchEvent(new PointerEvent(`pointerenter`))
    const event = new KeyboardEvent(`keydown`, {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    })
    await fire(via === `focus` ? button : globalThis, event)
    expect(action).toHaveBeenCalledTimes(handled ? 1 : 0)
    expect(event.defaultPrevented).toBe(handled)
    detach()
  })

  test(`typing in a field is left alone and an action returning false keeps the key`, async () => {
    const root = create_root()
    const input = document.createElement(`input`)
    root.append(input)
    const action = vi.fn(() => false)
    viewer_keys(() => ({ x: action, Escape: action }))(root)
    const typed = new KeyboardEvent(`keydown`, { key: `x`, bubbles: true, cancelable: true })
    await fire(input, typed)
    expect(action).not.toHaveBeenCalled()
    const escape = new KeyboardEvent(`keydown`, {
      key: `Escape`,
      bubbles: true,
      cancelable: true,
    })
    await fire(root, escape)
    expect(action).toHaveBeenCalledOnce()
    expect(escape.defaultPrevented).toBe(false)
  })
})

describe(`ShortcutsHelp`, () => {
  const mount_help = (wrapper: HTMLElement, scopes: ShortcutScope[]) => {
    const target = create_root(wrapper)
    mounted.push(mount(ShortcutsHelp, { target, props: { scopes, wrapper } }))
    return target
  }
  const listed = () =>
    [...document.querySelectorAll(`.shortcuts-list dd`)].map((node) => node.textContent)

  test(`? and the header button toggle the hovered viewer's shortcut list`, async () => {
    const root = create_root()
    const target = mount_help(root, [`viewer`])
    await tick()
    expect(root.getAttribute(`data-mv-shortcuts`)).toBe(`viewer`)
    const button = target.querySelector<HTMLButtonElement>(`button.shortcuts-btn`)
    expect(button?.getAttribute(`aria-keyshortcuts`)).toBe(`?`)

    root.dispatchEvent(new PointerEvent(`pointerenter`))
    await press(`?`, { shiftKey: true })
    expect(listed()).toEqual([
      SHORTCUTS.help.description,
      SHORTCUTS.fullscreen.description,
      SHORTCUTS.close.description,
    ])
    expect(button?.getAttribute(`aria-expanded`)).toBe(`true`)
    await press(`?`, { shiftKey: true })
    expect(document.querySelector(`.shortcuts-list`)).toBeNull()
    await fire(button)
    expect(listed()).toHaveLength(3)
  })

  // Like `f`, the outer viewer owns `?` and lists the scopes of the viewers active inside it
  test(`a nested viewer defers ? to the outer one, which lists both`, async () => {
    const outer = create_root()
    const inner = create_root(outer)
    mount_help(outer, [`viewer`, `sequence`])
    mount_help(inner, [`camera`])
    await tick()
    const focused = document.createElement(`button`)
    inner.append(focused)
    focused.focus()
    await press(`?`, { shiftKey: true }, focused) // bubbles through inner to outer
    expect(document.querySelectorAll(`.shortcuts-list`)).toHaveLength(1)
    expect(listed()).toContain(SHORTCUTS.reset_camera.description)
    expect(listed()).toContain(SHORTCUTS.play.description)
  })
})

// `r` resets the camera of every 3D viewer through SceneCamera's shared reset, only while
// that viewer is hovered (or holds focus)
test.each([
  [`BrillouinZone`, BrillouinZone, `.brillouin-zone`],
  [`FermiSurface`, FermiSurface, `.fermi-surface`],
  [`ScatterPlot3D`, ScatterPlot3D, `.scatter-3d`],
] as [string, Component, string][])(
  `%s resets its camera on r`,
  async (_name, comp, selector) => {
    mounted.push(mount(comp, { target: document.body, props: {} }))
    await tick()
    const root = document.querySelector<HTMLElement>(selector)
    if (!root) throw new Error(`${selector} missing`)
    await press(`r`)
    expect(reset_scene_cameras).not.toHaveBeenCalled()
    root.dispatchEvent(new PointerEvent(`pointerenter`))
    await press(`r`)
    expect(reset_scene_cameras).toHaveBeenCalledExactlyOnceWith(root)
    await press(`r`, { ctrlKey: true }) // Cmd/Ctrl+R stays the browser's reload
    expect(reset_scene_cameras).toHaveBeenCalledOnce()
  },
)
