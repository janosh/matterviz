<script lang="ts">
  import type { AnyStructure } from '$lib/structure'
  import { get_electro_neg_formula } from '$lib/composition'
  import { format_num } from '$lib/labels'
  import { FloatingPopup, GlassChip } from '$lib/overlays'
  import { sanitize_formula } from '$lib/sanitize'
  import { Structure } from '$lib/structure'
  import type { StructurePopupContext, StructurePopupStats } from './types'
  import type { ComponentProps, Snippet } from 'svelte'

  let {
    structure,
    place_right = true,
    width = 500,
    height = 400,
    stats,
    top_left,
    children,
    popup_div = $bindable(),
    ...rest
  }: Omit<ComponentProps<typeof FloatingPopup>, `children` | `place`> & {
    structure: AnyStructure
    place_right?: boolean
    width?: number
    height?: number
    stats?: StructurePopupStats
    top_left?: Snippet<[StructurePopupContext]>
    children?: Snippet<[StructurePopupContext]>
  } = $props()

  const formula_html = $derived(
    sanitize_formula(
      get_electro_neg_formula(stats?.formula ?? structure, { plain_text: true }),
    ),
  )
  const context = $derived({ structure, stats, formula_html })
</script>

<!-- named popup_body, not children: the outer `children` prop renders inside it -->
{#snippet popup_body({ close_button }: { close_button: Snippet })}
  {#if top_left || stats}
    <GlassChip class="structure-stats">
      {#if top_left}
        {@render top_left(context)}
      {:else if stats}
        {#if stats.id}
          ID = {stats.id}<br />
        {/if}
        {#if formula_html}
          {@html formula_html}<br />
        {/if}
        {#if stats.e_above_hull != null}
          E<sub>above hull</sub> = {format_num(stats.e_above_hull, `.3~`)} eV/atom<br />
        {/if}
        {#if stats.e_form != null}
          E<sub>form</sub> = {format_num(stats.e_form, `.3~`)}
          eV/atom
        {/if}
      {/if}
    </GlassChip>
  {/if}

  <Structure
    {structure}
    {width}
    {height}
    top_right_controls={close_button}
    show_controls="hover"
    style="--struct-width: {width}px; --struct-height: {height}px; --struct-min-width: 0"
  />
  {@render children?.(context)}
{/snippet}

<FloatingPopup
  {...rest}
  class={[`structure-popup`, rest.class]}
  place={place_right ? `right` : `left`}
  bind:popup_div
  children={popup_body}
/>
