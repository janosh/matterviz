// Playback (create_sequence_player) and SequenceControls are tested in svelte-widgets
import { normalize_show_controls, type ShowControlsProp } from '#lib/controls'
import SequenceControlBar from '#lib/layout/SequenceControlBar.svelte'
import { createRawSnippet, flushSync } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vite-plus/test'
import { bind_props, mount_in_test, query, trigger_resize_observer } from '../setup'

// Drive the rAF loop by hand: each frame callback is queued, the returned function pops and
// runs one
const stub_animation_frames = () => {
  const callbacks: FrameRequestCallback[] = []
  let next_id = 1
  vi.spyOn(globalThis, `requestAnimationFrame`).mockImplementation((callback_fn) => {
    callbacks.push(callback_fn)
    return next_id++
  })
  vi.spyOn(globalThis, `cancelAnimationFrame`).mockImplementation(() => {})
  onTestFinished(() => {
    vi.restoreAllMocks()
  })
  return (timestamp: number) => {
    const callback = callbacks.shift()
    if (!callback) throw new Error(`Missing animation frame callback`)
    callback(timestamp)
    flushSync()
  }
}

// `never` hides the bar, except that an active fullscreen controller inside must stay mounted
test.each([
  [`hover`, false, `shown`],
  [`never`, false, `absent`],
  [`never`, true, `hidden`],
] satisfies [ShowControlsProp, boolean, `shown` | `hidden` | `absent`][])(
  `SequenceControlBar with show_controls=%j fullscreen=%s: %s`,
  (show_controls, fullscreen, expected) => {
    const state = $state({ height: 0 })
    const children = createRawSnippet(() => ({
      render: () => `<button class="play">x</button>`,
    }))
    const controls_config = normalize_show_controls(show_controls)
    const target = mount_in_test(
      SequenceControlBar,
      bind_props({ controls_config, fullscreen, children }, state),
    )
    flushSync()
    const bar = target.querySelector<HTMLElement>(`.sequence-control-bar`)
    expect(!bar ? `absent` : bar.style.display === `none` ? `hidden` : `shown`).toBe(expected)
    expect(target.querySelector(`.play`) !== null).toBe(expected !== `absent`)
    // happy-dom reports clientHeight 600 for every element (tests/vitest/environment.ts)
    expect(state.height).toBe(expected === `absent` ? 0 : 600)
  },
)

// The slider row stacks only when the controls beside it leave the slider under its flex-basis
// and returns once they fit: a bar_width bar minus a button (10), the step input (50) and count
// (30) leaves bar_width - 90 against the slider's 100px. The button's margin doesn't count (an
// auto margin resolves to all the free space once stacked, so counting it would never unstack).
test.each([
  [200, false],
  [190, false],
  [185, true],
])(`a %ipx SequenceControlBar stacks the slider row: %s`, (bar_width, stacked) => {
  // happy-dom has no layout: elements report the width their data-width names
  const run_frame = stub_animation_frames()
  vi.spyOn(Element.prototype, `getBoundingClientRect`).mockImplementation(function (
    this: Element,
  ) {
    return { width: Number(this.getAttribute(`data-width`) ?? 0) } as DOMRect
  })
  onTestFinished(() => {
    vi.restoreAllMocks()
  })
  const children = createRawSnippet(() => ({
    render: () => `<div class="step-section">
      <input data-width="50" /><span data-width="30"></span>
      <div class="slider-container" style="flex-basis: 100px"></div>
    </div>`,
  }))
  const target = mount_in_test(SequenceControlBar, {
    controls_config: normalize_show_controls(`always`),
    children,
  })
  flushSync()
  const bar = query(target, `.sequence-control-bar`)
  // a control mounting later (picked up by the bar's MutationObserver)
  bar.insertAdjacentHTML(
    `afterbegin`,
    `<button data-width="10" style="margin-inline-start: 60px"></button>`,
  )
  const resize_to = (width: number) => {
    Object.defineProperty(bar, `clientWidth`, { value: width, configurable: true })
    trigger_resize_observer(bar)
    flushSync()
    run_frame(0) // measured a frame later, outside the observer's callback
  }
  resize_to(bar_width)
  expect(bar.classList.contains(`stack_step`)).toBe(stacked)
  resize_to(200) // widening to a fitting width unstacks the row
  expect(bar.classList.contains(`stack_step`)).toBe(false)
})
