import BrillouinZone from '#lib/brillouin/BrillouinZone.svelte'
import FermiSurface from '#lib/fermi-surface/FermiSurface.svelte'
import ShortcutsList from 'svelte-widgets/ShortcutsList.svelte'
import ScatterPlot3D from '#lib/plot/scatter-3d/ScatterPlot3D.svelte'
import type * as camera_reset from '#lib/scene/camera-reset'
import { reset_scene_cameras } from '#lib/scene/camera-reset'
import { SHORTCUTS, shortcut_entries, shortcuts_for } from '#lib/shortcuts'
import type { ShortcutScope } from '#lib/shortcuts'
import { format_shortcut_keys, shortcut_attrs } from 'svelte-widgets/shortcuts'
import type { Shortcut } from 'svelte-widgets/shortcuts'
import { type Component, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { fire, keydown } from './setup'

const { fullscreen: full, close, reset_camera, wheel_zoom, hover_walk, info_pane } = SHORTCUTS

vi.mock(`#lib/scene/camera-reset`, async (original) => ({
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
    [SHORTCUTS.redo, `Ctrl+Y / ⌘+Y / Ctrl+⇧+Z / ⌘+⇧+Z`],
    [SHORTCUTS.jump, `0-9`],
    [SHORTCUTS.close, `Esc`],
    [SHORTCUTS.wheel_zoom, `⌘/Ctrl + scroll`],
  ])(`formats %j as %s`, (shortcut, expected) => {
    expect(format_shortcut_keys(shortcut)).toBe(expected)
  })

  test(`buttons take aria-keyshortcuts and a title hint from the registry`, () => {
    expect(shortcut_attrs(SHORTCUTS.reset_camera)).toEqual({
      'aria-keyshortcuts': `R`,
      title: `Reset camera (R)`,
    })
    expect(shortcut_attrs(SHORTCUTS.view_mode, `Plot-only`).title).toBe(`Plot-only (V / ⇧+V)`)
  })

  test(`shortcuts_for lists each matching entry once, in registry order`, () => {
    const listed = shortcuts_for([`camera`, `brillouin`, `brillouin`])
    expect(listed).toEqual([reset_camera, wheel_zoom, hover_walk, info_pane])
    expect(shortcuts_for([])).toEqual([])
  })

  // a Structure lists its mode's scope: no key twice, so none a mode doesn't handle
  test.each([`structure-view`, `structure-edit-atoms`, `structure-edit-bonds`] as const)(
    `a Structure in %s lists each key once`,
    (mode) => {
      const keys = shortcuts_for([`viewer`, `structure`, `camera`, mode]).flatMap((shortcut) =>
        shortcut.keys.split(` `),
      )
      expect(keys.filter((key, idx) => keys.indexOf(key) !== idx)).toEqual([])
    },
  )
})

describe(`shortcut_entries in ShortcutsList`, () => {
  // Lists exactly the given scopes' entries, collapsed until opened; `F` only where the host
  // can fullscreen
  test.each([
    [[`viewer`, `camera`], true, [full, close, reset_camera, wheel_zoom, hover_walk]],
    [
      [`viewer`, `camera`, `brillouin`],
      false,
      [close, reset_camera, wheel_zoom, hover_walk, info_pane],
    ],
    [[`viewer`], false, [close]],
  ] as [ShortcutScope[], boolean, Shortcut[]][])(
    `scopes %j (fullscreen %s)`,
    async (scopes, fullscreen, expected) => {
      const target = create_root()
      const shortcuts = shortcut_entries(scopes, fullscreen)
      mounted.push(mount(ShortcutsList, { target, props: { shortcuts } }))
      await tick()
      const details = target.querySelector<HTMLDetailsElement>(`details.shortcuts-list`)
      expect(details?.open).toBe(false)
      expect(details?.querySelector(`summary`)?.textContent).toBe(`Keyboard shortcuts`)
      const listed = [...target.querySelectorAll(`dd`)].map((node) => node.textContent)
      expect(listed).toEqual(expected.map((shortcut) => shortcut.description))
      const keys = [...target.querySelectorAll(`dt`)].map((node) =>
        node.textContent?.replaceAll(/\s+/g, ` `).trim(),
      )
      expect(keys).toEqual(expected.map(format_shortcut_keys))
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
