import ChemPotDiagram from '#lib/chempot-diagram/ChemPotDiagram.svelte'
import ChemPotDiagram3D from '#lib/chempot-diagram/ChemPotDiagram3D.svelte'
import type ChemPotScene3D from '#lib/chempot-diagram/ChemPotScene3D.svelte'
import ChemPotTooltip from '#lib/chempot-diagram/ChemPotTooltip.svelte'
import { chempot_png_blob, chempot_svg_string } from '#lib/chempot-diagram/export.js'
import type { ChemPotHoverInfo } from '#lib/chempot-diagram/types.js'
import type { PhaseData } from '#lib/convex-hull/types.js'
import type * as scene_module from '#lib/scene/index.js'
import type * as threlte_core from '@threlte/core'
import type * as convex_module from 'three/examples/jsm/geometries/ConvexGeometry.js'
import { ARITY_COLORS } from '#lib/chempot-diagram/color.js'
import { swizzle_to_render } from '#lib/chempot-diagram/compute.js'
import type { Vec3 } from '#lib/math.js'
import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import * as THREE from 'three/webgpu'
import { afterEach, expect, onTestFinished, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'
import { mount_scene } from '../scene/mount'
import { bind_props, doc_query, query, set_input } from '../setup'
import { load_json } from '../test-fixtures'

// happy-dom has no WebGPU: the scene is swapped for a recording stub (its props are still
// the component's live deriveds) and every ConvexGeometry build is counted
const convex_builds = vi.hoisted(() => ({ count: 0 }))
vi.mock(`three/examples/jsm/geometries/ConvexGeometry.js`, async (original) => {
  const mod = await original<typeof convex_module>()
  class CountingConvexGeometry extends mod.ConvexGeometry {
    constructor(...args: ConstructorParameters<typeof mod.ConvexGeometry>) {
      super(...args)
      convex_builds.count++
    }
  }
  return { ...mod, ConvexGeometry: CountingConvexGeometry }
})
vi.mock(`#lib/scene/index.js`, async (original) => ({
  ...(await original<typeof scene_module>()),
  webgpu_available: () => true,
}))
vi.mock(`@threlte/core`, async (original) => ({
  ...(await original<typeof threlte_core>()),
  Canvas: Reflect.get((await import(`../isosurface/threlte-stub`)).threlte_stub.T, `Canvas`),
}))
vi.mock(`#lib/chempot-diagram/ChemPotScene3D.svelte`, async () => ({
  default: Reflect.get((await import(`../isosurface/threlte-stub`)).threlte_stub.T, `Scene`),
}))

const entries = load_json<PhaseData[]>(`${import.meta.dirname}/pd_entries_test.json.gz`)
const ytos_entries = load_json<PhaseData[]>(`${import.meta.dirname}/ytos_entries.json.gz`)
let mounted: ReturnType<typeof mount> | undefined
afterEach(() => {
  if (mounted) void unmount(mounted)
  mounted = undefined
  threlte_stub.reset()
  document.body.innerHTML = ``
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test.each([`success`, `empty`, `timeout`])(`composited PNG encoding: %s`, async (outcome) => {
  vi.useFakeTimers()
  const wrapper = document.createElement(`div`)
  const canvas = document.createElement(`canvas`)
  wrapper.append(canvas)
  vi.spyOn(canvas, `getBoundingClientRect`).mockReturnValue(new DOMRect(0, 0, 200, 100))
  // a HiDPI backing store already at the 2x export size is encoded without resampling
  Object.assign(canvas, { width: 400, height: 200 })
  Object.defineProperties(canvas, {
    clientWidth: { value: 200 },
    clientHeight: { value: 100 },
  })
  // the WebGPU frame is encoded (a 2D drawImage of the canvas reads no pixels) and composited
  const frame_blob = new Blob([`frame`], { type: `image/png` })
  canvas.toBlob = (callback: BlobCallback) => callback(frame_blob)
  const frame = { close: vi.fn() }
  const decode = vi.fn(async () => frame)
  vi.stubGlobal(`createImageBitmap`, decode)
  const context = { scale: vi.fn(), drawImage: vi.fn() }
  const blob = new Blob([`pixels`], { type: `image/png` })
  const output = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (callback: BlobCallback) => {
      if (outcome === `success`) setTimeout(() => callback(blob), 6000)
      if (outcome === `empty`) callback(null)
    },
  }
  vi.spyOn(document, `createElement`).mockReturnValue(output as unknown as HTMLCanvasElement)
  const settled = vi.fn()
  void chempot_png_blob(wrapper, 144).then(settled, settled)
  await vi.runAllTimersAsync()
  expect([output.width, output.height]).toEqual([400, 200])
  expect(context.scale).toHaveBeenCalledExactlyOnceWith(2, 2)
  expect(decode).toHaveBeenCalledExactlyOnceWith(frame_blob)
  expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(frame, 0, 0, 200, 100)
  expect(frame.close).toHaveBeenCalledOnce()
  if (outcome === `success`) {
    expect(settled).toHaveBeenCalledExactlyOnceWith(blob)
    // the SVG embeds that encoded frame too: toDataURL of a presented WebGPU canvas is blank
    const svg = await chempot_svg_string(wrapper, {})
    expect(svg).toContain(`<image href="data:image/png;base64,${btoa(`frame`)}"`)
  } else {
    expect(settled).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: expect.stringContaining(
          outcome === `empty` ? `Failed to generate high-resolution PNG` : `toBlob timed out`,
        ),
      }),
    )
  }
  expect(vi.getTimerCount()).toBe(0)
})

// Mount, silence the expected console noise and wait out the compute spinner. Returns a getter
// for the Scene stub's live props (re-looked-up, since toggles re-render the node).
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- each call site names the Scene props shape it reads
const mount_diagram = async <T>(
  props: ComponentProps<typeof ChemPotDiagram3D>,
): Promise<() => T> => {
  vi.spyOn(console, `error`).mockImplementation(() => undefined)
  mounted = mount(ChemPotDiagram3D, { target: document.body, props })
  await tick()
  await vi.waitFor(() => expect(document.querySelector(`.spinner`)).toBeNull())
  return () => {
    const node = threlte_stub.nodes.find(({ tag }) => tag === `Scene`)
    if (!node) throw new Error(`scene stub not mounted`)
    return node.props as T
  }
}

// Overlay hulls are cached per formula: a toggle used to rebuild all k + 1 overlay hulls plus
// the occlusion hull, now only the new overlay's hull and the occlusion hull
test(`toggling a formula overlay builds only that domain's hull`, async () => {
  const scene = await mount_diagram<{
    formula_meshes: { geometry: object; color: string }[]
    formula_edges: { geometry: object }[]
  }>({
    entries,
    config: { default_min_limit: -25, draw_formula_meshes: true, draw_formula_lines: true },
  })
  expect(scene().formula_meshes).toHaveLength(0)
  document.querySelector<HTMLButtonElement>(`.chempot-formula-toggle`)?.click()
  flushSync()
  const checkboxes = [...document.querySelectorAll<HTMLInputElement>(`.formula-list input`)]
  const formulas = [...document.querySelectorAll(`.formula-list label`)].map((label) =>
    label.textContent?.trim(),
  )
  expect(formulas).toHaveLength(11)
  const toggle = (formula: string) => {
    const before = convex_builds.count
    checkboxes[formulas.indexOf(formula)].click()
    flushSync()
    const { formula_meshes, formula_edges } = scene()
    return { builds: convex_builds.count - before, formula_meshes, formula_edges }
  }

  // the occlusion hull spans every domain, overlays included, so only the overlay's own hull
  // is built
  const first = toggle(`Fe2O3`)
  expect(first.builds).toBe(1)
  expect(first.formula_meshes).toHaveLength(1)
  const second = toggle(`Li2O`)
  expect(second.builds).toBe(1)
  expect(second.formula_meshes).toHaveLength(2)
  // the cached Fe2O3 hull is reused, not rebuilt
  expect(second.formula_meshes[0].geometry).toBe(first.formula_meshes[0].geometry)
  expect(second.formula_edges[0].geometry).toBe(first.formula_edges[0].geometry)
  const third = toggle(`LiFeO2`)
  expect(third.builds).toBe(1)
  expect(third.formula_meshes).toHaveLength(3)
  // colours follow the draw order, not the cache: three overlays, three distinct colours
  expect(new Set(third.formula_meshes.map(({ color }) => color)).size).toBe(3)
  // un-drawing disposes that overlay's geometry and builds nothing
  const fe2o3_geometry = first.formula_meshes[0].geometry
  // Disposal must run after the flush: reading the scene's live `formula_meshes` derived
  // here would re-enter it (and throw) if the eviction still disposed inside it
  const meshes_at_dispose: object[][] = []
  const dispose = vi
    .spyOn(fe2o3_geometry as { dispose(): void }, `dispose`)
    .mockImplementation(() => {
      meshes_at_dispose.push(scene().formula_meshes.map(({ geometry }) => geometry))
    })
  const removed = toggle(`Fe2O3`)
  expect(removed.builds).toBe(0)
  expect(removed.formula_meshes).toHaveLength(2)
  expect(dispose).toHaveBeenCalledOnce()
  expect(meshes_at_dispose).toEqual([removed.formula_meshes.map(({ geometry }) => geometry)])
  expect(meshes_at_dispose[0]).not.toContain(fe2o3_geometry)
})

// Only formal_chempots/default_min_limit/limits/elements reach the worker, so label and overlay
// toggles must not recompute (or rebuild any hull)
test(`display toggles and partial number input never recompute the diagram`, async () => {
  const scene = await mount_diagram<{ domain_labels: unknown[] }>({
    entries,
    config: { default_min_limit: -25 },
  })
  const controls_toggle = document.querySelector<HTMLButtonElement>(`.chempot-controls-toggle`)
  expect(controls_toggle?.style.position).toBe(`static`)
  controls_toggle?.click()
  flushSync()
  const pane_inputs = [...document.querySelectorAll<HTMLInputElement>(`.draggable-pane input`)]
  const by_label = (text: string) =>
    pane_inputs.find((input) => input.closest(`label`)?.textContent?.includes(text))
  const scene_labels = () => scene().domain_labels.length
  expect(scene_labels()).toBeGreaterThan(0)
  const before = convex_builds.count
  for (const label of [`Label stable`, `Meshes`, `Lines`]) {
    const checkbox = by_label(label)
    if (!checkbox) throw new Error(`no "${label}" checkbox`)
    checkbox.click()
    flushSync()
  }
  const min_limit = by_label(`Min limit`)
  if (!min_limit) throw new Error(`no min-limit input`)
  // keystrokes don't commit (typing -10 must not compute at -1 first), and an unparsable
  // committed value is ignored
  set_input(min_limit, `-1`)
  min_limit.value = `-`
  min_limit.dispatchEvent(new Event(`change`, { bubbles: true }))
  flushSync()
  await tick()
  expect(convex_builds.count - before).toBe(0)
  expect(document.querySelector(`.spinner`)).toBeNull()
  expect(document.querySelector(`.empty-state`)).toBeNull()
  expect(scene_labels()).toBe(0) // labels hidden without touching the geometry
})

// From the focused viewer root the keyboard walks the drawn domains in legend order, each
// tooltip placed at the hull faces the domain owns, and Enter pins it like a click. The real
// scene is mounted on the props the diagram hands its stub.
test(`keyboard walks the domains and Enter pins`, async () => {
  const bound: { hover_info: ChemPotHoverInfo | null } = { hover_info: null }
  const get_scene = await mount_diagram<ComponentProps<typeof ChemPotScene3D>>(
    bind_props({ entries, config: { default_min_limit: -25 } }, bound),
  )
  const { default: Scene } = await vi.importActual<{ default: typeof ChemPotScene3D }>(
    `#lib/chempot-diagram/ChemPotScene3D.svelte`,
  )
  const scene_props = get_scene()
  const { keys, unmount_scene } = mount_scene((anchor) => Scene(anchor, scene_props))
  onTestFinished(unmount_scene)
  flushSync()
  expect(keys.press(`ArrowRight`)).toBe(true)
  const [first] = scene_props.hover_meshes
  expect([bound.hover_info?.formula, keys.message]).toEqual([first.formula, first.formula])
  const { x, y } = bound.hover_info?.pointer ?? {}
  expect([x, y].every(Number.isFinite)).toBe(true)
  // pinned, the tooltip outlives the cursor the walk's Escape clears
  expect([`Enter`, `Escape`].map((key) => keys.press(key))).toEqual([true, true])
  expect(bound.hover_info?.formula).toBe(first.formula)
})

// A wheel zoom fires OrbitControls' start without any pointer move (so no pointerleave)
test(`camera start clears an unpinned domain tooltip, a pinned one survives and follows recomputes`, async () => {
  // plain object: the test only reads the bound value back, no reactivity needed
  const bound: { hover_info: ChemPotHoverInfo | null } = { hover_info: null }
  const get_scene = await mount_diagram<{
    hover_meshes: { formula: string; info: ChemPotHoverInfo }[]
    on_domain_hover: (mesh: unknown, event: unknown) => void
    on_domain_press: (mesh: unknown, event: unknown) => void
    on_camera_start: () => void
  }>(bind_props({ entries, config: { default_min_limit: -25 } }, bound))
  const scene = get_scene()
  const [domain] = scene.hover_meshes
  // every domain belongs to an entry formula, whose energy stats the hover info carries
  const { info } = domain
  if (info.view !== `3d`) throw new Error(`expected 3D hover info, got ${info.view}`)
  expect(info.matching_entry_count).toBeGreaterThan(0)
  expect(info.min_energy_per_atom).toBeLessThanOrEqual(info.max_energy_per_atom ?? -Infinity)
  // by touch: it has no hover, so a tap's press is what shows (and pins) a domain's tooltip
  const event = {
    nativeEvent: new PointerEvent(`pointerdown`, { pointerType: `touch` }),
    stopPropagation: () => undefined,
  }

  scene.on_domain_hover(domain, event)
  flushSync()
  expect(bound.hover_info?.formula).toBe(domain.formula)
  scene.on_camera_start() // wheel zoom: start with no pointer movement
  flushSync()
  expect(bound.hover_info).toBeNull()

  scene.on_domain_press(domain, event) // a tap or click pins the tooltip
  flushSync()
  expect(bound.hover_info?.formula).toBe(domain.formula)
  scene.on_camera_start()
  flushSync()
  expect(bound.hover_info?.formula).toBe(domain.formula)

  const pinned_ranges = bound.hover_info?.axis_ranges
  document.querySelector<HTMLButtonElement>(`.chempot-controls-toggle`)?.click()
  flushSync()
  const formal = [...document.querySelectorAll(`.draggable-pane label`)]
    .find((label) => label.textContent?.includes(`Formal chempots`))
    ?.querySelector(`input`)
  formal?.click() // absolute chempots: recompute
  await vi.waitFor(() => expect(bound.hover_info?.axis_ranges).not.toEqual(pinned_ranges))
  const fresh = get_scene().hover_meshes.find(({ formula }) => formula === domain.formula)
  expect(bound.hover_info?.formula).toBe(domain.formula)
  expect(bound.hover_info?.axis_ranges).toEqual(fresh?.info.axis_ranges)
  // a press on the pinned domain or Escape unpins, closing the tooltip
  const wrapper = doc_query(`.chempot-diagram-3d`)
  const escape = () =>
    wrapper.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }))
  escape() // closes the controls pane still open from above first
  flushSync()
  expect(bound.hover_info?.formula).toBe(domain.formula)
  for (const unpin of [() => get_scene().on_domain_press(fresh, event), escape]) {
    get_scene().on_domain_hover(fresh, event)
    flushSync()
    expect(bound.hover_info?.formula).toBe(domain.formula)
    unpin()
    flushSync()
    expect(bound.hover_info).toBeNull()
    get_scene().on_domain_press(fresh, event) // re-pin
    flushSync()
  }
})

// A hull face's owner is the domain holding all three corners (nearest-centroid labelled six
// faceless domains). "Surface" used to raycast from inside the hull, hit only culled back faces
// and so select all; it now picks the domains owning an envelope face.
test(`hull faces are labelled by their owning domain, which the Surface quick-select picks`, async () => {
  const scene = await mount_diagram<{
    render_domains: { formula: string; points_3d: number[][] }[]
    render_axis_scale: Vec3
    hull_geometry: {
      getAttribute(name: string): { count: number; array: ArrayLike<number> }
    }
    domain_labels: { formula: string }[]
    formula_meshes: { geometry: object; color: string }[]
  }>({
    entries: ytos_entries,
    config: { elements: [`Y`, `Ti`, `O`], default_min_limit: -25, draw_formula_meshes: true },
  })
  const { render_domains, render_axis_scale, hull_geometry, domain_labels } = scene()
  const swiz = swizzle_to_render(render_axis_scale)
  const render_pts = new Map(
    render_domains.map(({ formula, points_3d }) => [
      formula,
      points_3d.map((point) => swiz(point[0], point[1], point[2])),
    ]),
  )
  const pos = hull_geometry.getAttribute(`position`).array
  const n_faces = pos.length / 9
  expect(n_faces).toBeGreaterThan(10)

  // formulas whose vertex set contains all three corners of at least one hull face
  const owners = new Set<string>()
  const possible = new Set<string>()
  for (let face_idx = 0; face_idx < n_faces; face_idx++) {
    const claimants = [...render_pts].filter(([, pts]) =>
      [0, 3, 6].every((vert) =>
        pts.some((point) =>
          point.every((val, axis) => Math.abs(val - pos[face_idx * 9 + vert + axis]) < 1e-3),
        ),
      ),
    )
    if (claimants.length === 1) owners.add(claimants[0][0])
    for (const [formula] of claimants) possible.add(formula)
  }
  expect(owners.size).toBeGreaterThan(5)
  const labelled = new Set(domain_labels.map(({ formula }) => formula))
  expect([...owners].filter((formula) => !labelled.has(formula))).toEqual([]) // all owners labelled
  expect([...labelled].filter((formula) => !possible.has(formula))).toEqual([]) // no others

  const n_domains = render_domains.length
  expect(n_domains).toBeGreaterThan(10)
  document.querySelector<HTMLButtonElement>(`.chempot-formula-toggle`)?.click()
  flushSync()
  const surface_button = [
    ...document.querySelectorAll<HTMLButtonElement>(`.overlay-actions button`),
  ].find((btn) => btn.textContent?.trim() === `Surface`)
  if (!surface_button) throw new Error(`Surface button not rendered`)
  surface_button.click()
  flushSync()
  const selected = [
    ...document.querySelectorAll<HTMLInputElement>(`.formula-list input`),
  ].filter((box) => box.checked).length
  expect(selected).toBeGreaterThan(0)
  expect(selected).toBeLessThan(n_domains) // buried domains stay unselected
  expect(scene().formula_meshes).toHaveLength(selected)
})

type Geometry = { getAttribute(name: string): { array: ArrayLike<number>; count: number } }
type HighlightScene = {
  hover_meshes: { formula: string; info: ChemPotHoverInfo }[]
  on_domain_hover: (mesh: unknown, event: unknown) => void
  on_domain_leave: (mesh: unknown) => void
  hull_geometry: Geometry | null
  highlight: { formula: string; color: string; faces?: number[]; edges?: Geometry } | null
}
const pointer_event = { nativeEvent: new PointerEvent(`pointermove`), stopPropagation() {} }
const highlighted = (scene: HighlightScene) => scene.highlight?.formula ?? null

// Matched by reduced formula; a phase without a domain here highlights nothing. The highlight
// (HoverHighlight, tested on its own) covers exactly the hull triangles drawn in the domain's
// colour, the whole visible face; a domain buried in a projection (TiSO5 in the S-less Ti-Y-O
// view) owns none and outlines its crease edges. A continuous colour mode gives each domain its
// own colour (arity colours repeat).
test.each([
  [`Fe4O6`, `Fe2O3`, entries, { default_min_limit: -25 }],
  [`NaCl`, null, entries, { default_min_limit: -25 }],
  [`Y2O3`, `O3Y2`, ytos_entries, { elements: [`Ti`, `Y`, `O`] }],
  [`TiSO5`, `O5STi`, ytos_entries, { elements: [`Ti`, `Y`, `O`] }],
])(`highlighted_formula %s highlights domain %s`, async (input, key, data, config) => {
  const scene = await mount_diagram<HighlightScene>({
    entries: data,
    config: { ...config, color_mode: `energy` },
    highlighted_formula: input,
  })
  const { highlight, hull_geometry } = scene()
  expect(highlight?.formula ?? null).toBe(key)
  if (!highlight || !hull_geometry) return
  const rgb = new THREE.Color(highlight.color).toArray()
  const hull_colors = hull_geometry.getAttribute(`color`).array
  const owned = Array.from(
    { length: hull_geometry.getAttribute(`position`).count / 3 },
    (_, idx) => idx,
  ).filter((tri_idx) =>
    [0, 1, 2].every((ch) => Math.abs(hull_colors[tri_idx * 9 + ch] - rgb[ch]) < 1e-6),
  )
  expect(highlight.faces).toEqual(owned.length > 0 ? owned : undefined)
  // a buried domain outlines its crease edges instead
  expect(Boolean(highlight.edges?.getAttribute(`position`).count)).toBe(owned.length === 0)
})

// A drawn overlay's hull faces wear its overlay colour, so its tooltip must too; other domains
// keep their (arity) domain colour
test(`domain tooltips match their drawn colour`, async () => {
  const scene = await mount_diagram<HighlightScene & { formula_meshes: { color: string }[] }>({
    entries,
    config: { default_min_limit: -25, formulas_to_draw: [`Fe2O3`], draw_formula_meshes: true },
  })
  const tip_bg = (formula: string) => {
    const mesh = scene().hover_meshes.find((hover_mesh) => hover_mesh.formula === formula)
    scene().on_domain_hover(mesh, pointer_event)
    flushSync()
    return query(document.body, `.chempot-tooltip`).style.backgroundColor
  }
  expect(tip_bg(`Fe2O3`)).toBe(scene().formula_meshes[0].color)
  // the hovered face lights up in that same colour, never a foreign highlight red
  expect(scene().highlight?.color).toBe(scene().formula_meshes[0].color)
  expect(ARITY_COLORS).toContain(tip_bg(`Li2O`))
  expect(ARITY_COLORS).toContain(scene().highlight?.color)
})

// Hover picks what is drawn: the scene raycasts the drawn hull and reads the face's owner, so
// the hoverable domains are exactly the face owners. In a projection a domain buried inside the
// envelope (TiSO5 in the S-less Ti-Y-O view) owns no face and is never reported. An overlay on
// the surface owns its faces, drawn in its overlay colour, so hovering it reports it.
test(`hover targets are exactly the drawn hull faces' owners`, async () => {
  type FaceScene = HighlightScene & { face_owners: string[] }
  const buried = `O5STi`
  const scene = await mount_diagram<FaceScene>({
    entries: ytos_entries,
    config: { elements: [`Ti`, `Y`, `O`] },
  })
  const hoverable = scene().hover_meshes.map(({ formula }) => formula)
  expect(hoverable.length).toBeGreaterThan(5)
  expect(new Set(hoverable)).toEqual(new Set(scene().face_owners))
  expect(hoverable).not.toContain(buried)
  // neighbours only list domains one can hover
  for (const { info } of scene().hover_meshes) {
    if (info.view !== `3d`) continue
    for (const neighbor of info.neighbors) expect(hoverable).toContain(neighbor)
  }

  // the overlay owns its faces in its overlay colour, also without domain colours
  const overlay = `O3Y2`
  for (const color_mode of [`arity`, `none`] as const) {
    if (mounted) void unmount(mounted)
    threlte_stub.reset()
    const with_overlay = await mount_diagram<
      FaceScene & { formula_meshes: { color: string }[] }
    >({
      entries: ytos_entries,
      config: { elements: [`Ti`, `Y`, `O`], formulas_to_draw: [overlay], color_mode },
    })
    const { face_owners, hull_geometry, formula_meshes } = with_overlay()
    expect(face_owners).toContain(overlay)
    const face_idx = face_owners.indexOf(overlay)
    const colors = hull_geometry?.getAttribute(`color`).array ?? []
    const overlay_rgb = new THREE.Color(formula_meshes[0].color).toArray()
    for (const ch of [0, 1, 2]) {
      expect(colors[face_idx * 9 + ch], color_mode).toBeCloseTo(overlay_rgb[ch], 6)
    }
  }
})

// The default tooltip body, line by line: summary (single energy when min = max), ranges with
// `=` (vertex round-off like 3.55e-15 as 0, not scientific notation), neighbours capped at 6,
// bounds grouped per side with lower first; narrowed via the PlotTooltip width variable
// rather than a max-width PlotTooltip would override
test.each([
  {
    energies: [-4.98, -4.81],
    count: 6,
    summary: `Compound · 6 entries · −4.98 to −4.81 eV/atom`,
  },
  { energies: [-10.9, -10.9], count: 1, summary: `Compound · 1 entry · −10.9 eV/atom` },
])(
  `3D tooltip summary $summary, ranges, neighbours and bounds`,
  ({ energies, count, summary }) => {
    const [min_energy_per_atom, max_energy_per_atom] = energies
    const hover_info: ChemPotHoverInfo = {
      formula: `Li2O`,
      view: `3d`,
      n_points: 4,
      n_vertices: 4,
      n_edges: 4,
      ann_loc: [0, 0, 0],
      axis_ranges: [{ element: `Li`, min_val: -2.88, max_val: 3.55e-15 }],
      touches_limits: [
        { element: `O`, side: `upper` },
        { element: `Li`, side: `lower` },
        { element: `Li`, side: `upper` },
      ],
      is_elemental: false,
      is_draw_formula: false,
      matching_entry_count: count,
      min_energy_per_atom,
      max_energy_per_atom,
      neighbors: [`Li`, `O`, `LiO`, `LiO2`, `Li2O2`, `FeLiO2`, `Fe2O3`, `Fe`],
    }
    mounted = mount(ChemPotTooltip, {
      target: document.body,
      props: { hover_info, pinned: false, constrain_to: { width: 400, height: 400 } },
    })
    const tooltip = query(document.body, `.chempot-tooltip`)
    const lines = [...tooltip.querySelectorAll(`p`)].map((line) =>
      (line.textContent ?? ``).replaceAll(/\s+/g, ` `).trim(),
    )
    expect(lines).toEqual([
      summary,
      `μ (eV) Li = [−2.88, 0]`,
      `Next to Li, O, LiO, LiO2, Li2O2, LiFeO2 +2 more`, // electronegativity order
      `Lower bound Li`,
      `Upper bound O, Li`,
    ])
    expect(tooltip.style.getPropertyValue(`--plot-tooltip-cap`)).toBe(`384px`)
  },
)

// Compact by default: no geometry debug counts, neighbours capped, bounds grouped per side,
// and left-aligned even inside a centered page section
test(`the domain tooltip stays compact and left-aligned`, async () => {
  document.body.style.textAlign = `center`
  onTestFinished(() => {
    document.body.style.textAlign = ``
  })
  // the YTOS Ti-Y-O projection of the bug report: Y2O3 has 10 neighbours
  const scene = await mount_diagram<HighlightScene>({
    entries: ytos_entries,
    config: { elements: [`Ti`, `Y`, `O`] },
  })
  const by_neighbors = scene().hover_meshes.toSorted((mesh_1, mesh_2) => {
    const count = ({ info }: { info: ChemPotHoverInfo }) =>
      info.view === `3d` ? info.neighbors.length : 0
    return count(mesh_2) - count(mesh_1)
  })
  const [crowded] = by_neighbors
  if (crowded.info.view !== `3d`) throw new Error(`expected 3D hover info`)
  scene().on_domain_hover(crowded, pointer_event)
  flushSync()
  const tooltip = query(document.body, `.chempot-tooltip`)
  const text = tooltip.textContent ?? ``
  expect(getComputedStyle(tooltip).textAlign).toBe(`start`)
  for (const debug of [`Vertices`, `Edges`, `Centroid`, `Points`])
    expect(text).not.toContain(debug)
  const { neighbors, touches_limits } = crowded.info
  expect(neighbors.length).toBeGreaterThan(6)
  expect(text).toContain(`+${neighbors.length - 6} more`)
  const bound_rows = [...tooltip.querySelectorAll(`.key`)].filter((key) =>
    key.textContent?.endsWith(`bound`),
  )
  const sides = new Set(touches_limits.map(({ side }) => side))
  expect(bound_rows).toHaveLength(sides.size)
})

// Each grid pane keeps its own hover (tooltip only there) while every pane highlights it
test(`a quaternary grid shares one arity legend; a domain hovered in one pane is highlighted in all, tooltip only in its own`, async () => {
  const bound: { hover_info: ChemPotHoverInfo | null } = { hover_info: null }
  vi.spyOn(console, `error`).mockImplementation(() => undefined)
  const config = { projection_mode: `grid` as const, default_min_limit: -25 }
  mounted = mount(ChemPotDiagram, {
    target: document.body,
    props: bind_props({ entries: ytos_entries, config }, bound),
  })
  const scenes = () =>
    threlte_stub.nodes
      .filter(({ tag }) => tag === `Scene`)
      .map(({ props }) => props as HighlightScene)
  await vi.waitFor(() => {
    expect(document.querySelector(`.spinner`)).toBeNull()
    expect(scenes()).toHaveLength(4)
    expect(scenes().every((scene) => scene.hover_meshes.length > 0)).toBe(true)
  })
  // one arity legend above the grid, not one per pane over its axis labels
  const legends = [...document.querySelectorAll<HTMLElement>(`.arity-legend`)].filter(
    (legend) => getComputedStyle(legend).display !== `none`,
  )
  expect(legends.map((legend) => legend.closest(`.projection-grid`))).toEqual([null])
  expect(legends[0].textContent).toBe(`UnaryBinaryTernary4+`)
  const panes = [...document.querySelectorAll(`.chempot-diagram-3d`)]
  const tooltip_panes = () =>
    panes.map((pane) => pane.querySelectorAll(`.chempot-tooltip`).length)
  const highlights = () => scenes().map(highlighted)

  const [first, second] = scenes()
  const hovered = second.hover_meshes.find(({ formula }) => formula.length > 2)
  const other = first.hover_meshes.find(({ formula }) => formula !== hovered?.formula)
  if (!hovered || !other) throw new Error(`no two distinct compound domains`)
  second.on_domain_hover(hovered, pointer_event)
  flushSync()
  expect(bound.hover_info?.formula).toBe(hovered.formula)
  expect(tooltip_panes()).toEqual([0, 1, 0, 0])
  expect(highlights()).toEqual(Array(4).fill(hovered.formula))
  // hovering in another pane hands the tooltip and highlight over
  second.on_domain_leave(hovered)
  first.on_domain_hover(other, pointer_event)
  flushSync()
  expect(tooltip_panes()).toEqual([1, 0, 0, 0])
  expect(highlights()).toEqual(Array(4).fill(other.formula))
  first.on_domain_leave(other)
  flushSync()
  expect(bound.hover_info).toBeNull()
  expect(tooltip_panes()).toEqual([0, 0, 0, 0])
  expect(highlights()).toEqual(Array(4).fill(null))
})

test(`slicing a quaternary at fixed mu re-sections on the main thread and plots section areas`, async () => {
  type SliceScene = {
    render_domains: { formula: string; points_3d: number[][] }[]
    data_center: Vec3
    data_extent: number
    render_axis_scale: Vec3
  }
  const framing = () => {
    const { data_center, data_extent, render_axis_scale } = scene()
    return { data_center, data_extent, render_axis_scale }
  }
  const scene = await mount_diagram<SliceScene>({
    entries: ytos_entries,
    config: { elements: [`O`, `Ti`, `Y`] },
  })
  const projected = scene().render_domains.map(({ formula }) => formula)
  // per-axis lowest drawn coordinate: the floor the artificial min limit is padded up to
  const floors = () =>
    [0, 1, 2].map((axis) =>
      Math.min(
        ...scene().render_domains.flatMap(({ points_3d }) => points_3d.map((pt) => pt[axis])),
      ),
    )
  const projected_floors = floors()
  // projected quaternary domains are polyhedra, so S's own facet and every S-free phase show
  expect(projected).toContain(`S`)
  const open_panes = () =>
    [...document.querySelectorAll(`.draggable-pane.pane-open`)].map((pane) =>
      [...pane.classList].find((name) => name.startsWith(`chempot-`)),
    )
  doc_query<HTMLButtonElement>(`.chempot-controls-toggle`).click()
  flushSync()
  expect(open_panes()).toEqual([`chempot-controls-pane`])
  doc_query<HTMLButtonElement>(`.chempot-slice-toggle`).click()
  flushSync()
  // one pane at a time: opening the slice pane closed the controls pane
  expect(open_panes()).toEqual([`chempot-slice-pane`])
  const slice_box = [
    ...document.querySelectorAll<HTMLInputElement>(`.chempot-slice input`),
  ].find((input) => input.type === `checkbox`)
  if (!slice_box) throw new Error(`no slice checkbox`)
  slice_box.click()
  flushSync()
  // toggling on slices at the S-rich end (Δmu_S = 0): S's own facet drops out
  expect(doc_query(`.slice-label`).textContent).toMatch(/Δμ\s*S\s*= 0 eV/)
  const at_rich = scene().render_domains.map(({ formula }) => formula)
  expect(at_rich).not.toContain(`S`)
  const rich_framing = framing()
  const range = doc_query<HTMLInputElement>(`.chempot-slice input[type="range"]`)
  set_input(range, `-3`)
  flushSync()
  // re-sectioned synchronously: no worker round trip, no stale overlay
  expect(document.querySelector(`.scene.stale`)).toBeNull()
  expect(doc_query(`.slice-label`).textContent).toMatch(/= −3 eV/) // format_num prints a Unicode minus
  const sliced = scene().render_domains
  expect(sliced.map(({ formula }) => formula)).not.toEqual(at_rich)
  // axes, camera and floor faces follow the slice-independent projection, so a sweep holds
  // the view (and the floor) still
  expect(framing()).toEqual(rich_framing)
  expect(floors()).toEqual(projected_floors)
  // exact sections are planar polygons in 3D
  for (const { points_3d } of sliced) expect(points_3d.length).toBeGreaterThanOrEqual(3)
  expect(document.querySelector(`.chempot-slice .scatter`)).not.toBeNull()
  slice_box.click()
  flushSync()
  expect(document.querySelector(`.slice-label`)).toBeNull()
  expect(scene().render_domains.map(({ formula }) => formula)).toEqual(projected)
})
