// The Threlte canvas never mounts under happy-dom (no navigator.gpu), so the viewport is
// swapped for a stub that only reports an isosurface worker failure. This pins the host side
// of Isosurface's error path: Structure registers a handler in context, Isosurface (a few
// layers down) picks it up without pass-through props, and the message lands in a
// dismissible warning notice.
import { get_isosurface_error_handler } from '$lib/isosurface/context'
import Structure from '$lib/structure/Structure.svelte'
import { structures } from '$site/structures'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { doc_query, make_grid, make_volume } from '../setup'

const worker_message = `Isosurface geometry failed: Failed to fetch dynamically imported module`
vi.mock(`$lib/structure/StructureViewport.svelte`, () => ({
  // Plain Svelte 5 component function: reads the context handler the way Isosurface does and
  // fires it as Isosurface would after its geometry worker rejects
  default: () => {
    const on_error = get_isosurface_error_handler()
    $effect(() => on_error?.(worker_message))
  },
}))

let component: ReturnType<typeof mount> | undefined
afterEach(async () => {
  if (component) await unmount(component)
  component = undefined
  Reflect.deleteProperty(navigator, `gpu`)
})

test(`Isosurface worker failures surface as a dismissible warning in Structure`, async () => {
  // The viewport stage is gated on webgpu_available(); the stub never touches a GPU
  Object.defineProperty(navigator, `gpu`, { value: {}, configurable: true })
  component = mount(Structure, {
    target: document.body,
    props: {
      structure: structures[0],
      volumetric_data: [make_volume(make_grid(2, 2, 2, 1))],
      analyze_symmetry: false,
    },
  })
  await tick()
  const notice = doc_query(`.isosurface-error`)
  expect(notice.textContent).toContain(worker_message)
  expect(notice.getAttribute(`role`)).toBe(`status`)
  // Not the fatal error path: the viewer stays up around the notice
  expect(document.querySelector(`.status-message.error`)).toBeNull()
  expect(document.querySelector(`.structure`)).toBeInstanceOf(HTMLElement)
  doc_query<HTMLButtonElement>(`.isosurface-error button`).click()
  flushSync()
  expect(document.querySelector(`.isosurface-error`)).toBeNull()
})
