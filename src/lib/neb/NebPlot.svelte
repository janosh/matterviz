<script lang="ts">
  // Energy profile of one or more reaction paths, with the barrier annotated and the
  // fitted saddle drawn distinctly from the highest computed image.
  import { plot_color } from '$lib/colors'
  import { format_num } from '$lib/labels'
  import { SettingsSection } from '$lib/layout'
  import { clamp } from '$lib/math'
  import { ScatterPlot, type DataSeries } from '$lib/plot'
  import type { ComponentProps } from 'svelte'
  import type { EnergyReference, ReactionCoordMode, ReactionPathInput } from './index'
  import type { PathProfile, PathSplineOptions } from './reaction-path'
  import {
    nearest_image_idx,
    normalize_paths,
    path_energy_unit,
    path_profile,
  } from './reaction-path'

  // Metadata carried by every image point so hover/click can map back to an image
  type PointMeta = { path_key: string; image_idx: number }
  // Presentation attributes spread onto the shared `seg` line snippet below
  type SegAttrs = Record<string, string | number>
  // ScatterPlot's metadata generic must stay mutually assignable with Record<string, unknown>,
  // so the plotted variant has optional fields and is narrowed before use. Spline series carry
  // no metadata at all, so the optionality is real, not just a type-level concession.
  type PlotPointMeta = Partial<PointMeta> & Record<string, unknown>

  let {
    paths,
    // Metric/pbc live here; `coord_mode` is the bindable x-axis so the pane can change it.
    coord_options = {},
    coord_mode = $bindable(`arc_length`),
    energy_reference = $bindable(`initial`),
    show_spline = $bindable(true),
    annotate_barrier = true,
    active_path_key = $bindable(``),
    active_image_idx = $bindable(0),
    on_image_change,
    x_axis = {},
    y_axis = {},
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    profiles: given_profiles,
    ...rest
  }: {
    paths: ReactionPathInput
    coord_options?: PathSplineOptions
    // Profiles of `paths` under (coord_options, coord_mode), keyed like normalize_paths(paths).
    // A host that already measured them (NebViewer's barrier table) passes them in so each
    // path is profiled once; otherwise they are computed here.
    profiles?: Record<string, PathProfile>
    coord_mode?: ReactionCoordMode
    energy_reference?: EnergyReference
    show_spline?: boolean
    annotate_barrier?: boolean
    active_path_key?: string
    active_image_idx?: number
    on_image_change?: (payload: PointMeta) => void
    x_axis?: ComponentProps<typeof ScatterPlot>[`x_axis`]
    y_axis?: ComponentProps<typeof ScatterPlot>[`y_axis`]
  } & Omit<
    ComponentProps<typeof ScatterPlot>,
    `series` | `x_axis` | `y_axis` | `controls_extra`
  > = $props()

  const named_paths = $derived(normalize_paths(paths))
  const profile_options = $derived({ ...coord_options, mode: coord_mode })

  // Everything the plot needs per path, recomputed only when inputs or modes change
  const profiles = $derived(
    named_paths.map(({ key, path }, path_idx) => {
      const profile = given_profiles?.[key] ?? path_profile(path, profile_options)
      const offset = energy_reference === `initial` ? path.images[0].energy : 0
      return {
        ...profile,
        key,
        path,
        energies: profile.energies.map((energy) => energy - offset),
        offset,
        color: plot_color(path_idx),
      }
    }),
  )

  const active = $derived(
    profiles.find((profile) => profile.key === active_path_key) ?? profiles[0],
  )
  const energy_unit = $derived(path_energy_unit(active.path))
  const clamped_idx = $derived(clamp(active_image_idx, 0, active.path.images.length - 1))

  const select_image = (path_key: string, image_idx: number) => {
    active_path_key = path_key
    active_image_idx = image_idx
    on_image_change?.({ path_key, image_idx })
  }

  const series = $derived<DataSeries<PlotPointMeta>[]>(
    profiles.flatMap(({ key, color, coords, energies, spline, offset }) => {
      const points: DataSeries<PlotPointMeta> = {
        id: `${key}-images`,
        x: coords,
        y: energies,
        label: key,
        markers: show_spline ? `points` : `line+points`,
        metadata: energies.map((_energy, image_idx) => ({ path_key: key, image_idx })),
        point_style: { fill: color, radius: key === active.key ? 6 : 4 },
        line_style: { stroke: color, stroke_width: 2 },
        unit: energy_unit,
      }
      if (!show_spline) return [points]
      const curve: DataSeries<PlotPointMeta> = {
        id: `${key}-spline`,
        x: spline.coords,
        y: spline.energies.map((energy) => energy - offset),
        label: `${key} (${spline.method})`,
        markers: `line`,
        line_style: { stroke: color, stroke_width: 1.5, curve: `linear` },
      }
      return [curve, points]
    }),
  )

  const x_label = $derived(
    coord_mode === `image_index` ? `Image index` : `Reaction coordinate (Å)`,
  )
  const y_label = $derived(
    energy_reference === `initial`
      ? `Energy relative to initial state (${energy_unit})`
      : `Energy (${energy_unit})`,
  )

  const current_coord = $derived(active.coords[clamped_idx])
  const IS_TS_FS_RULE: SegAttrs = {
    'stroke-width': 0.75,
    'stroke-dasharray': `4 4`,
    opacity: 0.55,
  }

  const select_point = (data: { x: number; metadata?: PlotPointMeta | null } | null) => {
    if (!data) return
    const { path_key, image_idx } = data.metadata ?? {}
    if (path_key !== undefined && image_idx !== undefined) {
      return select_image(path_key, image_idx)
    }
    // Spline points carry no metadata; map the hovered coordinate to the nearest image
    select_image(active.key, nearest_image_idx(active.coords, data.x))
  }
</script>

<ScatterPlot
  {...rest}
  bind:show_controls
  bind:controls_open
  {series}
  x_axis={{ label: x_label, ...x_axis }}
  y_axis={{ label: y_label, ...y_axis }}
  current_x_value={current_coord}
  on_point_hover={select_point}
  on_point_click={select_point}
>
  {#snippet controls_extra()}
    <SettingsSection
      title="Profile"
      class="ctrl-line"
      current_values={{ coord_mode, energy_reference, show_spline }}
      on_reset={() => {
        coord_mode = `arc_length`
        energy_reference = `initial`
        show_spline = true
      }}
      layout="flow"
    >
      <label>
        <span>x-axis</span>
        <select id="neb-coord-mode" bind:value={coord_mode}>
          <option value="arc_length">Arc length</option>
          <option value="image_index">Image index</option>
        </select>
      </label>
      <label>
        <span>Energies</span>
        <select id="neb-energy-reference" bind:value={energy_reference}>
          <option value="initial">Relative to initial</option>
          <option value="absolute">Absolute</option>
        </select>
      </label>
      <label>
        <input id="neb-show-spline" type="checkbox" bind:checked={show_spline} />
        Spline
      </label>
    </SettingsSection>
  {/snippet}
  {#snippet user_content({ width, height, x_scale_fn, y_scale_fn, pad })}
    {@const left = pad.l}
    {@const right = width - pad.r}
    {@const top = pad.t}
    {@const bottom = height - pad.b}
    {@const in_x = (val: number) => Number.isFinite(val) && val >= left && val <= right}
    {@const in_y = (val: number) => Number.isFinite(val) && val >= top && val <= bottom}
    {#snippet seg(xy: [number, number, number, number], extra: SegAttrs)}
      <line x1={xy[0]} y1={xy[1]} x2={xy[2]} y2={xy[3]} stroke={active.color} {...extra} />
    {/snippet}
    <!-- active image marker: a full-height rule so the 3D view and plot stay tied together -->
    {@const marker_x = x_scale_fn(current_coord)}
    {#if in_x(marker_x)}
      {@render seg([marker_x, top, marker_x, bottom], {
        stroke: `var(--scatter-current-frame-color, #ff6b35)`,
        'stroke-width': 1,
        'stroke-dasharray': `2 3`,
        opacity: 0.7,
      })}
    {/if}
    {#if annotate_barrier}
      <!-- Annotate the spline peak (interpolated saddle). The highest computed image
        is already a marker; E_act used to sit there and miss the curve's apex. -->
      {@const { analysis, spline, offset } = active}
      {@const saddle = show_spline
        ? spline.fitted_max
        : { coord: analysis.ts_coordinate, energy: analysis.ts_energy }}
      {@const y_initial = y_scale_fn(analysis.initial_energy - offset)}
      {@const y_ts = y_scale_fn(saddle.energy - offset)}
      {@const y_final = y_scale_fn(analysis.final_energy - offset)}
      {@const arrow_x = x_scale_fn(saddle.coord)}
      {@const barrier_label = format_num(saddle.energy - analysis.initial_energy, `.3~`)}
      <!-- reference rules at the initial, transition and final state energies -->
      {#each [y_initial, y_ts, y_final] as y_pos, rule_idx (rule_idx)}
        {#if in_y(y_pos)}{@render seg([left, y_pos, right, y_pos], IS_TS_FS_RULE)}{/if}
      {/each}
      {#if in_y(y_initial) && in_y(y_ts) && in_x(arrow_x)}
        {@render seg([arrow_x, y_initial, arrow_x, y_ts], { 'stroke-width': 1.25 })}
        {#each [[y_initial, 1], [y_ts, -1]] as const as [y_tip, dir] (dir)}
          <path
            d="M{arrow_x - 4} {y_tip - 5 * dir} L{arrow_x} {y_tip} L{arrow_x + 4} {y_tip -
              5 * dir}"
            fill="none"
            stroke={active.color}
            stroke-width="1.25"
          />
        {/each}
        <text
          x={arrow_x + 6}
          y={(y_initial + y_ts) / 2}
          fill={active.color}
          font-size="0.8em"
          dominant-baseline="middle"
        >
          E<tspan baseline-shift="sub" font-size="0.75em">act</tspan> = {barrier_label}
          {energy_unit}
        </text>
      {/if}
      <!-- fitted saddle: a cross, never a data point, since no image was computed there -->
      {@const fit_x = x_scale_fn(spline.fitted_max.coord)}
      {@const fit_y = y_scale_fn(spline.fitted_max.energy - offset)}
      {#if in_x(fit_x) && in_y(fit_y)}
        {#each [[-5, -5, 5, 5], [-5, 5, 5, -5]] as const as [dx1, dy1, dx2, dy2] (dx1 + dy1)}
          {@render seg([fit_x + dx1, fit_y + dy1, fit_x + dx2, fit_y + dy2], {
            'stroke-width': 1.5,
          })}
        {/each}
        <text
          x={fit_x}
          y={fit_y - 9}
          fill={active.color}
          font-size="0.75em"
          text-anchor="middle"
        >
          fit +{format_num(spline.fitted_max.energy - analysis.ts_energy, `.3~`)}
        </text>
      {/if}
    {/if}
  {/snippet}
</ScatterPlot>

<style>
  /* WebKit doesn't inherit dominant-baseline from <text> to <tspan> */
  tspan {
    dominant-baseline: inherit;
  }
</style>
