import type { Locator } from '@playwright/test'
import { expect, test } from '@playwright/test'
import type * as ElementModule from '$lib/element/types'
import type * as H5UtilsModule from '$lib/trajectory/parse/h5-utils'
import type * as OpenTrajectoryModule from '$lib/trajectory/open'
import type * as FrameModule from '$lib/trajectory/frame'
import type { TrajectoryFrame } from '$lib/trajectory'
import type * as ParseWorkerModule from '$lib/file-viewer/parse-in-worker'
import { readFile } from 'node:fs/promises'
import {
  drop_file,
  collect_console_errors,
  expect_centered,
  expect_inline_spinner,
  IS_CI,
  require_bbox,
} from './helpers'

// Extended timeout for elements that load after trajectory data (plots, controls)
const LOAD_TIMEOUT = 15_000
const HYDRATION_TIMEOUT = 30_000

// Helper to conditionally skip entire describe blocks on CI
const describe_local_only = (title: string, callback: () => void): void => {
  if (IS_CI) test.describe.skip(title, callback)
  else test.describe(title, callback)
}

test(`homepage keeps the compressed trajectory source URL after loading`, async ({ page }) => {
  const compressed_path = `/trajectories/Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz`
  const compressed_data = await readFile(`src/site${compressed_path}`)
  const trajectory_requests: string[] = []
  await page.route(`**${compressed_path}`, (route) =>
    route.fulfill({ body: compressed_data, contentType: `application/gzip` }),
  )
  page.on(`request`, (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith(compressed_path.replace(/\.gz$/, ``))) trajectory_requests.push(path)
  })

  await page.goto(`/`, { waitUntil: `domcontentloaded` })
  await page
    .getByRole(`region`, { name: `Trajectory viewer`, exact: true })
    .scrollIntoViewIfNeeded()
  const filename = page.locator(`.trajectory button.filename`)
  await expect(filename).toBeVisible({ timeout: LOAD_TIMEOUT })

  expect(trajectory_requests).toEqual([compressed_path])
})

async function select_display_mode(trajectory: Locator, mode_name: string) {
  const display_button = trajectory.locator(`.view-mode-dropdown-wrapper .view-mode-button`)
  await expect(display_button).toBeVisible()
  await display_button.click()
  const dropdown = trajectory.locator(`.view-mode-dropdown`)
  await expect(dropdown).toBeVisible()
  const option = dropdown.locator(`.view-mode-option`).filter({ hasText: mode_name })
  await expect(option).toBeVisible()
  await option.click()
  await expect(dropdown).toBeHidden()
  return trajectory.locator(`.content-area`)
}

test.describe(`Trajectory Component`, () => {
  let trajectory_viewer: Locator
  let controls: Locator

  test.beforeEach(async ({ page }, test_info) => {
    test_info.setTimeout(test_info.timeout + HYDRATION_TIMEOUT)
    trajectory_viewer = page.locator(`#loaded-trajectory`)
    controls = trajectory_viewer.locator(`.trajectory-controls`)
    const query = test_info.tags.includes(`@single-viewer`) ? `?single-viewer` : ``
    if (test_info.tags.includes(`@file-destination`)) {
      await page.addInitScript(() => {
        // Keep the native writable handle and stream; replace only the OS picker in automation.
        Object.defineProperty(window, `showDirectoryPicker`, {
          value: async () =>
            (await navigator.storage.getDirectory()).getDirectoryHandle(`chosen-exports`, {
              create: true,
            }),
        })
      })
    }
    if (query) await page.setViewportSize({ width: 1500, height: 1400 })
    await page.goto(`/test/trajectory${query}`, { waitUntil: `domcontentloaded` })
    await expect(trajectory_viewer).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(`h1`)).toHaveAttribute(`data-hydrated`, `true`, {
      timeout: HYDRATION_TIMEOUT,
    })
    if (query) await expect(page.locator(`.trajectory`)).toHaveCount(1)
  })

  test(`empty state displays correctly`, async ({ page }) => {
    const empty_trajectory = page.locator(`#empty-state`)

    await expect(empty_trajectory.locator(`.empty-state h3`)).toHaveText(`Load Trajectory`)
    await expect(empty_trajectory.locator(`.empty-state > ul`)).toContainText(
      `Multi-frame XYZ`,
    )
    await expect(empty_trajectory).toHaveAttribute(
      `aria-label`,
      `Drop trajectory file here to load`,
    )
  })

  test(
    `toolbar icons stay consistent and analysis anchors stay hidden`,
    { tag: `@single-viewer` },
    async ({ page }) => {
      // The MSD/VACF/RDF/hotspots/structure-id/data-inspector panes keep their ViewerPane toggles inside
      // the Analysis ToolbarMenu only as layout anchors; #439 moved the wrapper into a child
      // component and a scoped selector stopped hiding them (stray toolbar icons)
      const anchors = controls.locator(`.analysis-dropdown-wrapper .analysis-toggle-anchor`)
      await expect(anchors).toHaveCount(6)
      for (const anchor of await anchors.all()) {
        await expect(anchor).toHaveCSS(`opacity`, `0`)
        await expect(anchor).toHaveCSS(`pointer-events`, `none`)
      }
      await expect(controls.locator(`.analysis-button`)).toBeVisible()
      await expect(controls.locator(`.analysis-button > svg`)).toHaveCount(1)
      await expect(controls.locator(`.view-mode-button > svg`)).toHaveCount(1)
      const check_icon_sizes = async () => {
        const icons = trajectory_viewer.locator(
          `button:is(.fullscreen-btn, .viewer-pane-toggle, .analysis-button, .view-mode-button) > svg`,
        )
        // Resizing can unmount panes: read the current icons and sizes in one DOM snapshot.
        await expect(async () => {
          const sizes = await icons.evaluateAll((elements) => {
            const size = getComputedStyle(document.documentElement).fontSize
            return elements.map((icon) => {
              const { width, height } = getComputedStyle(icon)
              return { width, height, size }
            })
          })
          expect(sizes.length).toBeGreaterThan(8)
          for (const { width, height, size } of sizes)
            expect([width, height]).toEqual([size, size])
        }).toPass()
      }
      await check_icon_sizes()
      const fullscreen = controls.locator(`.fullscreen-button`)
      await fullscreen.click()
      await expect(fullscreen).toHaveAttribute(`aria-pressed`, `true`)
      await check_icon_sizes()
      await fullscreen.click()
      await expect(fullscreen).toHaveAttribute(`aria-pressed`, `false`)
      await page.setViewportSize({ width: 390, height: 844 })
      await check_icon_sizes()
    },
  )

  test(`narrow viewer hides the filename and keeps the step slider off the FPS input`, async () => {
    await trajectory_viewer.evaluate((element) => {
      element.style.width = `1200px`
    })
    await expect(trajectory_viewer.locator(`button.filename`)).toBeVisible()
    await trajectory_viewer.evaluate((element) => {
      element.style.width = `800px`
    })
    await expect(trajectory_viewer.locator(`button.filename`)).toBeHidden()
    const slider_box = await trajectory_viewer.locator(`.slider-container`).boundingBox()
    const fps_box = await trajectory_viewer.locator(`.fps-section`).boundingBox()
    if (!slider_box || !fps_box) throw new Error(`slider or fps section not laid out`)
    expect(slider_box.x + slider_box.width).toBeLessThanOrEqual(fps_box.x + 1)
  })

  test(`loads and scrubs a local HDF5 File through the lazy worker loader`, async ({
    page,
  }) => {
    const empty_trajectory = page.locator(`#empty-state`)
    await empty_trajectory.evaluate(async (target) => {
      const response = await fetch(`/trajectories/flame-gold-cluster-55-atoms.h5`)
      const source = await response.blob()
      const transfer = new DataTransfer()
      transfer.items.add(new File([source], `gold.h5`))
      target.dispatchEvent(new DragEvent(`drop`, { bubbles: true, dataTransfer: transfer }))
    })

    await expect(empty_trajectory.locator(`button.filename`)).toContainText(`gold.h5`, {
      timeout: LOAD_TIMEOUT,
    })
    const step_input = empty_trajectory.locator(`.step-input`)
    await expect(step_input).toHaveValue(`0`)
    await step_input.fill(`19`)
    await step_input.press(`Enter`)
    await expect(step_input).toHaveValue(`19`)
  })

  test(`loads a remote HDF5 Blob once through the lazy worker loader`, async ({ page }) => {
    const empty_trajectory = page.locator(`#empty-state`)
    const source_url = `/trajectories/flame-gold-cluster-55-atoms.h5`
    const load_gate = Promise.withResolvers<undefined>()
    await page.route(`**${source_url}`, async (route) => {
      await load_gate.promise
      await route.continue()
    })
    let source_requests = 0
    page.on(`request`, (request) => {
      if (new URL(request.url()).pathname === source_url) source_requests++
    })
    await empty_trajectory.evaluate((target, url) => {
      const transfer = new DataTransfer()
      transfer.setData(`application/json`, JSON.stringify({ url }))
      target.dispatchEvent(new DragEvent(`drop`, { bubbles: true, dataTransfer: transfer }))
    }, source_url)

    const loading = empty_trajectory.locator(`.trajectory-loading`)
    await expect(loading.getByRole(`status`)).toHaveText(`Loading trajectory...`)
    try {
      for (const width of [1200, 420]) {
        await page.setViewportSize({ width, height: 900 })
        const [viewer, panel, bar, cancel] = await Promise.all(
          [
            empty_trajectory,
            loading,
            loading.getByRole(`progressbar`),
            loading.getByRole(`button`, { name: `Cancel` }),
          ].map((locator) => require_bbox(locator)),
        )
        const { label } = await expect_inline_spinner(loading)
        for (const box of [panel, bar, cancel]) {
          expect_centered(box, viewer, `x`)
        }
        expect_centered(panel, viewer, `y`)
        expect(bar.y).toBeGreaterThan(label.y + label.height)
        expect(cancel.y).toBeGreaterThan(bar.y + bar.height)
        expect(bar.width).toBeLessThan(viewer.width - 24)
        const font_size = await loading.evaluate((element) =>
          Number(getComputedStyle(element).fontSize.replace(`px`, ``)),
        )
        expect(bar.width).toBeLessThanOrEqual(24 * font_size)
      }
    } finally {
      load_gate.resolve(undefined)
    }

    await expect(empty_trajectory.locator(`button.filename`)).toContainText(
      `flame-gold-cluster-55-atoms.h5`,
      { timeout: LOAD_TIMEOUT },
    )
    expect(source_requests).toBe(1)
    await expect(empty_trajectory.locator(`.step-input`)).toHaveAttribute(`max`, `19`)
  })

  test(`HDF5 worker and main-thread data match exactly @source`, async ({ page }) => {
    const source_url = `/trajectories/gold-nanoparticle-md.h5`
    const comparison = await page.evaluate(async (url) => {
      const worker_module_path = `/src/lib/file-viewer/parse-in-worker.ts`
      const open_module_path = `/src/lib/trajectory/open.ts`
      const h5_utils_module_path = `/src/lib/trajectory/parse/h5-utils.ts`
      const element_module_path = `/src/lib/element/types.ts`
      const frame_module_path = `/src/lib/trajectory/frame.ts`
      const { materialize_frame_result } = (await import(
        frame_module_path
      )) as typeof FrameModule
      const [{ parse_in_worker }, { open_trajectory }, { with_h5_file }, { ELEM_SYMBOLS }] =
        await Promise.all([
          import(worker_module_path) as Promise<typeof ParseWorkerModule>,
          import(open_module_path) as Promise<typeof OpenTrajectoryModule>,
          import(h5_utils_module_path) as Promise<typeof H5UtilsModule>,
          import(element_module_path) as Promise<typeof ElementModule>,
        ])
      const source = await (await fetch(url)).blob()
      const source_buffer = await source.arrayBuffer()
      const raw = await with_h5_file(source_buffer, `oracle.h5`, (h5_file) => {
        const numeric = (path: string): number[] => {
          const dataset = h5_file.get(path)
          if (!dataset || !(`to_array` in dataset)) {
            throw new Error(`missing oracle dataset ${path}`)
          }
          const values = dataset.to_array()
          if (!Array.isArray(values) && !ArrayBuffer.isView(values)) {
            throw new TypeError(`oracle dataset ${path} is not numeric`)
          }
          return Array.from(values as ArrayLike<number | bigint>)
            .flat(Infinity)
            .map(Number)
        }
        return {
          positions: numeric(`/data/positions`),
          atomic_numbers: numeric(`/data/atomic_numbers`),
          cell: numeric(`/data/cell`),
          pbc: numeric(`/data/pbc`),
          velocity: numeric(`/data/velocities`),
          velocity_steps: numeric(`/steps/velocities`),
          forces: numeric(`/data/forces`),
          force_steps: numeric(`/steps/forces`),
          position_steps: numeric(`/steps/positions`),
        }
      })
      const memfs = await open_trajectory(source_buffer, { filename: `gold.h5` })
      const result = await parse_in_worker(source, `gold.h5`)
      if (result.type !== `trajectory`) throw new Error(`Expected HDF5 trajectory`)
      const workerfs = result.data
      const request = { signal_keys: [`velocity`, `forces`] }
      const memfs_stream = await memfs.collect_positions?.(request)
      const workerfs_stream = await workerfs.collect_positions?.(request)
      if (!memfs_stream || !workerfs_stream) throw new Error(`missing HDF5 position stream`)
      const serialize_frame = (frame: TrajectoryFrame | null | undefined) =>
        frame
          ? {
              step: frame.step,
              sites: frame.structure.sites.map(({ xyz, species }) => ({
                xyz,
                elements: species.map(({ element }) => element),
              })),
              lattice:
                `lattice` in frame.structure
                  ? {
                      matrix: frame.structure.lattice.matrix,
                      pbc: frame.structure.lattice.pbc,
                    }
                  : null,
            }
          : null
      const frame_indices = [0, Math.floor(memfs.frame_count / 2), memfs.frame_count - 1]
      const [memfs_frames, workerfs_frames] = await Promise.all(
        [memfs, workerfs].map((run) =>
          Promise.all(
            frame_indices.map(async (frame_idx) =>
              serialize_frame(await materialize_frame_result(run.read_frame(frame_idx))),
            ),
          ),
        ),
      )
      const stream_values = (stream: typeof memfs_stream) => [
        ...stream.positions,
        ...[`velocity`, `forces`].flatMap((key) => [...(stream.signals?.[key]?.values ?? [])]),
      ]
      const expected = [...raw.positions, ...raw.velocity, ...raw.forces]
      const streams = [memfs_stream, workerfs_stream]
      const stream_value_counts = streams.map((stream) => stream_values(stream).length)
      const errors = streams.flatMap((stream) =>
        stream_values(stream).map((value, value_idx) => Math.abs(value - expected[value_idx])),
      )
      const relative_errors = errors.map((error, value_idx) => {
        const expected_value = expected[value_idx % expected.length]
        return expected_value === 0 ? error : error / Math.abs(expected_value)
      })
      const stream_metadata = (stream: typeof memfs_stream) => ({
        n_frames: stream.n_frames,
        n_atoms: stream.n_atoms,
        elements: stream.elements,
        steps: stream.steps,
        pbc: stream.pbc,
        lattice_matrices: stream.lattice_matrices,
        signals: Object.fromEntries(
          Object.entries(stream.signals ?? {}).map(([key, signal]) => [
            key,
            {
              sample_shape: signal.sample_shape,
              steps: signal.steps,
              unit: signal.unit,
            },
          ]),
        ),
      })
      const exact = (left: unknown, right: unknown) =>
        JSON.stringify(left) === JSON.stringify(right)
      const n_atoms = raw.atomic_numbers.length
      const elements = raw.atomic_numbers.map(
        (atomic_number) => ELEM_SYMBOLS[atomic_number - 1],
      )
      if (elements.some((element) => !element)) {
        throw new Error(`oracle fixture contains invalid atomic numbers`)
      }
      const pbc = Array.from({ length: 3 }, () => Boolean(raw.pbc[0]))
      const lattice = Array.from({ length: 3 }, (_unused, row_idx) =>
        Array.from(
          { length: 3 },
          (_unused_2, column_idx) => raw.cell[column_idx * 3 + row_idx],
        ),
      )
      const volume = Math.abs(
        lattice[0][0] * (lattice[1][1] * lattice[2][2] - lattice[1][2] * lattice[2][1]) -
          lattice[0][1] * (lattice[1][0] * lattice[2][2] - lattice[1][2] * lattice[2][0]) +
          lattice[0][2] * (lattice[1][0] * lattice[2][1] - lattice[1][1] * lattice[2][0]),
      )
      const oracle_frame = (frame_idx: number) => ({
        step: raw.position_steps[frame_idx],
        sites: Array.from({ length: n_atoms }, (_unused, atom_idx) => ({
          xyz: raw.positions.slice(
            (frame_idx * n_atoms + atom_idx) * 3,
            (frame_idx * n_atoms + atom_idx + 1) * 3,
          ),
          elements: [elements[atom_idx]],
        })),
        lattice: {
          matrix: lattice,
          pbc,
        },
      })
      const oracle_frames = frame_indices.map(oracle_frame)
      const oracle_metadata = {
        n_frames: raw.position_steps.length,
        n_atoms,
        elements,
        steps: raw.position_steps,
        pbc,
        lattice_matrices: raw.position_steps.map(() => lattice),
        signals: {
          velocity: {
            sample_shape: [n_atoms, 3],
            steps: raw.velocity_steps,
          },
          forces: {
            sample_shape: [n_atoms, 3],
            steps: raw.force_steps,
          },
        },
      }
      const oracle_plot_metadata = raw.position_steps.map((step, frame_number) => ({
        frame_number,
        step,
        properties: { volume },
      }))
      const preview_equal = exact(
        serialize_frame(memfs.preview),
        serialize_frame(workerfs.preview),
      )
      const plot_metadata_equal = exact(memfs.properties.rows, workerfs.properties.rows)
      const stream_metadata_equal = exact(
        stream_metadata(memfs_stream),
        stream_metadata(workerfs_stream),
      )
      const random_frames_equal = exact(memfs_frames, workerfs_frames)
      const descriptors_equal = exact(memfs.signals, workerfs.signals)
      const oracle_frames_equal = exact(memfs_frames, oracle_frames)
      const oracle_metadata_equal = exact(stream_metadata(memfs_stream), oracle_metadata)
      const oracle_plot_metadata_equal = exact(memfs.properties.rows, oracle_plot_metadata)
      workerfs.dispose()
      memfs.dispose()
      // All reads reject after disposal; the stored preview remains available directly.
      const disposed_error = await Promise.resolve(
        materialize_frame_result(workerfs.read_frame(1)),
      ).then(() => `missing error`, String)
      return {
        max_absolute_error: errors.reduce((maximum, error) => Math.max(maximum, error), 0),
        max_relative_error: relative_errors.reduce(
          (maximum, error) => Math.max(maximum, error),
          0,
        ),
        stream_value_counts_equal: stream_value_counts.every(
          (value_count) => value_count === expected.length,
        ),
        // lazy HDF5 signals cross the worker boundary as descriptors, never with `values`
        loaded_signals: Object.values({ ...memfs.signals, ...workerfs.signals }).some(
          (signal) => `values` in signal,
        ),
        descriptors: Object.keys(workerfs.signals ?? {}).toSorted(),
        descriptors_equal,
        oracle_frames_equal,
        oracle_metadata_equal,
        oracle_plot_metadata_equal,
        disposed: disposed_error.includes(`disposed`),
        plot_metadata_equal,
        preview_equal,
        random_frames_equal,
        stream_metadata_equal,
      }
    }, source_url)

    expect(comparison).toEqual({
      max_absolute_error: 0,
      max_relative_error: 0,
      stream_value_counts_equal: true,
      loaded_signals: false,
      descriptors: [`forces`, `velocity`],
      descriptors_equal: true,
      oracle_frames_equal: true,
      oracle_metadata_equal: true,
      oracle_plot_metadata_equal: true,
      disposed: true,
      plot_metadata_equal: true,
      preview_equal: true,
      random_frames_equal: true,
      stream_metadata_equal: true,
    })
  })

  test(`basic controls and navigation work`, async () => {
    const step_input = controls.locator(`.step-input`)
    await expect(step_input).toHaveValue(`0`)
    await expect(controls.locator(`span`).filter({ hasText: `/ 3` })).toBeVisible()

    await controls.locator(`button[title^="Next step"]`).click()
    await expect(step_input).toHaveValue(`1`)
    await controls.locator(`button[title^="Previous step"]`).click()
    await expect(step_input).toHaveValue(`0`)
    await step_input.fill(`2`)
    await step_input.press(`Enter`)
    await expect(step_input).toHaveValue(`2`)
  })

  test(`playback controls function properly`, async () => {
    const play_button = controls.locator(`.play-button`)
    await expect(play_button).toHaveText(`▶`)
    await play_button.click()
    await expect(play_button).toHaveText(`⏸`)
    await play_button.click()
    await expect(play_button).toHaveText(`▶`)
  })

  test(
    `hotspot settings fit the pane and explain missing units`,
    { tag: `@single-viewer` },
    async ({ page }) => {
      // Reserve scrollbar space on macOS too, matching Linux's narrower pane content.
      await page.addStyleTag({
        content: `.pane-content { scrollbar-gutter: stable; } ::-webkit-scrollbar { width: 15px; }`,
      })
      const trajectory_xyz = [0, 1]
        .map(
          (step) =>
            `2\nProperties=species:S:1:pos:R:3:mass:R:1:velocity:R:3 step=${step}\nSi 0 0 0 28 1 0 0\nSi 1 0 0 28 0 1 0\n`,
        )
        .join(``)
      await drop_file(page, trajectory_viewer, trajectory_xyz, `hotspot-settings.xyz`)
      await expect(controls.locator(`.step-input`)).toHaveAttribute(`max`, `1`)
      await controls.locator(`.analysis-button`).click()
      await trajectory_viewer
        .getByRole(`button`, { name: `Thermal hotspots`, exact: true })
        .click()
      const pane = trajectory_viewer.locator(`.hotspots-pane`)
      const calculate = pane.getByRole(`button`, { name: `Calculate hotspots`, exact: true })
      await expect(pane.getByText(`Inferred from recorded masses`)).toBeVisible()
      await expect(calculate).toBeDisabled()
      await expect(calculate).toHaveAccessibleDescription(/Select velocity units/)
      await expect(pane.getByRole(`heading`, { name: `Thermal hotspots` })).toHaveCSS(
        `margin-top`,
        `0px`,
      )
      const advanced = pane.locator(`.advanced-settings`)
      await expect(advanced).not.toHaveAttribute(`open`)
      await expect(pane.getByLabel(/^Velocity units/)).toBeVisible()
      await expect(pane.getByLabel(/^Motion/)).not.toBeVisible()
      await advanced.locator(`summary`).first().click()
      for (const width of [1200, 390]) {
        await page.setViewportSize({ width, height: 844 })
        await expect(async () => {
          const overflow = await pane.locator(`.pane-content`).evaluate((content) => {
            const bounds = content.getBoundingClientRect()
            const style = getComputedStyle(content)
            const left = bounds.left + Number(style.paddingLeft.slice(0, -2))
            const right = bounds.right - Number(style.paddingRight.slice(0, -2))
            return [...content.querySelectorAll(`input, select, .hotspot-controls label`)]
              .filter((element) => {
                const rect = element.getBoundingClientRect()
                if (!rect.width || !rect.height) return false
                const label = element.closest(`label`)?.getBoundingClientRect()
                return (
                  rect.left < left - 1 ||
                  rect.right > right + 1 ||
                  (label && (rect.left < label.left - 1 || rect.right > label.right + 1))
                )
              })
              .map((element) => element.outerHTML)
          })
          expect(overflow).toEqual([])
        }).toPass()
        if (width === 1200) {
          for (const [left, right] of [
            [`Source`, `Velocity units`],
            [`Masses`, `Mass units`],
            [`Frame stride`, `Grid resolution`],
            [`Velocity property`, `Motion`],
            [`Grid frame`, `Mobile-atom selection property`],
            [`Dimensions`, `Degrees of freedom per atom`],
          ]) {
            const left_bounds = await require_bbox(pane.getByLabel(new RegExp(`^${left}`)))
            const right_bounds = await require_bbox(pane.getByLabel(new RegExp(`^${right}`)))
            expect(Math.abs(left_bounds.y - right_bounds.y)).toBeLessThan(1)
            expect(right_bounds.x).toBeGreaterThan(left_bounds.x)
          }
        }
        await calculate.scrollIntoViewIfNeeded()
        await expect(calculate).toBeInViewport()
        await expect(pane.getByRole(`status`)).toBeInViewport()
        const button_bounds = await require_bbox(calculate)
        const pane_bounds = await require_bbox(pane)
        expect(button_bounds.width).toBeLessThan(pane_bounds.width * 0.75)
      }
      await advanced.locator(`summary`).first().click()
      await pane.getByLabel(/^Velocity units/).selectOption(`A/fs`)
      await expect(calculate).toBeEnabled()
      await expect(calculate).not.toHaveAttribute(`aria-describedby`)
    },
  )

  for (const [mode, fullscreen] of [
    [`Structure-only`, false],
    [`Structure + Scatter`, true],
  ] as const) {
    test(
      `floating panes cover embedded controls in ${mode}`,
      { tag: `@single-viewer` },
      async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 900 })
        await select_display_mode(trajectory_viewer, mode)
        if (fullscreen) {
          await controls.locator(`.fullscreen-button`).click()
          await expect(controls.locator(`.fullscreen-button`)).toHaveAttribute(
            `aria-pressed`,
            `true`,
          )
        }
        const structure = trajectory_viewer.locator(`.structure`)
        const toolbar = structure.locator(`.control-buttons`)
        for (const label of [
          `Thermal hotspots`,
          `Mean squared displacement`,
          `Data inspector`,
        ]) {
          await controls.locator(`.analysis-button`).click()
          await controls.getByRole(`button`, { name: label, exact: true }).click()
          const pane = controls.locator(`.viewer-pane-open`)
          await expect(pane).toBeVisible()
          // Focus keeps the underlying hover toolbar visible even though the pane covers it.
          await structure.focus()
          await expect(toolbar).toHaveCSS(`opacity`, `1`)
          await expect(async () => {
            const covered = await pane.evaluate((element) => {
              const rect = element.getBoundingClientRect()
              const viewer = element.closest(`.trajectory`)
              if (!viewer) throw new Error(`Missing trajectory viewer`)
              return [
                ...viewer.querySelectorAll(`.structure .control-buttons button`),
              ].flatMap((button) => {
                const button_bounds = button.getBoundingClientRect()
                const coord_x = button_bounds.x + button_bounds.width / 2
                const coord_y = button_bounds.y + button_bounds.height / 2
                if (
                  !button_bounds.width ||
                  !button_bounds.height ||
                  coord_x <= rect.left ||
                  coord_x >= rect.right ||
                  coord_y <= rect.top ||
                  coord_y >= rect.bottom
                )
                  return []
                return [element.contains(document.elementFromPoint(coord_x, coord_y))]
              })
            })
            expect(covered.length).toBeGreaterThan(0)
            expect(covered.every(Boolean)).toBe(true)
          }).toPass({ timeout: 5000 })
        }
      },
    )
  }

  test(
    `hotspot coverage preserves sampled gaps and leaves the slider usable`,
    { tag: `@single-viewer` },
    async ({ page }) => {
      const console_errors = collect_console_errors(page)
      const content = [0, 1, 2, 3]
        .map(
          (step) =>
            `2\nLattice="4 0 0 0 4 0 0 0 4" Properties=species:S:1:pos:R:3:velocities:R:3 step=${step}\nSi 1 1 1 ${step + 1} 0 0\nSi 2 2 2 0 1 0\n`,
        )
        .join(``)
      await drop_file(page, trajectory_viewer, content, `hotspots.xyz`)
      await expect(controls.locator(`.step-input`)).toHaveAttribute(`max`, `3`)
      await controls.locator(`.step-input`).fill(`1`)
      await controls.locator(`.step-input`).press(`Enter`)
      await controls.locator(`.analysis-button`).click()
      await trajectory_viewer
        .getByRole(`button`, { name: `Thermal hotspots`, exact: true })
        .click()
      const pane = trajectory_viewer.locator(`.hotspots-pane`)
      await pane.getByLabel(/^Velocity units/).selectOption(`A/ps`)
      await pane.getByLabel(/^Masses/).selectOption(`standard`)
      await pane.getByLabel(/^Frame stride/).fill(`2`)
      // Heatmap results must keep the normal atom canvas and its camera mounted.
      const atom_canvas = trajectory_viewer.locator(`.structure canvas`).first()
      await expect(atom_canvas).toBeVisible()
      await atom_canvas.evaluate((element) =>
        element.setAttribute(`data-test-mounted`, `true`),
      )
      await pane.getByRole(`button`, { name: `Calculate hotspots`, exact: true }).click()
      await expect(pane.locator(`.hotspot-map-status`)).toHaveText(`Time average · 2 frames`)
      const coverage = controls.locator(`.hotspot-coverage`)
      await expect(coverage).toHaveAttribute(
        `aria-label`,
        `Hotspot analysis: 2/2 sampled frames complete`,
      )
      await expect(coverage.locator(`pattern`)).toHaveAttribute(`width`, `2`)
      await expect(coverage.locator(`.completed`)).toHaveAttribute(`width`, `3`)
      await expect(coverage.locator(`line`)).toHaveAttribute(`x1`, `1`)
      await expect(coverage.locator(`.active`)).toHaveCount(0)
      const slider = controls.locator(`.step-slider`)
      expect(
        await slider.evaluate((element) => Number(getComputedStyle(element).zIndex)),
      ).toBeGreaterThan(
        await coverage.evaluate((element) => Number(getComputedStyle(element).zIndex)),
      )
      const bounds = await require_bbox(slider, `frame slider`)
      await slider.click({ position: { x: bounds.width - 2, y: bounds.height - 2 } })
      await expect(controls.locator(`.step-input`)).toHaveValue(`3`)
      await expect(trajectory_viewer.locator(`.hotspot-overlay`)).toHaveCount(0)
      await controls.getByRole(`button`, { name: `Play`, exact: true }).click()
      await expect(controls.locator(`.step-input`)).not.toHaveValue(`3`)
      await controls.getByRole(`button`, { name: `Pause`, exact: true }).click()
      await expect(atom_canvas).toHaveAttribute(`data-test-mounted`, `true`)
      const heat_toggle = pane.getByLabel(`Heatmap on atoms`)
      await expect(heat_toggle).toBeVisible()
      await expect(heat_toggle).toBeChecked()
      await heat_toggle.uncheck()
      await expect(atom_canvas).toHaveAttribute(`data-test-mounted`, `true`)
      await heat_toggle.check()
      await expect(pane.locator(`.hotspot-map-status`)).toHaveText(`Time average · 2 frames`)
      await pane.getByLabel(/^Minimum average atoms\/bin/).fill(`1`)
      const legend = pane.getByLabel(`Thermal color legend`)
      await expect(legend).toContainText(`eV/atom`)
      const scale_lock = pane.getByLabel(`Lock numeric color ranges`)
      await scale_lock.check()
      await expect(legend).toContainText(`Ranges locked`)
      await pane.getByLabel(/^Display/).selectOption(`temperature`)
      await expect(scale_lock).not.toBeChecked()
      await expect(legend).toContainText(`kinetic temperature`)
      await expect(legend.locator(`small`).filter({ hasText: /^K$/ }).first()).toBeVisible()
      await pane.getByLabel(/^Display/).selectOption(`energy`)
      await pane.getByLabel(`Volume cloud`, { exact: true }).check()
      const opacity = pane.getByLabel(/^Cloud opacity/).locator(`..`)
      const atom_opacity = pane.getByLabel(/^Atom opacity/)
      await expect(atom_opacity).toHaveValue(`0.5`)
      await atom_opacity.press(`ArrowLeft`)
      await expect(atom_opacity).toHaveValue(`0.49`)
      await expect(atom_canvas).toHaveAttribute(`data-test-mounted`, `true`)
      const base_color = pane.getByRole(`group`, { name: `Cloud base color`, exact: true })
      const hot_color = pane.getByRole(`group`, { name: `Hotspot color`, exact: true })
      for (const [left, right] of [
        [opacity, atom_opacity.locator(`..`)],
        [base_color, hot_color],
      ]) {
        const left_bounds = await require_bbox(left)
        const right_bounds = await require_bbox(right)
        expect(Math.abs(left_bounds.y - right_bounds.y)).toBeLessThan(1)
      }
      const cutaway_mode = pane.getByLabel(/^Cutaway mode/)
      await expect(cutaway_mode).toHaveValue(`off`)
      await cutaway_mode.selectOption(`slab`)
      await pane.getByLabel(/^Cutaway axis/).selectOption(`0`)
      await expect(pane.getByLabel(/^Slab thickness/)).toHaveValue(`0.25`)
      await pane.getByLabel(/^Cutaway position/).press(`ArrowRight`)
      await expect(pane.getByLabel(/^Cutaway position/)).toHaveValue(`0.51`)
      await expect(atom_canvas).toHaveAttribute(`data-test-mounted`, `true`)
      await expect(pane.locator(`.hotspot-map-status`)).toHaveText(`Time average · 2 frames`)
      await page.setViewportSize({ width: 390, height: 844 })
      await expect
        .poll(() =>
          pane
            .locator(`.pane-content`)
            .evaluate((element) => element.scrollWidth - element.clientWidth),
        )
        .toBeLessThanOrEqual(0)
      await cutaway_mode.selectOption(`off`)
      await expect(pane.getByLabel(/^Slab thickness/)).toHaveCount(0)
      await page.keyboard.press(`Escape`)
      await page.setViewportSize({ width: 1500, height: 1400 })
      await expect(pane).not.toBeVisible()
      const atom_bounds = await require_bbox(atom_canvas)
      const thermal_tooltip = page.getByRole(`tooltip`).filter({ hasText: `Bin-average` })
      // Probe the canvas itself: the volume must not intercept the underlying atom hover.
      for (const row of [0.5, 0.4, 0.6, 0.3, 0.7]) {
        for (const col of [0.5, 0.4, 0.6, 0.3, 0.7]) {
          await page.mouse.move(
            atom_bounds.x + col * atom_bounds.width,
            atom_bounds.y + row * atom_bounds.height,
          )
          if (await thermal_tooltip.isVisible()) break
        }
        if (await thermal_tooltip.isVisible()) break
      }
      await expect(thermal_tooltip).toContainText(`Bin-average kinetic energy:`)
      await expect(
        thermal_tooltip.locator(`small`).filter({ hasText: `eV/atom` }),
      ).toBeVisible()
      await expect(thermal_tooltip).toContainText(`Analysis: 2 frames`)
      await expect(thermal_tooltip).toContainText(`average atoms/bin`)
      expect(console_errors).toEqual([])
    },
  )

  test(`spectroscopy settings remain usable after a failed calculation`, async ({ page }) => {
    const content = Array.from(
      { length: 8 },
      (_unused, frame_idx) =>
        `2\nLattice="2 0 0 0 2 0 0 0 2" Properties=species:S:1:pos:R:3\nH ${frame_idx * 0.01} 0 0\nO 1 1 1\n`,
    ).join(``)
    await drop_file(page, trajectory_viewer, content, `spectroscopy.xyz`)
    await expect(controls.locator(`.step-input`)).toHaveAttribute(`max`, `7`)
    await controls.locator(`.analysis-button`).click()
    await trajectory_viewer
      .getByRole(`button`, {
        name: `Trajectory IR/Raman & VDOS`,
        exact: true,
      })
      .click()
    const analysis = trajectory_viewer.locator(`.trajectory-spectroscopy-inline`)
    await expect(analysis.locator(`.scatter`)).toBeVisible({ timeout: LOAD_TIMEOUT })
    await analysis.locator(`.plot-controls-toggle`).click()
    await analysis.getByLabel(`Simulation timestep`).fill(`1`)
    await analysis.getByLabel(`Simulation time unit`).fill(`invalid`)
    await analysis
      .getByRole(`button`, { name: `Recompute spectroscopy`, exact: true })
      .press(`Enter`)
    await expect(analysis).toContainText(`time_unit 'invalid' cannot be converted`)
    await analysis.getByLabel(`Simulation time unit`).fill(`fs`)
    await analysis
      .getByRole(`button`, { name: `Compute spectroscopy`, exact: true })
      .press(`Enter`)
    await expect(analysis.locator(`.scatter`)).toBeVisible({ timeout: LOAD_TIMEOUT })
    await expect(analysis).not.toContainText(`time_unit 'invalid' cannot be converted`)
  })

  for (const label of [`WebM`, `MP4`])
    test(
      `tiny trajectory AV1 ${label} export cancels, restores its frame, and retries with decodable video`,
      { tag: [`@single-viewer`, `@file-destination`] },
      async ({ page }, test_info) => {
        await trajectory_viewer.scrollIntoViewIfNeeded()
        const step_input = controls.locator(`.step-input`)
        await step_input.fill(`2`)
        await trajectory_viewer.locator(`.trajectory-export-toggle`).click()
        const pane = trajectory_viewer.locator(`.export-pane.pane-open`)
        await pane
          .getByRole(`textbox`, { name: `File name`, exact: true })
          .fill(`My trajectory`)
        for (const width of [390, 1200]) {
          await page.setViewportSize({ width, height: 1000 })
          // Both adjacent frame inputs and mixed FPS/resolution controls need breathing room.
          for (const section of await pane.locator(`.settings-section`).all()) {
            const gaps = await section.evaluate((element) => {
              const rows = [...element.children].map((row) => row.getBoundingClientRect())
              return rows.slice(1).map((row, idx) => row.top - rows[idx].bottom)
            })
            expect(gaps.length).toBeGreaterThan(0)
            for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(7.5)
          }
        }
        await expect(pane.locator(`.resolution-buttons button`)).toHaveText([
          `0.5x`,
          `1x`,
          `2x`,
          `4x`,
        ])
        await expect(pane.locator(`.resolution-buttons .active`)).toHaveText(`1x`)
        await pane.getByRole(`spinbutton`, { name: `Frame Rate (FPS)` }).fill(`10`)
        await expect(trajectory_viewer).toHaveClass(/\bhorizontal\b/)
        const expected_size = await trajectory_viewer
          .locator(`.viewport-cell`)
          .first()
          .evaluate((viewport) => {
            // Canvas CSS sizes lag responsive layout until Threlte's next resize update.
            // Export scales the settled viewport before flooring to whole pixels.
            const { width, height } = viewport.getBoundingClientRect()
            return {
              width: Math.floor(width * devicePixelRatio * 3),
              height: Math.floor(height * devicePixelRatio * 3),
            }
          })
        const export_button = pane.getByRole(`button`, {
          name: `Download ${label}`,
          exact: true,
        })
        let downloads = 0
        page.on(`download`, () => downloads++)
        await export_button.click()
        const [progress, status, cancel] = await pane
          .locator(`.export-progress`)
          .evaluate((element) =>
            [element, ...element.querySelectorAll(`[role="status"], button`)].map((node) => {
              const { x, y, width, height, bottom } = node.getBoundingClientRect()
              return { x, y, width, height, bottom }
            }),
          )
        await pane.getByRole(`button`, { name: `Cancel export`, exact: true }).click()
        for (const box of [status, cancel]) {
          expect_centered(box, progress, `x`)
        }
        expect(cancel.y - status.bottom).toBeGreaterThanOrEqual(8)
        await expect(export_button).toBeEnabled()
        await expect(step_input).toHaveValue(`2`)
        expect(downloads).toBe(0)
        const [download] = await Promise.all([
          page.waitForEvent(`download`),
          export_button.click().then(async () => {
            await expect(export_button).toBeEnabled()
            expect(await pane.locator(`.error-message`).allTextContents()).toEqual([])
          }),
        ])
        await expect(step_input).toHaveValue(`2`)
        expect(downloads).toBe(1)
        const format = label.toLowerCase()
        const path = test_info.outputPath(`trajectory.${format}`)
        await download.saveAs(path)
        const video_data = await readFile(path)
        expect(download.suggestedFilename()).toBe(`My trajectory.${format}`)
        // Assert the encoded track, not just the requested MIME type or file extension.
        expect(video_data.includes(format === `webm` ? `V_AV1` : `av01`)).toBe(true)
        const decoded = await page.evaluate(
          ({ encoded, mime_type }) =>
            new Promise<{ width: number; height: number; color_span: number }>(
              (resolve, reject) => {
                const video = document.createElement(`video`)
                video.requestVideoFrameCallback(() => {
                  video.pause()
                  const canvas = document.createElement(`canvas`)
                  canvas.width = video.videoWidth
                  canvas.height = video.videoHeight
                  const context = canvas.getContext(`2d`)
                  if (!context) return reject(new Error(`Canvas 2D context not available`))
                  context.drawImage(video, 0, 0)
                  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
                  let min_channel = 255
                  let max_channel = 0
                  for (let idx = 0; idx < pixels.length; idx++) {
                    if (idx % 4 === 3) continue
                    min_channel = Math.min(min_channel, pixels[idx])
                    max_channel = Math.max(max_channel, pixels[idx])
                  }
                  resolve({
                    width: video.videoWidth,
                    height: video.videoHeight,
                    color_span: max_channel - min_channel,
                  })
                })
                video.addEventListener(`error`, () =>
                  reject(new Error(video.error?.message ?? `AV1 decode failed`)),
                )
                video.muted = true
                video.src = `data:${mime_type};base64,${encoded}`
                video.play().catch(reject)
              },
            ),
          { encoded: video_data.toString(`base64`), mime_type: `video/${format}` },
        )
        expect(decoded.width).toBe(expected_size.width)
        expect(decoded.height).toBe(expected_size.height)
        // A valid container holding only a blank frame is still a broken trajectory export.
        expect(decoded.color_span).toBeGreaterThan(40)
        await pane.getByRole(`button`, { name: `Choose export folder`, exact: true }).click()
        await expect(pane.locator(`.folder-name`)).toHaveText(`chosen-exports/`)
        await export_button.click()
        await expect(export_button).toBeEnabled()
        await expect(pane.getByRole(`alert`)).toHaveCount(0)
        expect(downloads).toBe(1)
        const saved = await page.evaluate(async (container) => {
          const directory = await (
            await navigator.storage.getDirectory()
          ).getDirectoryHandle(`chosen-exports`)
          const file = await (
            await directory.getFileHandle(`My trajectory.${container}`)
          ).getFile()
          const contents = new TextDecoder().decode(await file.arrayBuffer())
          return {
            name: file.name,
            size: file.size,
            av1: contents.includes(container === `webm` ? `V_AV1` : `av01`),
          }
        }, format)
        expect(saved).toMatchObject({ name: `My trajectory.${format}`, av1: true })
        expect(saved.size).toBeGreaterThan(100)
      },
    )

  test.describe(`layout and configuration options`, () => {
    test(`step labels clear ticks and stay within the control bar`, async ({ page }) => {
      const loaded_trajectory = page.locator(`#loaded-trajectory`)
      const step_labels = loaded_trajectory.locator(`.step-labels .step-label`)
      await expect(step_labels).toHaveText([`0`, `1`, `2`])

      const { controls_bottom, label_bottoms, tick_label_gaps } = await loaded_trajectory
        .locator(`.trajectory-controls`)
        .evaluate((control_bar) => {
          const labels = Array.from(control_bar.querySelectorAll(`.step-label`))
          return {
            controls_bottom: control_bar.getBoundingClientRect().bottom,
            label_bottoms: labels.map((label) => label.getBoundingClientRect().bottom),
            tick_label_gaps: labels.map((label) => {
              const tick = label.previousElementSibling
              if (!(tick instanceof HTMLElement)) throw new Error(`step tick not found`)
              return label.getBoundingClientRect().top - tick.getBoundingClientRect().bottom
            }),
          }
        })
      expect(Math.max(...label_bottoms)).toBeLessThanOrEqual(controls_bottom)
      expect(Math.min(...tick_label_gaps)).toBeGreaterThanOrEqual(1)

      await expect(page.locator(`#negative-step-labels .step-label`)).toHaveText([
        `0`,
        `1`,
        `2`,
      ])
      await expect(page.locator(`#array-step-labels .step-label`)).toHaveText([`0`, `2`])
    })

    test(`viewer surface contrasts the page and hover controls overlay it`, async ({
      page,
    }) => {
      await expect(page.locator(`#no-controls .trajectory-controls`)).toBeHidden()
      const hover_viewer = page.locator(`#vertical-layout`)
      const hover_controls = hover_viewer.locator(`.trajectory-controls`)
      await expect(hover_viewer).toHaveCSS(`border-radius`, `4px`)
      const surface_bg = await hover_viewer.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      )
      const page_bg = await page
        .locator(`body`)
        .evaluate((element) => getComputedStyle(element).backgroundColor)
      expect(surface_bg).not.toBe(page_bg)
      await expect(hover_viewer.locator(`.content-area > .structure`)).toHaveCSS(
        `background-color`,
        surface_bg,
      )
      await expect(hover_viewer.locator(`.content-area > .scatter`)).toHaveCSS(
        `background-color`,
        surface_bg,
      )
      await expect(hover_controls).toHaveCSS(`position`, `absolute`)
      await hover_viewer.hover()
      await expect(hover_controls).toBeVisible()
      const structure_controls = hover_viewer.locator(
        `.content-area > .structure > .control-buttons`,
      )
      await expect(structure_controls).toBeVisible()
      const [trajectory_box, structure_box] = await Promise.all([
        hover_controls.boundingBox(),
        structure_controls.boundingBox(),
      ])
      if (!trajectory_box || !structure_box) throw new Error(`toolbar bounds not found`)
      expect(structure_box.y).toBeGreaterThanOrEqual(trajectory_box.y + trajectory_box.height)
    })
  })

  describe_local_only(`plot and data visualization`, () => {
    // Skipped on CI because scatter plot rendering times out

    test(`legend toggle keeps a series hidden`, async () => {
      const scatter_plot = trajectory_viewer.locator(`.scatter`)
      await expect(scatter_plot).toBeVisible({ timeout: LOAD_TIMEOUT })

      const legend_items = scatter_plot.locator(`.legend .legend-item`)
      await expect(legend_items).toHaveCount(2)

      const first_item = legend_items.first()
      await expect(first_item).toBeVisible()
      await expect(first_item).not.toHaveClass(/hidden/)

      await first_item.click()
      await expect(first_item).toHaveClass(/hidden/)

      // Regression: trigger a reactive update and verify hidden state persists.
      const next_btn = trajectory_viewer.locator(`button[title^="Next step"]`)
      await expect(next_btn).toBeVisible()
      await next_btn.click()
      await expect(first_item).toHaveClass(/hidden/)
    })

    for (const [selector, navigation_enabled] of [
      [`#no-plot-skimming`, false],
      [`#loaded-trajectory`, true],
    ] as const) {
      test(`plot navigation enabled=${navigation_enabled} requires a click`, async ({
        page,
      }) => {
        const trajectory = page.locator(selector)
        const scatter_plot = trajectory.locator(`.scatter`)
        const step_input = trajectory.locator(`.step-input`)
        await expect(scatter_plot).toBeVisible({ timeout: LOAD_TIMEOUT })
        const plot_points = scatter_plot.locator(`.marker`)
        expect(await plot_points.count()).toBeGreaterThan(1)
        const initial_step = await step_input.inputValue()
        await plot_points.nth(1).hover()
        await expect(step_input).toHaveValue(initial_step)
        await plot_points.nth(1).click()
        if (navigation_enabled) await expect(step_input).not.toHaveValue(initial_step)
        else await expect(step_input).toHaveValue(initial_step)
      })
    }

    for (const [kind, frame_count] of [
      [`constant-values`, 2],
      [`single-frame`, 1],
    ] as const) {
      test(`plot hides for ${kind} trajectories`, async ({ page }) => {
        const viewer = page.locator(`#${kind}`)
        const content_area = viewer.locator(`.content-area`)
        await expect(content_area).toHaveClass(/hide-plot/)
        await expect(content_area.locator(`.structure`)).toBeVisible()
        await expect(viewer.locator(`.step-input`)).toHaveValue(`0`)
        await expect(
          viewer.locator(`.trajectory-controls span`).filter({ hasText: `/ ${frame_count}` }),
        ).toBeVisible()
      })
    }
  })

  test.describe(`advanced features`, () => {
    test(`custom controls snippet works`, async ({ page }) => {
      const custom_controls = page.locator(`#custom-controls`)
      await expect(custom_controls.locator(`.trajectory-controls .nav-section`)).toBeHidden()
      const buttons = custom_controls.locator(`.trajectory-controls button`)
      await expect(buttons).toHaveText([`First`, `Last`])
      await buttons.last().click()
      await expect(custom_controls.locator(`.trajectory-controls`)).toContainText(
        `Step 3 of 3`,
      )
    })

    test(`accessibility attributes are present`, async ({ page }) => {
      const trajectory = page.locator(`#loaded-trajectory`)
      const trajectory_controls = trajectory.locator(`.trajectory-controls`)

      // Basic accessibility
      await expect(trajectory).toHaveAttribute(`role`, `application`)
      await expect(trajectory).toHaveAttribute(`tabindex`, `0`)

      // Button titles
      await expect(trajectory_controls.locator(`.play-button`)).toHaveAttribute(
        `title`,
        /Play|Pause/,
      )
      await expect(
        trajectory_controls.locator(`button[title^="Previous step"]`),
      ).toHaveAttribute(`title`, /^Previous step/)
      const info_toggle = trajectory_controls.locator(`.trajectory-info-toggle`)
      await expect(info_toggle).toHaveAttribute(`aria-label`, /trajectory info/)
      await info_toggle.click()
      const info_pane = trajectory.locator(`.trajectory-info-pane`)
      const info_row = info_pane.locator(`.info-row`).first()
      await expect(info_row.locator(`span`).first()).toHaveCSS(`text-align`, `left`)
      const widths = await info_row
        .locator(`span`)
        .evaluateAll((spans) => spans.map((span) => span.getBoundingClientRect().width))
      expect(widths).toHaveLength(2)
      const [label_width, value_width] = widths
      expect(value_width).toBeGreaterThan(label_width)
      await expect(controls.locator(`.fullscreen-button`)).toHaveAttribute(
        `aria-label`,
        /fullscreen/,
      )
    })

    test(`keyboard shortcuts are disabled when typing in inputs`, async ({ page }) => {
      const trajectory = page.locator(`#loaded-trajectory`)
      await select_display_mode(trajectory, `Structure-only`)
      const step_input = trajectory.locator(`.step-input`)
      await step_input.focus()
      await expect(step_input).toHaveValue(`0`)
      await step_input.fill(`1`)
      await expect(step_input).toHaveValue(`1`)
      await step_input.focus()
      await page.keyboard.press(`Space`)
      const play_button = trajectory.locator(`.play-button`)
      await expect(play_button).toHaveText(`▶`)
      await page.keyboard.press(`v`)
      await expect(trajectory.locator(`.content-area`)).toHaveClass(/show-structure-only/)
    })

    test(`V cycles only the focused viewer and keeps focus when its structure disappears`, async ({
      page,
    }) => {
      const trajectory = page.locator(`#loaded-trajectory`)
      const sibling = page.locator(`#vertical-layout`)
      const content = await select_display_mode(trajectory, `Structure + Histogram`)
      const view_button = trajectory.locator(`.trajectory-controls .view-mode-button`)
      await trajectory.locator(`.structure`).focus()
      await sibling.hover()
      const resting_background = await view_button.evaluate(
        (button) => getComputedStyle(button).backgroundColor,
      )
      const icon_box = await require_bbox(view_button.locator(`svg`))
      await page.keyboard.press(`v`)
      await expect(view_button).not.toHaveCSS(`background-color`, resting_background)
      await expect(view_button).toHaveCSS(`box-shadow`, /0px 0px 0px 1px$/)
      expect(await require_bbox(view_button.locator(`svg`))).toMatchObject({
        width: icon_box.width,
        height: icon_box.height,
      })
      await expect(content).toHaveClass(/show-plot-only/)
      await expect(trajectory.locator(`.scatter`)).toBeVisible()
      await expect(trajectory).toBeFocused()
      await expect(view_button).toHaveCSS(`background-color`, resting_background)
      await page.keyboard.press(`v`)
      await expect(trajectory.locator(`.histogram`)).toBeVisible()
      await page.keyboard.press(`Shift+V`)
      await expect(view_button).not.toHaveCSS(`background-color`, resting_background)
      await expect(trajectory.locator(`.scatter`)).toBeVisible()
      await expect(trajectory).toBeFocused()
      await expect(sibling.locator(`.trajectory-controls .view-mode-button`)).toHaveAttribute(
        `aria-label`,
        /^Automatic:/,
      )
      await sibling.focus()
      await page.keyboard.press(`v`)
      await expect(sibling.locator(`.content-area`)).toHaveClass(/show-structure-only/)
      await expect(trajectory.locator(`.scatter`)).toBeVisible()
    })

    test(
      `playback shortcuts flash their controls without resizing them`,
      { tag: `@single-viewer` },
      async ({ page }) => {
        const trajectory = page.locator(`#loaded-trajectory`)
        await trajectory.focus()
        for (const [key, selector] of [
          [`ArrowRight`, `.nav-section button:last-child`],
          [`ArrowLeft`, `.nav-section button:first-child`],
          [`End`, `.step-input`],
          [`Home`, `.step-input`],
          [`+`, `.fps-section input`],
          [`-`, `.fps-section input`],
          [`Space`, `.play-button`],
          [`Space`, `.play-button`],
        ]) {
          const control = trajectory.locator(selector)
          await page.keyboard.press(key)
          await expect(control, key).toHaveCSS(`box-shadow`, /0px 0px 0px 1px$/)
          const { width, height } = await require_bbox(control)
          await expect(control, key).toHaveCSS(`box-shadow`, `none`)
          expect(await require_bbox(control), key).toMatchObject({ width, height })
        }
      },
    )

    test(`FPS input uses 0.1 increments and shared bounds`, async ({ page }) => {
      const trajectory = page.locator(`#loaded-trajectory`)
      const play_button = trajectory.locator(`.play-button`)

      await play_button.click() // Start playing to show FPS controls

      const fps_section = trajectory.locator(`.fps-section`)
      await expect(fps_section).toBeVisible()
      const fps_input = fps_section.locator(`input[type="number"]`)
      for (const [input, expected] of [
        [`12.34`, `12.3`],
        [`300`, `300`],
        [`0`, `0`],
      ]) {
        await fps_input.fill(input)
        await fps_input.press(`Enter`)
        await expect(fps_input).toHaveValue(expected)
      }
      await expect(fps_input).toHaveAttribute(`min`, `0`)
      await expect(fps_input).toHaveAttribute(`max`, `300`)
      await expect(fps_input).toHaveAttribute(`step`, `0.1`)
      await expect(fps_section.locator(`input[type="range"]`)).toHaveCount(0)
      await expect(play_button).toHaveText(`▶`)
    })
  })

  test.describe(`responsive design and viewport-based layout`, () => {
    test(
      `viewer height stays compact across viewport orientations`,
      { tag: `@single-viewer` },
      async ({ page }) => {
        await expect(trajectory_viewer.locator(`.scatter`)).toBeVisible()
        for (const min_height of [500, 420]) {
          if (min_height !== 500) {
            await trajectory_viewer.evaluate((element, height) => {
              element.style.setProperty(`--traj-min-height`, `${height}px`)
            }, min_height)
          }
          // Cross the portrait/landscape boundary in both directions, then a phone width.
          for (const width of [1200, 899, 901, 390, 1200]) {
            await page.setViewportSize({ width, height: 900 })
            await expect(trajectory_viewer).toHaveCSS(`height`, `${min_height}px`)
          }
        }
      },
    )

    test(`display mode menu overrides visually flat automatic plots`, async ({ page }) => {
      const trajectory = page.locator(`#empty-state`)
      const content_area = trajectory.locator(`.content-area`)
      const display_button = trajectory.locator(
        `.view-mode-dropdown-wrapper .view-mode-button`,
      )
      await expect(trajectory.locator(`.empty-state`)).toBeVisible()
      const content = [0, 1, 2]
        .map(
          (step) =>
            `2\nProperties=species:S:1:pos:R:3 energy=${-1_750_000 + step} kinetic_energy=${9500 + step} total_energy=${-1_740_500 + 2 * step}\nSi 0 0 0\nSi 1 1 ${1 + step / 10}\n`,
        )
        .join(``)
      await drop_file(page, trajectory, content, `flat-energy-traces.xyz`)
      await expect(content_area).toHaveClass(/show-structure-only/)
      await expect(display_button).toHaveAttribute(
        `aria-label`,
        `Automatic: Structure-only (V: next, Shift+V: previous)`,
      )
      await expect(trajectory.locator(`.scatter`)).toHaveCount(0)
      await select_display_mode(trajectory, `Structure-only`)
      await expect(content_area).toHaveClass(/show-structure-only/)
      await select_display_mode(trajectory, `Scatter-only`)
      await expect(content_area).toHaveClass(/show-plot-only/)
      await select_display_mode(trajectory, `Structure + Scatter`)
      await expect(content_area).toHaveClass(/show-both/)
      await expect(trajectory.locator(`.scatter`)).toBeVisible()
      await select_display_mode(trajectory, `Automatic`)
      await expect(content_area).toHaveClass(/show-structure-only/)
    })

    test(`mobile viewport forces vertical content layout for small screens`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 700, height: 800 })
      const trajectory = page.locator(`#auto-layout`)
      const content_area = trajectory.locator(`.content-area`)
      await expect(trajectory).toBeVisible({ timeout: LOAD_TIMEOUT })
      await expect(content_area).toBeVisible({ timeout: LOAD_TIMEOUT })

      await expect(async () => {
        const columns = await content_area.evaluate(
          (element) => getComputedStyle(element).gridTemplateColumns,
        )
        expect(columns.split(` `)).toHaveLength(1)
      }).toPass({ timeout: 5000 })
    })

    test(`narrow container stacks the panes and widening it unstacks them`, async ({
      page,
    }) => {
      // Three resize cycles, each waiting on a ResizeObserver, does not fit the
      // default 30s budget when the whole suite shares one software GPU.
      test.slow()
      const trajectory = page.locator(`#auto-layout`)

      await trajectory.scrollIntoViewIfNeeded()
      // Wait for the plot, not the controls: controls render as soon as the
      // trajectory loads, but the scatter only appears once plot metadata is
      // sampled, and both panes have to exist before either can be measured.
      await expect(trajectory.locator(`.scatter`)).toBeVisible({
        timeout: 30000,
      })

      // 500px tall is what a chat sidebar card really measures, and minHeight has
      // to go for any height below that to stick: .trajectory's own 500px floor
      // outranks an inline height, exactly as it does to Hive's card.
      const set_size = (width: number, height = 500) =>
        trajectory.evaluate(
          (element: HTMLElement, size) => Object.assign(element.style, size),
          {
            width: `${width}px`,
            height: `${height}px`,
            minHeight: `0`,
          },
        )

      // The class comes from a ResizeObserver, which a page full of software-WebGPU
      // canvases can leave waiting well past the default 5s expect timeout.
      const resize_timeout = { timeout: 20_000 }

      await set_size(480)
      await expect(trajectory).toHaveClass(/vertical/, resize_timeout)
      await expect(trajectory).not.toHaveClass(/horizontal/)

      // Stacked means structure on top, plot below, splitting the box evenly.
      // The layout class alone would still pass if the grid ordered them the
      // other way round, or handed the plot its 350px floor and the structure
      // whatever was left.
      const panes = await trajectory.evaluate((element) => {
        const rect = (sel: string) => element.querySelector(sel)?.getBoundingClientRect()
        return { structure: rect(`.structure`), plot: rect(`.scatter`) }
      })
      if (!panes.structure || !panes.plot) throw new Error(`panes not found`)
      expect(panes.plot.top).toBeGreaterThan(panes.structure.top)
      expect(panes.structure.height).toBeCloseTo(panes.plot.height, 0)

      // Widening the sidebar puts them back side by side without a remount
      await set_size(900)
      await expect(trajectory).toHaveClass(/horizontal/, resize_timeout)
      await expect(trajectory).not.toHaveClass(/vertical/)

      // This viewer's controls bar takes ~32px the panes never get. At 380px tall
      // that leaves 174px rows, under the readable minimum, so it stays side by
      // side. Measuring the wrapper would see 190px rows and stack it instead.
      await set_size(520, 380)
      await expect(trajectory).toHaveClass(/horizontal/, resize_timeout)
    })

    test(`plot and structure start equal and resize live in both layouts`, async ({
      page,
    }) => {
      const check_viewer = async (
        selector: string,
        orientation: `horizontal` | `vertical`,
      ) => {
        const viewer = page.locator(selector)
        await expect(viewer).toBeVisible()
        await expect(viewer).toHaveClass(new RegExp(orientation))
        await expect(viewer.locator(`.structure`)).toBeVisible({
          timeout: LOAD_TIMEOUT,
        })
        await expect(viewer.locator(`.scatter`)).toBeVisible({
          timeout: LOAD_TIMEOUT,
        })
        const pane_dimensions = () =>
          viewer.locator(`.content-area`).evaluate((element) => {
            const structure = element.querySelector(`.structure`)
            const plot = element.querySelector(`.scatter`)
            if (!(structure instanceof HTMLElement) || !(plot instanceof HTMLElement)) {
              throw new Error(`trajectory panes not found`)
            }
            return {
              structure: structure.getBoundingClientRect(),
              plot: plot.getBoundingClientRect(),
            }
          })
        const dimensions = await pane_dimensions()
        for (const dimension of [`width`, `height`] as const) {
          expect(dimensions.structure[dimension] / dimensions.plot[dimension]).toBeCloseTo(
            1,
            1,
          )
        }

        const divider = viewer.getByRole(`separator`, {
          name: `Resize structure and plot panes`,
        })
        const drag_divider = async (delta_x: number, delta_y: number) => {
          await divider.scrollIntoViewIfNeeded()
          const bounds = await divider.boundingBox()
          if (!bounds) throw new Error(`pane divider bounds not found`)
          const start = {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2,
          }
          await page.mouse.move(start.x, start.y)
          await page.mouse.down()
          await page.mouse.move(start.x + delta_x, start.y + delta_y)
          const resized = await pane_dimensions()
          await page.mouse.up()
          return { bounds, resized }
        }
        const { resized } = await drag_divider(
          orientation === `horizontal` ? 40 : 0,
          orientation === `vertical` ? 40 : 0,
        )
        const dimension = orientation === `horizontal` ? `width` : `height`
        expect(resized.structure[dimension]).toBeGreaterThan(dimensions.structure[dimension])
        expect(resized.plot[dimension]).toBeLessThan(dimensions.plot[dimension])

        if (orientation === `horizontal`) {
          await viewer.evaluate((element) => element.setAttribute(`dir`, `rtl`))
          const rtl_dimensions = await pane_dimensions()
          const { bounds, resized: rtl_resized } = await drag_divider(-40, 0)
          expect(bounds.x + bounds.width / 2).toBeCloseTo(rtl_dimensions.structure.x, 0)
          expect(rtl_resized.structure.width).toBeGreaterThan(rtl_dimensions.structure.width)
          expect(rtl_resized.plot.width).toBeLessThan(rtl_dimensions.plot.width)
        }
      }

      await check_viewer(`#auto-layout`, `horizontal`)
      await check_viewer(`#vertical-layout`, `vertical`)
    })
  })
})
