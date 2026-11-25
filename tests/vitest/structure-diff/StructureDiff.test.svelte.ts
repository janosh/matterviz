import type { Vec3 } from '#lib/math.js'
import type StructureScene from '#lib/structure/StructureScene.svelte'
import type { Crystal, Site } from '#lib/structure/index.js'
import { StructureDiff } from '#lib/structure-diff/index.js'
import { compute_structure_diff } from '#lib/structure-diff/compute.js'
import { type ComponentProps, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { OrthographicCamera } from 'three'
import { make_crystal } from '../test-fixtures'

// The 3D canvas can't render here: pass Canvas children through and record the props the
// scene receives, as the Structure tests do
vi.mock(`@threlte/core`, async (import_original) => ({
  ...(await import_original<Record<string, unknown>>()),
  Canvas: (anchor: Node, props: { children: (anchor: Node) => void }) =>
    props.children(anchor),
}))
const scene_stub = vi.hoisted(() => ({
  all: [] as ComponentProps<typeof StructureScene>[],
  get props() {
    return this.all.at(-1)
  },
}))
// passthrough spy: counts diff recomputes per interaction
vi.mock(`#lib/structure-diff/compute.js`, async (import_original) => {
  const original = await import_original<{
    compute_structure_diff: typeof compute_structure_diff
  }>()
  return { ...original, compute_structure_diff: vi.fn(original.compute_structure_diff) }
})
vi.mock(`#lib/structure/StructureScene.svelte`, () => ({
  default: (_anchor: Node, props: NonNullable<typeof scene_stub.props>) => {
    scene_stub.all.push(props)
    props.camera = new OrthographicCamera()
    return {}
  },
}))

const reference = make_crystal(5, [
  { element: `Na`, abc: [0, 0, 0], properties: { force: [0, 0, 1] } },
  { element: `Cl`, abc: [0.5, 0.5, 0.5] },
  { element: `Cl`, abc: [0.98, 0.5, 0] },
])
// Cl sites swapped and shifted: target site 1 is reference site 2 moved across the a face
const target: Crystal = make_crystal(5, [
  [`Na`, [0.01, 0, 0]],
  [`Cl`, [0.02, 0.5, 0]],
  [`Cl`, [0.5, 0.5, 0.5]],
])

const mounted: Record<string, unknown>[] = []
afterEach(() => {
  scene_stub.all = []
  for (const component of mounted.splice(0)) void unmount(component)
  vi.unstubAllGlobals()
})
const mount_diff = async (props: ComponentProps<typeof StructureDiff>) => {
  // the canvas only mounts where WebGPU exists
  vi.stubGlobal(`navigator`, {
    gpu: {},
    userAgent: navigator.userAgent,
    platform: navigator.platform,
  })
  mounted.push(mount(StructureDiff, { target: document.body, props }))
  await tick()
}

describe(`StructureDiff`, () => {
  test(`headline numbers and a displacement-colored scene without bonds`, async () => {
    await mount_diff({ reference, target, remove_drift: false })
    const headline = document.querySelector(`.headline`)?.textContent?.replaceAll(/\s+/g, ` `)
    // max |Δr| is the Cl that crossed the a face: 0.04 * 5 Å, not 0.96 * 5 Å
    // RMSD = sqrt((0.05^2 + 0.2^2) / 3) Å
    expect(headline).toMatch(/RMSD 0\.119 Å max \|Δr\| 0\.2 Å site 2 \(Cl\)/)
    expect(headline).toContain(`ΔV +0%`)
    expect(headline).toContain(`sites reordered`)
    expect(headline).not.toContain(`drift`)
    // an unchanged cell has no lattice disclosure
    expect(document.querySelector(`details.lattice`)).toBeNull()
    const scene = scene_stub.props
    expect(scene?.scene_children).toBeTypeOf(`function`)
    expect(scene?.show_bonds).toBe(`never`)
    // the shown target carries its displacements as its only site property (forces dropped)
    const sites: Site[] = scene?.structure?.sites ?? []
    expect(sites.map(({ properties }) => Object.keys(properties))).toEqual(
      Array.from({ length: 3 }, () => [`displacement`]),
    )
    expect(Math.hypot(...(sites[1].properties.displacement as Vec3))).toBeCloseTo(0.2, 12)
    // atoms colored by |Δr|: one property color per site, the largest on the moved Cl
    const values = scene?.property_colors?.values ?? []
    expect(values).toHaveLength(3)
    expect(Math.max(...values.map(Number))).toBeCloseTo(0.2, 12)
  })

  test(`an index-ordered pair shows no reorder badge, the removed drift, a changed cell its lattice rows`, async () => {
    const pair = (lattice: number, na_a: number) =>
      make_crystal(lattice, [
        [`Cl`, [0.5, 0.5, 0.5]],
        [`Na`, [na_a, 0, 0]],
      ])
    await mount_diff({ reference: pair(5, 0), target: pair(5.5, 0.01) })
    const headline = document.querySelector(`.headline`)
    expect(headline?.textContent).not.toContain(`sites reordered`)
    // drift removal is on by default: the mean of Na's 0.055 Å and Cl's 0 Å shift
    expect(headline?.textContent?.replaceAll(/\s+/g, ` `)).toContain(`drift 0.028 Å removed`)
    // closed by default, with one column per changed parameter (the unchanged angles get
    // none) and reference, target and Δ rows
    const details = document.querySelector<HTMLDetailsElement>(`details.lattice`)
    expect(details?.open).toBe(false)
    expect(details?.querySelector(`summary`)?.textContent).toBe(`Lattice`)
    const table = details?.querySelector(`table`)
    const text_of = (selector: string) =>
      [...(table?.querySelectorAll(selector) ?? [])].map((cell) => cell.textContent?.trim())
    expect(text_of(`thead th`)).toEqual([``, `a (Å)`, `b (Å)`, `c (Å)`, `V (Å³)`])
    expect(text_of(`tbody th`)).toEqual([`Reference`, `Target`, `Δ`])
    expect(text_of(`tbody tr:last-child td`)).toEqual([`+10%`, `+10%`, `+10%`, `+33.1%`])
  })

  test(`docked site table sorts by |Δr| and links hover; only a swap recomputes the diff`, async () => {
    const props = $state<ComponentProps<typeof StructureDiff>>({
      reference,
      target,
      arrow_scale: 1,
      hovered_site_idx: null,
    })
    vi.mocked(compute_structure_diff).mockClear()
    await mount_diff(props)
    const calls = () => vi.mocked(compute_structure_diff).mock.calls.length
    const table_rows = () => document.querySelectorAll(`.structure-site-sidebar tbody tr`)
    await vi.waitFor(() => expect(table_rows()).toHaveLength(3), { timeout: 5000 }) // lazy import
    const headers = [...document.querySelectorAll(`.structure-site-sidebar thead th`)].map(
      (th) => th.textContent?.trim().replace(/\s*[↑↓]$/, ``),
    )
    // |Δr| leads, coordinates hidden
    expect(headers.filter(Boolean)).toEqual([
      `Site`,
      `Element`,
      `|Δr| (Å)`,
      `Δx (Å)`,
      `Δy (Å)`,
      `Δz (Å)`,
    ])
    // sorted by |Δr| descending: the Cl that crossed the face (site 2) first
    const row_cell = table_rows()[0].querySelectorAll(`td`)[headers.indexOf(`Site`)]
    expect(row_cell?.textContent?.trim()).toBe(`2`)
    row_cell?.dispatchEvent(new PointerEvent(`pointerover`, { bubbles: true }))
    props.arrow_scale = 5
    await tick()
    expect(props.hovered_site_idx).toBe(1)
    expect(scene_stub.props?.hovered_idx).toBe(1)
    expect(calls()).toBe(1) // hover and exaggeration reuse the diff
    Object.assign(props, { reference: target, target: reference })
    await tick()
    expect(calls()).toBe(2)
  })

  test(`the exaggeration reset returns to true size and shows only while exaggerated`, async () => {
    const props = $state<ComponentProps<typeof StructureDiff>>({
      reference,
      target,
      arrow_scale: 1,
      structure_props: { active_pane: `controls` },
    })
    await mount_diff(props)
    const reset = () =>
      document.querySelector<HTMLButtonElement>(`button[title^="Reset exaggeration"]`)
    await vi.waitFor(() => expect(reset()).not.toBeNull())
    expect(reset()?.style.visibility).toBe(`hidden`)
    props.arrow_scale = 8
    await tick()
    expect(reset()?.style.visibility).toBe(``)
    reset()?.click()
    await tick()
    expect(props.arrow_scale).toBe(1)
    expect(reset()?.style.visibility).toBe(`hidden`)
  })

  test(`mismatched compositions show the error instead of a viewer`, async () => {
    const other = make_crystal(5, [
      [`Na`, [0, 0, 0]],
      [`Br`, [0.5, 0.5, 0.5]],
      [`Cl`, [0.98, 0.5, 0]],
    ])
    await mount_diff({ reference, target: other })
    expect(document.body.textContent).toContain(`different compositions`)
    expect(scene_stub.all).toHaveLength(0)
  })
})
