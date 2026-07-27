<script lang="ts">
  // Reaction-path viewer: energy profile on the left, the structure of the hovered or
  // selected image on the right, with barrier numbers and playback along the path.
  import { StatusMessage } from '$lib/feedback'
  import Icon from '$lib/Icon.svelte'
  import { create_file_drop_handler, drag_over_handlers } from '$lib/io'
  import { format_num } from '$lib/labels'
  import { Structure } from '$lib/structure'
  import { to_error } from '$lib/utils'
  import { SvelteMap } from 'svelte/reactivity'
  import type {
    EnergyReference,
    PathMetric,
    ReactionCoordMode,
    ReactionPath,
    ReactionPathInput,
  } from './index'
  import NebPlot from './NebPlot.svelte'
  import { type DroppedFile, parse_dropped_paths } from './parse'
  import { normalize_paths, path_energy_unit, path_profile } from './reaction-path'

  let {
    paths,
    coord_mode = $bindable(`arc_length`),
    energy_reference = $bindable(`initial`),
    metric = `minimum_image`,
    show_spline = $bindable(true),
    active_path_key = $bindable(``),
    active_image_idx = $bindable(0),
    enable_drop = true,
    fps = 4,
    error_msg = $bindable(undefined),
    plot_style = `height: 460px`,
    structure_style = `height: 460px`,
    ...rest
  }: {
    paths?: ReactionPathInput
    coord_mode?: ReactionCoordMode
    energy_reference?: EnergyReference
    metric?: PathMetric
    show_spline?: boolean
    active_path_key?: string
    active_image_idx?: number
    enable_drop?: boolean
    fps?: number
    error_msg?: string
    plot_style?: string
    structure_style?: string
  } & Record<string, unknown> = $props()

  let dropped_paths = $state(new SvelteMap<string, ReactionPath>())
  let dragover = $state(false)
  let is_playing = $state(false)

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
  // measure the path with, so the two cannot report different barriers.
  const coord_options = $derived({ mode: coord_mode, metric })
  const profile = $derived(active ? path_profile(active.path, coord_options) : null)
  const n_images = $derived(active?.path.images.length ?? 0)
  const image_idx = $derived(
    Math.min(Math.max(active_image_idx, 0), Math.max(n_images - 1, 0)),
  )
  const current_image = $derived(active?.path.images[image_idx])
  const energy_unit = $derived(active ? path_energy_unit(active.path) : `eV`)

  const go_to_image = (idx: number) => {
    if (idx >= 0 && idx < n_images) active_image_idx = idx
  }

  $effect(() => {
    if (!is_playing || n_images < 2) return
    const timer = setInterval(() => {
      active_image_idx = (active_image_idx + 1) % n_images
    }, 1000 / fps)
    return () => clearInterval(timer)
  })

  const handle_drop = create_file_drop_handler({
    allow: () => enable_drop,
    on_drop: (content, filename) => {
      const text = content instanceof ArrayBuffer ? new TextDecoder().decode(content) : content
      try {
        const parsed = parse_dropped_paths([{ content: text, filename }])
        for (const [key, path] of Object.entries(parsed)) {
          dropped_paths.set(key, path)
          active_path_key = key
        }
        active_image_idx = 0
      } catch (exc) {
        error_msg = `${filename}: ${to_error(exc).message}`
      }
    },
    on_error: (msg) => {
      error_msg = msg
    },
    set_loading: (loading) => {
      if (loading) [error_msg, dragover] = [undefined, false]
    },
  })

  const set_dragover = (over: boolean) => (dragover = over)
  const drop_zone = $derived(
    enable_drop ? { ondrop: handle_drop, ...drag_over_handlers({ set_dragover }) } : {},
  )

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

<div class="neb-viewer {dragover ? `dragging` : ``}" {...drop_zone} {...rest}>
  <StatusMessage bind:message={error_msg} type="error" dismissible />

  {#if !active || !profile}
    <div class="empty">
      <StatusMessage
        message={enable_drop
          ? `Drop a matterviz-reaction-path JSON or a multi-frame extended-XYZ file here`
          : `No reaction path to display`}
        style="border: none"
      />
    </div>
  {:else}
    <div class="controls">
      {#if named_paths.length > 1}
        <label>
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
      <label>
        x-axis
        <select bind:value={coord_mode}>
          <option value="arc_length">Arc length</option>
          <option value="image_index">Image index</option>
        </select>
      </label>
      <label>
        Energies
        <select bind:value={energy_reference}>
          <option value="initial">Relative to initial</option>
          <option value="absolute">Absolute</option>
        </select>
      </label>
      <label><input type="checkbox" bind:checked={show_spline} /> Spline</label>
    </div>

    <div class="panes">
      <NebPlot
        paths={merged}
        {coord_options}
        {energy_reference}
        {show_spline}
        bind:active_path_key
        bind:active_image_idx
        style={plot_style}
      />
      <div class="structure-pane">
        {#if current_image}
          <Structure structure={current_image.structure} style={structure_style} />
        {/if}
        {#snippet step_button(delta: number, title: string, glyph: string)}
          <button
            onclick={() => go_to_image(image_idx + delta)}
            disabled={image_idx + delta < 0 || image_idx + delta >= n_images}
            {title}>{glyph}</button
          >
        {/snippet}
        <div class="stepper">
          {@render step_button(-1, `Previous image`, `‹`)}
          <button
            onclick={() => (is_playing = !is_playing)}
            disabled={n_images < 2}
            title={is_playing ? `Pause` : `Play along the path`}
          >
            <Icon icon={is_playing ? `Pause` : `Play`} />
          </button>
          {@render step_button(1, `Next image`, `›`)}
          <input
            type="range"
            min="0"
            max={Math.max(n_images - 1, 0)}
            value={image_idx}
            oninput={(event) => go_to_image(Number(event.currentTarget.value))}
            aria-label="Image slider"
          />
          <span>
            {current_image?.label ?? `image ${image_idx}`} ({image_idx + 1}/{n_images})
          </span>
          <strong>{format_num(shown_energy, `.4~`)} {energy_unit}</strong>
        </div>
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
    display: flex;
    flex-direction: column;
    gap: 8pt;
  }
  .neb-viewer.dragging {
    outline: 2px dashed var(--accent-color, #4e79a7);
    outline-offset: 4px;
  }
  .empty {
    outline: 2px dashed var(--border-color, #ccc);
    border-radius: var(--border-radius, 3pt);
    text-align: center;
    padding: 2em 1em;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 6pt 12pt;
    align-items: center;
    justify-content: center;
    label {
      display: inline-flex;
      align-items: center;
      gap: 4pt;
      font-size: 0.85em;
    }
  }
  .panes {
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 8pt;
    @media (max-width: 900px) {
      grid-template-columns: 1fr;
    }
  }
  .structure-pane {
    display: flex;
    flex-direction: column;
    gap: 6pt;
    min-width: 0;
  }
  .stepper {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6pt;
    font-size: 0.85em;
    button {
      padding: 2pt 8pt;
      cursor: pointer;
      background: var(--surface-bg-hover, rgba(255, 255, 255, 0.1));
      border: 1px solid var(--border-color, #999);
      border-radius: var(--border-radius, 3pt);
    }
    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    input[type='range'] {
      flex: 1 1 90pt;
      min-width: 80pt;
    }
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
