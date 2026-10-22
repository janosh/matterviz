import { extract_fermi_surface } from '#lib/fermi-surface/compute.js'
import FermiSurface from '#lib/fermi-surface/FermiSurface.svelte'
import type * as extract_async from '#lib/fermi-surface/extract-async.js'
import { type BandGridJson, normalize_fermi_surface } from '#lib/fermi-surface/parse.js'
import type { BandGridData, FermiSurfaceData } from '#lib/fermi-surface/types.js'
import { createRawSnippet, flushSync, mount, tick, unmount, type ComponentProps } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { can_create_worker } from '#lib/worker-client.svelte.js'
import {
  bind_props,
  click_export,
  create_drop_event,
  doc_query,
  expect_shortcuts_in_pane,
  mock_parse_worker,
} from '../setup'
import type { Vec3 } from '#lib/math.js'
import { IDENTITY_MATRIX3, make_bxsf } from '../test-fixtures'

beforeEach(mock_parse_worker)

// Extraction stays real unless a test sets `jobs` to settle them by hand, in request order:
// `settle` resolves one with its real surface and returns the mesh positions, `fail` rejects it
const extraction = vi.hoisted(() => ({
  jobs: null as { settle: () => Float32Array; fail: (error: Error) => void }[] | null,
  release: vi.fn(),
  cancel: vi.fn(),
}))
vi.mock(`#lib/fermi-surface/extract-async.js`, async (original) => {
  const actual = await original<typeof extract_async>()
  return {
    ...actual,
    create_latest_extractor: () => {
      const real = actual.create_latest_extractor()
      const extract = (...args: Parameters<typeof real>) => {
        if (!extraction.jobs) return real(...args)
        const { promise, resolve, reject } = Promise.withResolvers<FermiSurfaceData>()
        const settle = () => {
          const surface = extract_fermi_surface(...args)
          resolve(surface)
          return surface.isosurfaces[0].positions
        }
        extraction.jobs.push({ settle, fail: reject })
        return promise
      }
      const cancel = () => {
        extraction.cancel()
        real.cancel()
      }
      return Object.assign(extract, { cancel })
    },
    register_fermi_viewer: () => extraction.release,
  }
})

const mounted: ReturnType<typeof mount>[] = []

afterEach(async () => {
  extraction.jobs = null
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const component of mounted.splice(0)) await unmount(component)
})

// Faking rAF keeps the extraction frames on the fake clock (~16 ms each), so a test can
// observe the viewer between them
const fake_frames = () =>
  vi.useFakeTimers({
    toFake: [`setTimeout`, `clearTimeout`, `requestAnimationFrame`, `cancelAnimationFrame`],
  })

// Nested [kx][ky][kz] energies |k − centre| on an endpoint-inclusive grid_n³ unit cell
const sphere_energies = (grid_n: number): number[][][] =>
  Array.from({ length: grid_n }, (_x, idx_x) =>
    Array.from({ length: grid_n }, (_y, idx_y) =>
      Array.from({ length: grid_n }, (_z, idx_z) =>
        Math.hypot(...[idx_x, idx_y, idx_z].map((idx) => idx / (grid_n - 1) - 0.5)),
      ),
    ),
  )
const typed_grid = (nested: number[][][]): BandGridData => {
  const dims: Vec3 = [nested.length, nested.length, nested.length]
  const values = Float64Array.from(nested.flat(2))
  return {
    energies: [[{ values, dims, order: `z_fastest` }]],
    k_grid: dims,
    k_lattice: IDENTITY_MATRIX3,
    fermi_energy: 0.3,
    n_bands: 1,
    n_spins: 1,
  }
}

test(`custom drops receive raw content while loading remains visible`, async () => {
  const pending = Promise.withResolvers<undefined>()
  const on_file_drop = vi.fn(() => pending.promise)
  const props = $state({ loading: false, on_file_drop })
  mounted.push(mount(FermiSurface, { target: document.body, props }))
  await tick()
  const file = new File([`custom surface`], `custom.txt`)
  document.querySelector(`.fermi-surface`)?.dispatchEvent(create_drop_event(file))
  await vi.waitFor(() => expect(on_file_drop).toHaveBeenCalledOnce())
  expect(on_file_drop).toHaveBeenCalledWith(`custom surface`, file.name, {
    source_filename: file.name,
    file,
  })
  expect(props.loading).toBe(true)
  expect(doc_query(`.task-status.overlay [role="status"]`).textContent?.trim()).toBe(
    `Loading Fermi surface...`,
  )
  pending.resolve(undefined)
  await vi.waitFor(() => expect(props.loading).toBe(false))
})

test(`built-in drops load typed Fermi surface data and provenance`, async () => {
  const payload = JSON.stringify({
    isosurfaces: [],
    k_lattice: IDENTITY_MATRIX3,
    fermi_energy: 0,
    reciprocal_cell: `wigner_seitz`,
    metadata: { n_bands: 1, n_surfaces: 0 },
  })
  const on_file_load = vi.fn()
  const props = $state<{ fermi_data?: FermiSurfaceData; on_file_load: typeof on_file_load }>({
    fermi_data: undefined,
    on_file_load,
  })
  mounted.push(mount(FermiSurface, { target: document.body, props }))
  await tick()
  const file = new File([payload], `fermi.json`)
  document.querySelector(`.fermi-surface`)?.dispatchEvent(create_drop_event(file))
  await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
  expect(props.fermi_data?.metadata).toEqual({ n_bands: 1, n_surfaces: 0 })
  expect(on_file_load).toHaveBeenCalledWith(
    expect.objectContaining({ filename: file.name, source_filename: file.name, file }),
  )
})

// Extracting a surface from a URL-loaded grid stores a new fermi_data. A bound parent hands
// back a proxy of it, so claiming the raw result left the loader reading the proxy as
// caller-supplied: it dropped the URL and never fetched the next one.
test.each([`http://x/a.bxsf`, new URL(`http://x/a.bxsf`)])(
  `a second source still loads after re-extraction with a bound fermi_data (%s)`,
  async (source) => {
    fake_frames()
    vi.spyOn(globalThis, `fetch`).mockImplementation(() =>
      Promise.resolve(new Response(make_bxsf(6))),
    )
    const on_file_load = vi.fn()
    const props = $state({
      source,
      fermi_data: undefined as FermiSurfaceData | undefined,
      on_file_load,
    })
    mounted.push(mount(FermiSurface, { target: document.body, props }))
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(300) // spinner frame + extraction frame
    expect(props.fermi_data?.isosurfaces.length).toBeGreaterThan(0)

    props.source = `http://x/b.bxsf`
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(2))
    expect(on_file_load.mock.calls[1][0].filename).toBe(`b.bxsf`)
  },
)

test(`extracts fermi_data from a band_data prop and re-extracts when mu changes`, async () => {
  fake_frames()
  const band_data = typed_grid(sphere_energies(6))
  // a band far below E_F never crosses, so it is never upsampled: it must not count as a grid
  // still to upsample (that put every mu change behind the spinner)
  const [sphere] = band_data.energies[0]
  band_data.energies[0].push({ ...sphere, values: sphere.values.map((energy) => energy - 5) })
  band_data.n_bands = 2
  const props = $state<{
    band_data?: BandGridData
    fermi_data?: FermiSurfaceData
    mu: number
    interpolation_factor: number
  }>({
    band_data,
    fermi_data: undefined,
    mu: 0,
    interpolation_factor: 1,
  })
  mounted.push(mount(FermiSurface, { target: document.body, props }))
  await vi.advanceTimersByTimeAsync(200)
  expect(props.fermi_data?.isosurfaces).toHaveLength(1)
  const n_vertices_at_0 = props.fermi_data?.isosurfaces[0].positions.length
  // The viewer chrome (and the Canvas it sits next to) must survive re-extraction: the
  // spinner overlays it rather than replacing it, so the WebGPU renderer is not torn down
  const chrome = document.querySelector(`.fermi-surface .control-buttons`)
  expect(chrome).not.toBeNull()

  const spinner_shown = () =>
    document.body.textContent?.includes(`Extracting Fermi surface...`)
  const n_vertices = () => props.fermi_data?.isosurfaces[0].positions.length ?? 0

  // A mu change only reruns marching cubes on the cached grid: it lands next frame with no
  // spinner, so a slider drag tracks the pointer (a 150 ms debounce froze it until rest)
  props.mu = 0.1 // bigger sphere → more vertices
  await vi.advanceTimersByTimeAsync(20)
  expect(spinner_shown()).toBe(false)
  const n_vertices_at_01 = n_vertices()
  expect(n_vertices_at_01).toBeGreaterThan(n_vertices_at_0 ?? 0)
  expect(document.querySelector(`.fermi-surface .control-buttons`)).toBe(chrome)

  // A new interpolation factor upsamples every band first: without workers (as here, and in
  // anywidget) that blocks the page, so the spinner overlays the Canvas for one painted frame
  expect(can_create_worker()).toBe(false)
  props.interpolation_factor = 2
  flushSync()
  expect(doc_query(`.task-status.overlay [role="status"]`).textContent?.trim()).toBe(
    `Extracting Fermi surface...`,
  )
  expect(document.querySelector(`.fermi-surface .control-buttons`)).toBe(chrome)
  await vi.advanceTimersByTimeAsync(16) // the spinner's frame: nothing extracted yet
  expect([spinner_shown(), n_vertices()]).toEqual([true, n_vertices_at_01])
  await vi.advanceTimersByTimeAsync(20)
  expect(spinner_shown()).toBe(false)
  expect(n_vertices()).toBeGreaterThan(n_vertices_at_01)

  // Clearing band_data while an extraction is pending must not commit a surface for it
  const committed = props.fermi_data
  props.interpolation_factor = 3
  flushSync()
  props.band_data = undefined
  await vi.advanceTimersByTimeAsync(100)
  expect(props.fermi_data).toBe(committed)
  expect(spinner_shown()).toBe(false)
})

// pymatviz's FermiSurfaceWidget(fermi_data=...) trait can only carry JSON, so the mesh arrives
// as plain vertices/faces/normals rows (IFermi `as_dict()` or our own export format) rather
// than the Float32Array/Uint32Array form parse_fermi_file returns. Both must render the same
// surface.
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
    // keyed by spin (Spin.up = 1); the band lives in band_idx
    '1': [{ vertices: json_vertices, faces: json_faces, band_idx: 3, dimensionality: `3D` }],
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
        {
          fermi_data: fermi_data as FermiSurfaceData,
          children,
          on_error,
          controls_open: true,
        },
        props,
      ),
    }),
  )
  await tick()
  expect(on_error).not.toHaveBeenCalled()
  expect(props.error_msg).toBeUndefined()
  expect(document.body.textContent).toContain(`EF =`) // E<sub>F</sub>
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
  expect(doc_query(`.fermi-surface > .viewer-error [role="alert"]`).textContent).toContain(
    `Invalid Fermi surface data`,
  )

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
  fake_frames()
  const nested = sphere_energies(5)
  const typed = typed_grid(nested)
  const props = $state<{ fermi_data?: FermiSurfaceData }>({ fermi_data: undefined })
  const band_data: BandGridJson = { ...typed, energies: [[nested]], properties: undefined }
  mounted.push(
    mount(FermiSurface, { target: document.body, props: bind_props({ band_data }, props) }),
  )
  await vi.advanceTimersByTimeAsync(200)
  expect(props.fermi_data?.isosurfaces).toHaveLength(1)
  // the nested [kx][ky][kz] JSON must flatten z-fastest to the same mesh the typed grid
  // (default mu = 0, auto interpolation_factor) extracts
  const expected = extract_fermi_surface(typed, { interpolation_factor: 0 }).isosurfaces[0]
  expect(expected.positions.length).toBeGreaterThan(0)
  expect(props.fermi_data?.isosurfaces[0].positions).toEqual(expected.positions)
  expect(props.fermi_data?.isosurfaces[0].indices).toEqual(expected.indices)
  expect(document.body.textContent).not.toContain(`Invalid Fermi surface data`)
  // committing fermi_data must not re-normalise the JSON grid into a new object: that re-ran
  // the extraction (and its upsampling) every frame
  const committed = props.fermi_data
  await vi.advanceTimersByTimeAsync(200)
  expect(props.fermi_data).toBe(committed)
})

test(`results commit in job order, only the newest reports errors, none land after unmount`, async () => {
  const jobs: NonNullable<typeof extraction.jobs> = []
  extraction.jobs = jobs
  const [on_error, band_data] = [vi.fn(), typed_grid(sphere_energies(6))]
  const props = $state<{ fermi_data?: FermiSurfaceData; error_msg?: string; mu: number }>({
    fermi_data: undefined,
    error_msg: undefined,
    mu: 0,
  })
  const component = mount(FermiSurface, {
    target: document.body,
    props: bind_props({ on_error, band_data }, props),
  })
  // one frame per request (two while the grid is cold): the main thread extracts per frame
  fake_frames()
  const request_mu = async (mu: number) => {
    props.mu = mu
    flushSync()
    await vi.advanceTimersByTimeAsync(40)
  }
  await vi.advanceTimersByTimeAsync(40)
  await request_mu(0.1)
  await request_mu(0.2)
  // a superseded extraction failing (e.g. its worker was torn down) goes unreported and
  // leaves the spinner up; the newest surface commits, and an older one resolving later does
  // not replace it (typed arrays are not proxied by $state, so identity shows)
  jobs[0].fail(new Error(`worker gone`))
  await tick()
  expect(document.body.textContent).toContain(`Extracting Fermi surface...`)
  const positions = jobs[2].settle()
  jobs[1].settle()
  await tick()
  expect(props.fermi_data?.isosurfaces[0].positions).toBe(positions)
  expect([props.error_msg, on_error.mock.calls.length]).toEqual([undefined, 0])
  await request_mu(0.3)
  jobs[3].fail(new Error(`boom`))
  await tick()
  const error_msg = `Fermi surface extraction failed: boom`
  expect(props.error_msg).toBe(error_msg)
  expect(on_error).toHaveBeenCalledExactlyOnceWith({ error_msg })
  // unmounting cancels the waiting request and releases the worker, and after it neither a
  // newer result nor the newest job's error lands
  await request_mu(0.4)
  await request_mu(0.5)
  for (const spy of [extraction.release, extraction.cancel]) spy.mockClear()
  await unmount(component)
  const { release, cancel } = extraction
  expect([release.mock.calls.length, cancel.mock.calls.length]).toEqual([1, 1])
  jobs[4].settle()
  jobs[5].fail(new Error(`worker gone`))
  await tick()
  expect(props.fermi_data?.isosurfaces[0].positions).toBe(positions)
  expect([props.error_msg, on_error.mock.calls.length]).toEqual([error_msg, 1])
})

// The viewer's one export pane: a PNG of the view plus the visible sheets as 3D models
test.each([
  [{}, [`PNG`, `STL`, `OBJ`, `GLB`]],
  [{ export_formats: [] }, null],
  [{ show_controls: { hidden: [`export-pane`] } }, null],
] as const)(`export pane with %j offers %j`, async (props, offered) => {
  const band_data = typed_grid(sphere_energies(5))
  mounted.push(mount(FermiSurface, { target: document.body, props: { band_data, ...props } }))
  // the chrome (with the controls toggle) mounts once the band grid is loaded
  const controls_toggle = () => document.querySelector(`.fermi-surface .pane-toggle`)
  await vi.waitFor(() => expect(controls_toggle()).not.toBeNull())
  expect_shortcuts_in_pane(document, `.fermi-controls`, [`viewer`, `camera`])
  const toggle = document.querySelector(`.fermi-export-toggle`)
  expect(toggle === null).toBe(offered === null)
  if (offered) expect(await click_export(null, document)).toEqual(offered)
})
