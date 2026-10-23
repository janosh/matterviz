import { pick_pane_orientation } from '#lib/layout/pane-orientation.js'
import { expect, test } from 'vitest'

// Unmeasured (0 or negative) sizes split side by side; when only one split leaves panes of at
// least 320x180 it wins (a 490x500 sidebar card stacks), otherwise pane shape decides
test.each([
  [0, 0, `horizontal`],
  [800, 0, `horizontal`],
  [490, 500, `vertical`],
  [700, 300, `horizontal`],
  [1200, 500, `horizontal`],
  [900, 800, `vertical`],
] as const)(`pick_pane_orientation(%d, %d) = %s`, (width, height, expected) => {
  expect(pick_pane_orientation(width, height)).toBe(expected)
})
