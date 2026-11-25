import { polygon_centroid, type Vec2 } from '#lib/math.js'
import { CONTROLS_ROW_HEIGHT } from '#lib/plot/core/layout.js'
import PourbaixControls from '#lib/pourbaix/PourbaixControls.svelte'
import PourbaixDiagram from '#lib/pourbaix/PourbaixDiagram.svelte'
import { pourbaix_systems, water_energy } from '#site/pourbaix.js'
import type { PourbaixHoverInfo } from '#lib/pourbaix/types.js'
import { type ComponentProps, createRawSnippet, flushSync, tick } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vite-plus/test'
import { mock_canvas_context, mount_in_test, pointer } from '../setup'

const [Fe, Cu, Zn] = [`Fe–H2O`, `Cu–H2O`, `Zn–H2O`].map(
  (name) => pourbaix_systems[name].entries,
)
const ag_te = pourbaix_systems[`Ag–Te–H2O (MP)`]
type Props = ComponentProps<typeof PourbaixDiagram>

// Mounts with $state props, so tests can change them and read bound ones afterwards
const render = async (overrides: Partial<Props> = {}) => {
  const style = `--scatter-width: 600px; --scatter-height: 400px`
  const props = $state<Props>({
    entries: Fe,
    water_energy,
    style,
    hover_info: null,
    ...overrides,
  })
  const root = mount_in_test(PourbaixDiagram, props)
  await tick()
  flushSync()
  return { root, props }
}
const polygons = (root: ParentNode) => [...root.querySelectorAll(`.pourbaix-domains polygon`)]
const labels = (root: ParentNode) =>
  [...root.querySelectorAll(`.domain-label`)].map((node) => node.textContent?.trim())
const tooltip_text = (root: ParentNode) =>
  root.querySelector(`.plot-tooltip`)?.textContent ?? null
// Hovers the pixel centroid of a domain polygon
const hover = (root: ParentNode, polygon: Element) => {
  const points = (polygon.getAttribute(`points`) ?? ``).split(` `)
  const [clientX, clientY] = polygon_centroid(
    points.map((pair) => pair.split(`,`).map(Number) as Vec2),
  )
  root
    .querySelector(`.pourbaix-domains`)
    ?.dispatchEvent(pointer(`pointermove`, { clientX, clientY }))
  flushSync()
}

test.each([
  [Fe, 5],
  [Cu, 4], // Cu^+ disproportionates at 10^-6
  [Zn, 3],
])(`renders one polygon per stable domain (%#)`, async (entries, count) => {
  expect(polygons((await render({ entries })).root)).toHaveLength(count)
})

test(`labels show charges as superscripts, water lines as ref lines, both toggle`, async () => {
  const { root, props } = await render()
  expect(labels(root)).toEqual(expect.arrayContaining([`Fe2+`, `Fe3+`, `Fe2O3`]))
  const fe2_label = root.querySelectorAll(`.domain-label`)[labels(root).indexOf(`Fe2+`)]
  expect(fe2_label.querySelector(`tspan[baseline-shift="0.4em"]`)?.textContent).toBe(`2+`)
  expect(root.textContent).toContain(`O₂/H₂O`)
  expect(root.textContent).toContain(`H⁺/H₂`)
  ;[props.show_water_lines, props.show_labels] = [false, false]
  flushSync()
  expect(labels(root)).toEqual([])
  expect(root.textContent).not.toContain(`O₂/H₂O`)
})

// The filled plot area starts below the corner controls row (gear, export, fullscreen)
// unless the caller sets its own top padding
test.each([
  [{}, CONTROLS_ROW_HEIGHT + 8],
  [{ padding: { t: 5 } }, 5],
])(`plot area top clears the controls row (%o)`, async (props, top) => {
  const { root } = await render(props)
  expect(Number(root.querySelector(`clipPath rect`)?.getAttribute(`y`))).toBe(top)
})

// Pointer pixels invert to (pH, E) inside the polygon drawn under them, for every domain. Ψ
// of the stable species never exceeds the Fe metal's Ψ = 0.
test(`hovering each domain's centroid highlights it and names it in the tooltip`, async () => {
  const { root, props } = await render()
  expect(labels(root)).toHaveLength(5) // every domain labeled, so labels pair with polygons
  for (const [idx, polygon] of polygons(root).entries()) {
    hover(root, polygon)
    expect(root.querySelector(`.pourbaix-domains polygon.hovered`)).toBe(polygon)
    expect(tooltip_text(root)).toContain(`${labels(root)[idx]} (`)
    expect(props.hover_info?.plane.label).toBe(
      labels(root)[idx]?.replace(/(?<charge>\d?[+-])$/, `^$<charge>`),
    )
    const psi = tooltip_text(root)
      ?.match(/Ψ:\s*(?<psi>\S+)/)
      ?.groups?.psi.replace(`−`, `-`)
    expect(Number(psi)).toBeLessThanOrEqual(0)
  }
  root.querySelector(`.pourbaix-domains`)?.dispatchEvent(pointer(`pointerleave`))
  flushSync()
  expect(tooltip_text(root)).toBeNull()
  expect(props.hover_info).toBeNull()
})

// hover_info binds whatever the tooltip shows: a snippet replaces its content, false hides it
const custom = createRawSnippet((info: () => PourbaixHoverInfo) => ({
  render: () => `<b>custom ${info().plane.label} at pH ${info().ph.toFixed(0)}</b>`,
}))
test.each([
  [custom, /^custom Fe2O3 at pH \d+$/],
  [false as const, null],
])(`tooltip %# replaces or hides the default`, async (tooltip, text) => {
  const { root, props } = await render({ tooltip })
  hover(root, polygons(root)[labels(root).indexOf(`Fe2O3`)])
  expect(props.hover_info?.plane.label).toBe(`Fe2O3`)
  if (text) expect(tooltip_text(root)?.trim()).toMatch(text)
  else expect(tooltip_text(root)).toBeNull()
})

// A slider change that removes the hovered domain re-resolves the hover at the same point
test(`hover follows log_conc and entry changes without a pointer move`, async () => {
  const { root, props } = await render({ entries: Cu, log_conc: -8 })
  hover(root, polygons(root)[1])
  expect(tooltip_text(root)).toContain(`Cu+ (aqueous)`)
  props.log_conc = -2
  flushSync()
  expect(polygons(root)).toHaveLength(4)
  expect(tooltip_text(root)).toContain(`Cu (solid)`)
  props.entries = []
  flushSync()
  expect(tooltip_text(root)).toBeNull() // the error state hovers nothing
})

test(`a new ph_range re-projects the domains`, async () => {
  const { root, props } = await render({ entries: Zn })
  const before = polygons(root).map((node) => node.getAttribute(`points`))
  props.ph_range = [9, 14] // past the Zn^2+/ZnO line at pH 8.6: the ion leaves the view
  await tick()
  flushSync()
  expect(labels(root)).toEqual([`Zn`, `ZnO`])
  expect(polygons(root).map((node) => node.getAttribute(`points`))).not.toEqual(before)
})

test.each([
  [{ entries: [...Fe, ...Zn, ...Cu] }, `up to two elements besides H and O, got [Fe, Zn, Cu]`],
  [{ heatmap_formula: `ZnO` }, `heatmap_formula ZnO names no entry`],
  [{ ph_range: [5, 5] as Vec2 }, `must be finite with min < max`],
])(`invalid input shows the error instead of a plot (%#)`, async (props, message) => {
  const { root } = await render(props)
  expect(root.textContent).toContain(message)
  expect(root.querySelector(`.pourbaix-domains`)).toBeNull()
})

// Two metals: a domain is a species pair, hovered as such, and the controls' x_Ag slider
// sets the composition the diagram recomputes for
test(`two-metal domains show species pairs and follow the composition`, async () => {
  const { root, props } = await render({ ...ag_te })
  const pair = polygons(root).find((polygon) => {
    hover(root, polygon)
    return tooltip_text(root)?.includes(` + `)
  })
  expect(pair).toBeDefined()
  expect(tooltip_text(root)).toMatch(
    /\((?:solid|aqueous)\) \+ .+\((?:solid|aqueous)\)[\s\S]*eV\/Ag\+Te/,
  )
  const controls = $state<ComponentProps<typeof PourbaixControls>>({
    log_conc: -8,
    temperature: 298.15,
    heatmap_formula: null,
    composition: null,
    show_water_lines: true,
    show_labels: true,
    formulas: ag_te.entries.map(({ formula }) => formula),
  })
  const pane = mount_in_test(PourbaixControls, controls)
  const slider = pane.querySelectorAll<HTMLInputElement>(`input[type="range"]`)[2]
  expect(pane.textContent).toContain(`0.50`)
  slider.value = `0.65`
  slider.dispatchEvent(new Event(`input`, { bubbles: true }))
  flushSync()
  expect(controls.composition).toEqual({ Ag: 0.65, Te: 1 - 0.65 })
  const before = polygons(root).length
  props.composition = { Ag: 2, Te: 1 }
  flushSync()
  expect(polygons(root)).not.toHaveLength(before)
  expect(labels(root)).toContain(`Ag2Te`)
})

// A stub 2D context records the painted pixels. The image spans the clip rect (the plot area)
// and its top-left pixel (pH -2, E 2.5) has Fe^3+'s color there: 0 above the envelope, the
// viridis start #440154. The color bar sits in the plot frame, where SVG/PNG export collects
// overlays, and transparent (not unpainted) fills keep the domains hoverable.
test(`heatmap paints one image over the plot area with an exported color bar`, async () => {
  const painted: ImageData[] = []
  onTestFinished(() => void vi.restoreAllMocks())
  mock_canvas_context({
    canvas: document.createElement(`canvas`),
    putImageData: (img: ImageData) => painted.push(img),
  })
  vi.spyOn(HTMLCanvasElement.prototype, `toDataURL`).mockReturnValue(
    `data:image/png;base64,stub`,
  )
  const { root } = await render({ heatmap_formula: `Fe^3+` })
  const [image, clip] = [`.pourbaix-domains image`, `clipPath rect`].map((sel) =>
    root.querySelector(sel),
  )
  expect(image?.getAttribute(`href`)).toBe(`data:image/png;base64,stub`)
  for (const attr of [`x`, `y`, `width`, `height`]) {
    expect(Number(image?.getAttribute(attr))).toBeCloseTo(Number(clip?.getAttribute(attr)), 6)
  }
  const [{ data, width, height }] = painted.slice(-1)
  expect([width, height]).toEqual([180, 120])
  expect(Array.from(data.slice(0, 3))).toEqual([0x44, 0x01, 0x54])
  const color_bar = root.querySelector(`.pourbaix-color-bar`)
  expect(
    color_bar?.closest(`.plot-frame`) && color_bar.hasAttribute(`data-export-overlay`),
  ).toBe(true)
  expect(new Set(polygons(root).map((node) => node.getAttribute(`fill`)))).toEqual(
    new Set([`transparent`]),
  )
})

// happy-dom's real getContext returns null, like a DOM without 2D canvas
test(`heatmap without a 2D canvas keeps its color bar but draws no image`, async () => {
  const { root } = await render({ heatmap_formula: `Fe^3+` })
  expect(root.querySelector(`.pourbaix-color-bar`)).not.toBeNull()
  expect(root.querySelector(`.pourbaix-domains image`)).toBeNull()
})
