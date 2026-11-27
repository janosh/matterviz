import { renderer_registry, scene_registry } from '#lib/io/export'
import { camera_flight_registry } from '#lib/scene/camera-flight'
import CameraFlightPane from '#lib/scene/CameraFlightPane.svelte'
import { mount, tick, unmount } from 'svelte'
import type { Scene, WebGPURenderer } from 'three/webgpu'
import { PerspectiveCamera } from 'three/webgpu'
import { expect, onTestFinished, test, vi } from 'vite-plus/test'
import { doc_query, mock_canvas_context } from '../setup'
import { flight_controller } from './mount'

// The playhead caption numbers MD frames from 1 like the trajectory's step input
test(`numbers the MD frame caption from 1 and lets file drops on waypoints reach the viewer`, async () => {
  mock_canvas_context()
  vi.spyOn(HTMLCanvasElement.prototype, `toDataURL`).mockReturnValue(`data:image/webp;base64,`)
  const canvas = document.createElement(`canvas`)
  const camera = new PerspectiveCamera(50)
  camera.position.set(0, 0, 10)
  camera_flight_registry.set(canvas, flight_controller(camera))
  const renderer = { init: async () => {}, render: vi.fn() }
  renderer_registry.set(canvas, renderer as unknown as WebGPURenderer)
  scene_registry.set(canvas, { scene: {} as Scene, camera })
  const timeline = { start: 0, end: 9, current: 4, prepare: async () => {} }
  const props = { open: true, canvas, timeline, on_export: vi.fn() }
  const pane = mount(CameraFlightPane, {
    target: document.body,
    props: { ...props, filename: `md`, class_prefix: `md` },
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
  // a file dropped on a waypoint reaches the enclosing viewer's drop zone; a waypoint
  // dragged onto another is the pane's own reorder
  const reached_viewer = vi.fn()
  document.body.addEventListener(`drop`, reached_viewer)
  onTestFinished(() => document.body.removeEventListener(`drop`, reached_viewer))
  const [first_waypoint, second_waypoint] = document.querySelectorAll(`.waypoint`)
  const drop_on = (target: Element) => {
    const event = new Event(`drop`, { bubbles: true, cancelable: true })
    Object.defineProperty(event, `dataTransfer`, { value: null })
    target.dispatchEvent(event)
    return event.defaultPrevented
  }
  expect(drop_on(first_waypoint)).toBe(false)
  expect(reached_viewer).toHaveBeenCalledOnce()
  const drag_start = new Event(`dragstart`, { bubbles: true })
  Object.defineProperty(drag_start, `dataTransfer`, { value: { setData: vi.fn() } })
  second_waypoint.dispatchEvent(drag_start)
  expect(drop_on(first_waypoint)).toBe(true)
  expect(reached_viewer).toHaveBeenCalledOnce()
  // the default 10 s and other round durations are no step mismatch against min 0.1
  const duration = doc_query<HTMLInputElement>(`input[aria-label="Flight duration"]`)
  for (const typed of [`10`, `2`, `0.25`]) {
    duration.value = typed
    expect(duration.validity.stepMismatch, typed).toBe(false)
  }
})
