import FermiSurface from '$lib/fermi-surface/FermiSurface.svelte'
import { mount, unmount, type ComponentProps } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { create_drop_event } from '../setup'

const mounted: ReturnType<typeof mount>[] = []
const mock_animation_frames = (): FrameRequestCallback[] => {
  const callbacks: FrameRequestCallback[] = []
  vi.spyOn(globalThis, `requestAnimationFrame`).mockImplementation((callback) =>
    callbacks.push(callback),
  )
  return callbacks
}
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
      file,
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
  const frame_callbacks = mock_animation_frames()
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

// safe_parse awaits a tick before committing. Without an is_current() check there, a slow
// URL A finishes after URL B and overwrites B's surface (or reports A's parse error over it).
test(`a slow first data_url cannot overwrite a newer one`, async () => {
  const bxsf = (fermi_energy: number) =>
    `# Fermi energy: ${fermi_energy} eV\nBEGIN_BLOCK_BANDGRID_3D\n  band_energies\n  BEGIN_BANDGRID_3D\n    1\n    3 3 3\n    0.0 0.0 0.0\n    1.0 0.0 0.0\n    0.0 1.0 0.0\n    0.0 0.0 1.0\n    BAND:   1\n    5.0 6.0 5.0\n    6.0 7.0 6.0\n    5.0 6.0 5.0\n    6.0 7.0 6.0\n    7.0 8.0 7.0\n    6.0 7.0 6.0\n    5.0 6.0 5.0\n    6.0 7.0 6.0\n    5.0 6.0 5.0\n  END_BANDGRID_3D\nEND_BLOCK_BANDGRID_3D\n`
  const frame_callbacks = mock_animation_frames()
  const responses = new Map<string, (response: Response) => void>()
  vi.spyOn(globalThis, `fetch`).mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (init?.headers) {
      return Promise.resolve(
        new Response(`text`, {
          status: 206,
          headers: { 'content-range': `bytes 0-3/100` },
        }),
      )
    }
    return new Promise((resolve) => responses.set(url, resolve))
  })

  const url_a = `http://x/a.bxsf`
  const url_b = `http://x/b.bxsf`
  const on_file_load = vi.fn()
  const props = $state({ data_url: url_a, on_file_load })
  mounted.push(mount(FermiSurface, { target: document.body, props }))

  await vi.waitFor(() => expect(responses.has(url_a)).toBe(true))
  responses.get(url_a)?.(new Response(bxsf(1)))
  await vi.waitFor(() => expect(frame_callbacks).toHaveLength(1))

  props.data_url = url_b
  await vi.waitFor(() => expect(responses.has(url_b)).toBe(true))
  frame_callbacks.shift()?.(0)
  frame_callbacks.shift()?.(0)

  responses.get(url_b)?.(new Response(bxsf(2)))
  await vi.waitFor(() => expect(frame_callbacks).toHaveLength(1))
  frame_callbacks.shift()?.(0)
  frame_callbacks.shift()?.(0)

  await vi.waitFor(() =>
    expect(on_file_load).toHaveBeenCalledWith(expect.objectContaining({ filename: `b.bxsf` })),
  )
  expect(on_file_load.mock.calls.map(([arg]) => arg.filename)).toEqual([`b.bxsf`])
})
