<script lang="ts">
  import { extract_formula_elements } from '$lib/composition/parse'
  import type { AxisConfig } from '$lib/plot'
  import { get_convex_hull_defaults } from '$lib/settings'
  import type { Component } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import ConvexHull2D from './ConvexHull2D.svelte'
  import ConvexHull3D from './ConvexHull3D.svelte'
  import ConvexHull4D from './ConvexHull4D.svelte'
  import MissingConvexHullData from './MissingConvexHullData.svelte'
  import type { BaseConvexHullProps, Hull3DProps } from './index'

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
    ...rest
  }: ConvexHullProps = $props()
  const entries = $derived(entries_prop ?? [])

  // Lightweight element extraction - count unique elements, stripping oxidation states
  // (e.g. "V4+" -> "V") to avoid counting the same element multiple times
  function extract_unique_elements(
    hull_entries: { composition: Record<string, number> }[],
  ): string[] {
    const elements = new SvelteSet<string>()
    for (const entry of hull_entries) {
      for (const key of Object.keys(entry.composition)) {
        // Extract valid element symbols, stripping oxidation states
        for (const elem of extract_formula_elements(key, { unique: false })) {
          elements.add(elem)
        }
      }
    }
    return Array.from(elements).toSorted()
  }

  // Detect dimensionality by counting unique elements (lightweight operation)
  const elements = $derived(extract_unique_elements(entries))
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
  // while each component declares only its dimension's props (2D lacks Hull3DProps, 3D/4D
  // lack x/y_axis), so a constructor union wouldn't compile. Svelte ignores extra props.
  const ConvexHullComponent = $derived(
    { 2: ConvexHull2D, 3: ConvexHull3D, 4: ConvexHull4D }[element_count] ?? null,
  ) as Component<ConvexHullProps> | null
</script>

{#if entries_prop === undefined}
  <MissingConvexHullData
    class={[`convex-hull-error`, rest.class]}
    hidden={rest.hidden}
    style={rest.style}
  />
{:else if ConvexHullComponent}
  <ConvexHullComponent
    {entries}
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
  />
{:else}
  <!-- Error state for unsupported dimensionalities -->
  <div class="convex-hull-error">
    <h3>Unsupported Chemical System</h3>
    <p>
      Convex hulls require 2, 3, or 4 elements. Found {element_count} element{element_count ===
      1
        ? ``
        : `s`}:
    </p>
    <strong>{elements.join(`, `)}</strong>
  </div>
{/if}

<style>
  .convex-hull-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    height: var(--convex-hull-height, 500px);
    padding: 2em;
    text-align: center;
    color: var(--convex-hull-text-color, #666);
    border: 1px solid var(--convex-hull-border-color, #ccc);
    border-radius: var(--border-radius, 3pt);
    background: var(--convex-hull-bg, transparent);
    h3 {
      margin: 0 0 1em;
    }
    p {
      margin: 0 0 0.5em;
    }
  }
</style>
