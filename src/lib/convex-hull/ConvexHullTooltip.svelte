<script lang="ts" generics="EntryT extends PhaseData = PhaseData">
  // Unified tooltip component for convex hull diagrams
  // Handles: custom snippets, prefix/suffix config, and default content
  import { ELEM_SYMBOL_TO_NAME, get_electro_neg_formula } from '$lib/composition'
  import type { ElementSymbol } from '$lib/element'
  import { format_num } from '$lib/labels'
  import type { Snippet } from 'svelte'
  import type { PolymorphStats } from './helpers'
  import type { TooltipConfig, TooltipSnippetProps } from './index'
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
    tooltip?: Snippet<[TooltipSnippetProps<EntryT>]> | TooltipConfig<EntryT>
    show_fractional?: boolean
  } = $props()

  // Custom tooltip handling
  const is_snippet = $derived(typeof tooltip === `function`)
  const config = $derived(
    !is_snippet && tooltip ? (tooltip as TooltipConfig<EntryT>) : null,
  )
  const prefix_html = $derived(
    typeof config?.prefix === `function` ? config.prefix(entry) : config?.prefix,
  )
  const suffix_html = $derived(
    typeof config?.suffix === `function` ? config.suffix(entry) : config?.suffix,
  )
  const tooltip_snippet = $derived(
    is_snippet ? (tooltip as Snippet<[TooltipSnippetProps<EntryT>]>) : null,
  )

  // Default tooltip content
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

{#if tooltip_snippet}
  {@render tooltip_snippet({ entry, highlight_style })}
{:else}
  {#if prefix_html}
    <div class="tooltip-prefix">{@html prefix_html}</div>
  {/if}

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

    <div>
      E<sub>above hull</sub>: {format_num(entry.e_above_hull ?? 0, `.3~`)} eV/atom
    </div>
    <div>E<sub>form</sub>: {format_num(entry.e_form_per_atom ?? 0, `.3~`)} eV/atom</div>

    {#if show_fractional && !is_element}
      {@const total = Object.values(entry.composition).reduce((sum, amt) => sum + amt, 0)}
      {@const fractions = Object.entries(entry.composition)
      .filter(([, amt]) => amt > 0)
      .map(([el, amt]) => `${el}<sub>${format_num(amt / total, `.2~`)}</sub>`)}
      {#if fractions.length > 1}
        <div>Fractional: {@html fractions.join(` `)}</div>
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

  {#if suffix_html}
    <div class="tooltip-suffix">{@html suffix_html}</div>
  {/if}
{/if}

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
