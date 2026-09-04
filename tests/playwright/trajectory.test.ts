import type { Locator } from '@playwright/test'
import { expect, test } from '@playwright/test'
import type * as ElementModule from '$lib/element/types'
import type * as H5UtilsModule from '$lib/trajectory/parse/h5-utils'
import type * as OpenTrajectoryModule from '$lib/trajectory/open'
import type { TrajectoryFrame } from '$lib/trajectory'
import type * as ParseWorkerModule from '$lib/file-viewer/parse-in-worker'
import { readFile } from 'node:fs/promises'
import { IS_CI } from './helpers'

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
    await page.goto(`/test/trajectory`, { waitUntil: `domcontentloaded` })
    await expect(trajectory_viewer).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(`h1`)).toHaveAttribute(`data-hydrated`, `true`, {
      timeout: HYDRATION_TIMEOUT,
    })
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

  test(`analysis pane toggles stay hidden anchors behind the Analysis menu`, async () => {
    // The MSD/VACF/RDF/structure-id/data-inspector panes keep their ViewerPane toggles inside
    // the Analysis ToolbarMenu only as layout anchors; #439 moved the wrapper into a child
    // component and a scoped selector stopped hiding them (stray toolbar icons)
    const anchors = controls.locator(`.analysis-dropdown-wrapper .analysis-toggle-anchor`)
    await expect(anchors).toHaveCount(5)
    for (const anchor of await anchors.all()) {
      await expect(anchor).toHaveCSS(`opacity`, `0`)
      await expect(anchor).toHaveCSS(`pointer-events`, `none`)
    }
    await expect(controls.locator(`.analysis-button`)).toBeVisible()
  })

  test(`narrow viewer hides the filename and keeps the step slider off the FPS input`, async () => {
    await trajectory_viewer.evaluate((el) => {
      el.style.width = `1200px`
    })
    await expect(trajectory_viewer.locator(`button.filename`)).toBeVisible()
    await trajectory_viewer.evaluate((el) => {
      el.style.width = `800px`
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
    let source_requests = 0
    page.on(`request`, (request) => {
      if (new URL(request.url()).pathname === source_url) source_requests++
    })
    await empty_trajectory.evaluate((target, url) => {
      const transfer = new DataTransfer()
      transfer.setData(`application/json`, JSON.stringify({ url }))
      target.dispatchEvent(new DragEvent(`drop`, { bubbles: true, dataTransfer: transfer }))
    }, source_url)

    await expect(empty_trajectory.locator(`button.filename`)).toContainText(
      `flame-gold-cluster-55-atoms.h5`,
      { timeout: LOAD_TIMEOUT },
    )
    expect(source_requests).toBe(1)
    await expect(empty_trajectory.locator(`.step-input`)).toHaveAttribute(`max`, `19`)
  })

  test(`main-thread and worker HDF5 runs return exactly matching data`, async ({ page }) => {
    const source_url = `/trajectories/gold-nanoparticle-md.h5`
    const comparison = await page.evaluate(async (url) => {
      const worker_module_path = `/src/lib/file-viewer/parse-in-worker.ts`
      const open_module_path = `/src/lib/trajectory/open.ts`
      const h5_utils_module_path = `/src/lib/trajectory/parse/h5-utils.ts`
      const element_module_path = `/src/lib/element/types.ts`
      const [
        { parse_trajectory_in_worker },
        { open_trajectory },
        { with_h5_file },
        { ELEM_SYMBOLS },
      ] = await Promise.all([
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
      const workerfs = await parse_trajectory_in_worker(source, `gold.h5`, undefined, {})
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
              serialize_frame(await run.read_frame(frame_idx)),
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
      // frame 0 is the in-memory preview and stays readable after dispose; any other frame rejects
      const disposed_error = await Promise.resolve(workerfs.read_frame(1)).then(
        () => `missing error`,
        String,
      )
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
      const item_count = await legend_items.count()
      test.skip(item_count < 2, `Need at least two legend items to test toggling`)

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

    test(`plot navigation can be disabled via plot_skimming prop`, async ({ page }) => {
      const trajectory = page.locator(`#no-plot-skimming`)
      const scatter_plot = trajectory.locator(`.scatter`)
      const step_input = trajectory.locator(`.step-input`)
      await expect(scatter_plot).toBeVisible({ timeout: LOAD_TIMEOUT })

      const initial_step = await step_input.inputValue()
      const plot_points = scatter_plot.locator(`.marker`)
      expect(await plot_points.count()).toBeGreaterThan(1)
      await plot_points.nth(1).click()
      await expect(step_input).toHaveValue(initial_step)
    })

    test(`plot navigation requires a click by default`, async ({ page }) => {
      const trajectory = page.locator(`#loaded-trajectory`)
      const scatter_plot = trajectory.locator(`.scatter`)
      const step_input = trajectory.locator(`.step-input`)
      await expect(scatter_plot).toBeVisible({ timeout: LOAD_TIMEOUT })

      const plot_points = scatter_plot.locator(`.marker`)
      expect(await plot_points.count()).toBeGreaterThan(1)
      const before = await step_input.inputValue()
      await plot_points.nth(1).hover()
      await expect(step_input).toHaveValue(before)
      await plot_points.nth(1).click()
      await expect(step_input).not.toHaveValue(before)
    })

    test(`plot hides when values are constant`, async ({ page }) => {
      const constant_trajectory = page.locator(`#constant-values`)
      const content_area = constant_trajectory.locator(`.content-area`)
      await expect(content_area).toHaveClass(/hide-plot/)
      await expect(content_area.locator(`.structure`)).toBeVisible()
    })

    test(`plot hides for single-frame trajectories`, async ({ page }) => {
      const single_frame_viewer = page.locator(`#single-frame`)
      const step_info = single_frame_viewer
        .locator(`.trajectory-controls span`)
        .filter({ hasText: `/ 1` })
      await expect(step_info).toBeVisible()
      const content_area = single_frame_viewer.locator(`.content-area`)
      await expect(content_area).toHaveClass(/hide-plot/)
      await expect(content_area.locator(`.structure`)).toBeVisible()
      await expect(single_frame_viewer.locator(`.step-input`)).toHaveValue(`0`)
    })
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
      const step_input = trajectory.locator(`.step-input`)
      await step_input.focus()
      await expect(step_input).toHaveValue(`0`)
      await step_input.fill(`1`)
      await expect(step_input).toHaveValue(`1`)
      await step_input.focus()
      await page.keyboard.press(`Space`)
      const play_button = trajectory.locator(`.play-button`)
      await expect(play_button).toHaveText(`▶`)
    })

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
    test(`display mode menu updates the visible pane`, async ({ page }) => {
      const trajectory = page.locator(`#auto-layout`)
      const content_area = trajectory.locator(`.content-area`)
      const display_button = trajectory.locator(
        `.view-mode-dropdown-wrapper .view-mode-button`,
      )
      const button_count = await display_button.count()
      test.skip(button_count === 0, `No view mode button found (no plot data)`)

      await expect(trajectory.locator(`.trajectory-controls`)).toBeVisible()
      await expect(display_button).toBeVisible()
      await select_display_mode(trajectory, `Structure-only`)
      await expect(content_area).toHaveClass(/show-structure-only/)
      await select_display_mode(trajectory, `Scatter-only`)
      await expect(content_area).toHaveClass(/show-plot-only/)
      await select_display_mode(trajectory, `Structure + Scatter`)
      await expect(content_area).toHaveClass(/show-both/)
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
        trajectory.evaluate((el: HTMLElement, size) => Object.assign(el.style, size), {
          width: `${width}px`,
          height: `${height}px`,
          minHeight: `0`,
        })

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
      const panes = await trajectory.evaluate((el) => {
        const rect = (sel: string) => el.querySelector(sel)?.getBoundingClientRect()
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
