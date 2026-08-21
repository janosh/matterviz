import Trajectory from '$lib/trajectory/Trajectory.svelte'
import { trajectory_from_frames } from '$lib/trajectory'
import { type ComponentProps, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import {
  assertHoverScopedShortcut,
  bind_props,
  doc_query,
  make_trajectory_frame,
  press_window_key,
} from '../setup'

// 5 frames gives headroom so a leaked ArrowRight visibly advances the step
// instead of no-opping at the last frame (which would mask a missing guard).
const trajectory = trajectory_from_frames(
  [0, 1, 2, 3, 4].map((step) => make_trajectory_frame(step, 1)),
)

// Unmount between tests so each viewer's <svelte:window> keydown listener is
// removed — otherwise a lingering hovered viewer responds to later tests' keys.
const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
  for (const app of mounted.splice(0)) void unmount(app)
})

// Mount a Trajectory viewer and return its wrapper. Pass `state` to two-way bind
// current_step_idx for navigation assertions; `extra` to override props.
const mount_trajectory = async (
  state?: { current_step_idx: number },
  extra?: Partial<ComponentProps<typeof Trajectory>>,
): Promise<HTMLElement> => {
  const props: ComponentProps<typeof Trajectory> = {
    trajectory,
    display_mode: `structure`,
    show_controls: `never`,
    ...extra,
  }
  mounted.push(
    mount(Trajectory, {
      target: document.body,
      props: state ? bind_props(props, state) : props,
    }),
  )
  await tick()
  return doc_query(`.trajectory`)
}

describe(`Trajectory keyboard shortcuts`, () => {
  test(`window keydown navigation is scoped to the hovered viewer`, async () => {
    const state = { current_step_idx: 0 }
    const viewer = await mount_trajectory(state)

    const fire = () => press_window_key({ key: `ArrowRight` })
    const read_state = () => state.current_step_idx
    await assertHoverScopedShortcut({ viewer, fire, read_state })
  })

  test(`suppresses browser defaults only for handled keys outside editing contexts`, async () => {
    const state = { current_step_idx: 0 }
    const viewer = await mount_trajectory(state)
    viewer.dispatchEvent(new PointerEvent(`pointerenter`))
    await tick()
    // handled (nav keys + Cmd/Ctrl+Arrow) suppress default; plain typing keys and
    // Cmd/Ctrl browser shortcuts (find/tab/jump) keep theirs
    const cases: [KeyboardEventInit, boolean][] = [
      [{ key: ` ` }, true],
      [{ key: `ArrowLeft` }, true],
      [{ key: `ArrowRight` }, true],
      [{ key: `Home` }, true],
      [{ key: `End` }, true],
      [{ key: `PageUp` }, true],
      [{ key: `PageDown` }, true],
      [{ key: `ArrowRight`, ctrlKey: true }, true],
      [{ key: `q` }, false],
      [{ key: `Tab` }, false],
      [{ key: `f`, ctrlKey: true }, false],
      [{ key: `1`, ctrlKey: true }, false],
      [{ key: `j`, ctrlKey: true }, false],
      [{ key: `l`, ctrlKey: true }, false],
    ]
    for (const [init, prevented] of cases) {
      expect(press_window_key(init).defaultPrevented, JSON.stringify(init)).toBe(prevented)
    }
    const step_before = state.current_step_idx
    const select = document.createElement(`select`)
    const editable = document.createElement(`div`)
    editable.contentEditable = `true`

    for (const target of [select, editable]) {
      viewer.append(target)
      target.focus()
      const event = new KeyboardEvent(`keydown`, {
        key: `ArrowRight`,
        bubbles: true,
        cancelable: true,
      })
      target.dispatchEvent(event)
      expect([state.current_step_idx, event.defaultPrevented]).toEqual([step_before, false])
    }
  })

  test(`only suppresses defaults for available viewer shortcuts`, async () => {
    const viewer = await mount_trajectory(undefined, { fullscreen_toggle: false })
    viewer.dispatchEvent(new PointerEvent(`pointerenter`))
    await tick()

    for (const [key, prevented] of [
      [`f`, false],
      [`=`, true],
      [`+`, true],
      [`-`, true],
    ] as const) {
      expect(press_window_key({ key }).defaultPrevented, key).toBe(prevented)
    }
  })

  test(`Cmd/Ctrl modifier is ignored for navigation except arrows (first/last)`, async () => {
    const state = { current_step_idx: 0 }
    const viewer = await mount_trajectory(state)
    viewer.dispatchEvent(new PointerEvent(`pointerenter`))
    await tick()

    press_window_key({ key: `1`, ctrlKey: true }) // browser shortcut → no navigation
    expect(state.current_step_idx, `Ctrl+1 must not navigate`).toBe(0)
    press_window_key({ key: `ArrowRight`, ctrlKey: true }) // intentional → jump to last
    expect(state.current_step_idx, `Ctrl+ArrowRight → last frame`).toBe(4)
  })
})
