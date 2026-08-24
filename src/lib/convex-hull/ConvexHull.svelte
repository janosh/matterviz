<script lang="ts">
  import type { ElementSymbol } from '$lib/element'
  import type { AxisConfig } from '$lib/plot'
  import { get_convex_hull_defaults } from '$lib/settings'
  import type { Component } from 'svelte'
  import ConvexHull2D from './ConvexHull2D.svelte'
  import ConvexHullCanvas from './ConvexHullCanvas.svelte'
  import type { BaseConvexHullProps, Hull3DProps } from './index'
  import MissingConvexHullData from './MissingConvexHullData.svelte'
  import { process_hull_entries } from './thermodynamics'

  // Union type combining all possible props from 2D, 3D, and 4D components
  // each specific component will only use its relevant props from this super set
  // (gas_config/gas_pressures already come from BaseConvexHullProps)
  type ConvexHullProps = BaseConvexHullProps &
    Hull3DProps & {
      x_axis?: AxisConfig
      y_axis?: AxisConfig
    }

  let {
    entries: entries_prop,
    // bindable props not part of rest because Svelte 5 doesn't support spreading bindable props.
    fullscreen = $bindable(false),
    wrapper = $bindable(),
    show_stable = $bindable(true),
    show_unstable = $bindable(true),
    hidden_categories = $bindable([]),
    show_hull_faces = $bindable(true),
    hull_face_opacity: hull_face_opacity_prop = $bindable(undefined as number | undefined),
    color_mode = $bindable(`energy`),
    color_scale = $bindable(`interpolateViridis`),
    info_pane_open = $bindable(false),
    controls_open = $bindable(false),
    max_hull_dist_show_phases: max_hull_dist_show_phases_prop = $bindable(
      undefined as number | undefined,
    ),
    max_hull_dist_show_labels = $bindable(0.1),
    show_stable_labels = $bindable(true),
    show_unstable_labels = $bindable(false),
    energy_source_mode = $bindable(`precomputed`),
    phase_stats = $bindable(null),
    display = $bindable({ x_grid: false, y_grid: false }),
    stable_entries = $bindable([]),
    unstable_entries = $bindable([]),
    highlighted_entries = $bindable([]),
    selected_entry = $bindable(null),
    temperature = $bindable(),
    gas_pressures = $bindable({}),
    children,
    ...rest
  }: ConvexHullProps = $props()

  // An empty array is the usual "not loaded yet" shape (the anywidget bridge sends [] before
  // the data arrives), so it gets the neutral missing-data state like `undefined`
  const entries = $derived(entries_prop?.length ? entries_prop : undefined)

  // Detect dimensionality from the same key parser the hull pipeline uses (oxidation states
  // stripped, compound-like keys rejected) so routing and processing can't disagree. Like the
  // pipeline's own arity check this runs on the raw entries, before any temperature or gas
  // filtering, so a temperature that drops every entry of one element can't reroute the
  // diagram. A rejected key is an `entries` prop problem, so instead of throwing mid-render
  // the error routes to ConvexHull2D, whose pipeline renders the same message as its empty
  // state.
  const parsed = $derived.by((): { elements: ElementSymbol[]; invalid: boolean } => {
    try {
      return { elements: process_hull_entries(entries ?? []).elements, invalid: false }
    } catch {
      return { elements: [], invalid: true }
    }
  })
  const elements = $derived(parsed.elements)
  const element_count = $derived(elements.length)

  const hull_defaults = $derived(
    get_convex_hull_defaults(element_count === 2 ? 2 : element_count === 3 ? 3 : 4),
  )
  let hull_face_opacity = $derived(
    hull_face_opacity_prop ??
      (`hull_face_opacity` in hull_defaults ? hull_defaults.hull_face_opacity : 1),
  )
  let max_hull_dist_show_phases = $derived(
    max_hull_dist_show_phases_prop ?? hull_defaults.max_hull_dist_show_phases,
  )
  $effect(() => {
    if (element_count < 2 || element_count > 4) return
    if (hull_face_opacity_prop !== hull_face_opacity)
      hull_face_opacity_prop = hull_face_opacity
    if (max_hull_dist_show_phases_prop !== max_hull_dist_show_phases) {
      max_hull_dist_show_phases_prop = max_hull_dist_show_phases
    }
  })

  // Map element count to component. Deliberate cast: the wrapper passes the prop superset
  // while each component declares only its dimension's props (2D lacks Hull3DProps and dim,
  // the canvas lacks x/y_axis), so a constructor union wouldn't compile. Svelte ignores extra
  // props. Missing entries (data not loaded yet) and invalid ones go to 2D, which renders the
  // missing-data/error state and zeroes the bound outputs like every dimension does.
  const canvas_dim = $derived(
    element_count === 3 || element_count === 4 ? element_count : null,
  )
  const ConvexHullComponent = $derived(
    entries === undefined || parsed.invalid || element_count === 2
      ? ConvexHull2D
      : canvas_dim
        ? ConvexHullCanvas
        : null,
  ) as Component<ConvexHullProps & { dim?: 3 | 4 }> | null

  // `rest` carries the non-bindable component props too (controls, config, callbacks, …).
  // Only the DOM attributes may reach the empty state, while `hidden`, `onclick`, aria-* and
  // data-* must all survive, so the component props are named and everything else passes.
  const HULL_PROP_KEYS = new Set<string>([
    `controls`,
    `config`,
    `show_controls`,
    `on_point_click`,
    `on_point_hover`,
    `fullscreen_toggle`,
    `enable_info_pane`,
    `label_threshold`,
    `entry_category`,
    `allow_file_drop`,
    `on_file_drop`,
    `enable_click_selection`,
    `enable_structure_preview`,
    `highlight_style`,
    `tooltip`,
    `interpolate_temperature`,
    `max_interpolation_gap`,
    `gas_config`,
    `hull_face_color_mode`,
    `gizmo`,
    `x_axis`,
    `y_axis`,
  ] satisfies (keyof ConvexHullProps)[])
  const dom_attrs = $derived(
    Object.fromEntries(Object.entries(rest).filter(([key]) => !HULL_PROP_KEYS.has(key))),
  )
</script>

<!-- keyed so a 3 ↔ 4 element switch remounts the canvas with its new dimension -->
{#if ConvexHullComponent}
  {#key canvas_dim}
    <ConvexHullComponent
      {entries}
      dim={canvas_dim ?? undefined}
      {...rest}
      bind:fullscreen
      bind:wrapper
      bind:show_stable
      bind:show_unstable
      bind:hidden_categories
      bind:show_hull_faces
      bind:hull_face_opacity
      bind:color_mode
      bind:color_scale
      bind:info_pane_open
      bind:controls_open
      bind:max_hull_dist_show_phases
      bind:max_hull_dist_show_labels
      bind:show_stable_labels
      bind:show_unstable_labels
      bind:energy_source_mode
      bind:phase_stats
      bind:display
      bind:stable_entries
      bind:unstable_entries
      bind:highlighted_entries
      bind:selected_entry
      bind:temperature
      bind:gas_pressures
      {children}
    />
  {/key}
{:else}
  <MissingConvexHullData
    {...dom_attrs}
    error="Convex hulls require 2, 3 or 4 elements, found {element_count}: {elements.join(
      `, `,
    )}"
    style="{rest.style ?? ``}; height: var(--hull-height, 500px)"
  />
{/if}
