<script lang="ts">
  // Hover tooltip shared by ChemPotDiagram (wrapper), ChemPotDiagram2D and ChemPotDiagram3D.
  // Placed with PlotTooltip inside the diagram container; `hover_info.pointer` is already
  // container-relative (see pointer.ts).
  import { get_electro_neg_formula, get_formula_label_segments } from '$lib/composition/format'
  import { format_num } from '$lib/labels'
  import { PlotTooltip } from '$lib/plot'
  import type { ChemPotHoverInfo } from './types'

  let {
    hover_info,
    pinned = false,
    detail_level = `detailed`,
    constrain_to,
  }: {
    hover_info: ChemPotHoverInfo
    pinned?: boolean
    detail_level?: `compact` | `detailed`
    // container size the tooltip is flipped/clamped inside
    constrain_to: { width: number; height: number }
  } = $props()

  const label = (formula: string): string =>
    get_electro_neg_formula(formula, { plain_text: true, delim: ``, amount_format: `.3~s` })
  const fmt = (value: number): string => format_num(value, `.4~g`)
</script>

<PlotTooltip
  x={hover_info.pointer?.x ?? 4}
  y={hover_info.pointer?.y ?? 4}
  offset={{ x: 0, y: 0 }}
  {constrain_to}
  fallback_size={{ width: 200, height: 100 }}
  class="chempot-tooltip"
>
  <h4>
    {#each get_formula_label_segments(label(hover_info.formula)) as segment, idx (idx)}
      {#if segment.subscript}<sub>{segment.text}</sub>{:else}{segment.text}{/if}
    {/each}
  </h4>
  {#if pinned}
    <p>Pinned · Press Esc to unlock</p>
  {/if}
  {#if hover_info.view === `2d`}
    <p>2D domain · Points: {hover_info.n_points}</p>
  {:else}
    <p>
      {hover_info.is_elemental ? `Elemental phase` : `Compound phase`}
      {#if hover_info.is_draw_formula}<span> · Overlay target</span>{/if}
    </p>
    <p>
      Vertices: {hover_info.n_vertices} · Edges: {hover_info.n_edges} · Points:
      {hover_info.n_points}
    </p>
    <p>
      Entries: {hover_info.matching_entry_count}
      {#if hover_info.min_energy_per_atom !== null && hover_info.max_energy_per_atom !== null}
        · E/atom: {fmt(hover_info.min_energy_per_atom)} to {fmt(
          hover_info.max_energy_per_atom,
        )}
        eV
      {/if}
    </p>
  {/if}
  {#if detail_level === `detailed`}
    <h5>Axis ranges</h5>
    {#each hover_info.axis_ranges as axis_range (axis_range.element)}
      <p>{axis_range.element}: {fmt(axis_range.min_val)} to {fmt(axis_range.max_val)} eV</p>
    {/each}
    {#if hover_info.view === `3d`}
      <p>Centroid: ({hover_info.ann_loc.map((val) => format_num(val, `.3~g`)).join(`, `)})</p>
      {#if hover_info.neighbors.length > 0}
        <h5>Neighbors ({hover_info.neighbors.length})</h5>
        <p>{hover_info.neighbors.map(label).join(`, `)}</p>
      {/if}
      {#if hover_info.touches_limits.length > 0}
        <h5>Touches bounds</h5>
        <p>{hover_info.touches_limits.join(`, `)}</p>
      {/if}
    {/if}
  {/if}
</PlotTooltip>

<style>
  :global(.chempot-tooltip) {
    max-width: min(32rem, 92vw);
    background: var(--tooltip-bg, light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.9)));
    color: var(--tooltip-text, var(--text-color, #222));
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);
    --plot-tooltip-padding: 6px 8px;
    --plot-tooltip-border-radius: 6px;
    --plot-tooltip-font-size: 12px;
    line-height: 1.3;
  }
  h4 {
    margin: 0 0 3px;
    font-size: 13px;
  }
  h5 {
    margin: 5px 0 0;
    font-size: 12px;
    font-weight: 600;
  }
  p {
    margin: 1px 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
