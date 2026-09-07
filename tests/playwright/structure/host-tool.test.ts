import { expect, type Download, type Page } from '@playwright/test'
import { drag_canvas, test_without_errors as test } from '../helpers'

const scene_state = (page: Page) =>
  page.evaluate(async () => {
    const module_path = `/src/lib/io/export.ts`
    const { scene_registry, renderer_registry } = await import(/* @vite-ignore */ module_path)
    const pan_module = `/src/lib/scene/pan.ts`
    const { read_pan_offset } = await import(/* @vite-ignore */ pan_module)
    const canvas = document.querySelector(`.structure canvas`)
    const entry = canvas && scene_registry.get(canvas)
    const renderer = canvas && renderer_registry.get(canvas)
    let arrows = 0
    let density_vertices = 0
    const atom_colors: number[] = []
    entry?.scene.traverse(
      (node: {
        isMesh?: boolean
        isInstancedMesh?: boolean
        count?: number
        geometry?: {
          type: string
          getAttribute: (name: string) => { count: number } | undefined
        }
        material?: { metalness?: number; roughness?: number }
        instanceColor?: { array: ArrayLike<number> }
      }) => {
        if (node.isInstancedMesh && node.geometry?.type === `ConeGeometry`)
          arrows += node.count ?? 0
        if (
          node.isInstancedMesh &&
          node.geometry?.type === `SphereGeometry` &&
          node.instanceColor
        )
          atom_colors.push(
            ...Array.from(node.instanceColor.array).slice(0, (node.count ?? 0) * 3),
          )
        if (
          node.isMesh &&
          !node.isInstancedMesh &&
          node.geometry?.type === `BufferGeometry` &&
          node.material?.metalness === 0.1 &&
          node.material?.roughness === 0.6
        )
          density_vertices += node.geometry.getAttribute(`position`)?.count ?? 0
      },
    )
    return {
      arrows,
      density_vertices,
      atom_colors,
      webgpu: Boolean(renderer?.backend?.isWebGPUBackend),
      camera: entry
        ? [
            ...entry.camera.position.toArray(),
            ...entry.camera.quaternion.toArray(),
            entry.camera.zoom,
            ...read_pan_offset(entry.camera),
          ]
        : undefined,
      rendered: (renderer?.info.render.calls ?? 0) > 0,
    }
  })

test(`prediction tools render with WebGPU and hand keyboard/camera ownership to a nested trajectory`, async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1100 })
  await page.goto(`/structure/host-tool`)
  await expect.poll(() => scene_state(page)).toMatchObject({ webgpu: true, rendered: true })
  const outer = page.locator(`.structure`).first()
  const original_colors = (await scene_state(page)).atom_colors
  await page.getByRole(`button`, { name: `Run prediction`, exact: true }).click()
  await expect(
    page.getByRole(`status`).filter({ hasText: `charges, dipoles and density` }),
  ).toBeVisible()
  await expect.poll(async () => (await scene_state(page)).arrows).toBeGreaterThan(0)
  await expect.poll(async () => (await scene_state(page)).density_vertices).toBeGreaterThan(0)
  expect((await scene_state(page)).atom_colors).not.toEqual(original_colors)
  await page.locator(`button.structure-controls-toggle`).click()
  await expect(
    page.getByRole(`button`, { name: `Add surface for Predicted density`, exact: true }),
  ).toBeVisible()
  await page.locator(`button.structure-controls-toggle`).click()
  await outer.locator(`canvas`).first().hover()
  await drag_canvas(outer.locator(`canvas`).first(), { dx: 65, dy: 35 })
  // Seed the live camera directly: this tests remount persistence independently of gestures.
  await page.evaluate(async () => {
    const export_module = `/src/lib/io/export.ts`
    const pan_module = `/src/lib/scene/pan.ts`
    const { scene_registry } = await import(/* @vite-ignore */ export_module)
    const { set_pan_offset } = await import(/* @vite-ignore */ pan_module)
    const canvas = document.querySelector(`.structure canvas`)
    const camera = canvas && scene_registry.get(canvas)?.camera
    if (!canvas || !camera) throw new Error(`Missing structure camera`)
    camera.zoom = 68.5797
    camera.updateProjectionMatrix()
    const { width, height } = canvas.getBoundingClientRect()
    set_pan_offset(camera, [30, 15], width, height)
  })
  const before = (await scene_state(page)).camera
  expect(before).toHaveLength(10)
  expect(before?.slice(8)).toEqual([30, 15])
  await page.getByRole(`button`, { name: `Show predicted trajectory` }).click()
  await expect(page.getByTestId(`predicted-trajectory`)).toBeVisible()
  // The outer tool remains mounted but hidden; the nested Structure must not register one.
  await expect(page.getByTestId(`host-tool-controls`)).toHaveCount(1)
  await expect(page.getByTestId(`host-tool-controls`)).toBeHidden()
  await expect.poll(() => scene_state(page)).toMatchObject({ webgpu: true, rendered: true })
  const nested = page.getByTestId(`predicted-trajectory`)
  await nested.locator(`canvas`).first().hover()
  await page.keyboard.press(`ArrowRight`)
  await expect(page.getByLabel(`Trajectory frame`)).toHaveText(`Frame 2`)
  await page.keyboard.press(`i`)
  await expect(nested.locator(`.structure-info-pane`)).toBeVisible()
  await page.getByRole(`button`, { name: `Return to structure` }).click()
  await expect(nested).toHaveCount(0)
  await expect(outer.locator(`.structure-info-pane`)).toBeHidden()
  await expect(page.getByTestId(`host-tool-controls`)).toBeVisible()
  await expect.poll(() => scene_state(page)).toMatchObject({ webgpu: true, rendered: true })
  await expect
    .poll(async () => {
      const after = (await scene_state(page)).camera
      return after && before
        ? Math.max(...after.map((coord: number, idx: number) => Math.abs(coord - before[idx])))
        : Infinity
    })
    .toBeLessThan(1e-10)
  expect((await scene_state(page)).camera?.slice(7)).toEqual(before?.slice(7))
})

test(`caller camera updates during a host view take precedence over its saved view`, async ({
  page,
}) => {
  await page.goto(`/test/structure`)
  await page.evaluate(async () => {
    const host_module = `/src/lib/structure/index.ts`
    const demo_module = `/src/routes/(demos)/structure/host-tool/DemoHostTool.svelte`
    const { structure_host_tool } = await import(/* @vite-ignore */ host_module)
    const { default: component } = await import(/* @vite-ignore */ demo_module)
    structure_host_tool.component = component
  })
  await expect.poll(() => scene_state(page)).toMatchObject({ webgpu: true, rendered: true })
  await page.getByRole(`button`, { name: `Show predicted trajectory` }).click()
  await expect(page.getByTestId(`predicted-trajectory`)).toBeVisible()
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent(`set-scene-props`, {
        detail: { camera_position: [12, 9, 7], camera_target: [0, 0, 0] },
      }),
    ),
  )
  await page.getByRole(`button`, { name: `Return to structure` }).click()
  await expect(page.getByTestId(`predicted-trajectory`)).toHaveCount(0)
  await expect
    .poll(async () => (await scene_state(page)).camera?.slice(0, 3))
    .toEqual([12, 9, 7])
})

const read_download = async (download: Download) => {
  const stream = await download.createReadStream()
  if (!stream) throw new Error(`Download has no stream`)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString())
}

test(`exports reproducible predictions separately from the original structure`, async ({
  page,
}) => {
  await page.goto(`/structure/host-tool`)
  await page.getByRole(`button`, { name: `Run prediction`, exact: true }).click()
  await page.locator(`button.structure-export-toggle`).click()
  const prediction_download = page.waitForEvent(`download`)
  await page.getByTitle(`Download Export prediction`, { exact: true }).click()
  const download = await prediction_download
  expect(download.suggestedFilename()).toMatch(/^prediction-\d+\.json$/)
  const data = await read_download(download)
  expect(data.provenance).toMatchObject({
    model: `Deterministic host example`,
    version: `1`,
    units: { density: `e/A^3` },
    settings: { seed: 0 },
  })
  expect(data.site_properties).toHaveLength(data.input.sites.length)
  expect(data.site_properties[0]).toMatchObject({ charge: 0.4, dipole: [0.4, 0.2, 0.1] })
  expect(data.input.sites[0].properties.charge).toBeUndefined()
  expect(data.volumes[0]).toMatchObject({ field_id: `density`, dims: [12, 12, 12] })
  expect(data.volumes[0].values).toHaveLength(12 ** 3)
  const original_download = page.waitForEvent(`download`)
  await page.getByTitle(`Download JSON`, { exact: true }).click()
  const original = await read_download(await original_download)
  expect(original.sites).toEqual(data.input.sites)
  expect(original.lattice).toEqual(data.input.lattice)
  expect(original.volumes).toBeUndefined()
  // Closed panes retain controls, so include hidden buttons when checking their removal.
  const density_surface = page.getByRole(`button`, {
    name: `Add surface for Predicted density`,
    exact: true,
    includeHidden: true,
  })
  await expect(density_surface).toHaveCount(1)
  await page.getByRole(`button`, { name: `Reset prediction surfaces` }).click()
  await page.getByRole(`button`, { name: `Clear prediction`, exact: true }).click()
  await expect(page.getByTitle(`Download Export prediction`, { exact: true })).toHaveCount(0)
  await expect(density_surface).toHaveCount(0)
})
