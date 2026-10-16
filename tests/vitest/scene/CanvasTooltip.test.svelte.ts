import CanvasTooltip from '#lib/scene/CanvasTooltip.svelte'
import type { Vec3 } from '#lib/math.js'
import { createRawSnippet, flushSync } from 'svelte'
import { PerspectiveCamera } from 'three/webgpu'
import { expect, onTestFinished, test } from 'vitest'
import { mount_scene } from './mount'

const px = (length: string) => Number(length.replace(/px$/, ``))

// A PlotTooltip at the projected 3D anchor, right of and below it by the anchor's on-screen
// radius, so the hovered object stays visible; hidden while the anchor is behind the camera
test.each<[string, Vec3, number]>([
  [`point anchor`, [0, 0, 0], 0],
  [`sphere anchor`, [0, 0, 0], 1],
  [`off-center anchor`, [2, 1, 0], 0.5],
])(`%s at %j with radius %s`, async (_desc, position, anchor_radius) => {
  const props = $state({ position, anchor_radius })
  const children = createRawSnippet(() => ({ render: () => `<b>Fe</b>` }))
  const { camera, render_frame, unmount_scene } = mount_scene((anchor) =>
    CanvasTooltip(anchor, {
      get position() {
        return props.position
      },
      get anchor_radius() {
        return props.anchor_radius
      },
      bg_color: `#000000`,
      children,
    }),
  )
  onTestFinished(unmount_scene)
  const cam = camera.current
  if (!(cam instanceof PerspectiveCamera)) throw new Error(`expected threlte's default camera`)
  Object.assign(cam, { fov: 50, aspect: 800 / 600 }).updateProjectionMatrix()
  cam.position.set(0, 0, 10)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  render_frame()
  flushSync()

  const tip = document.querySelector<HTMLElement>(`[role="tooltip"].plot-tooltip`)
  if (!tip) throw new Error(`tooltip not rendered`)
  expect(tip.textContent).toBe(`Fe`)
  // projection by hand: NDC from the camera's frustum, then 800x600 pixels
  const half_height = 10 * Math.tan((25 * Math.PI) / 180) // world units at the anchor's depth
  const px_per_unit = 300 / half_height
  const [screen_x, screen_y] = [
    400 + position[0] * px_per_unit,
    300 - position[1] * px_per_unit,
  ]
  const radius_px = anchor_radius * px_per_unit
  // f64 matrix math; style:left/top serialize 6 decimals, so 1e-5 px
  expect(Math.abs(px(tip.style.left) - (screen_x + radius_px + 4))).toBeLessThan(1e-5)
  expect(Math.abs(px(tip.style.top) - (screen_y + 4))).toBeLessThan(1e-5)

  props.position = [0, 0, 20] // behind the camera
  flushSync()
  expect(document.querySelector(`.plot-tooltip`)).toBeNull()
})
