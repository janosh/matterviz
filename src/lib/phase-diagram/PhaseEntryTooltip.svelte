<script lang="ts">
  import type { ElementSymbol } from '$lib'
  import { is_unary_entry } from '$lib'
  import { elem_symbol_to_name, get_electro_neg_formula } from '$lib/composition'
  import { format_fractional, format_num } from '$lib/labels'
  import type { PhaseEntry } from './types'

  let { entry }: { entry: PhaseEntry } = $props()

  const is_element = $derived(is_unary_entry(entry))
  const elem_symbol = $derived(
    is_element ? (Object.keys(entry.composition)[0] as ElementSymbol) : ``,
  )
  const elem_name = $derived(
    is_element && elem_symbol ? elem_symbol_to_name[elem_symbol] ?? `` : ``,
  )
</script>

<div class="tooltip-title">
  {@html get_electro_neg_formula(entry.composition)}{
    is_element && elem_name ? ` (${elem_name})` : ``
  }
</div>

<div>E<sub>above hull</sub>: {format_num(entry.e_above_hull ?? 0, `.3~`)} eV/atom</div>
<div>E<sub>form</sub>: {format_num(entry.e_form_per_atom ?? 0, `.3~`)} eV/atom</div>

{#if entry.entry_id}
  <div class="entry-id">ID: {entry.entry_id}</div>
{/if}

{#if !is_element}
  {@const total = Object.values(entry.composition).reduce((sum, amt) => sum + amt, 0)}
  {@const fractions = Object.entries(entry.composition)
    .filter(([, amt]) => amt > 0)
    .map(([el, amt]) => `${el}${format_fractional(amt / total)}`)}
  {#if fractions.length > 1}
    Fractional: {fractions.join(` `)}
  {/if}
{/if}

<style>
  .tooltip-title {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .entry-id {
    font-size: 0.9em;
    opacity: 0.8;
    margin-top: 4px;
  }
</style>
