<script lang="ts">
  import { materialize_frame_result } from '#lib/trajectory/frame.js'

  import { track_settings } from '#lib/controls.js'
  import type { PaneProps, PaneToggleProps } from '#lib/overlays/index.js'
  import type { VideoFormat } from '#lib/io/export.js'
  import {
    export_trajectory_video,
    is_video_export_supported,
    observe_canvas_presence,
  } from '#lib/io/export.js'
  import { FileExportState, type FileExportContext } from '#lib/io/file-export.svelte.js'
  import ExportPane from '#lib/io/ExportPane.svelte'
  import type { ExportItem, ExportSection } from '#lib/io/types.js'
  import { display_idx, format_num, from_display_idx } from '#lib/labels.js'
  import { NumberRangeInput, SettingsSection } from '#lib/layout/index.js'
  import TaskStatus from 'svelte-widgets/TaskStatus.svelte'
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'
  import { clamp } from '#lib/math.js'
  import {
    poscar_export_unavailable_reason,
    xyz_export_unavailable_reason,
  } from '#lib/structure/export.js'
  import type { TrajectoryRun } from '#lib/trajectory/index.js'
  import type { TrajectoryFrameResolver } from '#lib/trajectory/file-export.js'
  import {
    collect_frame_property_rows,
    create_poscar_frame_range_zip,
    frame_rows_to_csv,
    frame_rows_to_json,
    serialize_extxyz_frame_range,
    trajectory_export_basename,
  } from '#lib/trajectory/file-export.js'
  import { tooltip } from 'svelte-widgets/attachments'
  import { abortable } from '#lib/utils.js'
  import { to_error } from 'svelte-widgets/utils'
  import { getAbortSignal } from 'svelte'
  import CameraFlightPane from '#lib/scene/CameraFlightPane.svelte'
  import Icon from 'svelte-widgets/Icon.svelte'
  import { Camera } from 'svelte-widgets/icons'
  import { camera_flight_frame, type CameraFlight } from '#lib/scene/camera-flight.js'

  let {
    export_pane_open = $bindable(false),
    flight_pane_open = $bindable(false),
    run,
    wrapper,
    filename = `trajectory`,
    video_fps = $bindable(30),
    video_width = $bindable(1920),
    video_height = $bindable(1080),
    bitrate_mbps = $bindable(20),
    current_step_idx = 0,
    on_step_change,
    resolve_frame,
    prepare_display_frame,
    on_flight_start,
    pane_props = {},
    toggle_props = {},
    ...rest
  }: {
    export_pane_open?: boolean
    flight_pane_open?: boolean
    run?: TrajectoryRun
    // Canvas wrapper for video export
    wrapper?: HTMLDivElement
    filename?: string
    video_fps?: number
    video_width?: number
    video_height?: number
    bitrate_mbps?: number
    current_step_idx?: number
    // Function to change trajectory step during export
    on_step_change?: (step_idx: number) => Promise<void> | void
    // Loads one frame by index. Indexed trajectories keep only a few frames in `frames`, so
    // without this the data exports below would silently write a truncated file.
    resolve_frame?: TrajectoryFrameResolver
    // Numeric renderers own their display buffers; wait for them before camera/video capture.
    prepare_display_frame?: (idx: number, signal: AbortSignal) => Promise<void>
    // Pause playback for deterministic stepping; returns a callback to restore playback.
    on_flight_start?: () => () => void
    pane_props?: PaneProps
    toggle_props?: PaneToggleProps
  } = $props()

  type TableFormat = `csv` | `json`

  const export_state = new FileExportState(() => trajectory_export_basename(filename))

  // Which export is running (one at a time) and how far along it is
  let running = $state<{
    label: string
    progress: number
    controller: AbortController
  } | null>(null)
  let export_error = $state<string>()
  let flight_running = $state(false)
  let camera_flight = $state.raw<CameraFlight>()
  let run_signal: AbortSignal
  $effect(() => {
    if (!run) return
    run_signal = getAbortSignal()
    return () => running?.controller.abort()
  })

  let total_frames_available = $derived(run?.frame_count ?? 0)
  let last_frame = $derived(Math.max(1, total_frames_available))
  // 1-based frame numbers as the inputs, file names and hints show them; exporters get the
  // 0-based indices. Writable deriveds keyed on the run, so loading another trajectory (even
  // one with the same frame count) resets to all its frames.
  let start_frame = $derived.by(() => {
    void run
    return 1
  })
  let end_frame = $derived.by(() => {
    void run
    return last_frame
  })
  $effect(() => {
    start_frame = clamp(start_frame, 1, last_frame)
    end_frame = clamp(end_frame, start_frame, last_frame)
  })
  const [start_idx, end_idx] = $derived([start_frame, end_frame].map(from_display_idx))
  let export_frame_count = $derived(end_frame >= start_frame ? end_frame - start_frame + 1 : 0)
  const flight_duration = $derived(camera_flight?.keyframes.at(-1)?.time ?? 0)
  const video_frame_count = $derived(
    camera_flight ? Math.max(1, Math.round(flight_duration * video_fps)) : export_frame_count,
  )
  let range = $derived(`${start_frame}-${end_frame}`)
  let data_export_disabled = $derived(
    running !== null || flight_running || !run || export_frame_count === 0,
  )
  // Preview is frame zero; only gate ranges containing it. Writers validate every frame.
  const gated_preview = $derived(run && start_idx === 0 ? run.preview.structure : undefined)
  const poscar_reason = $derived(
    gated_preview && poscar_export_unavailable_reason(gated_preview),
  )
  const xyz_reason = $derived(gated_preview && xyz_export_unavailable_reason(gated_preview))

  let canvas = $state.raw<HTMLCanvasElement | null>(null)
  $effect(() => observe_canvas_presence(wrapper, (found) => (canvas = found)))
  const video_formats = ([`webm`, `mp4`] as const).map((format) => ({
    format,
    label: format === `webm` ? `WebM` : `MP4`,
    supported: is_video_export_supported(format),
  }))
  let file_size_mb = $derived(
    canvas ? (bitrate_mbps * 1e6 * video_frame_count) / video_fps / 8 / 1024 / 1024 : 0,
  )

  const frame_at: TrajectoryFrameResolver = (idx, signal) =>
    resolve_frame
      ? resolve_frame(idx, signal)
      : run
        ? materialize_frame_result(run.read_frame(idx, signal))
        : null

  async function prepare_frame(idx: number, signal: AbortSignal) {
    if (!prepare_display_frame) {
      const frame = await frame_at(idx, signal)
      signal.throwIfAborted()
      if (!frame) throw new Error(`Trajectory frame ${display_idx(idx)} is unavailable`)
    }
    await on_step_change?.(idx)
    await prepare_display_frame?.(idx, signal)
  }

  const on_progress = (done: number, total: number) => {
    if (running) running.progress = (done / total) * 100
  }

  // Run one export, surfacing its progress and error. The task acts through side effects (a
  // download or a clipboard write) or returns the text to copy.
  async function run_export<Result>(
    label: string,
    task: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result | null> {
    if (running || flight_running) return null
    export_error = undefined
    const controller = new AbortController()
    running = { label, progress: 0, controller }
    try {
      const result = await task(controller.signal)
      controller.signal.throwIfAborted()
      return result
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error(`Trajectory ${label} export failed:`, error)
        export_error = to_error(error).message
      }
      return null
    } finally {
      running = null
    }
  }

  // Every frame in the range, resolved one at a time (or read off run properties when they cover
  // the range), so an indexed trajectory exports its full range and not the ~10 frames it
  // holds in memory.
  const serialize_table = async (format: TableFormat, signal: AbortSignal) => {
    if (!run) throw new Error(`No trajectory to export`)
    const table = await collect_frame_property_rows(
      start_idx,
      end_idx,
      frame_at,
      run,
      on_progress,
      signal,
    )
    return format === `csv` ? frame_rows_to_csv(table) : frame_rows_to_json(table)
  }

  const data_export_item = (
    item: ExportItem,
    suffix: string,
    mime: string,
    serialize: (signal: AbortSignal, filename: string) => Promise<string | Blob>,
  ): ExportItem => ({
    ...item,
    disabled: data_export_disabled || Boolean(item.disabled_reason),
    on_download: ({ filename: basename, prepare }) =>
      run_export(item.label, async (signal) => {
        const save = await prepare(`${basename}${suffix}`, signal)
        await save(await serialize(signal, basename), mime)
      }),
  })

  async function export_video(format: VideoFormat, context: FileExportContext) {
    if (!run || !on_step_change || !canvas || export_frame_count === 0) {
      export_error = !run
        ? `No trajectory`
        : !on_step_change
          ? `Frame navigation unavailable`
          : !canvas
            ? `Canvas not ready`
            : `Invalid frame range`
      return
    }
    const original_step = current_step_idx
    const export_run = run
    const lifetime_signal = run_signal
    const [first_idx, last_idx] = [start_idx, end_idx]
    const flight = camera_flight && structuredClone(camera_flight)
    const frame_count = video_frame_count
    await run_export(format.toUpperCase(), async (signal) => {
      const output_name = `${context.filename}.${format}`
      const save = await context.prepare(output_name, signal)
      // The viewer pauses playback here, before a lazy frame read can take over.
      await on_step_change(original_step)
      await export_trajectory_video(canvas, output_name, {
        format,
        fps: video_fps,
        total_frames: frame_count,
        width: video_width,
        height: video_height,
        bitrate: bitrate_mbps * 1e6,
        camera_flight: flight,
        signal,
        on_save: (blob) => save(blob, blob.type),
        on_progress: (progress) => {
          if (running) running.progress = progress
        },
        on_step: (idx) =>
          prepare_frame(
            flight
              ? camera_flight_frame(
                  frame_count <= 1 ? 0 : idx / (frame_count - 1),
                  first_idx,
                  last_idx,
                )
              : first_idx + idx,
            signal,
          ),
        on_finish: async () => {
          if (run !== export_run || lifetime_signal.aborted) return
          // Cancel still restores the mounted viewer; teardown must also release a read
          // from a custom resolver that ignores its signal.
          try {
            const frame = await abortable(
              () => frame_at(original_step, lifetime_signal),
              lifetime_signal,
            )
            if (!frame)
              throw new Error(`Trajectory frame ${display_idx(original_step)} is unavailable`)
          } finally {
            if (run === export_run && !lifetime_signal.aborted)
              await on_step_change(original_step)
          }
        },
      })
    })
  }

  let sections = $derived<ExportSection[]>([
    {
      title: `Export Data`,
      items: [
        data_export_item(
          {
            label: `extXYZ`,
            hint: `All frames ${range} as one extended XYZ file`,
            disabled_reason: xyz_reason,
          },
          `.extxyz`,
          `chemical/x-xyz`,
          (signal) =>
            serialize_extxyz_frame_range(start_idx, end_idx, frame_at, on_progress, signal),
        ),
        data_export_item(
          {
            label: `POSCAR ZIP`,
            hint: `One numbered POSCAR per frame, zipped`,
            disabled_reason: poscar_reason,
          },
          `_poscar_${range}.zip`,
          `application/zip`,
          (signal, basename) =>
            create_poscar_frame_range_zip(
              start_idx,
              end_idx,
              frame_at,
              basename,
              total_frames_available,
              on_progress,
              signal,
            ),
        ),
      ],
    },
    {
      title: `Export Properties`,
      items: ([`csv`, `json`] as const).map((format) =>
        data_export_item(
          {
            label: format.toUpperCase(),
            hint:
              format === `csv`
                ? `One row per frame over frames ${range}: frame number, MD step, then every extracted property with its unit in the header`
                : `Same per-frame numbers as the CSV, with a separate units map`,
            copy_text: () =>
              run_export(format.toUpperCase(), (signal) => serialize_table(format, signal)),
          },
          `_frames_${range}.${format}`,
          format === `csv` ? `text/csv` : `application/json`,
          (signal) => serialize_table(format, signal),
        ),
      ),
    },
  ])

  const frame_range_settings = $derived(
    track_settings(() => ({ start_frame, end_frame }), {
      start_frame: 1,
      end_frame: last_frame,
    }),
  )
  const video_settings_settings = track_settings(
    () => ({ video_fps, video_width, video_height, bitrate_mbps }),
    {
      video_fps: 30,
      video_width: 1920,
      video_height: 1080,
      bitrate_mbps: 20,
    },
  )
</script>

{#snippet frame_range_inputs(first_label: string, last_label: string, slider_labels = false)}
  <NumberRangeInput
    min={1}
    max={last_frame}
    step={1}
    bind:value={start_frame}
    range_props={slider_labels ? { 'aria-label': `${first_label} slider` } : undefined}
    >{first_label}</NumberRangeInput
  >
  <NumberRangeInput
    min={start_frame}
    max={last_frame}
    step={1}
    bind:value={end_frame}
    range_props={slider_labels ? { 'aria-label': `${last_label} slider` } : undefined}
    >{last_label}</NumberRangeInput
  >
{/snippet}

<ExportPane
  state={export_state}
  busy={running !== null || flight_running}
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
      changed_keys={frame_range_settings.changed_keys}
      on_reset={() => ({ start_frame, end_frame } = frame_range_settings.snapshot())}
    >
      {@render frame_range_inputs(`Start Frame`, `End Frame`)}
    </SettingsSection>
  {/snippet}

  {#if running}
    <div class="export-info export-progress">
      <TaskStatus
        spinner
        label={`Exporting ${running.label}…`}
        value={running.progress}
        cancel_label="Cancel export"
        on_cancel={() => running?.controller.abort()}
      />
    </div>
  {/if}
  <StatusMessage message={export_error} type="error" class="error-message" />

  <h4>Export Video · AV1</h4>

  {#if run && on_step_change}
    <button
      type="button"
      disabled={running !== null}
      style="display: inline-flex; align-items: center; gap: 0.5em; justify-self: start"
      onclick={() => {
        flight_pane_open = true
        export_pane_open = false
      }}
    >
      <Icon icon={Camera} /> Plan camera flight
    </button>
  {/if}

  {#if !video_formats.some(({ supported }) => supported)}
    <StatusMessage
      message="This browser does not support AV1 video recording."
      type="warning"
      class="warning"
    />
  {:else}
    <SettingsSection
      title="Video Settings"
      changed_keys={video_settings_settings.changed_keys}
      on_reset={() =>
        ({ video_fps, video_width, video_height, bitrate_mbps } =
          video_settings_settings.snapshot())}
    >
      <NumberRangeInput min={10} max={60} step={1} bind:value={video_fps}
        >Frame Rate (FPS)</NumberRangeInput
      >

      <NumberRangeInput min={2} max={7680} step={2} bind:value={video_width}
        >Width (px)</NumberRangeInput
      >
      <NumberRangeInput min={2} max={4320} step={2} bind:value={video_height}
        >Height (px)</NumberRangeInput
      >
      <NumberRangeInput min={1} max={200} step={1} bind:value={bitrate_mbps}
        >Bitrate (Mbps)</NumberRangeInput
      >
      {#if camera_flight}<small
          >Includes camera flight · {video_frame_count} video frames</small
        >{/if}
    </SettingsSection>

    <div class="export-buttons">
      {#each video_formats as { label, format, supported } (format)}
        <div style="display: flex; align-items: center; gap: 4pt">
          {label}
          <button
            type="button"
            onclick={() => export_state.run((context) => export_video(format, context))}
            disabled={data_export_disabled ||
              export_state.disabled ||
              !on_step_change ||
              !canvas ||
              !supported}
            aria-label="Download {label}"
            {@attach tooltip({
              content: supported
                ? `Export AV1 video as ${label}`
                : `AV1 recording in ${label} is not supported in this browser`,
            })}
          >
            ⬇
          </button>
        </div>
      {/each}
    </div>

    <div class="export-info">
      {format_num(video_frame_count / video_fps, `.1f`)}s ({export_frame_count} frames: {range})
      {#if file_size_mb > 0}
        • ~{file_size_mb < 1
          ? `${format_num(file_size_mb * 1024, `.0f`)} KB`
          : `${format_num(file_size_mb, `.1f`)} MB`}
      {/if}
    </div>

    {#if run && !canvas}
      <StatusMessage message="Waiting for canvas..." type="warning" />
    {/if}
  {/if}
</ExportPane>

{#if run && on_step_change}
  {#key run}
    <CameraFlightPane
      bind:open={flight_pane_open}
      {canvas}
      {filename}
      source_key={run}
      disabled={running !== null}
      bind:busy={flight_running}
      class_prefix="trajectory-flight"
      {pane_props}
      on_export={() => {
        export_pane_open = true
        flight_pane_open = false
      }}
      on_change={(flight) => (camera_flight = flight)}
      timeline={{
        start: start_idx,
        end: end_idx,
        current: current_step_idx,
        begin: on_flight_start,
        prepare: prepare_frame,
      }}
    >
      {#snippet timeline_controls()}
        {@render frame_range_inputs(`First MD frame`, `Last MD frame`, true)}
      {/snippet}
    </CameraFlightPane>
  {/key}
{/if}

<style>
  .export-buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1ex;
  }
  .export-progress {
    text-align: center;
    --task-status-button-justify: center;
  }
  .export-info {
    margin-top: 1ex;
    padding: 1ex;
    background: var(--surface-bg, rgba(0, 0, 0, 0.05));
    border-radius: 4px;
    font-size: 0.9em;
    color: var(--text-color-muted);
  }
</style>
