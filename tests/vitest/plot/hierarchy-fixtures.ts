// Fixtures shared by the Sunburst and Treemap tests
import type { SunburstNode, SunburstNodeHandlerProps } from '#lib/plot/index.js'
import { expect, type Mock } from 'vite-plus/test'

// A (explicit color) -> {A1: 4, A2: 6}, B: 10. Root total = 20.
export const tree: SunburstNode[] = [
  {
    label: `A`,
    color: `#e15759`,
    children: [
      { label: `A1`, value: 4 },
      { label: `A2`, value: 6 },
    ],
  },
  { label: `B`, value: 10 },
]

// Hovering leaf A1 of `tree` fires on_node_hover once with its breadcrumb payload
export const expect_a1_hover = (on_node_hover: Mock): void => {
  expect(on_node_hover).toHaveBeenCalledOnce()
  expect(on_node_hover.mock.calls[0][0] as SunburstNodeHandlerProps).toMatchObject({
    type: `node`,
    label: `A1`,
    value: 4,
    depth: 2,
    is_leaf: true,
    path: [`A`, `A/A1`],
    label_path: [`A`, `A1`],
    fraction: expect.closeTo(0.2, 9),
    parent_fraction: expect.closeTo(0.4, 9),
  })
}
