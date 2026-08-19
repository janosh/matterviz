<script lang="ts">
  import type { PaneProps, PaneToggleProps } from '$lib/overlays'
  import { create_clipboard_feedback } from '$lib/overlays'
  import {
    estimate_video_bitrate,
    export_trajectory_video,
    get_ffmpeg_conversion_command,
    observe_canvas_presence,
  } from '$lib/io/export'
  import { download } from '$lib/io/fetch'
  import ExportPane from '$lib/io/ExportPane.svelte'
  import { format_num } from '$lib/labels'
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import type { TrajectoryType } from '$lib/trajectory'
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
    trajectory = undefined,
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
    // Control pane state
    export_pane_open?: boolean
    // Trajectory data for generating filename
    trajectory?: TrajectoryType
    // Canvas wrapper for video export
    wrapper?: HTMLDivElement
    // Filename for export
    filename?: string
    // Export settings
    video_fps?: number
    resolution_multiplier?: number
    // Function to change trajectory step during export
    on_step_change?: (step_idx: number) => Promise<void> | void
    // Loads one frame by index. Indexed trajectories keep only a few frames in `frames`, so
    // without this the data exports below would silently write a truncated file.
    resolve_frame?: TrajectoryFrameResolver
    // Pane customization
    pane_props?: PaneProps
    toggle_props?: PaneToggleProps
  } = $props()

  // extXYZ/POSCAR write out the structures; CSV/JSON write out the per-frame numbers
  type StructureFormat = `extxyz` | `poscar`
  type TableFormat = `csv` | `json`

  let is_exporting = $state(false)
  let export_progress = $state(0)
  let export_format = $state<`webm` | `mp4`>(`webm`)
  let export_error = $state<string | null>(null)
  // Which data export is running, so only the clicked button shows its percentage
  let data_export_format = $state<StructureFormat | TableFormat | null>(null)
  let data_export_progress = $state(0)
  let is_exporting_data = $derived(data_export_format !== null)

  let total_frames_available = $derived(
    trajectory?.total_frames || trajectory?.frames?.length || 0,
  )
  let last_frame_idx = $derived(Math.max(0, total_frames_available - 1))

  let start_frame = $state(0)
  let end_frame = $derived(last_frame_idx)

  let canvas = $derived(wrapper?.querySelector(`canvas`) as HTMLCanvasElement)

  // Estimated file size in MB
  let file_size_mb = $derived.by(() => {
    if (!canvas) return 0
    const pixels = canvas.width * canvas.height * resolution_multiplier ** 2
    const bitrate = estimate_video_bitrate(pixels, video_fps)
    return (bitrate * export_frame_count) / video_fps / 8 / 1024 / 1024
  })

  // Validate and constrain frame range
  $effect(() => {
    start_frame = Math.min(Math.max(0, start_frame), last_frame_idx)
    end_frame = Math.min(Math.max(start_frame, end_frame), last_frame_idx)
  })

  let export_frame_count = $derived(end_frame >= start_frame ? end_frame - start_frame + 1 : 0)

  let data_export_disabled = $derived(
    is_exporting || is_exporting_data || !trajectory || export_frame_count === 0,
  )

  async function handle_video_export(format: `webm` | `mp4`) {
    export_error = null

    // Validate
    if (!trajectory || !on_step_change || !canvas || export_frame_count === 0) {
      export_error = !trajectory
        ? `No trajectory`
        : !canvas
          ? `Canvas not ready`
          : `Invalid frame range`
      return
    }

    export_format = format
    is_exporting = true
    export_progress = 0

    try {
      await export_trajectory_video(canvas, `${filename}.webm`, {
        fps: video_fps,
        total_frames: export_frame_count,
        resolution_multiplier,
        on_progress: (progress) => (export_progress = progress),
        on_step: (idx) => on_step_change(start_frame + idx),
      })

      if (format === `mp4`) {
        navigator.clipboard
          .writeText(get_ffmpeg_conversion_command(`${filename}.webm`))
          .catch(console.warn)
      }

      export_progress = 100
      setTimeout(() => {
        is_exporting = false
        export_progress = 0
      }, 1000)
    } catch (error) {
      console.error(`Export failed:`, error)
      export_error = to_error(error).message
      is_exporting = false
      export_progress = 0
    }
  }

  // Falls back to the in-memory frame when the host supplied no loader (eager trajectories)
  const frame_at: TrajectoryFrameResolver = (idx) =>
    resolve_frame ? resolve_frame(idx) : (trajectory?.frames?.[idx] ?? null)

  const on_export_progress = (done: number, total: number) =>
    (data_export_progress = (done / total) * 100)

  // Run one data export, keeping the clicked button's progress/error state in sync. The task
  // acts through side effects (a download or a clipboard write) rather than a return value.
  async function run_data_export(
    format: StructureFormat | TableFormat,
    task: () => Promise<void>,
  ) {
    export_error = null
    data_export_format = format
    data_export_progress = 0
    try {
      await task()
    } catch (error) {
      console.error(`Trajectory data export failed:`, error)
      export_error = to_error(error).message
    } finally {
      data_export_format = null
      data_export_progress = 0
    }
  }

  // Every frame in the range, resolved one at a time (or read off plot_metadata when it covers
  // the range), so an indexed trajectory exports its full range and not the ~10 frames it
  // holds in memory.
  const serialize_table = async (format: TableFormat) => {
    if (!trajectory) throw new Error(`No trajectory to export`)
    const table = await collect_frame_property_rows(
      start_frame,
      end_frame,
      frame_at,
      trajectory,
      on_export_progress,
    )
    return format === `csv` ? frame_rows_to_csv(table) : frame_rows_to_json(table)
  }

  const export_data = (format: StructureFormat | TableFormat) =>
    run_data_export(format, async () => {
      const base = trajectory_export_basename(filename)
      const range = `${start_frame}-${end_frame}`
      if (format === `extxyz`) {
        const content = await serialize_extxyz_frame_range(
          start_frame,
          end_frame,
          frame_at,
          on_export_progress,
        )
        download(content, `${base}.extxyz`, `chemical/x-xyz`)
      } else if (format === `poscar`) {
        const blob = await create_poscar_frame_range_zip(
          start_frame,
          end_frame,
          frame_at,
          filename,
          total_frames_available,
          on_export_progress,
        )
        download(blob, `${base}_poscar_${range}.zip`, `application/zip`)
      } else {
        download(
          await serialize_table(format),
          `${base}_frames_${range}.${format}`,
          format === `csv` ? `text/csv` : `application/json`,
        )
      }
    })

  const { copied, copy } = create_clipboard_feedback()

  const copy_table = (format: TableFormat) =>
    run_data_export(format, async () => {
      await copy(await serialize_table(format), format)
    })

  let is_video_supported = $derived(
    typeof MediaRecorder !== `undefined` &&
      MediaRecorder.isTypeSupported(`video/webm;codecs=vp9`),
  )

  let has_canvas = $state(false)

  $effect(() => observe_canvas_presence(wrapper, (val) => (has_canvas = val)))
</script>

{#snippet download_button(
  format: StructureFormat | TableFormat,
  hint: string,
  aria_label?: string,
)}
  <button
    type="button"
    onclick={() => export_data(format)}
    disabled={data_export_disabled}
    aria-label={aria_label}
    {@attach tooltip({ content: hint })}
  >
    {#if data_export_format === format && data_export_progress > 0}
      {format_num(data_export_progress, `.0f`)}%
    {:else}⬇{/if}
  </button>
{/snippet}

<ExportPane
  bind:export_pane_open
  {pane_props}
  toggle_props={{
    title: export_pane_open ? `` : `Export Trajectory`,
    ...toggle_props,
    class: [`trajectory-export-toggle`, toggle_props?.class],
  }}
  {...rest}
>
  <!-- Shared by the data and video exports below, so it sits outside the MediaRecorder gate -->
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

  {#if export_error}
    <div class="error-message">⚠️ {export_error}</div>
  {/if}

  <h4>Export Data</h4>

  <div class="export-buttons">
    {#each [{ label: `extXYZ`, format: `extxyz`, hint: `All frames ${start_frame}–${end_frame} as one extended XYZ file` }, { label: `POSCAR ZIP`, format: `poscar`, hint: `One numbered POSCAR per frame, zipped` }] as const as { label, format, hint } (format)}
      <div style="display: flex; align-items: center; gap: 4pt">
        {label}
        {@render download_button(format, hint)}
      </div>
    {/each}
  </div>

  <h4>Export Properties</h4>

  <div class="export-buttons">
    {#each [{ label: `CSV`, format: `csv`, hint: `One row per frame over ${start_frame}–${end_frame}: frame index, MD step, then every extracted property with its unit in the header` }, { label: `JSON`, format: `json`, hint: `Same per-frame numbers as the CSV, with a separate units map` }] as const as { label, format, hint } (format)}
      <div style="display: flex; align-items: center; gap: 4pt">
        {label}
        {@render download_button(format, hint, `Download ${label}`)}
        <button
          type="button"
          onclick={() => copy_table(format)}
          disabled={data_export_disabled}
          aria-label="Copy {label} to clipboard"
          {@attach tooltip({ content: `Copy ${label} to clipboard` })}
        >
          {copied.has(format) ? `✅` : `📋`}
        </button>
      </div>
    {/each}
  </div>

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
            {@const width_px = canvas ? Math.round(canvas.width * multiplier) : 0}
            {@const height_px = canvas ? Math.round(canvas.height * multiplier) : 0}
            <button
              type="button"
              class:active={resolution_multiplier === multiplier}
              onclick={() => (resolution_multiplier = multiplier)}
              {@attach tooltip({
                content: canvas
                  ? `${multiplier}x (${width_px}×${height_px})`
                  : `${multiplier}x`,
              })}
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
            onclick={() => handle_video_export(format)}
            disabled={is_exporting || is_exporting_data || !trajectory || !has_canvas}
            {@attach tooltip({ content: hint })}
          >
            {#if is_exporting && export_format === format}
              {export_progress.toFixed(0)}%
            {:else}⬇{/if}
          </button>
        </div>
      {/each}
    </div>

    <div class="export-info">
      {(export_frame_count / video_fps).toFixed(1)}s ({export_frame_count} frames: {start_frame}–{end_frame})
      {#if file_size_mb > 0}
        • ~{file_size_mb < 1
          ? `${(file_size_mb * 1024).toFixed(0)} KB`
          : `${file_size_mb.toFixed(1)} MB`}
      {/if}
    </div>

    {#if trajectory && !has_canvas}
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
    margin: 0;
    margin-left: auto;
    white-space: nowrap;
  }
  .resolution-buttons button {
    flex: 0 0 auto;
    min-width: 2.8em;
    padding: 1pt 3pt;
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.2));
    background: var(--btn-bg, rgba(255, 255, 255, 0.1));
    color: var(--text-color);
    cursor: pointer;
    transition: all 0.2s;
  }
  .resolution-buttons button:hover {
    background: var(--btn-bg-hover, rgba(255, 255, 255, 0.2));
  }
  .resolution-buttons button.active {
    background: var(--accent-color, #4a9eff);
    border-color: var(--accent-color, #4a9eff);
    color: white;
  }
</style>
