<script lang="ts">
  import { DraggablePane, SettingsSection } from '$lib'
  import {
    export_trajectory_video,
    get_ffmpeg_conversion_command,
  } from '$lib/io/export'
  import type { TrajectoryType } from '$lib/trajectory'
  import type { ComponentProps } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'

  interface Props {
    // Control pane state
    export_pane_open?: boolean
    // Trajectory data for generating filename
    trajectory?: TrajectoryType | undefined
    // Canvas wrapper for video export
    wrapper?: HTMLDivElement | undefined
    // Filename for export
    filename?: string
    // Export settings
    video_fps?: number
    resolution_multiplier?: number
    // Function to change trajectory step during export
    on_step_change?: (step_idx: number) => Promise<void> | void
    // Pane customization
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
  }

  let {
    export_pane_open = $bindable(false),
    trajectory = undefined,
    wrapper = undefined,
    filename = `trajectory`,
    video_fps = $bindable(30),
    resolution_multiplier = $bindable(1),
    on_step_change = undefined,
    pane_props = $bindable({}),
    toggle_props = $bindable({}),
    ...rest
  }: Props = $props()

  let is_exporting = $state(false)
  let export_progress = $state(0)
  let export_format = $state<`webm` | `mp4`>(`webm`)

  let total_frames_available = $derived(
    trajectory?.total_frames || trajectory?.frames?.length || 0,
  )

  let start_frame = $state(0)
  let end_frame = $state(0)

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

  let export_frame_count = $derived(
    end_frame >= start_frame ? end_frame - start_frame + 1 : 0,
  )

  async function handle_video_export(format: `webm` | `mp4` = `webm`) {
    const canvas = wrapper?.querySelector(`canvas`) as HTMLCanvasElement
    if (!trajectory || !on_step_change || !canvas) return

    export_format = format
    is_exporting = true
    export_progress = 0

    try {
      await export_trajectory_video(canvas, `${filename}.webm`, {
        fps: video_fps,
        total_frames: export_frame_count,
        resolution_multiplier,
        on_progress: (progress) => (export_progress = progress),
        on_step: async (idx) => {
          // Map export frame index to actual trajectory frame
          await on_step_change(start_frame + idx)
        },
      })

      // Copy ffmpeg command for MP4 conversion
      if (format === `mp4`) {
        const cmd = get_ffmpeg_conversion_command(`${filename}.webm`)
        navigator.clipboard.writeText(cmd).catch(console.warn)
      }

      export_progress = 100
      setTimeout(() => {
        is_exporting = false
        export_progress = 0
      }, 1000)
    } catch (error) {
      console.error(`Export failed:`, error)
      is_exporting = false
      export_progress = 0
    }
  }

  let is_video_supported = $derived(
    typeof window !== `undefined` &&
      typeof MediaRecorder !== `undefined` &&
      MediaRecorder.isTypeSupported(`video/webm;codecs=vp9`),
  )

  let has_canvas = $state(false)

  $effect(() => {
    if (!wrapper) {
      has_canvas = false
      return
    }
    const check = () => (has_canvas = Boolean(wrapper.querySelector(`canvas`)))
    check()
    const observer = new MutationObserver(check)
    observer.observe(wrapper, { childList: true, subtree: true })
    return () => observer.disconnect()
  })
</script>

<DraggablePane
  bind:show={export_pane_open}
  open_icon="Cross"
  closed_icon="Export"
  pane_props={{ ...pane_props, class: `export-pane ${pane_props?.class ?? ``}` }}
  toggle_props={{
    title: `${export_pane_open ? `Close` : `Open`} export controls`,
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

      <label>
        Resolution
        <div class="resolution-buttons">
          {#each [0.5, 1, 2, 4, 8] as multiplier (multiplier)}
            <button
              type="button"
              class:active={resolution_multiplier === multiplier}
              onclick={() => (resolution_multiplier = multiplier)}
              {@attach tooltip({ content: `${multiplier}x canvas resolution` })}
            >
              {multiplier}x
            </button>
          {/each}
        </div>
      </label>

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
    <div class="export-buttons">
      {#each [
        { label: `WebM`, format: `webm`, hint: `Export as WebM video` },
        {
          label: `MP4`,
          format: `mp4`,
          hint: `Downloads WebM + copies ffmpeg conversion command`,
        },
      ] as const as
        { label, format, hint }
        (format)
      }
        <div style="display: flex; align-items: center; gap: 4pt">
          {label}
          <button
            type="button"
            onclick={() => handle_video_export(format)}
            disabled={is_exporting || !trajectory || !has_canvas}
            {@attach tooltip({ content: hint })}
          >
            {#if is_exporting && export_format === format}
              {export_progress.toFixed(0)}% ({format})
            {:else}⬇{/if}
          </button>
        </div>
      {/each}
      <div style="font-size: 0.9em; color: var(--text-color-muted)">
        {(export_frame_count / video_fps).toFixed(1)}s ({export_frame_count} frames: {
          start_frame
        }–{end_frame})
      </div>
    </div>

    {#if trajectory && !has_canvas}
      <div class="warning" style="font-size: 0.9em; padding: 0.5ex">
        Waiting for canvas...
      </div>
    {/if}
  {/if}
</DraggablePane>

<style>
  .warning {
    padding: 1ex;
    background: var(--warning-bg, rgba(255, 165, 0, 0.1));
    border: 1px solid var(--warning-color, orange);
    border-radius: 4px;
  }
  .export-buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1ex;
  }
  .resolution-buttons {
    display: flex;
    gap: 6pt;
    margin: 4pt;
  }
  .resolution-buttons button {
    flex: 1;
    padding: 1pt 4pt;
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
