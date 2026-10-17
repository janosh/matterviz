import BrillouinZone from '#lib/brillouin/BrillouinZone.svelte'
import FermiSurface from '#lib/fermi-surface/FermiSurface.svelte'
import { host } from '#lib/host.js'
import ShortcutsList from '#lib/layout/ShortcutsList.svelte'
import ScatterPlot3D from '#lib/plot/scatter-3d/ScatterPlot3D.svelte'
import type * as camera_reset from '#lib/scene/camera-reset.js'
import { reset_scene_cameras } from '#lib/scene/camera-reset.js'
import {
  format_shortcut_keys,
  SHORTCUTS,
  shortcut_attrs,
  shortcuts_for,
  viewer_keys,
} from '#lib/shortcuts.js'
import type { Shortcut, ShortcutScope } from '#lib/shortcuts.js'
import { type Component, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { fire, keydown } from './setup'

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
const key_event = (key: string, init: KeyboardEventInit = {}) =>
  keydown(key, { cancelable: true, ...init })
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = globalThis) =>
  fire(target, key_event(key, init))

describe(`shortcut registry`, () => {
  test.each([
    [SHORTCUTS.reset_camera, `R`],
    [SHORTCUTS.first, `Home / Ctrl+←`],
    [SHORTCUTS.speed, `- / +`],
    [SHORTCUTS.redo, `Ctrl+Y / ⌘+Y / Ctrl+Shift+Z / ⌘+Shift+Z`],
    [SHORTCUTS.jump, `0-9`],
    [SHORTCUTS.close, `Esc`],
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
    expect(listed).toEqual([SHORTCUTS.reset_camera, SHORTCUTS.hover_walk, SHORTCUTS.info_pane])
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
    [`autorepeat`, `x`, { repeat: true }, `hover`, false],
    [`unbound key`, `y`, {}, `hover`, false],
  ] as const)(`%s`, async (_name, key, init, via, handled) => {
    const root = create_root()
    const button = document.createElement(`button`)
    root.append(button)
    const action = vi.fn()
    const detach = viewer_keys(() => ({ x: action }))(root)
    if (via === `hover`) root.dispatchEvent(new PointerEvent(`pointerenter`))
    const event = key_event(key, init)
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
    await press(`x`, {}, input)
    expect(action).not.toHaveBeenCalled()
    const escape = key_event(`Escape`)
    await fire(root, escape)
    expect(action).toHaveBeenCalledOnce()
    expect(escape.defaultPrevented).toBe(false)
  })
})

describe(`ShortcutsList`, () => {
  const orig_fullscreen = host.fullscreen
  afterEach(() => {
    host.fullscreen = orig_fullscreen
  })

  // Lists exactly the given scopes' entries, collapsed until opened; `F` only where the host
  // can fullscreen
  const { fullscreen: full, close, reset_camera, hover_walk, info_pane } = SHORTCUTS
  test.each([
    [[`viewer`, `camera`], true, [full, close, reset_camera, hover_walk]],
    [[`viewer`, `camera`, `brillouin`], false, [close, reset_camera, hover_walk, info_pane]],
    [[`viewer`], false, [close]],
  ] as [ShortcutScope[], boolean, Shortcut[]][])(
    `scopes %j (fullscreen %s)`,
    async (scopes, fullscreen, expected) => {
      host.fullscreen = fullscreen
      const target = create_root()
      mounted.push(mount(ShortcutsList, { target, props: { scopes } }))
      await tick()
      const details = target.querySelector<HTMLDetailsElement>(`details.shortcuts-list`)
      expect(details?.open).toBe(false)
      expect(details?.querySelector(`summary`)?.textContent).toBe(`Keyboard shortcuts`)
      const listed = [...target.querySelectorAll(`dd`)].map((node) => node.textContent)
      expect(listed).toEqual(expected.map((shortcut) => shortcut.description))
      expect(target.querySelector(`dt kbd`)?.textContent).toBe(
        format_shortcut_keys(expected[0]),
      )
    },
  )
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
  },
)
