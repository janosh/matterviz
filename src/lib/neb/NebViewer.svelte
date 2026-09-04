<script lang="ts">
  // Reaction-path viewer: energy profile on the left, the structure of the hovered or
  // selected image on the right, with barrier numbers and playback along the path.
  import { DEFAULT_FPS_RANGE } from '$lib/constants'
  import { normalize_show_controls } from '$lib/controls'
  import type { ShowControlsProp } from '$lib/controls'
  import { StatusMessage } from '$lib/feedback'
  import { as_text, file_drop_zone } from '$lib/io'
  import { format_num } from '$lib/labels'
  import { FullscreenButton } from '$lib/layout'
  import PaneDivider from 'svelte-widgets/SplitPane.svelte'
  import { create_sequence_player } from '$lib/layout/sequence-player.svelte'
  import SequenceControlBar from '$lib/layout/SequenceControlBar.svelte'
  import { clamp } from '$lib/math'
  import SequenceControls from '$lib/layout/SequenceControls.svelte'
  import { Structure } from '$lib/structure'
  import { to_error } from '$lib/utils'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap } from 'svelte/reactivity'
  import type {
    EnergyReference,
    PathMetric,
    ReactionCoordMode,
    ReactionPath,
    ReactionPathInput,
  } from './index'
  import NebPlot from './NebPlot.svelte'
  import { parse_dropped_paths } from './parse'
  import { normalize_paths, path_energy_unit, path_profile } from './reaction-path'

  type NebControlName = `path` | `nav` | `step` | `fps` | `energy` | `fullscreen`

  let {
    paths,
    coord_mode = $bindable(`arc_length`),
    energy_reference = $bindable(`initial`),
    metric = `minimum_image`,
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
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    paths?: ReactionPathInput
    coord_mode?: ReactionCoordMode
    energy_reference?: EnergyReference
    metric?: PathMetric
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
    plot_props?: Partial<ComponentProps<typeof NebPlot>>
    structure_props?: Partial<ComponentProps<typeof Structure>>
    on_fullscreen_change?: (fullscreen: boolean) => void
  } = $props()

  const dropped_paths = new SvelteMap<string, ReactionPath>()
  let controls_height = $state(0)
  const controls_config = $derived(normalize_show_controls(show_controls, `always`))

  const merged: ReactionPathInput = $derived({
    ...(paths
      ? Object.fromEntries(normalize_paths(paths).map(({ key, path }) => [key, path]))
      : {}),
    ...Object.fromEntries(dropped_paths),
  })
  const named_paths = $derived(Object.keys(merged).length > 0 ? normalize_paths(merged) : [])
  const active = $derived(
    named_paths.find((entry) => entry.key === active_path_key) ?? named_paths[0],
  )
  // The one options object both the summary table below and the plot's own annotation
  // measure the path with, so the two cannot report different barriers. Profiles are
  // computed once here and handed to the plot.
  const coord_options = $derived({ mode: coord_mode, metric })
  const profiles = $derived(
    Object.fromEntries(
      named_paths.map(({ key, path }) => [key, path_profile(path, coord_options)]),
    ),
  )
  const profile = $derived(active ? profiles[active.key] : null)
  const n_images = $derived(active?.path.images.length ?? 0)
  const image_idx = $derived(clamp(active_image_idx, 0, Math.max(n_images - 1, 0)))
  const current_image = $derived(active?.path.images[image_idx])
  const image_caption = $derived(current_image?.label ?? `image ${image_idx}`)
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

  // Keep the public binding aligned with the clamped image shown after changing paths.
  $effect(() => {
    if (active_image_idx !== image_idx) active_image_idx = image_idx
  })

  const drop_zone = file_drop_zone({
    allow: () => allow_file_drop,
    on_drop: (content, filename) => {
      try {
        const parsed = parse_dropped_paths([{ content: as_text(content), filename }])
        for (const [key, path] of Object.entries(parsed)) {
          dropped_paths.set(key, path)
          active_path_key = key
        }
        active_image_idx = 0
      } catch (exc) {
        error_msg = `${filename}: ${to_error(exc).message}`
      }
    },
    on_error: (msg) => (error_msg = msg),
    set_loading: (loading) => {
      if (loading) error_msg = undefined
    },
  })

  // Energy of the shown image on the same reference as the plot's y axis
  const shown_energy = $derived(
    (current_image?.energy ?? 0) -
      (profile && energy_reference === `initial` ? profile.analysis.initial_energy : 0),
  )

  const barrier_rows = $derived.by(() => {
    if (!profile) return []
    const { analysis, spline } = profile
    const ts_idx = analysis.ts_image_idx
    const with_unit = (value: number) => `${format_num(value, `.4~`)} ${energy_unit}`
    const excess = format_num(spline.fitted_max.energy - analysis.ts_energy, `.3~`)
    const coord_unit = coord_mode === `arc_length` ? ` Å` : ``
    const ts_at = `#${ts_idx} at ${format_num(analysis.ts_coordinate, `.4~`)}${coord_unit}`
    return [
      [`Forward barrier`, with_unit(analysis.forward_barrier)],
      [`Reverse barrier`, with_unit(analysis.reverse_barrier)],
      [`Reaction energy`, with_unit(analysis.reaction_energy)],
      [`Highest image`, ts_at],
      [`Fitted saddle (${spline.method})`, `+${excess} ${energy_unit} above image #${ts_idx}`],
    ]
  })
</script>

<div
  {...rest}
  bind:this={wrapper}
  class={[`neb-viewer sequence-viewer`, rest.class]}
  {@attach drop_zone}
>
  <StatusMessage bind:message={error_msg} type="error" dismissible />

  {#if !active || !profile}
    <div class="empty">
      <StatusMessage
        message={allow_file_drop
          ? `Drop a matterviz-reaction-path JSON or a multi-frame extended-XYZ file here`
          : `No reaction path to display`}
        style="border: none"
      />
    </div>
  {:else}
    <SequenceControlBar class="neb-controls" {controls_config} bind:height={controls_height}>
      {#if named_paths.length > 1 && controls_config.visible(`path`)}
        <label class="path-control">
          Path
          <select
            value={active.key}
            onchange={(event) => {
              active_path_key = event.currentTarget.value
              active_image_idx = 0
            }}
          >
            {#each named_paths as { key } (key)}<option value={key}>{key}</option>{/each}
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
        aria_valuetext="{image_caption} ({image_idx + 1} of {n_images})"
        disable_step_while_playing={false}
      />
      {#if controls_config.visible(`energy`)}
        <span class="image-status">
          {image_caption} ({image_idx + 1}/{n_images})
          <strong>{format_num(shown_energy, `.4~`)} {energy_unit}</strong>
        </span>
      {/if}

      {#if fullscreen_toggle && controls_config.visible(`fullscreen`)}
        <FullscreenButton
          bind:fullscreen
          {wrapper}
          bg_css_var="--neb-bg-fullscreen"
          on_change={on_fullscreen_change}
          class="fullscreen-button"
          style="margin-inline-start: auto"
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
        paths={merged}
        {profiles}
        {coord_options}
        bind:coord_mode
        bind:energy_reference
        bind:show_spline
        bind:active_path_key
        bind:active_image_idx
        show_controls={controls_config.mode !== `never` && plot_props.show_controls !== false}
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
            structure={current_image.structure}
            structure_series_key={active?.path}
            allow_file_drop={structure_props.allow_file_drop ?? false}
            show_controls={controls_config.mode === `never`
              ? false
              : structure_props.show_controls}
          />
        {/if}
      </div>
    </div>

    <dl class="barrier-summary">
      {#each barrier_rows as [term, value] (term)}
        <dt>{term}</dt>
        <dd>{value}</dd>
      {/each}
    </dl>
  {/if}
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
  .neb-viewer:fullscreen .structure-pane > :global(.structure) {
    height: 100% !important;
    min-height: 0 !important;
  }
  .neb-viewer.dragover {
    outline: 2px dashed var(--accent-color, #4e79a7);
    outline-offset: 4px;
  }
  .empty {
    outline: 2px dashed var(--border-color, #ccc);
    border-radius: var(--border-radius, 3pt);
    text-align: center;
    padding: 2em 1em;
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
  .barrier-summary {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2pt 12pt;
    margin: 0;
    font-size: 0.85em;
    dt {
      color: var(--text-color-muted, #888);
    }
    dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
    }
  }
</style>
