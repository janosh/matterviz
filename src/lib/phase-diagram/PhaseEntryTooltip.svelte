<script lang="ts">
  import type { ElementSymbol } from '$lib'
  import { is_unary_entry } from '$lib'
  import { elem_symbol_to_name, get_electro_neg_formula } from '$lib/composition'
  import { format_fractional, format_num } from '$lib/labels'
  import { calculate_polymorph_stats } from './helpers'
  import type { PhaseData } from './types'

  let { entry, all_entries }: { entry: PhaseData; all_entries?: PhaseData[] } =
    $props()

  const is_element = $derived(is_unary_entry(entry))
  const elem_symbol = $derived(
    is_element ? (Object.keys(entry.composition)[0] as ElementSymbol) : ``,
  )
  const elem_name = $derived(
    is_element && elem_symbol ? elem_symbol_to_name[elem_symbol] ?? `` : ``,
  )
  const polymorph_stats = $derived(
    all_entries ? calculate_polymorph_stats(entry, all_entries) : null,
  )
</script>

<div class="tooltip-title">
  {#if entry.entry_id}
    <strong>ID: {entry.entry_id}</strong>
  {/if}
  {@html get_electro_neg_formula(entry.composition)}{
    is_element && elem_name ? ` (${elem_name})` : ``
  }
</div>

<div>E<sub>above hull</sub>: {format_num(entry.e_above_hull ?? 0, `.3~`)} eV/atom</div>
<div>E<sub>form</sub>: {format_num(entry.e_form_per_atom ?? 0, `.3~`)} eV/atom</div>

{#if !is_element}
  {@const total = Object.values(entry.composition).reduce((sum, amt) => sum + amt, 0)}
  {@const fractions = Object.entries(entry.composition)
    .filter(([, amt]) => amt > 0)
    .map(([el, amt]) => `${el}${format_fractional(amt / total)}`)}
  {#if fractions.length > 1}
    Fractional: {fractions.join(` `)}
  {/if}
{/if}

{#if polymorph_stats}
  <div
    class="polymorphs"
    title="Total structures with same fractional composition. ↑ = higher energy (less stable), ↓ = lower energy (more stable), = equal energy"
  >
    Polymorphs:
    {polymorph_stats.total}
    <span title="{polymorph_stats.higher} higher in energy">↑{
        polymorph_stats.higher
      }</span>
    <span title="{polymorph_stats.lower} lower in energy">↓{polymorph_stats.lower}</span>
    <span title="{polymorph_stats.equal} equal in energy">={polymorph_stats.equal}</span>
  </div>
{/if}

<style>
  .tooltip-title {
    margin-bottom: 2px;
  }
  .polymorphs span {
    margin-left: 3px;
  }
</style>
