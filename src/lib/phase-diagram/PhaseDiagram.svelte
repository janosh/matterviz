<script lang="ts">
  import type { AxisConfig } from '$lib/plot'
  import type { Component } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import type { BasePhaseDiagramProps, Hull3DProps } from './index'
  import PhaseDiagram2D from './PhaseDiagram2D.svelte'
  import PhaseDiagram3D from './PhaseDiagram3D.svelte'
  import PhaseDiagram4D from './PhaseDiagram4D.svelte'

  // Union type combining all possible props from 2D, 3D, and 4D components
  // Note: This is a superset - each specific component will only use its relevant props
  type PhaseDiagramProps = BasePhaseDiagramProps & Hull3DProps & { // 2D-specific props
    x_axis?: AxisConfig
    y_axis?: AxisConfig
  }

  // Component type that accepts our unified props
  type UnifiedComponent = Component<PhaseDiagramProps>

  let {
    entries,
    // Only list props that need special handling in this wrapper:
    // 1. Bindable props (required to use $bindable())
    // 2. Props with meaningful defaults (optional)
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

  // Lightweight element extraction - just count unique elements without processing entries
  function extract_unique_elements(
    entries: { composition: Record<string, number> }[],
  ): string[] {
    const elements = new SvelteSet<string>()
    for (const entry of entries) {
      for (const elem of Object.keys(entry.composition)) {
        elements.add(elem)
      }
    }
    return Array.from(elements).sort()
  }

  // Detect dimensionality by counting unique elements (lightweight operation)
  const elements = $derived(extract_unique_elements(entries))
  const element_count = $derived(elements.length)

  // Map element count to corresponding component
  // Cast to UnifiedComponent to bypass TypeScript's union type complexity
  const Component = $derived<UnifiedComponent | null>(
    element_count === 2
      ? (PhaseDiagram2D as UnifiedComponent)
      : element_count === 3
      ? (PhaseDiagram3D as UnifiedComponent)
      : element_count === 4
      ? (PhaseDiagram4D as UnifiedComponent)
      : null,
  )
</script>

{#if Component}
  <Component
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
  <div
    class="phase-diagram-error"
    style="display: flex; align-items: center; justify-content: center; height: var(--pd-height, 500px); border: 1px solid var(--text-color, #ccc); border-radius: 4px; background: var(--pd-bg, transparent)"
  >
    <div style="text-align: center; padding: 2em; color: var(--text-color, #666)">
      <h3 style="margin: 0 0 1em 0">Unsupported Chemical System</h3>
      <p style="margin: 0">
        Phase diagrams require 2, 3, or 4 elements. Found {element_count} element{
          element_count ===
            1
          ? ``
          : `s`
        }:
      </p>
      <p style="margin: 0.5em 0 0 0; font-weight: bold">
        {elements.join(`, `)}
      </p>
    </div>
  </div>
{/if}
