<script lang="ts">
  import { Icon } from '$lib'
  import type { IconName } from '$lib/icons'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props {
    controls_open?: boolean // Whether the control panel is open
    show_controls?: boolean // Whether to show the control panel at all
    controls_content?: Snippet<[]> // Custom content to render inside the panel
    toggle_button?: HTMLAttributes<HTMLButtonElement> // Props for the toggle button
    panel_props?: HTMLAttributes<HTMLDivElement> // Props for the control panel dialog
    show_toggle_button?: boolean // Whether the toggle button should be shown
    open_icon?: IconName // Custom icon for open state
    closed_icon?: IconName // Custom icon for closed state
    toggle_controls_btn?: HTMLButtonElement // Toggle button DOM element
    controls_div?: HTMLDivElement // Control panel DOM element
    icon_style?: string // Style for the icon
  }
  let {
    controls_open = $bindable(false),
    show_controls = true,
    controls_content,
    toggle_button = {},
    panel_props = {},
    show_toggle_button = true,
    open_icon = `Cross`,
    closed_icon = `Settings`,
    toggle_controls_btn,
    controls_div,
    icon_style = `width: 24px; height: 24px`,
  }: Props = $props()

  const [panel_class, toggle_class] = [`controls-panel`, `controls-toggle`]

  function on_keydown(event: KeyboardEvent) {
    if (event.key === `Escape`) controls_open = false
  }
  function toggle_controls() {
    controls_open = !controls_open
  }
  function handle_click_outside(event: MouseEvent) {
    if (!controls_open) return

    const target = event.target as Element
    const control_panel = target.closest(`.${panel_class}`)
    const toggle_btn = target.closest(`.${toggle_class}`)

    // Don't close if clicking inside panel or on toggle button
    if (!control_panel && !toggle_btn) controls_open = false
  }
</script>

<svelte:window onkeydown={on_keydown} />
<svelte:document onclick={handle_click_outside} />

{#if show_controls}
  {#if show_toggle_button}
    <button
      bind:this={toggle_controls_btn}
      onclick={toggle_controls}
      aria-expanded={controls_open}
      aria-controls="controls-panel"
      title={toggle_button.title ?? (controls_open ? `Close controls` : `Open controls`)}
      {...toggle_button}
      class="{toggle_class} {toggle_button.class ?? ``}"
    >
      <Icon icon={controls_open ? open_icon : closed_icon} style={icon_style} />
    </button>
  {/if}

  <div
    class:controls-open={controls_open}
    bind:this={controls_div}
    role="dialog"
    {...panel_props}
    class="{panel_class} {panel_props.class ?? ``}"
  >
    {#if controls_content}
      {@render controls_content()}
    {/if}
  </div>
{/if}

<style>
  .controls-toggle {
    background-color: transparent;
    width: 30px;
    height: 30px;
    box-sizing: border-box;
    display: flex;
    place-items: center;
    padding: 4pt 4pt;
    border-radius: 50%;
  }
  .controls-toggle:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }
  .controls-panel {
    position: absolute;
    left: unset;
    background: transparent;
    border: none;
    display: grid;
    gap: var(--controls-gap, 4pt);
    text-align: var(--controls-text-align, left);
    transition: var(--controls-transition, 0.3s);
    box-sizing: border-box;
    top: var(--controls-top, 20pt);
    right: var(--controls-right, 6pt);
    background: var(--controls-bg, rgba(10, 10, 10, 0.95));
    padding: var(--controls-padding, 6pt 9pt);
    border-radius: var(--controls-border-radius, 3pt);
    width: var(--controls-width, 20em);
    max-width: var(--controls-max-width, 90cqw);
    color: var(--controls-text-color);
    overflow: auto;
    max-height: var(--controls-max-height, calc(100vh - 3em));
    visibility: hidden;
    opacity: 0;
    z-index: var(--controls-z-index, 1);
    pointer-events: none;
  }
  .controls-panel.controls-open {
    visibility: visible !important;
    opacity: 1 !important;
    pointer-events: auto !important;
  }
  .controls-panel :global(hr) {
    border: none;
    background: var(--controls-hr-bg, gray);
    margin: var(--controls-hr-margin, 0);
    height: var(--controls-hr-height, 0.5px);
  }
  .controls-panel :global(label) {
    display: flex;
    align-items: center;
    gap: var(--controls-label-gap, 2pt);
  }
  .controls-panel :global(input[type='range']) {
    margin-left: auto;
    width: var(--controls-input-range-width, 100px);
    flex-shrink: 0;
  }
  .controls-panel :global(.slider-control input[type='range']) {
    margin-left: 0;
  }
  .controls-panel :global(input[type='number']) {
    box-sizing: border-box;
    text-align: center;
    border-radius: var(--controls-input-num-border-radius, 3pt);
    width: var(--controls-input-num-width, 2.2em);
    border: var(--controls-input-num-border, none);
    background: var(--controls-input-num-bg, rgba(255, 255, 255, 0.15));
    margin-right: 3pt;
    margin-left: var(--controls-input-num-margin-left, 6pt);
    flex-shrink: 0;
  }
  .controls-panel :global(input::-webkit-inner-spin-button) {
    display: none;
  }
  .controls-panel :global(button) {
    width: max-content;
    background-color: var(--controls-btn-bg, rgba(255, 255, 255, 0.2));
  }
  .controls-panel :global(select) {
    margin: var(--controls-select-margin, 0 0 0 5pt);
    color: var(--controls-select-color, white);
    background-color: var(--controls-select-bg, rgba(255, 255, 255, 0.1));
  }
  .controls-panel :global(input[type='color']) {
    width: var(--input-color-width, 40px);
    height: var(--input-color-height, 16px);
    margin: var(--input-color-margin, 0 0 0 5pt);
    border: var(--input-color-border, 1px solid rgba(255, 255, 255, 0.05));
    box-sizing: border-box;
  }
  .controls-panel :global(.section-heading) {
    margin: 8pt 0 2pt;
    font-size: 0.9em;
    color: var(--text-muted, #ccc);
  }
  .controls-panel :global(.control-row) {
    display: flex;
    gap: 4pt;
    align-items: flex-start;
  }
  .controls-panel :global(.control-row label) {
    min-width: 0;
  }
  .controls-panel :global(.control-row label.compact) {
    flex: 0 0 auto;
    margin-right: 8pt;
  }
  .controls-panel :global(.control-row label.slider-control) {
    flex: 1;
  }
</style>
