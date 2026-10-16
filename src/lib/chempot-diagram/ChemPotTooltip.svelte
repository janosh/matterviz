<script lang="ts">
  // Hover tooltip shared by ChemPotDiagram2D and ChemPotDiagram3D.
  // Placed with PlotTooltip inside the diagram container; `hover_info.pointer` is already
  // container-relative (see container_pointer in controls-state.svelte.ts).
  import { get_formula_label_segments } from '#lib/composition/format.js'
  import { format_num } from '#lib/labels.js'
  import { PlotTooltip } from '#lib/plot/index.js'
  import { domain_formula_text } from './controls-state.svelte'
  import type { ChemPotHoverInfo, ChemPotTooltipProp } from './types'

  let {
    hover_info,
    pinned,
    tooltip,
    constrain_to,
    bg_color,
  }: {
    hover_info: ChemPotHoverInfo
    pinned: boolean
    tooltip?: ChemPotTooltipProp // a snippet replaces the content below
    // container size the tooltip is flipped/clamped inside
    constrain_to: { width: number; height: number }
    bg_color?: string // the hovered domain's fill
  } = $props()

  const MAX_NEIGHBORS = 6
  // vertex round-off (|x| ~ 1e-15 eV) would print as 3.55e-15 instead of 0
  const fmt = (value: number): string => format_num(Math.abs(value) < 1e-9 ? 0 : value, `.3~g`)
  const detail_level = $derived(
    (typeof tooltip === `object` && tooltip.detail_level) || `detailed`,
  )
  // One line: phase kind, entry count and energy (a single value when min = max)
  const summary = $derived.by(() => {
    if (hover_info.view === `2d`) return ``
    const { is_elemental, is_draw_formula, matching_entry_count: count } = hover_info
    const { min_energy_per_atom: e_min, max_energy_per_atom: e_max } = hover_info
    const energy =
      e_min === null || e_max === null
        ? ``
        : `${e_min === e_max ? fmt(e_min) : `${fmt(e_min)} to ${fmt(e_max)}`} eV/atom`
    return [
      is_elemental ? `Element` : `Compound`,
      is_draw_formula && `overlay`,
      count > 0 && `${count} ${count === 1 ? `entry` : `entries`}`,
      energy,
    ]
      .filter(Boolean)
      .join(` · `)
  })
  // Bounds the domain is clipped against, grouped per side (lower first)
  const bounds = $derived.by((): [string, string[]][] => {
    if (hover_info.view === `2d`) return []
    const { touches_limits } = hover_info
    return (
      [
        [`Lower`, `lower`],
        [`Upper`, `upper`],
      ] as const
    ).flatMap(([label, side]) => {
      const elements = touches_limits.filter((bound) => bound.side === side)
      return elements.length > 0 ? [[label, elements.map(({ element }) => element)]] : []
    })
  })
</script>

<PlotTooltip
  x={hover_info.pointer?.x ?? 4}
  y={hover_info.pointer?.y ?? 4}
  {constrain_to}
  fallback_size={{ width: 200, height: 100 }}
  {bg_color}
  class="chempot-tooltip"
>
  {#if typeof tooltip === `function`}
    {@render tooltip(hover_info)}
  {:else}
    <h4>
      {#each get_formula_label_segments(domain_formula_text(hover_info.formula)) as segment, idx (idx)}
        {#if segment.subscript}<sub>{segment.text}</sub>{:else}{segment.text}{/if}
      {/each}
    </h4>
    {#if pinned}<small>Pinned · Esc to unlock</small>{/if}
    {#if summary}<p>{summary}</p>{/if}
    {#if detail_level === `detailed`}
      <!-- running text, not a two-column grid: lines fill the width and wrap early -->
      <p class="ranges">
        <span class="key">μ (eV)</span>
        {#each hover_info.axis_ranges as { element, min_val, max_val } (element)}
          <span>{element} = [{fmt(min_val)}, {fmt(max_val)}]</span>
        {/each}
      </p>
      {#if hover_info.view === `3d` && hover_info.neighbors.length > 0}
        <p>
          <span class="key">Next to</span>
          {hover_info.neighbors.slice(0, MAX_NEIGHBORS).map(domain_formula_text).join(`, `)}
          {#if hover_info.neighbors.length > MAX_NEIGHBORS}
            +{hover_info.neighbors.length - MAX_NEIGHBORS} more
          {/if}
        </p>
      {/if}
      {#each bounds as [side, elements] (side)}
        <p><span class="key">{side} bound</span> {elements.join(`, `)}</p>
      {/each}
    {/if}
  {/if}
</PlotTooltip>

<style>
  :global(.chempot-tooltip) {
    /* narrow, so the wrapping lines below fill the box instead of leaving gutters */
    --plot-tooltip-max-width: 14rem;
  }
  small {
    display: block;
  }
  /* each range stays whole and lines break between ranges, packed with the key */
  .ranges {
    display: flex;
    flex-wrap: wrap;
    column-gap: 0.5em;
    span {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
  }
</style>
