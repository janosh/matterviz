<script lang="ts">
  import type { ScatterPlotOptions } from '#lib/plot/index.js'
  import type { StructureOptions } from '#lib/structure/index.js'
  // Reaction-path viewer: energy profile on the left, the structure of the hovered or
  // selected image on the right, with barrier numbers and playback along the path.
  import { DEFAULT_FPS_RANGE } from '#lib/constants.js'
  import { normalize_show_controls, shows_fullscreen_toggle } from '#lib/controls.js'
  import type { ShowControlsProp } from '#lib/controls.js'
  import StatGrid from 'svelte-widgets/StatGrid.svelte'
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'
  import EmptyState from 'svelte-widgets/EmptyState.svelte'
  import ViewerError from '#lib/layout/ViewerError.svelte'
  import ViewerNotices from '#lib/layout/ViewerNotices.svelte'
  import { as_text, file_drop_zone } from '#lib/io/index.js'
  import ExportPane from '#lib/io/ExportPane.svelte'
  import { canvas_sources, json_source, type ExportProps } from '#lib/io/export.js'
  import { csv_source } from '#lib/plot/core/utils/chart-export.js'
  import { display_idx, format_num, parse_warnings_notice } from '#lib/labels.js'
  import { FullscreenButton } from '#lib/layout/index.js'
  import PaneDivider from 'svelte-widgets/SplitPane.svelte'
  import {
    create_sequence_player,
    is_sequence_key_target,
  } from '#lib/layout/sequence-player.svelte.js'
  import SequenceControlBar from '#lib/layout/SequenceControlBar.svelte'
  import { clamp } from '#lib/math.js'
  import SequenceControls from '#lib/layout/SequenceControls.svelte'
  import { Structure } from '#lib/structure/index.js'
  import { collect_parse_warnings } from '#lib/trajectory/parse/shared.js'
  import { to_error } from 'svelte-widgets/utils'
  import { viewer_keydown } from '#lib/shortcuts.js'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap } from 'svelte/reactivity'
  import type {
    EnergyReference,
    PathProfile,
    ReactionCoordMode,
    ReactionPath,
    ReactionPathInput,
  } from './index'
  import NebPlot from './NebPlot.svelte'
  import { parse_dropped_paths, REACTION_PATH_FORMAT } from './parse'
  import type { PathSplineOptions } from './reaction-path'
  import { normalize_paths, path_energy_unit, path_profile } from './reaction-path'

  type NebControlName = `path` | `nav` | `step` | `fps` | `energy` | `export` | `fullscreen`

  let {
    paths,
    coord_mode = $bindable(`arc_length`),
    energy_reference = $bindable(`initial`),
    coord_options = {},
    show_spline = $bindable(true),
    active_path_key = $bindable(``),
    active_image_idx = $bindable(0),
    allow_file_drop = true,
    fps = $bindable(4),
    fps_range = DEFAULT_FPS_RANGE,
    auto_play = false,
    show_controls,
    pane_ratio = $bindable(0.6),
    fullscreen_toggle = true,
    fullscreen = $bindable(false),
    wrapper = $bindable(),
    error_msg = $bindable(undefined),
    plot_props = { style: `height: 460px` },
    structure_props = { style: `height: 460px` },
    on_fullscreen_change,
    export_formats,
    export_filename = `reaction-path`,
    on_export,
    ...rest
  }: HTMLAttributes<HTMLDivElement> &
    ExportProps & {
      paths?: ReactionPathInput
      coord_mode?: ReactionCoordMode
      energy_reference?: EnergyReference
      // Path metric, pbc, spline sampling and force usage; the x-axis mode is `coord_mode`
      coord_options?: Omit<PathSplineOptions, `mode`>
      show_spline?: boolean
      active_path_key?: string
      active_image_idx?: number
      allow_file_drop?: boolean
      fps?: number
      fps_range?: readonly [number, number]
      auto_play?: boolean
      // 'always' | 'hover' | 'never' | { mode, hidden: NebControlName[], style }
      show_controls?: ShowControlsProp<NebControlName>
      pane_ratio?: number
      fullscreen_toggle?: boolean
      fullscreen?: boolean
      wrapper?: HTMLDivElement
      error_msg?: string
      plot_props?: Omit<
        ScatterPlotOptions,
        `controls_extra` | `on_point_hover` | `on_point_click`
      >
      structure_props?: StructureOptions
      on_fullscreen_change?: (fullscreen: boolean) => void
    } = $props()

  const dropped_paths = new SvelteMap<string, ReactionPath>()
  let controls_height = $state(0)
  const controls_config = $derived(normalize_show_controls(show_controls, `always`))
  const show_toggle = $derived(shows_fullscreen_toggle(fullscreen_toggle, controls_config))

  const merged: ReactionPathInput = $derived({
    ...(paths
      ? Object.fromEntries(normalize_paths(paths).map(({ key, path }) => [key, path]))
      : {}),
    ...Object.fromEntries(dropped_paths),
  })
  const named_paths = $derived(Object.keys(merged).length > 0 ? normalize_paths(merged) : [])
  // The one options object both the summary table below and the plot's own annotation
  // measure the path with, so the two cannot report different barriers. Profiles are
  // computed once here and handed to the plot. A path that cannot be profiled (identical
  // consecutive images give no arc length, mismatched site counts no displacement) is
  // reported and left out instead of throwing through the render.
  const profile_options = $derived({ ...coord_options, mode: coord_mode })
  const { profiled, failures: profile_failures } = $derived.by(() => {
    const entries: { key: string; path: ReactionPath; profile: PathProfile }[] = []
    const failures: string[] = []
    for (const { key, path } of named_paths) {
      try {
        entries.push({ key, path, profile: path_profile(path, profile_options) })
      } catch (exc) {
        failures.push(`${key}: ${to_error(exc).message}`)
      }
    }
    return { profiled: entries, failures }
  })
  const profiles = $derived(
    Object.fromEntries(profiled.map(({ key, profile }) => [key, profile])),
  )
  const plotted_paths = $derived(
    Object.fromEntries(profiled.map(({ key, path }) => [key, path])),
  )
  const active = $derived(
    profiled.find((entry) => entry.key === active_path_key) ?? profiled[0],
  )
  const profile = $derived(active?.profile ?? null)
  const n_images = $derived(active?.path.images.length ?? 0)
  const image_idx = $derived(clamp(active_image_idx, 0, Math.max(n_images - 1, 0)))
  const current_image = $derived(active?.path.images[image_idx])
  // A file's own image label leads the 1-based position unless it just restates this image's
  // 0- or 1-based index (`image 0`); a different number (a sub-path's `image 3`) is real info
  const image_caption = $derived.by(() => {
    const { label = `` } = current_image ?? {}
    const position = `image ${display_idx(image_idx)} of ${n_images}`
    const restated = [image_idx, display_idx(image_idx)].some(
      (num) => label.toLowerCase() === `image ${num}`,
    )
    return label && !restated ? `${label}: ${position}` : position
  })
  const energy_unit = $derived(active ? path_energy_unit(active.path) : `eV`)

  const playback = create_sequence_player({
    count: () => n_images,
    index: () => active_image_idx,
    set_index: (index) => (active_image_idx = index),
    fps: () => fps,
    set_fps: (value) => (fps = value),
    fps_range: () => fps_range,
    should_auto_play: () => auto_play && Boolean(active),
  })

  // Playback keys work while the viewer is focused or hovered, as in Trajectory, not only
  // while its slider has focus
  const keys = viewer_keydown(
    (event) => is_sequence_key_target(event) && playback.handle_keydown(event),
  )

  // Keep the public binding aligned with the clamped image shown after changing paths. With
  // no path yet there is nothing to clamp against, so a bound index waits for its paths.
  $effect(() => {
    if (n_images > 0 && active_image_idx !== image_idx) active_image_idx = image_idx
  })

  // The latest drop's recoverable parse warnings, one dismissible notice
  let parse_warning_msg = $state<string>()
  // Loose structure files only form a path TOGETHER, so a drop is parsed as one batch
  const drop_zone = file_drop_zone({
    allow: () => allow_file_drop,
    on_batch: (dropped) => {
      ;[error_msg, parse_warning_msg] = [undefined, undefined]
      const files = dropped.map(({ content, filename }) => ({
        content: as_text(content),
        filename,
      }))
      try {
        const { value: parsed, warnings } = collect_parse_warnings(() =>
          parse_dropped_paths(files),
        )
        // Profile before accepting, so an unplottable path is refused with its reason
        for (const path of Object.values(parsed)) path_profile(path, profile_options)
        for (const [key, path] of Object.entries(parsed)) {
          dropped_paths.set(key, path)
          active_path_key = key
        }
        active_image_idx = 0
        parse_warning_msg = parse_warnings_notice(warnings)
      } catch (exc) {
        const names = files.map(({ filename }) => filename).join(`, `)
        error_msg = `${names}: ${to_error(exc).message}`
      }
    },
    on_error: (msg) => (error_msg = msg),
  })

  // Energy of the shown image on the same reference as the plot's y axis
  const shown_energy = $derived(
    (current_image?.energy ?? 0) -
      (profile && energy_reference === `initial` ? profile.analysis.initial_energy : 0),
  )

  // === Export ===
  // PNG of the shown image's structure view; CSV of every profiled path's energy profile on
  // the current reaction coordinate; JSON in the native (re-loadable) reaction-path format
  const export_sources = {
    ...canvas_sources(() => wrapper?.querySelector(`.structure-pane canvas`)),
    csv: csv_source(() => ({
      header: [`path`, `image`, `reaction_coordinate`, `energy`, `energy_rel_initial`],
      rows: profiled.flatMap(({ key, profile: { coords, energies, analysis } }) =>
        energies.map((energy, idx) => [
          key,
          display_idx(idx),
          coords[idx],
          energy,
          energy - analysis.initial_energy,
        ]),
      ),
    })),
    json: json_source(() => ({ format: REACTION_PATH_FORMAT, paths: plotted_paths })),
  }

  const barrier_stats = $derived.by(() => {
    if (!profile) return []
    const { analysis, spline } = profile
    const ts_image = `#${display_idx(analysis.ts_image_idx)}`
    const with_unit = (value: number) => `${format_num(value, `.4~`)} ${energy_unit}`
    const excess = format_num(spline.fitted_max.energy - analysis.ts_energy, `.3~`)
    // on the image-number axis the coordinate is the image number itself
    const ts_at =
      coord_mode === `arc_length`
        ? `${ts_image} at ${format_num(analysis.ts_coordinate, `.4~`)} Å`
        : ts_image
    return [
      { label: `Forward barrier`, value: with_unit(analysis.forward_barrier) },
      { label: `Reverse barrier`, value: with_unit(analysis.reverse_barrier) },
      { label: `Reaction energy`, value: with_unit(analysis.reaction_energy) },
      { label: `Highest image`, value: ts_at },
      {
        label: `Fitted saddle (${spline.method})`,
        value: `+${excess} ${energy_unit} above image ${ts_image}`,
      },
    ]
  })
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  role="application"
  aria-label="Reaction path viewer"
  tabindex="0"
  {...rest}
  bind:this={wrapper}
  class={[`neb-viewer`, rest.class]}
  {@attach drop_zone}
  {@attach keys}
>
  {#if !active || !profile}
    <EmptyState
      message={allow_file_drop
        ? `Drop a matterviz-reaction-path JSON or a multi-frame extended-XYZ file here`
        : `No reaction path to display`}
    />
  {:else}
    <SequenceControlBar
      class="neb-controls"
      {controls_config}
      {fullscreen}
      bind:height={controls_height}
    >
      {#if profiled.length > 1 && controls_config.visible(`path`)}
        <label class="path-control">
          Path
          <select
            value={active.key}
            onchange={(event) => {
              active_path_key = event.currentTarget.value
              active_image_idx = 0
            }}
          >
            {#each profiled as { key } (key)}<option value={key}>{key}</option>{/each}
          </select>
        </label>
      {/if}

      <SequenceControls
        {controls_config}
        index={image_idx}
        count={n_images}
        {playback}
        item_name="image"
        play_title={playback.is_playing ? `Pause` : `Play along the path`}
        aria_label="NEB image"
        aria_valuetext={image_caption}
        disable_step_while_playing={false}
      />
      {#if controls_config.visible(`energy`)}
        <span class="image-status">
          {image_caption}
          <strong>{format_num(shown_energy, `.4~`)} {energy_unit}</strong>
        </span>
      {/if}

      {#if fullscreen || show_toggle}
        <FullscreenButton
          bind:fullscreen
          hidden={!show_toggle}
          {wrapper}
          bg_css_var="--neb-bg-fullscreen"
          on_change={on_fullscreen_change}
          class="fullscreen-button"
        />
      {/if}
      {#if export_formats?.length !== 0 && controls_config.visible(`export`)}
        <ExportPane
          filename={export_filename}
          sources={export_sources}
          {export_formats}
          {on_export}
          toggle_props={{
            class: `neb-export-toggle`,
            title: `Export reaction path`,
            style: `position: static`,
          }}
        />
      {/if}
    </SequenceControlBar>

    <div
      class="panes"
      style:--viewer-buttons-top={controls_config.mode === `hover`
        ? `calc(${controls_height}px + 1ex)`
        : undefined}
    >
      <NebPlot
        {...plot_props}
        paths={plotted_paths}
        {profiles}
        {coord_options}
        bind:coord_mode
        bind:energy_reference
        bind:show_spline
        bind:active_path_key
        bind:active_image_idx
        shortcut_scopes={[`viewer`, `sequence`]}
        show_controls={controls_config.mode === `never` ? false : plot_props.show_controls}
      />
      <PaneDivider
        orientation="horizontal"
        bind:ratio={pane_ratio}
        aria-label="Resize reaction plot and structure panes"
      />
      <div class="structure-pane">
        {#if current_image}
          <Structure
            {...structure_props}
            allow_file_drop={false}
            structure={current_image.structure}
            structure_series_key={active?.path}
            show_controls={controls_config.mode === `never`
              ? false
              : structure_props.show_controls}
          />
        {/if}
      </div>
    </div>

    <StatGrid items={barrier_stats} class="barrier-summary" aria-label="Reaction barriers" />
  {/if}
  {#if profile_failures.length > 0}
    <StatusMessage message={profile_failures.join(`; `)} type="error" />
  {/if}
  <ViewerNotices>
    <StatusMessage bind:message={parse_warning_msg} type="warning" dismissible />
  </ViewerNotices>
  <ViewerError bind:message={error_msg} dismissible />
</div>

<style>
  .neb-viewer {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8pt;
    container-type: inline-size;
    --sequence-controls-wrap: wrap;
    --sequence-slider-min-width: 80pt;
  }
  /* push the chrome buttons (fullscreen, export) to the bar's end */
  .neb-viewer :global(.neb-controls > :is(.fullscreen-button, .neb-export-toggle)) {
    margin-inline-start: auto;
  }
  .neb-viewer :global(.neb-controls > .fullscreen-button ~ .neb-export-toggle) {
    margin-inline-start: 0;
  }
  .neb-viewer:fullscreen {
    width: 100vw;
    height: 100vh;
    padding: 8pt;
    box-sizing: border-box;
    overflow: auto;
    background: var(--neb-bg-fullscreen, var(--page-bg, Canvas));
  }
  .neb-viewer:fullscreen .panes {
    flex: 1;
    min-height: 0;
    grid-auto-rows: minmax(0, 1fr);
  }
  .neb-viewer:fullscreen .panes > :global(.scatter),
  .neb-viewer:fullscreen .structure-pane,
  .neb-viewer:fullscreen .structure-pane :global(.structure) {
    height: 100% !important;
    min-height: 0 !important;
  }
  .neb-viewer.dragover {
    outline: 2px dashed var(--accent-color, #4e79a7);
    outline-offset: 4px;
  }
  .path-control {
    display: flex;
    align-items: center;
    gap: 4pt;
    white-space: nowrap;
  }
  .image-status {
    display: inline-flex;
    align-items: baseline;
    gap: 4pt;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .image-status strong {
    color: var(--accent-color, currentColor);
  }
  .panes {
    display: grid;
    position: relative;
    /* Keep embedded viewer controls below the sequence bar. */
    isolation: isolate;
    grid-template-columns: minmax(0, var(--split-pane-size, 60%)) minmax(0, 1fr);
    @media (max-width: 900px) {
      grid-template-columns: 1fr;
      gap: 8pt;
      > :global(.pane-divider) {
        display: none;
      }
    }
  }
  .structure-pane {
    min-width: 0;
  }
  .neb-viewer :global(.stat-label) {
    white-space: normal;
  }
</style>
