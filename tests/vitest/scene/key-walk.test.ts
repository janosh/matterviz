// KeyWalk, the keyboard hover every 3D scene shares, and KeyWalkRoot, which feeds it the keys
// of its focused viewer root
import { KeyWalk, KeyWalkRoot, type KeyWalkOptions } from '#lib/scene/key-walk.svelte.js'
import { describe, expect, onTestFinished, test, vi } from 'vite-plus/test'

// A walk over `targets` logging the pointer handlers it replays
const make_walk = (targets: string[], options: Partial<KeyWalkOptions<string>> = {}) => {
  const log: string[] = []
  const walk = new KeyWalk({
    targets: () => targets,
    hover: (target) => log.push(`hover ${target}`),
    leave: (target) => log.push(`leave ${target}`),
    label: (target) => `target ${target}`,
    ...options,
  })
  return { walk, log }
}
const keydown = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent(`keydown`, { key, bubbles: true, cancelable: true, ...init })

describe(`KeyWalk`, () => {
  // keys pressed in turn, whether each was taken, then the cursor's target and the replayed
  // pointer handlers (each step leaves the last target, then enters the next), optionally with
  // the pointer resting on a target
  // oxfmt-ignore
  test.each<[string, string[], boolean[], string | null, string[], string?]>([
    [`first step forward`, [`ArrowRight`], [true], `a`, [`hover a`]],
    [`first step back starts at the end`, [`ArrowLeft`], [true], `c`, [`hover c`]],
    [`Down/Up step like Right/Left`, [`ArrowDown`, `ArrowDown`, `ArrowUp`], [true, true, true],
      `a`, [`hover a`, `leave a`, `hover b`, `leave b`, `hover a`]],
    [`wraps past the end`, [`End`, `ArrowRight`], [true, true], `a`,
      [`hover c`, `leave c`, `hover a`]],
    [`wraps past the start`, [`Home`, `ArrowLeft`], [true, true], `c`,
      [`hover a`, `leave a`, `hover c`]],
    [`Escape leaves, then is left alone`, [`Home`, `Escape`, `Escape`], [true, true, false],
      null, [`hover a`, `leave a`]],
    [`Enter without a click is left alone`, [`Enter`, `Home`, `Enter`, ` `],
      [false, true, false, false], `a`, [`hover a`]],
    [`other keys are left alone`, [`a`, `Tab`, `PageDown`], [false, false, false], null, []],
    [`steps on from the pointer's hover`, [`ArrowRight`], [true], `c`, [`leave b`, `hover c`], `b`],
    [`Escape leaves the pointer's hover`, [`Escape`], [true], null, [`leave b`], `b`],
  ])(`%s`, (_label, keys, taken, current, log_expected, pointer) => {
    const { walk, log } = make_walk([`a`, `b`, `c`], {
      hovered: (target) => target === pointer,
    })
    expect(keys.map((key) => walk.handle_key(keydown(key)))).toEqual(taken)
    expect(walk.current).toBe(current)
    expect(walk.message).toBe(current === null ? `` : `target ${current}`)
    expect(log).toEqual(log_expected)
  })

  test(`Enter/Space click the cursor's target, Escape unpins before it clears`, () => {
    const click = vi.fn()
    let pinned = false
    const unpin = vi.fn(() => {
      const was = pinned
      pinned = false
      return was
    })
    const { walk, log } = make_walk([`a`, `b`], { click, unpin })
    expect(walk.handle_key(keydown(`Enter`))).toBe(false) // no cursor yet
    walk.handle_key(keydown(`End`))
    expect([`Enter`, ` `].map((key) => walk.handle_key(keydown(key)))).toEqual([true, true])
    expect(click.mock.calls).toEqual([[`b`], [`b`]])
    pinned = true
    expect(walk.handle_key(keydown(`Escape`))).toBe(true) // unpins, keeps the cursor
    expect(walk.current).toBe(`b`)
    expect(walk.handle_key(keydown(`Escape`))).toBe(true) // clears
    expect([walk.current, log]).toEqual([null, [`hover b`, `leave b`]])
    expect(unpin).toHaveBeenCalledTimes(2)
  })

  test.each<[string, string, KeyboardEventInit]>([
    [`Ctrl chord`, `ArrowRight`, { ctrlKey: true }],
    [`Alt chord`, `ArrowRight`, { altKey: true }],
    [`Meta chord`, `Home`, { metaKey: true }],
    [`composing`, `ArrowRight`, { isComposing: true }],
  ])(`leaves %s alone`, (_label, key, init) => {
    const { walk, log } = make_walk([`a`])
    expect(walk.handle_key(keydown(key, init))).toBe(false)
    const handled = keydown(`ArrowRight`)
    handled.preventDefault() // something before the walk took it
    expect(walk.handle_key(handled)).toBe(false)
    expect(log).toEqual([])
  })

  test(`no targets: nothing to walk, a cursor whose target is gone counts as none`, () => {
    const targets = [`a`]
    const { walk, log } = make_walk(targets)
    walk.handle_key(keydown(`ArrowRight`))
    targets.pop()
    expect(walk.current).toBeNull()
    expect(
      [`ArrowRight`, `End`, `Escape`].map((key) => walk.handle_key(keydown(key))),
    ).toEqual([false, false, false])
    walk.clear()
    expect(log).toEqual([`hover a`])
  })
})

describe(`KeyWalkRoot`, () => {
  // A focusable root with a button inside, inside an enclosing viewer that takes ArrowLeft
  const mount_root = () => {
    const outer = document.createElement(`div`)
    const node = Object.assign(document.createElement(`div`), { tabIndex: 0 })
    const button = document.createElement(`button`)
    node.append(button)
    outer.append(node)
    document.body.append(outer)
    outer.addEventListener(`keydown`, (event) => {
      if (event.key === `ArrowLeft`) event.preventDefault()
    })
    const root = new KeyWalkRoot()
    const { walk, log } = make_walk([`a`, `b`, `c`])
    root.walk = walk
    onTestFinished(root.attach(node))
    onTestFinished(() => outer.remove())
    const press = (target: HTMLElement, key: string) => {
      const event = keydown(key)
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    return { root, walk, log, node, button, press }
  }

  test(`walks on keys at the focused root only, after enclosing viewers' own keys`, () => {
    const { root, walk, node, button, press } = mount_root()
    expect(press(button, `ArrowRight`)).toBe(false) // a control inside keeps its keys
    expect(walk.current).toBeNull()
    expect(press(node, `ArrowRight`)).toBe(true)
    expect(root.message).toBe(`target a`)
    expect(press(node, `ArrowLeft`)).toBe(true) // taken by the enclosing viewer, not walked
    expect(walk.current).toBe(`a`)
    root.walk = null // the scene unregistered
    expect([press(node, `ArrowRight`), root.message]).toEqual([false, ``])
  })

  test(`focus leaving the root clears the cursor, moving inside it does not`, () => {
    const { walk, log, node, button, press } = mount_root()
    press(node, `ArrowRight`)
    node.dispatchEvent(new FocusEvent(`focusout`, { relatedTarget: button }))
    expect(walk.current).toBe(`a`)
    node.dispatchEvent(new FocusEvent(`focusout`, { relatedTarget: null }))
    expect(walk.current).toBeNull()
    expect(log).toEqual([`hover a`, `leave a`])
  })
})
