<script lang="ts">
  import type { PaneProps, PaneToggleProps } from '$lib/overlays'
  import {
    estimate_video_bitrate,
    export_trajectory_video,
    get_ffmpeg_conversion_command,
    observe_canvas_presence,
  } from '$lib/io/export'
  import { download } from '$lib/io/fetch'
  import ExportPane from '$lib/io/ExportPane.svelte'
  import type { ExportSection } from '$lib/io/types'
  import { format_num } from '$lib/labels'
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import { clamp } from '$lib/math'
  import {
    fractional_export_unavailable_reason,
    xyz_export_unavailable_reason,
  } from '$lib/structure/export'
  import type { TrajectoryRun } from '$lib/trajectory'
  import type { TrajectoryFrameResolver } from '$lib/trajectory/file-export'
  import {
    collect_frame_property_rows,
    create_poscar_frame_range_zip,
    frame_rows_to_csv,
    frame_rows_to_json,
    serialize_extxyz_frame_range,
    trajectory_export_basename,
  } from '$lib/trajectory/file-export'
  import { tooltip } from 'svelte-widgets/attachments'
  import { to_error } from '$lib/utils'

  let {
    export_pane_open = $bindable(false),
    run = undefined,
    wrapper = undefined,
    filename = `trajectory`,
    video_fps = $bindable(30),
    resolution_multiplier = $bindable(1),
    on_step_change = undefined,
    resolve_frame = undefined,
    pane_props = {},
    toggle_props = {},
    ...rest
  }: {
    export_pane_open?: boolean
    // Trajectory data for generating filename
    run?: TrajectoryRun
    // Canvas wrapper for video export
    wrapper?: HTMLDivElement
    filename?: string
    video_fps?: number
    resolution_multiplier?: number
    // Function to change trajectory step during export
    on_step_change?: (step_idx: number) => Promise<void> | void
    // Loads one frame by index. Indexed trajectories keep only a few frames in `frames`, so
    // without this the data exports below would silently write a truncated file.
    resolve_frame?: TrajectoryFrameResolver
    pane_props?: PaneProps
    toggle_props?: PaneToggleProps
  } = $props()

  type VideoFormat = `webm` | `mp4`
  type TableFormat = `csv` | `json`

  // Which export is running (one at a time) and how far along it is
  let running = $state<{ label: string; progress: number } | null>(null)
  let export_error = $state<string | null>(null)

  let total_frames_available = $derived(run?.frame_count ?? 0)
  let last_frame_idx = $derived(Math.max(0, total_frames_available - 1))
  let start_frame = $state(0)
  let end_frame = $derived(last_frame_idx)
  // Validate and constrain frame range
  $effect(() => {
    start_frame = clamp(start_frame, 0, last_frame_idx)
    end_frame = clamp(end_frame, start_frame, last_frame_idx)
  })
  let export_frame_count = $derived(end_frame >= start_frame ? end_frame - start_frame + 1 : 0)
  let range = $derived(`${start_frame}-${end_frame}`)
  let data_export_disabled = $derived(running !== null || !run || export_frame_count === 0)
  // Preview is frame zero; only gate ranges containing it. Writers validate every frame.
  let poscar_reason = $derived(
    run && start_frame === 0
      ? fractional_export_unavailable_reason(run.preview.structure)
      : undefined,
  )

  const xyz_reason = $derived(
    run && start_frame === 0
      ? xyz_export_unavailable_reason(run.preview.structure)
      : undefined,
  )

  let canvas = $derived(wrapper?.querySelector<HTMLCanvasElement>(`canvas`) ?? null)
  let has_canvas = $state(false)
  $effect(() => observe_canvas_presence(wrapper, (val) => (has_canvas = val)))
  let is_video_supported = $derived(
    typeof MediaRecorder !== `undefined` &&
      MediaRecorder.isTypeSupported(`video/webm;codecs=vp9`),
  )
  // Estimated file size in MB
  let file_size_mb = $derived.by(() => {
    if (!canvas) return 0
    const pixels = canvas.width * canvas.height * resolution_multiplier ** 2
    const bitrate = estimate_video_bitrate(pixels, video_fps)
    return (bitrate * export_frame_count) / video_fps / 8 / 1024 / 1024
  })

  const frame_at: TrajectoryFrameResolver = (idx) =>
    resolve_frame ? resolve_frame(idx) : (run?.read_frame(idx) ?? null)

  const on_progress = (done: number, total: number) => {
    if (running) running.progress = (done / total) * 100
  }

  // Run one export, surfacing its progress and error. The task acts through side effects (a
  // download or a clipboard write) or returns the text to copy.
  async function run_export<Result>(
    label: string,
    task: () => Promise<Result>,
  ): Promise<Result | null> {
    export_error = null
    running = { label, progress: 0 }
    try {
      return await task()
    } catch (error) {
      console.error(`Trajectory ${label} export failed:`, error)
      export_error = to_error(error).message
      return null
    } finally {
      running = null
    }
  }

  // Every frame in the range, resolved one at a time (or read off run properties when they cover
  // the range), so an indexed trajectory exports its full range and not the ~10 frames it
  // holds in memory.
  const serialize_table = async (format: TableFormat) => {
    if (!run) throw new Error(`No trajectory to export`)
    const table = await collect_frame_property_rows(
      start_frame,
      end_frame,
      frame_at,
      run,
      on_progress,
    )
    return format === `csv` ? frame_rows_to_csv(table) : frame_rows_to_json(table)
  }

  const download_table = (format: TableFormat) =>
    run_export(format.toUpperCase(), async () =>
      download(
        await serialize_table(format),
        `${trajectory_export_basename(filename)}_frames_${range}.${format}`,
        format === `csv` ? `text/csv` : `application/json`,
      ),
    )

  async function export_video(format: VideoFormat) {
    if (!run || !on_step_change || !canvas || export_frame_count === 0) {
      export_error = !run
        ? `No trajectory`
        : !canvas
          ? `Canvas not ready`
          : `Invalid frame range`
      return
    }
    await run_export(format.toUpperCase(), async () => {
      await export_trajectory_video(canvas, `${filename}.webm`, {
        fps: video_fps,
        total_frames: export_frame_count,
        resolution_multiplier,
        on_progress: (progress) => {
          if (running) running.progress = progress
        },
        on_step: (idx) => on_step_change(start_frame + idx),
      })
      if (format === `mp4`) {
        navigator.clipboard
          .writeText(get_ffmpeg_conversion_command(`${filename}.webm`))
          .catch(console.warn)
      }
    })
  }

  let sections = $derived<ExportSection[]>([
    {
      title: `Export Data`,
      items: [
        {
          label: `extXYZ`,
          hint: `All frames ${range} as one extended XYZ file`,
          disabled: data_export_disabled || Boolean(xyz_reason),
          disabled_reason: xyz_reason,
          on_download: () =>
            run_export(`extXYZ`, async () =>
              download(
                await serialize_extxyz_frame_range(
                  start_frame,
                  end_frame,
                  frame_at,
                  on_progress,
                ),
                `${trajectory_export_basename(filename)}.extxyz`,
                `chemical/x-xyz`,
              ),
            ),
        },
        {
          label: `POSCAR ZIP`,
          hint: `One numbered POSCAR per frame, zipped`,
          disabled: data_export_disabled || Boolean(poscar_reason),
          disabled_reason: poscar_reason,
          on_download: () =>
            run_export(`POSCAR ZIP`, async () =>
              download(
                await create_poscar_frame_range_zip(
                  start_frame,
                  end_frame,
                  frame_at,
                  filename,
                  total_frames_available,
                  on_progress,
                ),
                `${trajectory_export_basename(filename)}_poscar_${range}.zip`,
                `application/zip`,
              ),
            ),
        },
      ],
    },
    {
      title: `Export Properties`,
      items: [
        {
          label: `CSV`,
          hint: `One row per frame over ${range}: frame index, MD step, then every extracted property with its unit in the header`,
          disabled: data_export_disabled,
          on_download: () => download_table(`csv`),
          copy_text: () => run_export(`CSV`, () => serialize_table(`csv`)),
        },
        {
          label: `JSON`,
          hint: `Same per-frame numbers as the CSV, with a separate units map`,
          disabled: data_export_disabled,
          on_download: () => download_table(`json`),
          copy_text: () => run_export(`JSON`, () => serialize_table(`json`)),
        },
      ],
    },
  ])
</script>

<ExportPane
  bind:export_pane_open
  {pane_props}
  toggle_props={{
    title: export_pane_open ? `` : `Export Trajectory`,
    ...toggle_props,
    class: [`trajectory-export-toggle`, toggle_props?.class],
  }}
  {sections}
  {...rest}
>
  {#snippet header()}
    <!-- Shared by the data and video exports, so it sits outside the MediaRecorder gate -->
    <SettingsSection
      title="Frame Range"
      current_values={{ start_frame, end_frame }}
      on_reset={() => {
        start_frame = 0
        end_frame = last_frame_idx
      }}
    >
      <NumberRangeInput min={0} max={last_frame_idx} step={1} bind:value={start_frame}
        >Start Frame</NumberRangeInput
      >
      <NumberRangeInput min={start_frame} max={last_frame_idx} step={1} bind:value={end_frame}
        >End Frame</NumberRangeInput
      >
    </SettingsSection>
  {/snippet}

  {#if running}
    <div class="export-info">
      Exporting {running.label}… {format_num(running.progress, `.0f`)}%
    </div>
  {/if}
  {#if export_error}
    <div class="error-message">⚠️ {export_error}</div>
  {/if}

  <h4>Export Video</h4>

  {#if !is_video_supported}
    <div class="warning">Video export requires Chrome, Edge, or Opera</div>
  {:else}
    <SettingsSection
      title="Video Settings"
      current_values={{ video_fps, resolution_multiplier }}
      on_reset={() => {
        video_fps = 30
        resolution_multiplier = 1
      }}
    >
      <NumberRangeInput min={10} max={60} step={1} bind:value={video_fps}
        >Frame Rate (FPS)</NumberRangeInput
      >

      <span class="field-label">
        Resolution
        <div class="resolution-buttons">
          {#each [0.5, 1, 2, 4, 8] as multiplier (multiplier)}
            {@const size = canvas
              ? ` (${Math.round(canvas.width * multiplier)}×${Math.round(canvas.height * multiplier)})`
              : ``}
            <button
              type="button"
              class:active={resolution_multiplier === multiplier}
              onclick={() => (resolution_multiplier = multiplier)}
              {@attach tooltip({ content: `${multiplier}x${size}` })}
            >
              {multiplier}x
            </button>
          {/each}
        </div>
      </span>
    </SettingsSection>

    <div class="export-buttons">
      {#each [{ label: `WebM`, format: `webm`, hint: `Export as WebM video` }, { label: `MP4`, format: `mp4`, hint: `WebM + ffmpeg command` }] as const as { label, format, hint } (format)}
        <div style="display: flex; align-items: center; gap: 4pt">
          {label}
          <button
            type="button"
            onclick={() => export_video(format)}
            disabled={running !== null || !run || !has_canvas}
            aria-label="Download {label}"
            {@attach tooltip({ content: hint })}
          >
            ⬇
          </button>
        </div>
      {/each}
    </div>

    <div class="export-info">
      {format_num(export_frame_count / video_fps, `.1f`)}s ({export_frame_count} frames: {range})
      {#if file_size_mb > 0}
        • ~{file_size_mb < 1
          ? `${format_num(file_size_mb * 1024, `.0f`)} KB`
          : `${format_num(file_size_mb, `.1f`)} MB`}
      {/if}
    </div>

    {#if run && !has_canvas}
      <div class="warning">Waiting for canvas...</div>
    {/if}
  {/if}
</ExportPane>

<style>
  .field-label {
    display: flex;
    align-items: center;
    gap: 6pt;
    white-space: nowrap;
  }
  .warning,
  .error-message {
    padding: 1ex;
    border-radius: var(--traj-border-radius, var(--border-radius, 3pt));
    font-size: 0.9em;
  }
  .warning {
    background: var(--warning-bg, rgba(255, 165, 0, 0.1));
    border: 1px solid var(--warning-color, orange);
  }
  .error-message {
    background: var(--error-bg, rgba(255, 0, 0, 0.1));
    border: 1px solid var(--error-color, rgba(255, 0, 0, 0.5));
    color: var(--error-color, #ff6b6b);
    margin-bottom: 1ex;
  }
  .export-buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1ex;
  }
  .export-info {
    margin-top: 1ex;
    padding: 1ex;
    background: var(--surface-bg, rgba(0, 0, 0, 0.05));
    border-radius: 4px;
    font-size: 0.9em;
    color: var(--text-color-muted);
  }
  .resolution-buttons {
    display: inline-flex;
    gap: 3pt;
    margin-left: auto;
    white-space: nowrap;
    button {
      flex: 0 0 auto;
      min-width: 2.8em;
      padding: 1pt 3pt;
      border: 1px solid var(--border-color, rgba(255, 255, 255, 0.2));
      background: var(--btn-bg, rgba(255, 255, 255, 0.1));
      color: var(--text-color);
      cursor: pointer;
      transition: all 0.2s;
      &:hover {
        background: var(--btn-bg-hover, rgba(255, 255, 255, 0.2));
      }
      &.active {
        background: var(--accent-color, #4a9eff);
        border-color: var(--accent-color, #4a9eff);
        color: white;
      }
    }
  }
</style>
