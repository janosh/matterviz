import type { GizmoOptions } from '$lib/scene'
import { gizmo_rect, responsive_gizmo_size } from '$lib/scene'
import Gizmo from '$lib/scene/Gizmo.svelte'
import { createSchedulerContext, currentWritable } from '@threlte/core'
import type * as threlte_core from '@threlte/core'
import { flushSync, mount, unmount } from 'svelte'
import { type Camera, Mesh, PerspectiveCamera, Scene } from 'three/webgpu'
import { describe, expect, test, vi } from 'vitest'
import { bind_props } from '../setup'

let make_threlte: () => unknown
vi.mock(`@threlte/core`, async (original) => ({
  ...(await original<typeof threlte_core>()),
  useThrelte: () => make_threlte(),
  useParent: () => currentWritable(undefined),
}))

test.each([0, 200])(
  `gizmo fade (%i ms) and camera flight finish without pointer-driven redraws`,
  async (fade_duration) => {
    const main_scene = new Scene()
    const camera = new PerspectiveCamera()
    camera.position.set(3, 3, 3)
    const passes: { scene: Scene; camera: Camera; opacity?: number }[] = []
    const renderer = {
      initialized: true,
      domElement: document.createElement(`canvas`),
      autoClear: true,
      getViewport: vi.fn(),
      getScissor: vi.fn(),
      getScissorTest: () => false,
      setViewport: vi.fn(),
      setScissor: vi.fn(),
      setScissorTest: vi.fn(),
      clearDepth: vi.fn(),
      render(scene: Scene, render_camera: Camera) {
        scene.updateMatrixWorld()
        const handle = scene.children[0]
        const opacity =
          handle instanceof Mesh && !Array.isArray(handle.material)
            ? handle.material.opacity
            : undefined
        passes.push({ scene, camera: render_camera, opacity })
      },
    }
    let scheduler_context: ReturnType<typeof createSchedulerContext> | undefined
    make_threlte = () => {
      const context = createSchedulerContext(() => ({
        renderMode: `on-demand`,
        autoRender: true,
      }))
      scheduler_context = context
      const auto_render_task = context.renderStage.createTask(Symbol(`main-render`), () =>
        renderer.render(main_scene, camera),
      )
      return {
        ...context,
        autoRenderTask: auto_render_task,
        renderer,
        camera: currentWritable(camera),
        size: currentWritable({ width: 400, height: 300 }),
        dom: renderer.domElement,
      }
    }
    const props = $state({ visible: false })
    const on_start = vi.fn()
    const on_end = vi.fn()
    const component = mount(Gizmo, {
      target: document.body,
      props: bind_props({ fade_duration, on_start, on_end }, props),
    })
    flushSync()
    if (!scheduler_context) throw new Error(`Gizmo did not initialize its scheduler`)
    const context = scheduler_context
    let elapsed = 0
    const frame = () => {
      elapsed += 50
      passes.length = 0
      context.scheduler.run(elapsed)
      context.frameInvalidated.current = false
      return passes.map(({ scene }) => (scene === main_scene ? `main` : `gizmo`))
    }
    try {
      expect(frame()).toEqual([`main`])
      expect(frame()).toEqual([])
      props.visible = true
      flushSync()
      const fade_frames = fade_duration === 0 ? 1 : 4
      for (let idx = 0; idx < fade_frames; idx++) expect(frame()).toEqual([`main`, `gizmo`])
      expect(passes.at(-1)?.opacity).toBe(0.8)
      expect(frame()).toEqual([]) // settled on-demand scene stays idle
      // Repeated atom-hover redraws must not change the settled opacity.
      for (let idx = 0; idx < 5; idx++) {
        context.invalidate()
        expect(frame()).toEqual([`main`, `gizmo`])
        expect(passes.at(-1)?.opacity).toBe(0.8)
      }
      props.visible = false
      flushSync()
      for (let idx = 0; idx < fade_frames; idx++) {
        expect(frame()).toEqual(idx === fade_frames - 1 ? [`main`] : [`main`, `gizmo`])
      }
      expect(frame()).toEqual([])
      context.invalidate()
      expect(frame()).toEqual([`main`]) // no stale gizmo after leaving

      props.visible = true
      flushSync()
      for (let idx = 0; idx < fade_frames; idx++) frame()
      const gizmo_pass = passes.at(-1)
      if (!gizmo_pass) throw new Error(`Missing gizmo render before axis click`)
      // Click the +X sphere, then hide the gizmo mid-flight. The camera must still land
      // without further pointer events, and stop requesting frames when it finishes.
      const point = gizmo_pass.scene.children[0].position.clone().project(gizmo_pass.camera)
      const rect = gizmo_rect({}, 400, 300)
      const click_position = {
        clientX: rect.x + ((point.x + 1) * rect.width) / 2,
        clientY: rect.y + ((1 - point.y) * rect.height) / 2,
      }
      for (const type of [`pointerdown`, `pointerup`]) {
        renderer.domElement.dispatchEvent(new PointerEvent(type, click_position))
      }
      expect(on_start).toHaveBeenCalledOnce()
      props.visible = false
      flushSync()
      for (let idx = 0; idx < 8; idx++) expect(frame()).toContain(`main`)
      expect(on_end).toHaveBeenCalledOnce()
      // Absolute tolerance 1e-12 for a radius ~5 camera rotation computed in f64.
      const target_position = camera.position.clone().set(Math.sqrt(27), 0, 0)
      expect(camera.position.distanceTo(target_position)).toBeLessThan(1e-12)
      expect(frame()).toEqual([])
      expect(renderer.autoClear).toBe(true)
    } finally {
      await unmount(component)
    }
  },
)

// Multi-view panes shrink their gizmo with the pane. Playwright used to assert this off the
// gizmo's DOM box, but the WebGPU gizmo draws inside the canvas and has no element.
describe(`responsive_gizmo_size`, () => {
  // one fifth of the short side, clamped to [34, 72]
  test.each([
    [1200, 900, 72, `above the cap clamps to the single-view size`],
    [400, 300, 60, `inside the linear region`],
    [250, 400, 50, `the shorter side wins regardless of orientation`],
    [400, 178, 36, `rounds to whole px`],
    [200, 150, 34, `below the floor clamps up to stay legible`],
    [0, 0, 34, `pre-layout zero size still yields a usable gizmo`],
  ])(`(%i, %i) -> %i (%s)`, (width, height, expected) => {
    expect(responsive_gizmo_size(width, height)).toBe(expected)
  })

  test(`never grows as the pane shrinks`, () => {
    const sizes = Array.from({ length: 80 }, (_, idx) =>
      responsive_gizmo_size(idx * 25, idx * 25),
    )
    expect(sizes.every((size, idx) => idx === 0 || size >= sizes[idx - 1])).toBe(true)
  })
})

// The rect is both the WebGPU viewport the gizmo renders into and the hit-test box for
// pointer events, so the two can only agree if this one function is right.
describe(`gizmo_rect`, () => {
  // oxfmt-ignore
  test.each([
    // unsized: 18% of the short side clamped to [70, 100], 5 px off the anchored edges
    [`default bottom-left on a wide canvas`, {}, 800, 600, { x: 5, y: 495, width: 100, height: 100 }],
    [`small canvas floors the box at 70`, {}, 200, 200, { x: 5, y: 125, width: 70, height: 70 }],
    [`top-right with custom offsets`, { placement: `top-right`, size: 60, offset: { right: 10, top: 20 } }, 800, 600, { x: 730, y: 20, width: 60, height: 60 }],
    [`bottom-right defaults the unset edges to 5`, { placement: `bottom-right`, size: 40, offset: { bottom: 30 } }, 300, 200, { x: 255, y: 130, width: 40, height: 40 }],
    [`top-left ignores right/bottom offsets`, { placement: `top-left`, size: 40, offset: { right: 99, bottom: 99 } }, 300, 200, { x: 5, y: 5, width: 40, height: 40 }],
    [`fill covers the whole canvas, square or not`, { placement: `fill`, size: 40, offset: { left: 9 } }, 300, 200, { x: 0, y: 0, width: 300, height: 200 }],
    // a viewport past the attachment fails WebGPU validation, so clamp instead of overflowing
    [`oversized request shrinks to the short side and pins to the bottom edge`, { size: 500 }, 120, 90, { x: 5, y: 0, width: 90, height: 90 }],
    [`canvas narrower than box + gap pins the left edge`, { placement: `bottom-right` }, 72, 200, { x: 0, y: 125, width: 70, height: 70 }],
    [`pre-layout zero canvas yields an empty rect at the origin`, {}, 0, 0, { x: 0, y: 0, width: 0, height: 0 }],
  ] as [string, GizmoOptions, number, number, ReturnType<typeof gizmo_rect>][])(
    `%s`,
    (_name, options, width, height, expected) => {
      expect(gizmo_rect(options, width, height)).toEqual(expected)
    },
  )

  test(`always stays inside the canvas`, () => {
    const placements = [`top-left`, `top-right`, `bottom-left`, `bottom-right`] as const
    for (const width of [0, 1, 30, 75, 120, 640]) {
      for (const height of [0, 1, 30, 75, 120, 480]) {
        for (const placement of placements) {
          for (const size of [undefined, 10, 70, 1000]) {
            const rect = gizmo_rect({ placement, size }, width, height)
            expect(rect.x).toBeGreaterThanOrEqual(0)
            expect(rect.y).toBeGreaterThanOrEqual(0)
            expect(rect.x + rect.width).toBeLessThanOrEqual(width)
            expect(rect.y + rect.height).toBeLessThanOrEqual(height)
            expect(rect.width).toBe(rect.height)
          }
        }
      }
    }
  })
})
