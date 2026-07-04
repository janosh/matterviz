<script lang="ts">
  import type { PaneProps, PaneToggleProps } from '$lib/overlays'
  import {
    estimate_video_bitrate,
    export_trajectory_video,
    get_ffmpeg_conversion_command,
    observe_canvas_presence,
  } from '$lib/io/export'
  import ExportPane from '$lib/io/ExportPane.svelte'
  import SettingsSection from '$lib/layout/SettingsSection.svelte'
  import type { TrajectoryType } from '$lib/trajectory'
  import type { ComponentProps } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'
  import { to_error } from '$lib/utils'

  let {
    export_pane_open = $bindable(false),
    trajectory = undefined,
    wrapper = undefined,
    filename = `trajectory`,
    video_fps = $bindable(30),
    resolution_multiplier = $bindable(1),
    on_step_change = undefined,
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
    // Pane customization
    pane_props?: PaneProps
    toggle_props?: PaneToggleProps
  } = $props()

  let is_exporting = $state(false)
  let export_progress = $state(0)
  let export_format = $state<`webm` | `mp4`>(`webm`)
  let export_error = $state<string | null>(null)

  let total_frames_available = $derived(
    trajectory?.total_frames || trajectory?.frames?.length || 0,
  )

  let start_frame = $state(0)
  let end_frame = $state(0)

  let canvas = $derived(wrapper?.querySelector(`canvas`) as HTMLCanvasElement)

  // Estimated file size in MB
  let file_size_mb = $derived.by(() => {
    if (!canvas) return 0
    const pixels = canvas.width * canvas.height * resolution_multiplier ** 2
    const bitrate = estimate_video_bitrate(pixels, video_fps)
    return (bitrate * export_frame_count) / video_fps / 8 / 1024 / 1024
  })

  // Initialize end_frame when trajectory changes
  $effect(() => {
    if (total_frames_available > 0) {
      end_frame = total_frames_available - 1
    }
  })

  // Validate and constrain frame range
  $effect(() => {
    if (start_frame < 0) start_frame = 0
    if (start_frame >= total_frames_available) {
      start_frame = Math.max(0, total_frames_available - 1)
    }
    if (end_frame < start_frame) end_frame = start_frame
    if (end_frame >= total_frames_available) {
      end_frame = Math.max(0, total_frames_available - 1)
    }
  })

  let export_frame_count = $derived(end_frame >= start_frame ? end_frame - start_frame + 1 : 0)

  async function handle_video_export(format: `webm` | `mp4` = `webm`) {
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
        on_step: async (idx) => await on_step_change(start_frame + idx),
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

  let is_video_supported = $derived(
    typeof globalThis !== `undefined` &&
      typeof MediaRecorder !== `undefined` &&
      MediaRecorder.isTypeSupported(`video/webm;codecs=vp9`),
  )

  let has_canvas = $state(false)

  $effect(() => observe_canvas_presence(wrapper, (val) => (has_canvas = val)))
</script>

<ExportPane
  bind:export_pane_open
  {pane_props}
  toggle_props={{
    title: export_pane_open ? `` : `Export Trajectory`,
    ...toggle_props,
    class: `trajectory-export-toggle ${toggle_props?.class ?? ``}`,
  }}
  {...rest}
>
  <h4>Export Video</h4>

  {#if !is_video_supported}
    <div class="warning">Video export requires Chrome, Edge, or Opera</div>
  {:else}
    <SettingsSection
      title="Video Settings"
      current_values={{ video_fps, resolution_multiplier, start_frame, end_frame }}
      on_reset={() => {
        video_fps = 30
        resolution_multiplier = 1
        start_frame = 0
        end_frame = total_frames_available - 1
      }}
    >
      <label>
        Frame Rate (FPS)
        <input type="number" min={10} max={60} bind:value={video_fps} />
        <input
          type="range"
          min={10}
          max={60}
          bind:value={video_fps}
          style="accent-color: var(--accent-color)"
        />
      </label>

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

      <label>
        Start Frame
        <input
          type="number"
          min={0}
          max={Math.max(0, total_frames_available - 1)}
          bind:value={start_frame}
        />
        <input
          type="range"
          min={0}
          max={Math.max(0, total_frames_available - 1)}
          bind:value={start_frame}
          style="accent-color: var(--accent-color)"
        />
      </label>

      <label>
        End Frame
        <input
          type="number"
          min={start_frame}
          max={Math.max(0, total_frames_available - 1)}
          bind:value={end_frame}
        />
        <input
          type="range"
          min={start_frame}
          max={Math.max(0, total_frames_available - 1)}
          bind:value={end_frame}
          style="accent-color: var(--accent-color)"
        />
      </label>
    </SettingsSection>

    <h4>Export Formats</h4>

    {#if export_error}
      <div class="error-message">⚠️ {export_error}</div>
    {/if}

    <div class="export-buttons">
      {#each [{ label: `WebM`, format: `webm`, hint: `Export as WebM video` }, { label: `MP4`, format: `mp4`, hint: `WebM + ffmpeg command` }] as const as { label, format, hint } (format)}
        <div style="display: flex; align-items: center; gap: 4pt">
          {label}
          <button
            type="button"
            onclick={() => handle_video_export(format)}
            disabled={is_exporting || !trajectory || !has_canvas}
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
