import { renderer_registry, scene_registry } from '#lib/io/export.js'
import {
  camera_flight_registry,
  create_camera_flight_controller,
} from '#lib/scene/camera-flight.js'
import CameraFlightPane from '#lib/scene/CameraFlightPane.svelte'
import { mount, tick, unmount } from 'svelte'
import type { Scene, WebGPURenderer } from 'three/webgpu'
import { PerspectiveCamera, Vector3 } from 'three/webgpu'
import { expect, onTestFinished, test, vi } from 'vitest'
import { doc_query, mock_canvas_context } from '../setup'

// The playhead caption numbers MD frames from 1 like the trajectory's step input
test(`numbers the MD frame caption from 1`, async () => {
  mock_canvas_context()
  vi.spyOn(HTMLCanvasElement.prototype, `toDataURL`).mockReturnValue(`data:image/webp;base64,`)
  const canvas = document.createElement(`canvas`)
  const camera = new PerspectiveCamera(50)
  camera.position.set(0, 0, 10)
  const controller = create_camera_flight_controller(
    { object: camera, target: new Vector3() },
    () => ({ width: 800, height: 600 }),
    vi.fn(),
    vi.fn(),
  )
  camera_flight_registry.set(canvas, controller)
  renderer_registry.set(canvas, {
    init: async () => {},
    render: vi.fn(),
  } as unknown as WebGPURenderer)
  scene_registry.set(canvas, { scene: {} as Scene, camera })
  const timeline = { start: 0, end: 9, current: 4, prepare: async () => {} }
  const pane = mount(CameraFlightPane, {
    target: document.body,
    props: {
      open: true,
      canvas,
      filename: `md`,
      timeline,
      on_export: vi.fn(),
      class_prefix: `md`,
    },
  })
  onTestFinished(() => unmount(pane))
  await tick()
  const orbit = [...document.querySelectorAll(`button`)].find((button) =>
    button.title.startsWith(`Create a complete orbit`),
  )
  orbit?.click()
  await vi.waitFor(() =>
    expect(document.querySelectorAll(`.waypoint`).length).toBeGreaterThan(1),
  )
  expect(doc_query(`.playhead`).textContent).toContain(`MD frame 5 (1–10)`)
})
