import FermiSurface from '$lib/fermi-surface/FermiSurface.svelte'
import { mount, unmount, type ComponentProps } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const create_drop_event = (file: File): DragEvent => {
  const drag_event = new DragEvent(`drop`, { bubbles: true })
  Object.defineProperty(drag_event, `dataTransfer`, {
    value: { files: [file], getData: () => `` },
  })
  return drag_event
}

const mounted: ReturnType<typeof mount>[] = []
const drop_file = (file: File, props: ComponentProps<typeof FermiSurface> = {}): void => {
  mounted.push(mount(FermiSurface, { target: document.body, props }))
  const drop_zone = document.querySelector<HTMLElement>(`.fermi-surface`)
  if (!drop_zone) throw new Error(`Fermi surface drop zone not found`)
  drop_zone.dispatchEvent(create_drop_event(file))
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const component of mounted.splice(0)) await unmount(component)
})

test(`custom file drop handler receives content and bypasses default parsing`, async () => {
  const drop_deferred = Promise.withResolvers<undefined>()
  const on_file_drop = vi.fn(() => drop_deferred.promise)
  const on_error = vi.fn()
  const content = `custom Fermi surface content`
  const file = new File([content], `custom.txt`)
  drop_file(file, { on_file_drop, on_error })

  await vi.waitFor(() => {
    expect(on_file_drop).toHaveBeenCalledWith(content, file.name, {
      source_filename: file.name,
    })
    expect(document.body.textContent).toContain(`Loading Fermi surface...`)
  })
  drop_deferred.resolve(undefined)
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(`Drop Fermi Surface File`),
  )
  expect(on_error).not.toHaveBeenCalled()
})

test(`default file parsing yields while loading state renders`, async () => {
  const frame_callbacks: FrameRequestCallback[] = []
  vi.spyOn(globalThis, `requestAnimationFrame`).mockImplementation((callback) => {
    frame_callbacks.push(callback)
    return frame_callbacks.length
  })
  const on_file_load = vi.fn()
  const content = JSON.stringify({
    isosurfaces: [],
    k_lattice: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    fermi_energy: 0,
    reciprocal_cell: `wigner_seitz`,
    metadata: { n_bands: 1, n_surfaces: 0, total_area: 0 },
  })
  const file = new File([content], `fermi.json`)
  drop_file(file, { on_file_load })

  await vi.waitFor(() => expect(frame_callbacks).toHaveLength(1))
  expect(document.body.textContent).toContain(`Loading Fermi surface...`)
  expect(on_file_load).not.toHaveBeenCalled()
  frame_callbacks.shift()?.(0)
  frame_callbacks.shift()?.(0)

  await vi.waitFor(() =>
    expect(on_file_load).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: file.name,
        source_filename: file.name,
      }),
    ),
  )
})
