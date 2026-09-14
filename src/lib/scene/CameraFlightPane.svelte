<script lang="ts">
  import { wait_for_renderer, renderer_registry, scene_registry } from '$lib/io/export'
  import ExportDestination from '$lib/io/ExportDestination.svelte'
  import { FileExportState } from '$lib/io/file-export.svelte'
  import { format_num } from '$lib/labels'
  import { clamp } from '$lib/math'
  import { ViewerPane, type PaneProps, type PaneToggleProps } from '$lib/overlays'
  import { to_error } from '$lib/utils'
  import { tick, type Snippet } from 'svelte'
  import { NumberRangeInput } from 'svelte-widgets'
  import { Camera } from 'svelte-widgets/icons'
  import {
    camera_flight_frame,
    camera_flight_registry,
    create_camera_flight_sampler,
    orbit_camera_flight,
    validate_camera_flight,
    type CameraFlight,
    type CameraPose,
  } from './camera-flight'
  import { create_camera_flight_editor } from './camera-flight-editor.svelte'
  import {
    create_camera_flight_session,
    type FlightActivity,
    type FlightTimeline,
  } from './camera-flight-session'

  let {
    open = $bindable(false),
    canvas,
    filename = `camera-flight`,
    source_key,
    disabled = false,
    busy = $bindable(false),
    timeline,
    timeline_controls,
    on_export,
    class_prefix = `camera-flight`,
    pane_props = {},
    toggle_props = {},
  }: {
    open?: boolean
    canvas?: HTMLCanvasElement | null
    filename?: string
    source_key?: unknown
    disabled?: boolean
    busy?: boolean
    timeline?: FlightTimeline
    timeline_controls?: Snippet
    on_export?: () => void
    class_prefix?: string
    pane_props?: PaneProps
    toggle_props?: PaneToggleProps
  } = $props()

  const editor = create_camera_flight_editor()
  const draft = $derived(editor.draft)
  const flight = $derived(editor.flight)
  const frames = $derived(draft.views)
  const selected = $derived(editor.selected)
  let session = $state.raw<ReturnType<typeof create_camera_flight_session>>()
  let activity = $state<FlightActivity>(null)
  let has_origin = $state(false)
  let movie_time = $state(0)
  let error = $state(``)
  let duration_error = $state(``)
  let time_errors = $state<Record<number, string>>({})
  let import_input: HTMLInputElement
  let dragged_view = $state<number | null>(null)
  let marker_drag = $state<{ idx: number; time: number } | null>(null)
  const playing = $derived(activity === `play`)
  const locked = $derived(disabled || busy)
  const ready = $derived(Boolean(canvas) && frames.length >= 2)

  async function attempt(action: () => unknown) {
    error = ``
    try {
      await action()
    } catch (cause) {
      error = to_error(cause).message
    }
  }

  $effect(() => {
    void source_key
    void canvas
    const instance = create_camera_flight_session({
      controller: () => (canvas ? camera_flight_registry.get(canvas) : undefined),
      timeline: () => timeline,
      settle: tick,
      on_change: (next, origin) => {
        activity = next
        busy = next !== null
        has_origin = origin
      },
    })
    session = instance
    return () => instance.dispose()
  })
  $effect(() => {
    if (!open && session) {
      const instance = session
      void attempt(async () => {
        await instance.restore()
        if (!open && session === instance) movie_time = 0
      })
    }
  })

  async function thumbnail(): Promise<string> {
    if (!canvas) throw new Error(`Wait for the 3D view to be ready`)
    const renderer = renderer_registry.get(canvas)
    const view = scene_registry.get(canvas)
    if (!renderer || !view) throw new Error(`Wait for the 3D view to be ready`)
    await wait_for_renderer(renderer)
    renderer.render(view.scene, view.camera)
    const image = document.createElement(`canvas`)
    image.width = 160
    image.height = 100
    const context = image.getContext(`2d`)
    if (!context) throw new Error(`Cannot capture a waypoint thumbnail`)
    const scale = Math.min(image.width / canvas.width, image.height / canvas.height)
    const width = canvas.width * scale
    const height = canvas.height * scale
    context.drawImage(canvas, (160 - width) / 2, (100 - height) / 2, width, height)
    return image.toDataURL(`image/webp`, 0.75)
  }

  const frame_at_time = (time: number, duration: number, steps?: FlightTimeline) =>
    steps ? camera_flight_frame(time / duration, steps.start, steps.end) : undefined

  function capture_view(mode: `append` | `insert` | `update` = `append`) {
    return attempt(() =>
      session?.run(
        `thumbnails`,
        async ({ pose, signal }) => {
          const image = await thumbnail()
          signal.throwIfAborted()
          if (mode === `update`) editor.update(selected, pose, image)
          else editor.add(pose, image, mode === `insert` ? selected : frames.length - 1)
          time_errors = {}
        },
        true,
      ),
    )
  }

  function replace_path(make: (pose: CameraPose) => unknown, automatic = false) {
    return attempt(() =>
      session?.run(
        `thumbnails`,
        async ({ pose, signal, show, timeline: steps }) => {
          const path = await make(pose)
          validate_camera_flight(path)
          const duration = path.keyframes[path.keyframes.length - 1].time
          const images: string[] = []
          for (const frame of path.keyframes) {
            await show(frame, frame_at_time(frame.time, duration, steps))
            images.push(await thumbnail())
            signal.throwIfAborted()
          }
          editor.load(path, images, automatic)
          movie_time = 0
          time_errors = {}
          duration_error = ``
        },
        true,
      ),
    )
  }

  const orbit = () => replace_path((pose) => orbit_camera_flight(pose, draft.duration), true)

  async function import_flight(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    try {
      await replace_path(async (): Promise<unknown> => JSON.parse(await file.text()))
    } finally {
      input.value = ``
    }
  }

  function seek(time: number, waypoint?: number) {
    movie_time = clamp(time, 0, draft.duration)
    if (waypoint !== undefined) editor.select(waypoint)
    return attempt(async () => {
      const pose =
        waypoint === undefined
          ? create_camera_flight_sampler(flight)(movie_time)
          : frames[waypoint]
      const selected_time = movie_time
      const duration = draft.duration
      await session?.run(`seek`, ({ show, timeline: steps }) =>
        show(pose, frame_at_time(selected_time, duration, steps)),
      )
    })
  }

  function play() {
    if (playing) {
      session?.cancel()
      return
    }
    return attempt(async () => {
      const sample = create_camera_flight_sampler(flight)
      const duration = draft.duration
      const start = movie_time >= duration ? 0 : movie_time
      const finished = await session?.run(
        `play`,
        async ({ show, signal, timeline: steps }) => {
          const started = performance.now()
          let time = start
          while (true) {
            await show(sample(time), frame_at_time(time, duration, steps))
            movie_time = time
            if (time === duration) break
            await new Promise<void>((resolve) => setTimeout(resolve, 1000 / 60))
            signal.throwIfAborted()
            time = Math.min(duration, start + (performance.now() - started) / 1000)
          }
        },
      )
      if (finished) await session?.restore()
    })
  }

  function set_duration(value: string) {
    try {
      editor.set_duration(Number(value))
      movie_time = Math.min(movie_time, draft.duration)
      duration_error = ``
      time_errors = {}
    } catch (cause) {
      duration_error = to_error(cause).message
    }
  }
  function set_time(idx: number, time: number) {
    try {
      editor.set_time(idx, time)
      time_errors[idx] = ``
      movie_time = Math.min(movie_time, draft.duration)
    } catch (cause) {
      time_errors[idx] = to_error(cause).message
    }
  }
  function history(back: boolean) {
    if (back) editor.undo()
    else editor.redo()
    time_errors = {}
    duration_error = ``
    movie_time = Math.min(movie_time, draft.duration)
  }
  function move_view(from: number, to: number) {
    editor.move(from, to)
    time_errors = {}
  }
  function keyboard(event: KeyboardEvent) {
    if (
      locked ||
      !(event.metaKey || event.ctrlKey) ||
      event.key.toLowerCase() !== `z` ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return
    event.preventDefault()
    event.stopPropagation()
    history(!event.shiftKey)
  }
  function move_marker(event: PointerEvent) {
    if (!marker_drag || !(event.currentTarget instanceof HTMLElement)) return
    const rect = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!rect?.width) return
    const { idx } = marker_drag
    const min = frames[idx - 1].time + 0.01
    const max = frames[idx + 1].time - 0.01
    if (min > max) return
    marker_drag = {
      idx,
      time: clamp(((event.clientX - rect.left) / rect.width) * draft.duration, min, max),
    }
  }
  const path_export = new FileExportState(() => `${filename}-camera`)
</script>

<ViewerPane
  bind:open
  pane_name="camera flight planner"
  {class_prefix}
  closed_icon={Camera}
  max_width="540px"
  persistent
  toggle_props={{
    title: `Plan camera flight`,
    'aria-label': `Plan camera flight`,
    ...toggle_props,
  }}
  pane_props={{
    ...pane_props,
    // Planning needs more room than the small viewer settings panes.
    style: `${pane_props.style ?? ``}; --pane-width: 510px; --pane-max-height: min(740px, calc(100dvh - 4em))`,
    onkeydown: keyboard,
  }}
>
  <section class="camera-flight" aria-label="Camera flight planner">
    <header>
      <div>
        <h4>Camera flight</h4>
        <p>Compose a path through your {timeline ? `trajectory` : `structure`}.</p>
      </div>
      <div class="history">
        {#each [true, false] as back}
          {@const label = back ? `Undo` : `Redo`}
          <button
            type="button"
            aria-label="{label} flight edit"
            title="{label} (⌘/Ctrl {back ? `` : `Shift `}Z)"
            disabled={locked || !(back ? editor.can_undo : editor.can_redo)}
            onclick={() => history(back)}>{back ? `↶` : `↷`}</button
          >
        {/each}
      </div>
    </header>

    <fieldset disabled={locked}>
      <div class="guide">
        <strong
          >{frames.length === 0
            ? `1. Add your starting view`
            : frames.length === 1
              ? `2. Move the camera, then add another view`
              : `${frames.length} views · ready to preview`}</strong
        >
        <p>
          {frames.length < 2
            ? `Orbit, zoom or pan the viewer to frame your shot.`
            : `Click a thumbnail to visit it. Drag cards to reorder, or use the arrow buttons.`}
        </p>
      </div>
      <div class="actions">
        <button
          class="primary"
          type="button"
          onclick={() => capture_view()}
          disabled={!canvas}
        >
          + {frames.length ? `Add next view` : `Add starting view`}
        </button>
        <button
          type="button"
          onclick={orbit}
          disabled={!canvas}
          title="Create a complete orbit; Undo keeps your previous path">360° orbit</button
        >
        <details class="files" style="margin-left: auto">
          <summary>Path files</summary>
          <ExportDestination state={path_export} disabled={busy} />
          <div>
            <button type="button" onclick={() => import_input.click()}>Load path</button>
            <button
              type="button"
              disabled={frames.length < 2 || path_export.disabled}
              onclick={() =>
                path_export.run(({ filename, save }) =>
                  save(
                    JSON.stringify(flight, null, 2),
                    `${filename}.json`,
                    `application/json`,
                  ),
                )}>Save path</button
            >
          </div>
        </details>
        <input
          bind:this={import_input}
          type="file"
          accept=".json,application/json"
          hidden
          onchange={import_flight}
        />
      </div>

      {#if frames.length}
        <div class="waypoints" aria-label="Camera waypoints">
          {#each frames as frame, idx (idx)}
            <button
              type="button"
              class:chosen={selected === idx}
              class="waypoint"
              draggable="true"
              aria-label={`Go to view ${idx + 1}`}
              aria-pressed={selected === idx}
              onclick={() => seek(frame.time, idx)}
              ondragstart={(event) => {
                dragged_view = idx
                event.dataTransfer?.setData(`application/x-matterviz-waypoint`, String(idx))
              }}
              ondragover={(event) => {
                if (dragged_view !== null) event.preventDefault()
              }}
              ondrop={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (dragged_view !== null) move_view(dragged_view, idx)
                dragged_view = null
              }}
              ondragend={() => (dragged_view = null)}
            >
              <img src={frame.thumbnail} alt={`Camera view ${idx + 1}`} draggable="false" />
              <span
                ><strong>View {idx + 1}</strong><small
                  >{format_num(frame.time, `.2~f`)} s</small
                ></span
              >
            </button>
          {/each}
        </div>
        <div class="selection-actions">
          <span style="margin-right: auto"
            >{selected >= 0 ? `View ${selected + 1}` : `Select a view`}</span
          >
          {#each [`update`, `insert`] as const as mode}
            <button
              type="button"
              disabled={selected < 0 || !canvas}
              onclick={() => capture_view(mode)}
              >{mode === `update` ? `Update view` : `Insert after`}</button
            >
          {/each}
          {#each [-1, 1] as direction}
            <button
              type="button"
              aria-label="Move selected view {direction < 0 ? `earlier` : `later`}"
              disabled={selected < 0 ||
                selected + direction < 0 ||
                selected + direction >= frames.length}
              onclick={() => move_view(selected, selected + direction)}
              >{direction < 0 ? `←` : `→`}</button
            >
          {/each}
          <button
            type="button"
            aria-label="Delete selected view"
            disabled={selected < 0}
            onclick={() => {
              editor.remove(selected)
              time_errors = {}
            }}>Delete</button
          >
        </div>
      {/if}

      <div class="timing">
        <label
          >Flight duration <span
            ><input
              type="number"
              min="0.1"
              step="0.5"
              aria-label="Flight duration"
              aria-invalid={Boolean(duration_error)}
              value={draft.duration}
              onchange={(event) => set_duration(event.currentTarget.value)}
            /> s</span
          ></label
        >
        <label style="justify-content: flex-end"
          ><input
            type="checkbox"
            checked={draft.automatic}
            onchange={(event) => {
              editor.set_automatic(event.currentTarget.checked)
              time_errors = {}
            }}
          /> Space views evenly</label
        >
      </div>
      {#if duration_error}<p role="alert">{duration_error}</p>{/if}
      <div class="timing">
        <label
          >Motion <select
            aria-label="Camera interpolation"
            title="Use perspective projection in the viewer controls for interior fly-throughs."
            value={draft.interpolation}
            onchange={(event) =>
              editor.set_interpolation(
                event.currentTarget.value as CameraFlight[`interpolation`],
              )}
            ><option value="smooth">Smooth</option><option value="linear">Linear</option
            ></select
          ></label
        >
        {#if frames[selected]}
          <label
            >View {selected + 1} at
            <span
              ><input
                type="number"
                min="0"
                step="0.1"
                aria-label={`Keyframe ${selected + 1} time`}
                disabled={selected === 0}
                aria-invalid={Boolean(time_errors[selected])}
                value={frames[selected].time}
                onchange={(event) => set_time(selected, Number(event.currentTarget.value))}
              /> s</span
            ></label
          >
        {/if}
      </div>
      {#each Object.values(time_errors).filter(Boolean) as message}
        <p role="alert">{message}</p>
      {/each}
      {#if timeline_controls}
        <div class="input-row">{@render timeline_controls()}</div>
      {/if}
    </fieldset>

    {#if frames.length >= 2}
      <div class="timeline">
        <div class="markers" aria-label="Waypoint timing">
          {#each frames as frame, idx (idx)}
            <button
              type="button"
              class:chosen={idx === selected}
              style:left={`${(100 * (marker_drag?.idx === idx ? marker_drag.time : frame.time)) / draft.duration}%`}
              aria-label={`View ${idx + 1} timeline marker`}
              title={`View ${idx + 1} · ${format_num(frame.time)} s`}
              disabled={locked && activity !== `seek`}
              onclick={() => seek(frames[idx].time, idx)}
              onpointerdown={(event) => {
                if (idx > 0 && idx < frames.length - 1) {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  marker_drag = { idx, time: frame.time }
                }
              }}
              onpointermove={move_marker}
              onpointerup={() => {
                if (marker_drag) set_time(marker_drag.idx, marker_drag.time)
                marker_drag = null
              }}
              onpointercancel={() => (marker_drag = null)}
              onkeydown={(event) => {
                if (
                  idx > 0 &&
                  idx < frames.length - 1 &&
                  [`ArrowLeft`, `ArrowRight`].includes(event.key)
                ) {
                  event.preventDefault()
                  event.stopPropagation()
                  set_time(idx, frame.time + (event.key === `ArrowLeft` ? -0.1 : 0.1))
                }
              }}>{idx + 1}</button
            >
          {/each}
        </div>
        <fieldset disabled={disabled || activity === `thumbnails` || activity === `restore`}>
          <NumberRangeInput
            class="playhead"
            title="Movie time in seconds"
            min={0}
            max={draft.duration}
            step={0.01}
            value={movie_time}
            on_commit={(time) => {
              if (time !== undefined) void seek(time)
            }}
            number_props={{ 'aria-label': `Movie time` }}
            range_props={{ 'aria-label': `Flight playhead` }}
          >
            <span>/ {format_num(draft.duration)} s</span>
            {#if timeline}<span
                >MD frame <strong>{timeline.current}</strong>
                <small>({timeline.start}–{timeline.end})</small></span
              >{/if}
          </NumberRangeInput>
        </fieldset>
        <small style="opacity: 0.7"
          >Scrub the slider to inspect. Drag numbered markers to adjust timing.</small
        >
      </div>
    {/if}

    <div class="transport">
      <button
        class="primary"
        style="flex: 1"
        type="button"
        disabled={!ready || disabled || (busy && activity !== `play` && activity !== `seek`)}
        onclick={play}>{playing ? `Pause flight` : `Preview flight`}</button
      >
      <button
        type="button"
        disabled={!has_origin || disabled || activity === `thumbnails`}
        onclick={() =>
          attempt(async () => {
            await session?.restore()
            movie_time = 0
          })}>Return to original view</button
      >
    </div>
    {#if activity === `thumbnails`}<p role="status">Capturing waypoint previews…</p>{/if}

    {#if error}<p role="alert">{error}</p>{/if}
    {#if on_export}<footer style="display: flex; justify-content: flex-end">
        <button type="button" disabled={busy} onclick={on_export}>Export options →</button>
      </footer>{/if}
  </section>
</ViewerPane>

<style>
  .camera-flight {
    display: grid;
    gap: 0.65em;
    min-width: 0;
    width: 100%;
    header,
    .history,
    .actions,
    .selection-actions,
    .transport {
      display: flex;
      gap: 0.4em;
      align-items: center;
    }
    header {
      justify-content: space-between;
    }
    header h4 {
      margin: 0;
    }
    p {
      margin: 0.3em 0;
    }
    fieldset {
      border: 0;
      padding: 0;
      margin: 0;
      min-width: 0;
      display: grid;
      gap: 0.75em;
    }
    button {
      border-radius: 5px;
    }
    small {
      font-size: 0.875em;
    }
    .primary {
      background: var(--accent-color, #4779c7);
      color: white;
    }
    .guide {
      padding: 0.65em;
      border-radius: 6px;
      background: var(--surface-bg-hover, #80808018);
    }
    .actions,
    .selection-actions,
    .transport {
      flex-wrap: wrap;
    }
    .files > div {
      display: flex;
      gap: 0.4em;
      padding-top: 0.4em;
    }
    summary {
      cursor: pointer;
    }
    .waypoints {
      display: flex;
      gap: 0.5em;
      overflow-x: auto;
      padding: 3px 2px 8px;
    }
    .waypoint {
      padding: 0;
      flex: 0 0 9em;
      overflow: hidden;
      border: 2px solid transparent;
      text-align: left;
      background: var(--surface-bg-hover, #80808018);
      img {
        display: block;
        width: 100%;
        aspect-ratio: 1.6;
        object-fit: contain;
        background: #18181c;
      }
      span {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.4em;
      }
    }
    .waypoint.chosen,
    .markers .chosen {
      border-color: var(--accent-color, #689aeb);
    }
    label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5em;
    }
    .timing {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 12em), 1fr));
      gap: 0.8em;
      align-items: center;
    }
    .input-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 14em), 1fr));
      gap: 0.5em 1em;
      :global(label) {
        gap: 0.4em;
      }
    }
    .timeline {
      padding: 0.3em 0.8em 0;
    }
    .markers {
      position: relative;
      height: 28px;
      margin-bottom: 0.25em;
      &::before {
        content: '';
        position: absolute;
        top: 12px;
        left: 0;
        right: 0;
        height: 2px;
        background: var(--border-color, #777);
      }
      button {
        position: absolute;
        transform: translateX(-50%);
        width: 24px;
        height: 24px;
        padding: 0;
        border: 2px solid var(--border-color, #777);
        border-radius: 50%;
        /* An opaque surface hides the connector even while the button is disabled. */
        background: var(--surface-bg, light-dark(#eee, #25262b));
        opacity: 1;
        font-size: 0.875em;
        cursor: ew-resize;
        touch-action: none;
        &:hover:not(:disabled) {
          background: var(--surface-bg-hover, light-dark(#ddd, #3a3a3a));
        }
        &:disabled {
          color: var(--text-color-muted, #888);
          cursor: not-allowed;
        }
      }
    }
    :global(.playhead) {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 0.4em;
      font-variant-numeric: tabular-nums;
      > :global(input[type='range']) {
        grid-row: 1;
        grid-column: 1 / -1;
        width: 100%;
      }
      > :global(input[type='number']) {
        grid-row: 2;
        grid-column: 1;
      }
      > :global(span) {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0.2em 0.5em;
        grid-row: 2;
        grid-column: 2;
      }
    }
    [role='alert'] {
      color: var(--error-color, #df6666);
    }
    [aria-invalid='true'] {
      outline: 1px solid var(--error-color, #df6666);
    }
  }
</style>
