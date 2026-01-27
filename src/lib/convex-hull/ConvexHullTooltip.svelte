<script lang="ts" generics="EntryT extends PhaseData = PhaseData">
  // Unified tooltip component for convex hull diagrams
  import { ELEM_SYMBOL_TO_NAME, get_electro_neg_formula } from '$lib/composition'
  import type { ElementSymbol } from '$lib/element'
  import { format_num } from '$lib/labels'
  import { TooltipContent } from '$lib/tooltip'
  import type { PolymorphStats } from './helpers'
  import type { ConvexHullTooltipProp, TooltipSnippetProps } from './index'
  import type { HighlightStyle, PhaseData } from './types'
  import { is_unary_entry } from './types'

  let {
    entry,
    polymorph_stats_map,
    highlight_style,
    tooltip,
    show_fractional = true,
  }: {
    entry: EntryT
    polymorph_stats_map?: Map<string, PolymorphStats>
    highlight_style?: HighlightStyle
    tooltip?: ConvexHullTooltipProp<EntryT>
    show_fractional?: boolean
  } = $props()

  const is_element = $derived(is_unary_entry(entry))
  const elem_symbol = $derived(
    is_element
      ? (Object.entries(entry.composition).find(([, n]) => n > 0)?.[0] ?? ``)
      : ``,
  ) as ElementSymbol | ``
  const elem_name = $derived(elem_symbol && ELEM_SYMBOL_TO_NAME[elem_symbol])
  const polymorph_stats = $derived(
    entry.entry_id && polymorph_stats_map
      ? polymorph_stats_map.get(entry.entry_id)
      : null,
  )
</script>

<TooltipContent
  data={entry}
  snippet_arg={{ entry, highlight_style } as TooltipSnippetProps<EntryT>}
  {tooltip}
>
  <div class="tooltip-content" style:--highlight-color={highlight_style?.color}>
    {#if highlight_style}
      <span class="highlight-badge">★ Highlighted</span>
    {/if}

    <div class="tooltip-title">
      {#if entry.entry_id}
        <strong style="display: block">
          {entry.entry_id}{is_element && elem_name ? ` (${elem_name})` : ``}
        </strong>
      {/if}
      {#if !is_element || !entry.entry_id}
        <strong style="display: block">
          {@html get_electro_neg_formula(entry.composition)}
        </strong>
      {/if}
    </div>

    {#if entry.e_above_hull != null}
      <div>
        E<sub>above hull</sub>: {format_num(entry.e_above_hull, `.3~`)} eV/atom
      </div>
    {/if}
    {#if entry.e_form_per_atom != null}
      <div>E<sub>form</sub>: {format_num(entry.e_form_per_atom, `.3~`)} eV/atom</div>
    {/if}

    {#if show_fractional && !is_element}
      {@const total = Object.values(entry.composition).reduce(
        (sum, amt) => sum + amt,
        0,
      )}
      {#if total > 0}
        {@const fractions = Object.entries(entry.composition)
        .filter(([, amt]) => amt > 0)
        .map(([el, amt]) => `${el}<sub>${format_num(amt / total, `.2~`)}</sub>`)}
        {#if fractions.length > 1}
          <div>Fractional: {@html fractions.join(` `)}</div>
        {/if}
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
</TooltipContent>

<style>
  .tooltip-content {
    max-width: var(--tooltip-max-width, 200px);
  }
  .tooltip-content > div {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
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
