// Playback (create_sequence_player) and SequenceControls are tested in svelte-widgets
import { normalize_show_controls, type ShowControlsProp } from '#lib/controls'
import SequenceControlBar from '#lib/layout/SequenceControlBar.svelte'
import { createRawSnippet, flushSync } from 'svelte'
import { expect, test } from 'vite-plus/test'
import { bind_props, mount_in_test } from '../setup'

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
