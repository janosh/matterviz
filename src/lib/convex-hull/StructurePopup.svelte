<script lang="ts">
  import type { AnyStructure } from '$lib/structure'
  import { get_electro_neg_formula } from '$lib/composition'
  import Icon from '$lib/Icon.svelte'
  import { format_num } from '$lib/labels'
  import { DragControlTab } from '$lib/overlays'
  import { sanitize_formula } from '$lib/sanitize'
  import { Structure } from '$lib/structure'
  import type { StructurePopupContext, StructurePopupStats } from './types'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { draggable } from 'svelte-multiselect/attachments'

  let {
    structure,
    place_right = true,
    width = 500,
    height = 400,
    onclose,
    stats,
    top_left,
    children,
    popup_div = $bindable(),
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
    structure: AnyStructure
    place_right?: boolean
    width?: number
    height?: number
    onclose?: () => void
    stats?: StructurePopupStats
    top_left?: Snippet<[StructurePopupContext]>
    children?: Snippet<[StructurePopupContext]>
    popup_div?: HTMLDivElement
  } = $props()

  const formula_html = $derived.by(() =>
    sanitize_formula(get_electro_neg_formula(stats?.formula ?? structure, true)),
  )
  const context = $derived({ structure, stats, formula_html })
</script>

{#snippet close_button()}
  <button class="close-btn" onclick={() => onclose?.()} title="Close (Esc)">
    <Icon icon="Cross" />
  </button>
{/snippet}

<svelte:window
  onkeydown={(event) => event.key === `Escape` && onclose?.()}
  onmousedown={(event) => {
    if (!popup_div || !(event.target instanceof Node)) return
    if (!popup_div.contains(event.target)) onclose?.()
  }}
/>

<div
  {@attach draggable({
    handle_selector: `.drag-handle`,
  })}
  {...rest}
  class={[`structure-popup`, place_right ? `right` : `left`, rest.class]}
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  bind:this={popup_div}
>
  <DragControlTab />
  <div class="structure-popup-content">
    {#if top_left || stats}
      <div class="structure-stats">
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
      </div>
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
  </div>
</div>

<style>
  .structure-popup {
    position: absolute;
    box-sizing: border-box;
    width: max-content;
    z-index: 10000;
    overflow: visible;
    top: 50%;
    transform: translateY(-50%);
  }
  .structure-popup-content {
    display: flex;
    gap: 8px;
    background: var(--surface-bg);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15);
    overflow: hidden;
  }
  .structure-popup.right {
    left: calc(100% + var(--structure-popup-gap, 1em));
  }
  .structure-popup.left {
    right: calc(100% + var(--structure-popup-gap, 1em));
  }
  .close-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    display: flex;
    padding: 0;
    font-size: inherit;
  }
  .close-btn:hover {
    background: var(--pane-btn-bg-hover);
  }
  .structure-stats {
    position: absolute;
    top: 10px;
    left: 10px;
    background: transparent;
    backdrop-filter: blur(8px);
    color: var(--text-color);
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 0.85em;
    z-index: 2;
  }
</style>
