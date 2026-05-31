import Trajectory from '$lib/trajectory/Trajectory.svelte'
import type { TrajectoryType } from '$lib/trajectory'
import { type ComponentProps, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import {
  assert_hover_scoped_shortcut,
  bind_props,
  doc_query,
  make_trajectory_frame,
  press_window_key,
} from '../setup'

// 5 frames gives headroom so a leaked ArrowRight visibly advances the step
// instead of no-opping at the last frame (which would mask a missing guard).
const trajectory: TrajectoryType = {
  frames: [0, 1, 2, 3, 4].map((step) => make_trajectory_frame(step, 1)),
}

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

    await assert_hover_scoped_shortcut({
      viewer,
      fire: () => press_window_key({ key: `ArrowRight` }),
      read_state: () => state.current_step_idx,
    })
  })

  test(`suppresses the browser default only for keys it handles`, async () => {
    const viewer = await mount_trajectory()
    viewer.dispatchEvent(new MouseEvent(`mouseenter`))
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
  })

  // Kept standalone: needs a fresh mount with fullscreen off and NOT playing. Can't
  // fold into the test above, whose Space case toggles play (which would make =/+/-
  // handled), and whose default mount has fullscreen on (which would handle f).
  test(`keeps browser default when a shortcut's inner condition fails`, async () => {
    const viewer = await mount_trajectory(undefined, { fullscreen_toggle: false })
    viewer.dispatchEvent(new MouseEvent(`mouseenter`))
    await tick()

    for (const init of [{ key: `f` }, { key: `=` }, { key: `+` }, { key: `-` }]) {
      expect(press_window_key(init).defaultPrevented, JSON.stringify(init)).toBe(false)
    }
  })

  test(`Cmd/Ctrl modifier is ignored for navigation except arrows (first/last)`, async () => {
    const state = { current_step_idx: 0 }
    const viewer = await mount_trajectory(state)
    viewer.dispatchEvent(new MouseEvent(`mouseenter`))
    await tick()

    press_window_key({ key: `1`, ctrlKey: true }) // browser shortcut → no navigation
    expect(state.current_step_idx, `Ctrl+1 must not navigate`).toBe(0)
    press_window_key({ key: `ArrowRight`, ctrlKey: true }) // intentional → jump to last
    expect(state.current_step_idx, `Ctrl+ArrowRight → last frame`).toBe(4)
  })
})
