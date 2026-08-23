import FermiSurface from '$lib/fermi-surface/FermiSurface.svelte'
import { type BandGridJson, normalize_fermi_surface } from '$lib/fermi-surface/parse'
import type { BandGridData, FermiSurfaceData } from '$lib/fermi-surface/types'
import { createRawSnippet, mount, tick, unmount, type ComponentProps } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { bind_props, create_drop_event, IDENTITY_MATRIX3, make_bxsf } from '../setup'

const mounted: ReturnType<typeof mount>[] = []
const mock_animation_frames = (): FrameRequestCallback[] => {
  const callbacks: FrameRequestCallback[] = []
  vi.spyOn(globalThis, `requestAnimationFrame`).mockImplementation((callback) =>
    callbacks.push(callback),
  )
  return callbacks
}
const drop_file = async (
  file: File,
  props: ComponentProps<typeof FermiSurface> = {},
): Promise<void> => {
  mounted.push(mount(FermiSurface, { target: document.body, props }))
  await tick() // the drop-zone attachment is wired one flush after mount
  const drop_zone = document.querySelector<HTMLElement>(`.fermi-surface`)
  if (!drop_zone) throw new Error(`Fermi surface drop zone not found`)
  drop_zone.dispatchEvent(create_drop_event(file))
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const component of mounted.splice(0)) await unmount(component)
})

test(`custom file drop handler receives content and bypasses default parsing`, async () => {
  const drop_deferred = Promise.withResolvers<undefined>()
  const on_file_drop = vi.fn(() => drop_deferred.promise)
  const on_error = vi.fn()
  const content = `custom Fermi surface content`
  const file = new File([content], `custom.txt`)
  await drop_file(file, { on_file_drop, on_error })

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
    k_lattice: IDENTITY_MATRIX3,
    fermi_energy: 0,
    reciprocal_cell: `wigner_seitz`,
    metadata: { n_bands: 1, n_surfaces: 0 },
  })
  const file = new File([content], `fermi.json`)
  await drop_file(file, { on_file_load })

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
  const frame_callbacks = mock_animation_frames()
  const responses = new Map<string, (response: Response) => void>()
  vi.spyOn(globalThis, `fetch`).mockImplementation((input) => {
    const url = input instanceof Request ? input.url : input.toString()
    return new Promise((resolve) => responses.set(url, resolve))
  })

  const url_a = `http://x/a.bxsf`
  const url_b = `http://x/b.bxsf`
  const on_file_load = vi.fn()
  const props = $state({ data_url: url_a, on_file_load })
  mounted.push(mount(FermiSurface, { target: document.body, props }))

  await vi.waitFor(() => expect(responses.has(url_a)).toBe(true))
  responses.get(url_a)?.(new Response(make_bxsf(1)))
  await vi.waitFor(() => expect(frame_callbacks).toHaveLength(1))

  props.data_url = url_b
  await vi.waitFor(() => expect(responses.has(url_b)).toBe(true))
  frame_callbacks.shift()?.(0)
  frame_callbacks.shift()?.(0)

  responses.get(url_b)?.(new Response(make_bxsf(2)))
  await vi.waitFor(() => expect(frame_callbacks).toHaveLength(1))
  frame_callbacks.shift()?.(0)
  frame_callbacks.shift()?.(0)

  await vi.waitFor(() =>
    expect(on_file_load).toHaveBeenCalledWith(expect.objectContaining({ filename: `b.bxsf` })),
  )
  expect(on_file_load.mock.calls.map(([arg]) => arg.filename)).toEqual([`b.bxsf`])
})

// Extracting a surface from a URL-loaded grid stores a new fermi_data. A bound parent hands
// back a proxy of it, so claiming the raw result left the loader reading the proxy as
// caller-supplied: it dropped the URL and never fetched the next one.
test(`a second data_url still loads after re-extraction with a bound fermi_data`, async () => {
  vi.useFakeTimers({
    toFake: [`setTimeout`, `clearTimeout`, `requestAnimationFrame`, `cancelAnimationFrame`],
  })
  vi.spyOn(globalThis, `fetch`).mockImplementation(() =>
    Promise.resolve(new Response(make_bxsf(6))),
  )
  const on_file_load = vi.fn()
  const props = $state({
    data_url: `http://x/a.bxsf`,
    fermi_data: undefined as FermiSurfaceData | undefined,
    on_file_load,
  })
  mounted.push(mount(FermiSurface, { target: document.body, props }))
  await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(1))
  await vi.advanceTimersByTimeAsync(300) // extraction debounce + paint ticks
  expect(props.fermi_data?.isosurfaces.length).toBeGreaterThan(0)

  props.data_url = `http://x/b.bxsf`
  await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(2))
  expect(on_file_load.mock.calls[1][0].filename).toBe(`b.bxsf`)
})

// Regression: with only `band_data` supplied (no parse path), the viewer used to render nothing
// because extraction ran solely inside safe_parse. The extraction effect must also react to
// mu / interpolation_factor changes.
test(`extracts fermi_data from a band_data prop and re-extracts when mu changes`, async () => {
  // Faking rAF too keeps the extraction's yield-to-paint tick on the fake clock, so the test
  // can observe the viewer mid-extraction (150 ms debounce, then two ~16 ms frames)
  vi.useFakeTimers({
    toFake: [`setTimeout`, `clearTimeout`, `requestAnimationFrame`, `cancelAnimationFrame`],
  })
  const grid_n = 6
  const values = new Float64Array(grid_n ** 3)
  let idx = 0
  for (let ix = 0; ix < grid_n; ix++) {
    for (let iy = 0; iy < grid_n; iy++) {
      for (let iz = 0; iz < grid_n; iz++) {
        values[idx++] = Math.hypot(ix / 5 - 0.5, iy / 5 - 0.5, iz / 5 - 0.5)
      }
    }
  }
  const band_data = {
    energies: [
      [
        {
          values,
          dims: [grid_n, grid_n, grid_n] as [number, number, number],
          order: `z_fastest` as const,
        },
      ],
    ],
    k_grid: [grid_n, grid_n, grid_n] as [number, number, number],
    k_lattice: IDENTITY_MATRIX3,
    fermi_energy: 0.3,
    n_bands: 1,
    n_spins: 1,
  }
  const props = $state<{
    band_data?: BandGridData
    fermi_data?: FermiSurfaceData
    mu: number
  }>({
    band_data,
    fermi_data: undefined,
    mu: 0,
  })
  mounted.push(mount(FermiSurface, { target: document.body, props }))
  await vi.advanceTimersByTimeAsync(200)
  expect(props.fermi_data?.isosurfaces).toHaveLength(1)
  const n_vertices_at_0 = props.fermi_data?.isosurfaces[0].positions.length
  // The viewer chrome (and the Canvas it sits next to) must survive re-extraction: the
  // spinner overlays it rather than replacing it, so the WebGPU renderer is not torn down
  const chrome = document.querySelector(`.fermi-surface .control-buttons`)
  expect(chrome).not.toBeNull()

  props.mu = 0.1 // bigger sphere → more vertices
  await vi.advanceTimersByTimeAsync(160) // past the debounce, inside the extraction tick
  expect(document.body.textContent).toContain(`Extracting Fermi surface...`)
  expect(document.querySelector(`.fermi-surface .control-buttons`)).toBe(chrome)
  await vi.advanceTimersByTimeAsync(100)
  expect(document.body.textContent).not.toContain(`Extracting Fermi surface...`)
  expect(props.fermi_data?.isosurfaces[0].positions.length).toBeGreaterThan(
    n_vertices_at_0 ?? 0,
  )
  expect(document.querySelector(`.fermi-surface .control-buttons`)).toBe(chrome)

  // Clearing band_data mid-extraction must not commit a surface for the vanished grid
  const committed = props.fermi_data
  props.mu = 0.2
  await vi.advanceTimersByTimeAsync(160)
  props.band_data = undefined
  await vi.advanceTimersByTimeAsync(200)
  expect(props.fermi_data).toBe(committed)
  expect(document.body.textContent).not.toContain(`Extracting Fermi surface...`)
  vi.useRealTimers()
})

// pymatviz's FermiSurfaceWidget(fermi_data=...) trait can only carry JSON, so the mesh arrives
// as plain vertices/faces/normals rows (IFermi `as_dict()` or our own export format) rather
// than the Float32Array/Uint32Array form parse_fermi_file returns. Both must render the same
// surface; previously the JSON form threw inside detect_irreducible_bz/compute_surface_radius.
// 12 vertices in the positive octant (enough for irreducible-BZ detection) forming a fan of
// 10 triangles plus one quad that fan-triangulates into two
const json_vertices = Array.from({ length: 12 }, (_, idx) => [
  0.1 + 0.05 * idx,
  0.2 + 0.03 * (idx % 4),
  0.3,
])
const json_faces = [
  ...Array.from({ length: 9 }, (_, idx) => [0, idx + 1, idx + 2]),
  [0, 10, 11, 1],
]
const matterviz_json = {
  isosurfaces: [{ vertices: json_vertices, faces: json_faces, band_index: 3, spin: null }],
  k_lattice: IDENTITY_MATRIX3,
  fermi_energy: 1.25,
  reciprocal_cell: `wigner_seitz`,
  metadata: { n_bands: 1, n_surfaces: 1 },
}
const ifermi_json = {
  '@module': `ifermi.surface`,
  '@class': `FermiSurface`,
  isosurfaces: {
    '3': [{ vertices: json_vertices, faces: json_faces, band_idx: 3, dimensionality: `3D` }],
  },
  reciprocal_space: { '@class': `WignerSeitzCell`, reciprocal_lattice: IDENTITY_MATRIX3 },
}
const typed_data = normalize_fermi_surface(matterviz_json)

test.each([
  [`matterviz JSON mesh`, matterviz_json],
  [`IFermi as_dict()`, ifermi_json],
  [`typed arrays`, typed_data],
])(`fermi_data as %s renders the same surface`, async (_label, fermi_data) => {
  const on_error = vi.fn()
  let rendered: FermiSurfaceData | undefined
  // The component's children type is intersected with HTMLAttributes' argument-less Snippet
  const children = createRawSnippet<[{ fermi_data?: FermiSurfaceData }]>((get) => ({
    render: () => `<span></span>`,
    setup: () => {
      $effect(() => {
        rendered = get().fermi_data
      })
    },
  })) as ComponentProps<typeof FermiSurface>[`children`]
  // Every bound key must be present for bind_props to wire it
  const props = $state<{ tile_bz: boolean; error_msg?: string }>({
    tile_bz: false,
    error_msg: undefined,
  })
  mounted.push(
    mount(FermiSurface, {
      target: document.body,
      props: bind_props(
        { fermi_data: fermi_data as FermiSurfaceData, children, on_error },
        props,
      ),
    }),
  )
  await tick()
  expect(on_error).not.toHaveBeenCalled()
  expect(props.error_msg).toBeUndefined()
  expect(document.body.textContent).toContain(`E_F`)
  // All vertices sit in the positive octant → detect_irreducible_bz walked typed positions
  expect(props.tile_bz).toBe(true)
  // Children receive the normalised surface: identical geometry to the typed-array form
  expect(rendered?.isosurfaces).toHaveLength(1)
  const [sheet] = rendered?.isosurfaces ?? []
  expect(sheet.positions).toBeInstanceOf(Float32Array)
  expect(sheet.indices).toBeInstanceOf(Uint32Array)
  expect([...sheet.positions]).toEqual([...typed_data.isosurfaces[0].positions])
  expect([...sheet.indices]).toEqual([...typed_data.isosurfaces[0].indices])
  expect(sheet.band_index).toBe(3)
  // Typed input passes through by identity so bound/URL-owned data keeps its object
  if (fermi_data === typed_data) expect(rendered).toBe(typed_data)
})

// A malformed payload is reported instead of thrown mid-render. A host that streams props
// (pymatviz) may send a bad payload and then a good one: the notice the bad one raised must
// not stick, or the viewer stays blank until the user dismisses it
test(`malformed fermi_data reports via error_msg/on_error and a later valid one clears it`, async () => {
  const on_error = vi.fn()
  const props = $state<{ fermi_data: unknown; error_msg?: string }>({
    fermi_data: { isosurfaces: [{ vertices: `nope` }] },
    error_msg: undefined,
  })
  mounted.push(
    mount(FermiSurface, {
      target: document.body,
      props: bind_props({ on_error }, props) as ComponentProps<typeof FermiSurface>,
    }),
  )
  await tick()
  expect(props.error_msg).toMatch(/^Invalid Fermi surface data: /)
  expect(on_error).toHaveBeenCalledWith({ error_msg: props.error_msg })
  expect(document.body.textContent).toContain(`Invalid Fermi surface data`)

  props.fermi_data = typed_data
  await tick()
  expect(props.error_msg).toBeUndefined()
  expect(document.body.textContent).not.toContain(`Invalid Fermi surface data`)
  // An unrelated error (a failed file load) is not the normalizer's to clear
  props.error_msg = `Failed to parse other.frmsf`
  props.fermi_data = { isosurfaces: [] }
  await tick()
  expect(props.error_msg).toBe(`Failed to parse other.frmsf`)
  expect(on_error).toHaveBeenCalledTimes(1)
})

// band_data travels the same JSON route with nested [spin][band][kx][ky][kz] energies
test(`band_data with nested JSON energies is extracted like the typed grid`, async () => {
  vi.useFakeTimers({
    toFake: [`setTimeout`, `clearTimeout`, `requestAnimationFrame`, `cancelAnimationFrame`],
  })
  const grid_n = 5
  const nested = Array.from({ length: grid_n }, (_x, ix) =>
    Array.from({ length: grid_n }, (_y, iy) =>
      Array.from({ length: grid_n }, (_z, iz) =>
        Math.hypot(ix / 4 - 0.5, iy / 4 - 0.5, iz / 4 - 0.5),
      ),
    ),
  )
  const props = $state<{ fermi_data?: FermiSurfaceData }>({ fermi_data: undefined })
  const band_data: BandGridJson = {
    energies: [[nested]],
    k_grid: [grid_n, grid_n, grid_n],
    k_lattice: IDENTITY_MATRIX3,
    fermi_energy: 0.3,
    n_bands: 1,
    n_spins: 1,
  }
  mounted.push(
    mount(FermiSurface, { target: document.body, props: bind_props({ band_data }, props) }),
  )
  await vi.advanceTimersByTimeAsync(200)
  expect(props.fermi_data?.isosurfaces).toHaveLength(1)
  expect(props.fermi_data?.isosurfaces[0].positions.length).toBeGreaterThan(0)
  expect(document.body.textContent).not.toContain(`Invalid Fermi surface data`)
  vi.useRealTimers()
})
