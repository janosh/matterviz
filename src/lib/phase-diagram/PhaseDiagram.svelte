<script lang="ts">
  import { extract_formula_elements } from '$lib/composition/parse'
  import type { AxisConfig } from '$lib/plot'
  import type { Component } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import type { BasePhaseDiagramProps, Hull3DProps } from './index'
  import PhaseDiagram2D from './PhaseDiagram2D.svelte'
  import PhaseDiagram3D from './PhaseDiagram3D.svelte'
  import PhaseDiagram4D from './PhaseDiagram4D.svelte'

  // Union type combining all possible props from 2D, 3D, and 4D components
  // each specific component will only use its relevant props from this super set
  type PhaseDiagramProps = BasePhaseDiagramProps & Hull3DProps & {
    x_axis?: AxisConfig
    y_axis?: AxisConfig
  }

  let {
    entries,
    // bindable props not part of rest because Svelte 5 doesn't support spreading bindable props.
    fullscreen = $bindable(false),
    wrapper = $bindable(),
    show_stable = $bindable(true),
    show_unstable = $bindable(true),
    show_hull_faces = $bindable(true),
    hull_face_opacity = $bindable(0.3),
    color_mode = $bindable(`energy`),
    color_scale = $bindable(`interpolateViridis`),
    info_pane_open = $bindable(false),
    legend_pane_open = $bindable(false),
    max_hull_dist_show_phases = $bindable(0.1),
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
    ...rest // All other PD props (both common and dimension-specific) go to rest
  }: PhaseDiagramProps = $props()

  // Lightweight element extraction - count unique elements, stripping oxidation states
  // (e.g. "V4+" -> "V") to avoid counting the same element multiple times
  function extract_unique_elements(
    entries: { composition: Record<string, number> }[],
  ): string[] {
    const elements = new SvelteSet<string>()
    for (const entry of entries) {
      for (const key of Object.keys(entry.composition)) {
        // Extract valid element symbols, stripping oxidation states
        for (const elem of extract_formula_elements(key, { unique: false })) {
          elements.add(elem)
        }
      }
    }
    return Array.from(elements).sort()
  }

  // Detect dimensionality by counting unique elements (lightweight operation)
  const elements = $derived(extract_unique_elements(entries))
  const element_count = $derived(elements.length)

  // Map element count to corresponding component
  // Note: Type assertion needed because TypeScript can't infer that all components
  // accept a compatible superset of props (BasePhaseDiagramProps + dimension-specific)
  const PhaseDiagramComponent = $derived(
    { 2: PhaseDiagram2D, 3: PhaseDiagram3D, 4: PhaseDiagram4D }[element_count] ??
      null,
  ) as Component<PhaseDiagramProps> | null
</script>

{#if PhaseDiagramComponent}
  <PhaseDiagramComponent
    {entries}
    {...rest}
    bind:fullscreen
    bind:wrapper
    bind:show_stable
    bind:show_unstable
    bind:show_hull_faces
    bind:hull_face_opacity
    bind:color_mode
    bind:color_scale
    bind:info_pane_open
    bind:legend_pane_open
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
  />
{:else}
  <!-- Error state for unsupported dimensionalities -->
  <div class="phase-diagram-error">
    <div style="text-align: center; padding: 2em; color: var(--text-color, #666)">
      <h3 style="margin: 0 0 1em 0">Unsupported Chemical System</h3>
      <p style="margin: 0">
        Phase diagrams require 2, 3, or 4 elements. Found {element_count} element{
          element_count === 1 ? `` : `s`
        }:
      </p>
      <p style="margin: 0.5em 0 0 0; font-weight: bold">
        {elements.join(`, `)}
      </p>
    </div>
  </div>
{/if}

<style>
  .phase-diagram-error {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    height: var(--pd-height, 500px);
    border: 1px solid var(--text-color, #ccc);
    border-radius: var(--border-radius, 3pt);
    background: var(--pd-bg, transparent);
  }
</style>
