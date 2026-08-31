<script lang="ts">
  // Draggable floating dialog shell shared by StructurePopup (convex hull) and
  // BrillouinZonePopup (band structure): Escape/click-outside dismissal, a drag tab and a close
  // button the caller places wherever its viewer keeps controls
  import { Icon } from 'svelte-widgets'
  import { Cross } from 'svelte-widgets/icons'
  import { click_outside, draggable } from 'svelte-widgets/attachments'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import DragControlTab from './DragControlTab.svelte'

  let {
    place = `right`,
    on_close,
    close_on_outside = true,
    show_drag_handle = true,
    arrow_x,
    children,
    popup_div = $bindable(),
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `children`> & {
    // right/left: beside the positioned ancestor, vertically centered. manual: caller positions
    // the popup itself via inline left/top styles (e.g. anchored to a clicked element)
    place?: `right` | `left` | `manual`
    on_close?: () => void
    close_on_outside?: boolean
    show_drag_handle?: boolean
    // px from the popup's left edge at which a small triangle on the bottom edge points down at
    // the anchor (a clicked tick label); omit for no arrow
    arrow_x?: number
    children?: Snippet<[{ close_button: Snippet }]>
    popup_div?: HTMLDivElement
  } = $props()
</script>

{#snippet close_button()}
  <button class="close-btn" onclick={() => on_close?.()} title="Close (Esc)">
    <Icon icon={Cross} />
  </button>
{/snippet}

<svelte:window onkeydown={(event) => event.key === `Escape` && on_close?.()} />

<!-- dismiss_on release, not the default press: this floats over a pannable plot, so starting
a pan behind it must not make it vanish under the cursor -->
<div
  {@attach click_outside({
    enabled: close_on_outside,
    dismiss_on: `release`,
    callback: () => on_close?.(),
  })}
  {@attach draggable({
    handle_selector: `.drag-handle`,
  })}
  {...rest}
  class={[`floating-popup`, place, rest.class]}
  role="dialog"
  tabindex="-1"
  bind:this={popup_div}
>
  {#if show_drag_handle}
    <DragControlTab />
  {/if}
  <div class="floating-popup-content">
    {@render children?.({ close_button })}
  </div>
  {#if arrow_x !== undefined}
    <!-- after the content so its unbordered upper half paints over the content's bottom border -->
    <div class="popup-arrow" style:left="{arrow_x}px"></div>
  {/if}
</div>

<style>
  .floating-popup {
    position: absolute;
    box-sizing: border-box;
    width: max-content;
    z-index: 10000;
    overflow: visible;
  }
  .floating-popup.right,
  .floating-popup.left {
    top: 50%;
    transform: translateY(-50%);
  }
  .floating-popup.right {
    left: calc(100% + var(--popup-gap, 1em));
  }
  .floating-popup.left {
    right: calc(100% + var(--popup-gap, 1em));
  }
  .floating-popup-content {
    display: flex;
    gap: 8px;
    background: var(--popup-bg, var(--menu-bg));
    color: var(--popup-color, var(--menu-color));
    border: 1px solid var(--popup-border, var(--menu-border));
    border-radius: 8px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15);
    overflow: hidden;
  }
  /* rotated square: its lower-right corner is the tip, only those two sides carry the border */
  .popup-arrow {
    position: absolute;
    bottom: -6px;
    width: 12px;
    height: 12px;
    transform: translateX(-50%) rotate(45deg);
    background: var(--popup-bg, var(--menu-bg));
    border-right: 1px solid var(--popup-border, var(--menu-border));
    border-bottom: 1px solid var(--popup-border, var(--menu-border));
    box-sizing: border-box;
    pointer-events: none;
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
</style>
