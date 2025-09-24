<script lang="ts">
  import type { AnyStructure } from '$lib'
  import { format_num } from '$lib/labels'
  import { Structure } from '$lib/structure'

  interface Props {
    structure: AnyStructure
    place_right?: boolean
    width?: number
    height?: number
    onclose?: () => void
    stats?: { id?: string; e_above_hull?: number; e_form?: number }
  }
  let {
    structure,
    place_right = true,
    width = 500,
    height = 400,
    onclose,
    stats,
  }: Props = $props()

  const handle_keydown = (event: KeyboardEvent) => {
    if (event.key === `Escape`) onclose?.()
  }

  let popup_div = $state<HTMLDivElement | null>(null)

  function handle_click_outside(event: MouseEvent) {
    if (!popup_div) return
    const target = event.target as HTMLElement
    const clicked_inside = target === popup_div || popup_div.contains(target)
    if (!clicked_inside) onclose?.()
  }
</script>

<svelte:window onkeydown={handle_keydown} />
<svelte:document onclick={handle_click_outside} />

<div
  class="structure-popup {place_right ? `right` : `left`}"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  bind:this={popup_div}
>
  <button class="close-btn" onclick={() => onclose?.()}>×</button>

  {#if stats}
    <div class="structure-stats">
      {#if stats.id}
        ID = {stats.id}<br>
      {/if}
      {#if stats.e_above_hull != null}
        E<sub style="font-size: 0.8em; baseline: 0.5em">above hull</sub> = {
          format_num(stats.e_above_hull || 0, `.3~`)
        } eV/atom<br>
      {/if}
      {#if stats.e_form != null}
        E<sub style="font-size: 0.8em">form</sub> = {format_num(stats.e_form || 0, `.3~`)}
        eV/atom
      {/if}
    </div>
  {/if}

  <Structure
    {structure}
    show_controls={false}
    enable_info_pane={false}
    allow_file_drop={false}
    fullscreen_toggle={false}
    {width}
    {height}
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
    position: absolute;
    top: 10px;
    right: 10px;
    width: 30px;
    height: 30px;
    background: rgba(0, 0, 0, 0.5);
    color: white;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    z-index: 2;
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .close-btn:hover {
    background: rgba(0, 0, 0, 0.7);
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
