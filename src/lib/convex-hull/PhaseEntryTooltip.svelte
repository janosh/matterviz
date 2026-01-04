<script lang="ts">
  import type { ElementSymbol } from '$lib/element'
  import { is_unary_entry } from './types'
  import { ELEM_SYMBOL_TO_NAME, get_electro_neg_formula } from '$lib/composition'
  import { format_fractional, format_num } from '$lib/labels'
  import type { PolymorphStats } from './helpers'
  import type { HighlightStyle, PhaseData } from './types'

  let { entry, polymorph_stats_map, highlight_style }: {
    entry: PhaseData
    polymorph_stats_map?: Map<string, PolymorphStats>
    highlight_style?: HighlightStyle // Applied when entry is highlighted
  } = $props()

  const is_element = $derived(is_unary_entry(entry))
  const elem_symbol = $derived(
    is_element ? (Object.keys(entry.composition)[0] as ElementSymbol) : ``,
  )
  const elem_name = $derived(
    is_element && elem_symbol ? ELEM_SYMBOL_TO_NAME[elem_symbol] ?? `` : ``,
  )
  // O(1) lookup of pre-computed polymorph stats
  const polymorph_stats = $derived(
    entry.entry_id && polymorph_stats_map
      ? polymorph_stats_map.get(entry.entry_id)
      : null,
  )
</script>

<div class="tooltip-content" style:--highlight-color={highlight_style?.color}>
  {#if highlight_style}
    <span class="highlight-badge">★ Highlighted</span>
  {/if}

  <div class="tooltip-title">
    {#if entry.entry_id}
      <strong style="display: block">ID: {entry.entry_id}</strong>
    {/if}
    <strong style="display: block">
      {@html get_electro_neg_formula(entry.composition)}{
        is_element && elem_name ? ` (${elem_name})` : ``
      }
    </strong>
  </div>

  <div>E<sub>above hull</sub>: {format_num(entry.e_above_hull ?? 0, `.3~`)} eV/atom</div>
  <div>E<sub>form</sub>: {format_num(entry.e_form_per_atom ?? 0, `.3~`)} eV/atom</div>

  {#if !is_element}
    {@const total = Object.values(entry.composition).reduce((sum, amt) => sum + amt, 0)}
    {@const fractions = Object.entries(entry.composition)
      .filter(([, amt]) => amt > 0)
      .map(([el, amt]) => `${el}${format_fractional(amt / total)}`)}
    {#if fractions.length > 1}
      <div>Fractional: {fractions.join(` `)}</div>
    {/if}
  {/if}

  {#if polymorph_stats}
    {@const { total, higher, lower, equal } = polymorph_stats}
    <div
      class="polymorphs"
      title="Total structures with same fractional composition. ↑ = higher energy (less stable), ↓ = lower energy (more stable), = equal energy"
    >
      Polymorphs:
      {total}
      {#if total > 0}
        <span title="{higher} higher in energy">↑{higher}</span>
        <span title="{lower} lower in energy">↓{lower}</span>
        {#if equal > 0}
          <span title="{equal} equal in energy">={equal}</span>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .highlight-badge {
    display: block;
    font-size: 0.75em;
    font-weight: 600;
    color: var(--highlight-color, #ff2222);
    margin-bottom: 4px;
  }
  .tooltip-title {
    margin-bottom: 2px;
  }
  .polymorphs span {
    margin-left: 3px;
  }
</style>
