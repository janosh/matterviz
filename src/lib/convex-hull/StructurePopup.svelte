<script lang="ts">
  import type { AnyStructure } from '$lib'
  import Icon from '$lib/Icon.svelte'
  import { format_num } from '$lib/labels'
  import { Structure } from '$lib/structure'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    structure,
    place_right = true,
    width = 500,
    height = 400,
    onclose,
    stats,
    popup_div = $bindable(),
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    structure: AnyStructure
    place_right?: boolean
    width?: number
    height?: number
    onclose?: () => void
    stats?: { id?: string; e_above_hull?: number; e_form?: number }
    popup_div?: HTMLDivElement
  } = $props()
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
  {...rest}
  class="structure-popup {place_right ? `right` : `left`} {rest.class ?? ``}"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  bind:this={popup_div}
>
  {#if stats}
    <div class="structure-stats">
      {#if stats.id}
        ID = {stats.id}<br>
      {/if}
      {#if stats.e_above_hull != null}
        E<sub>above hull</sub> = {format_num(stats.e_above_hull ?? 0, `.3~`)} eV/atom<br>
      {/if}
      {#if stats.e_form != null}
        E<sub>form</sub> = {format_num(stats.e_form || 0, `.3~`)}
        eV/atom
      {/if}
    </div>
  {/if}

  <Structure
    {structure}
    {width}
    {height}
    top_right_controls={close_button}
    show_controls
  />
</div>

<style>
  .structure-popup {
    position: absolute;
    box-sizing: border-box;
    width: 500px;
    background: var(--surface-bg);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    overflow: hidden;
    top: 50%;
    transform: translateY(-50%);
  }
  .structure-popup.right {
    left: calc(100% + 1em);
  }
  .structure-popup.left {
    right: calc(100% + 1em);
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
    background: var(--surface-bg);
    color: var(--text-color);
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 0.85em;
    z-index: 2;
  }
</style>
