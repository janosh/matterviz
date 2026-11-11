<script lang="ts">
  import type { ShowControlsState } from '#lib/controls.js'
  import type { Snippet } from 'svelte'
  import type { Attachment } from 'svelte/attachments'
  import type { ClassValue } from 'svelte/elements'

  let {
    controls_config,
    fullscreen = false,
    height = $bindable(0),
    class: class_name,
    children,
  }: {
    controls_config: ShowControlsState
    fullscreen?: boolean // Keep the hidden active fullscreen controller mounted until exit.
    height?: number
    class?: ClassValue
    children: Snippet
  } = $props()

  // flex: 1 shrinks the step slider to nothing instead of wrapping, so it gets its own row once
  // the controls beside it leave it narrower than its flex-basis (--sequence-slider-min-width).
  // The wrap follows what the bar holds, not a fixed width. Siblings are measured as laid out:
  // they only shrink while sharing the slider's row, so both layouts are stable (no flip-flop).
  let stack_step = $state(false)
  // computed lengths resolve to px; keywords such as a `normal` gap count as 0, so the slider's
  // flex-basis must be a length
  const px = (value: string): number => Number(value.replace(/px$/, ``)) || 0
  // the elements' summed widths plus one gap after each that takes up space. Margins don't
  // count: an auto margin (e.g. pushing buttons to the bar's end) resolves to the free space,
  // which would keep a stacked bar stacked however wide it grew.
  const row_width = (elements: Element[], gap: string): number =>
    elements.reduce((sum, el) => {
      const out_of_flow = [`absolute`, `fixed`].includes(getComputedStyle(el).position)
      const width = out_of_flow ? 0 : el.getBoundingClientRect().width
      return width ? sum + width + px(gap) : sum
    }, 0)
  const fit_step_row: Attachment<HTMLElement> = (bar) => {
    const update = () => {
      const step = bar.querySelector(`:scope > .step-section`)
      const slider = step?.querySelector(`.slider-container`)
      if (!step || !slider) return (stack_step = false)
      const { paddingInlineStart, paddingInlineEnd, columnGap } = getComputedStyle(bar)
      const others = [...bar.children].filter((child) => child !== step)
      const step_labels = [...step.children].filter((child) => child !== slider)
      const room =
        bar.clientWidth -
        px(paddingInlineStart) -
        px(paddingInlineEnd) -
        row_width(others, columnGap) -
        row_width(step_labels, getComputedStyle(step).columnGap)
      stack_step = room < px(getComputedStyle(slider).flexBasis)
    }
    const resize = new ResizeObserver(update)
    // re-observe as controls mount and unmount (panes, menus, the step section itself)
    const observe = () => {
      resize.disconnect()
      const step = bar.querySelector(`:scope > .step-section`)
      for (const element of [bar, ...bar.children, ...(step?.children ?? [])])
        resize.observe(element)
    }
    const mutations = new MutationObserver(observe)
    mutations.observe(bar, { childList: true })
    observe()
    return () => {
      resize.disconnect()
      mutations.disconnect()
    }
  }
</script>

{#if controls_config.mode !== `never` || fullscreen}
  <section
    class={[`sequence-control-bar`, controls_config.class, class_name, { stack_step }]}
    {@attach fit_step_row}
    bind:clientHeight={height}
    style={controls_config.mode === `never` ? `display: none` : controls_config.style}
  >
    {@render children()}
  </section>
{/if}

<style>
  .sequence-control-bar {
    position: relative;
    display: flex;
    align-items: center;
    /* items wrap only once they overflow; fit_step_row gives the slider its own row */
    flex-wrap: var(--sequence-controls-wrap, wrap);
    gap: var(--sequence-controls-gap, clamp(4pt, 1.6cqw, 1.5ex));
    width: 100%;
    min-width: 0;
    padding: var(--sequence-controls-padding, clamp(2pt, 0.5cqw, 1ex) clamp(4pt, 1cqw, 1.2ex));
    box-sizing: border-box;
    z-index: var(--sequence-controls-z-index, var(--z-index-viewer-pane, 10));
    /* docked on the viewer's top edge: the content below meets its bottom edge square */
    border-radius: var(--sequence-controls-border-radius, 4px 4px 0 0);
    background: var(
      --sequence-controls-bg,
      var(--surface-bg-hover, light-dark(#f4f4f5, #2a2c33))
    );
    color: var(--sequence-controls-color, light-dark(#1a1a1a, #e8e8e8));
    font-size: var(--sequence-controls-font-size, 0.85rem);
    backdrop-filter: blur(4px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    --icon-size: var(--sequence-controls-icon-size, var(--ctrl-btn-icon-size, 1rem));
    &.hover-visible {
      position: absolute;
      inset: 0 0 auto;
    }
    &.always-visible {
      opacity: 1;
      pointer-events: auto;
    }
    &:focus-within {
      z-index: var(--sequence-controls-focus-z-index, var(--z-index-viewer-dropdown, 100));
    }
    :global(button > svg) {
      width: var(--icon-size);
      height: var(--icon-size);
    }
    :global(.fullscreen-button) {
      --fullscreen-btn-padding: 0;
      --fullscreen-btn-bg: transparent;
    }
    &.stack_step > :global(.step-section) {
      flex-basis: 100%;
      order: 1;
    }
  }
  :global(:is(:hover, :focus-within)) > .sequence-control-bar.hover-visible {
    opacity: 1;
    pointer-events: auto;
  }
  /* Finger-sized hit areas for every control in the bar. Icons and text keep their size;
     the bar grows from ~20px to 32px rows only on coarse pointers. */
  @media (pointer: coarse) {
    .sequence-control-bar :global(:is(button, select, input[type='number'])) {
      min-height: 32px;
      box-sizing: border-box;
    }
    .sequence-control-bar :global(button) {
      min-width: 32px;
    }
    .sequence-control-bar :global(input[type='range']) {
      height: 32px; /* the track stays thin; this is the touchable strip around it */
    }
  }
</style>
