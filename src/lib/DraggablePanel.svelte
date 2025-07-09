<script lang="ts">
  import { Icon } from '$lib'
  import type { IconName } from '$lib/icons'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { draggable } from './attachments'

  interface Props {
    show?: boolean
    show_panel?: boolean
    children: Snippet<[]>
    // Toggle button
    toggle_props?: HTMLAttributes<HTMLButtonElement>
    open_icon?: IconName
    closed_icon?: IconName
    icon_style?: string
    // Panel positioning and styling
    offset?: { x?: number; y?: number }
    max_width?: string
    panel_props?: HTMLAttributes<HTMLDivElement>
    // Callbacks
    onclose?: () => void
    on_drag_start?: () => void
    custom_toggle?: () => void
    // Bindable state
    toggle_panel_btn?: HTMLButtonElement
    panel_div?: HTMLDivElement
    has_been_dragged?: boolean
    currently_dragging?: boolean
  }

  let {
    show = $bindable(false),
    show_panel = true,
    children,
    toggle_props = {},
    open_icon = `Cross`,
    closed_icon = `Settings`,
    icon_style = ``,
    offset = { x: 5, y: 5 },
    max_width = `450px`,
    panel_props = {},
    onclose = () => {},
    on_drag_start = () => {},
    custom_toggle = undefined,
    toggle_panel_btn,
    panel_div,
    has_been_dragged = $bindable(false),
    currently_dragging = $bindable(false),
  }: Props = $props()

  let initial_position = $state({ left: `50px`, top: `50px` })
  let show_control_buttons = $state(false)

  // Keyboard shortcuts
  function on_keydown(event: KeyboardEvent) {
    if (event.key === `Escape`) {
      event.preventDefault()
      close_panel()
    }
  }

  // Panel actions
  function toggle_panel() {
    show = !show
    if (!show) onclose()
  }

  function close_panel() {
    show = false
    onclose()
  }

  function reset_position() {
    if (toggle_panel_btn) {
      const pos = calculate_position()
      initial_position = pos
      if (panel_div) {
        Object.assign(panel_div.style, {
          left: pos.left,
          top: pos.top,
          right: `auto`,
          bottom: `auto`,
          width: ``,
        })
      }
    }
    // Hide the control buttons after reset
    show_control_buttons = false
    has_been_dragged = false
  }

  // Drag handlers
  function handle_drag_start() {
    has_been_dragged = true
    show_control_buttons = true
    currently_dragging = true
    on_drag_start()
  }

  function handle_drag_end() {
    currently_dragging = false
  }

  // Position calculation
  function calculate_position() {
    if (!toggle_panel_btn) return { left: `50px`, top: `50px` }

    const toggle_rect = toggle_panel_btn.getBoundingClientRect()
    const panel_width = panel_div?.getBoundingClientRect().width || 450
    const positioned_ancestor = toggle_panel_btn.offsetParent as HTMLElement
    const ancestor_rect = positioned_ancestor?.getBoundingClientRect()

    if (!ancestor_rect) {
      // Fallback to document positioning
      const scroll_x = window.scrollX || document.documentElement.scrollLeft
      const scroll_y = window.scrollY || document.documentElement.scrollTop
      return {
        left: `${toggle_rect.right - panel_width + (offset.x ?? 5) + scroll_x}px`,
        top: `${toggle_rect.bottom + (offset.y ?? 5) + scroll_y}px`,
      }
    }

    // Position relative to positioned ancestor
    return {
      left: `${
        toggle_rect.right - ancestor_rect.left - panel_width + (offset.x ?? 5)
      }px`,
      top: `${toggle_rect.bottom - ancestor_rect.top + (offset.y ?? 5)}px`,
    }
  }

  // Click outside handler
  function handle_click_outside(event: MouseEvent) {
    if (!show) return

    const target = event.target as HTMLElement
    const is_toggle_button = toggle_panel_btn &&
      (target === toggle_panel_btn || toggle_panel_btn.contains(target))
    const is_inside_panel = panel_div &&
      (target === panel_div || panel_div.contains(target))

    if (
      !is_toggle_button && !is_inside_panel && !has_been_dragged &&
      !currently_dragging
    ) {
      close_panel()
    }
  }

  // Button click handler
  function handle_button_click(event: MouseEvent, action: () => void) {
    event.stopPropagation()
    action()
  }

  // Position panel when shown
  $effect(() => {
    if (show && toggle_panel_btn && !has_been_dragged) {
      const pos = calculate_position()
      initial_position = pos
      if (panel_div) {
        Object.assign(panel_div.style, {
          left: pos.left,
          top: pos.top,
          right: `auto`,
          bottom: `auto`,
        })
      }
    }
  })
</script>

<svelte:window onkeydown={on_keydown} />
<svelte:document onclick={handle_click_outside} />

{#if show_panel}
  <button
    bind:this={toggle_panel_btn}
    onclick={(event) => handle_button_click(event, custom_toggle || toggle_panel)}
    aria-expanded={show}
    aria-controls="draggable-panel"
    title={toggle_props.title ?? (show ? `Close panel` : `Open panel`)}
    {...toggle_props}
    class="panel-toggle {toggle_props.class ?? ``}"
  >
    <Icon icon={show ? open_icon : closed_icon} style={icon_style} />
  </button>

  <div
    {@attach draggable({
      handle_selector: `.drag-handle`,
      on_drag_start: handle_drag_start,
      on_drag_end: handle_drag_end,
    })}
    bind:this={panel_div}
    role="dialog"
    aria-label="Draggable panel"
    aria-modal="false"
    style:max-width={max_width}
    style:top={initial_position.top}
    style:left={initial_position.left}
    style:display={show ? `grid` : `none`}
    {...panel_props}
    class="draggable-panel {show ? `panel-open` : ``} {panel_props.class ?? ``}"
  >
    <div class="panel-header">
      <div class="control-buttons">
        {#if show_control_buttons}
          <button
            class="reset-button"
            onclick={(event) => handle_button_click(event, reset_position)}
            title="Reset panel position"
            aria-label="Reset panel position"
          >
            <Icon icon="Reset" style="width: 1.25em; height: 1.25em" />
          </button>
          <button
            class="close-button"
            onclick={(event) => handle_button_click(event, close_panel)}
            title="Close panel"
            aria-label="Close panel"
          >
            <Icon icon="Cross" style="width: 1.25em; height: 1.25em" />
          </button>
        {/if}
        <Icon
          icon="DragIndicator"
          class="drag-handle"
          style="width: 1.25em; height: 1.25em"
        />
      </div>
    </div>

    {@render children()}
  </div>
{/if}

<style>
  .panel-toggle {
    width: 30px;
    height: 30px;
    box-sizing: border-box;
    display: flex;
    place-items: center;
    padding: 4pt;
    border-radius: var(--panel-toggle-border-radius, 3pt);
    background-color: transparent;
    transition: background-color 0.2s;
  }
  .panel-toggle:hover {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
  }
  .draggable-panel {
    position: absolute; /* Use absolute so panel scrolls with page content */
    background: var(--panel-bg, rgba(15, 23, 42, 0.95));
    border: 1px solid var(--panel-border, rgba(255, 255, 255, 0.15));
    border-radius: 6px;
    padding: 5px 15px 15px;
    box-sizing: border-box;
    z-index: 10;
    display: grid;
    gap: 4pt;
    text-align: left;
    /* Exclude position from being transitioned to prevent sluggish dragging */
    transition: opacity 0.3s, background-color 0.3s, border-color 0.3s, box-shadow 0.3s;
    width: 28em;
    max-width: 90cqw;
    overflow: auto;
    max-height: calc(100vh - 3em);
    pointer-events: auto;
  }
  :global(body.fullscreen) .draggable-panel {
    position: fixed !important; /* In fullscreen, we want viewport-relative positioning */
    top: 3.3em !important;
    right: 1em !important;
    left: auto !important;
  }
  /* Panel content styling */
  .draggable-panel :global(hr) {
    border: none;
    background: var(--panel-hr-bg, rgba(255, 255, 255, 0.1));
    margin: 0;
    height: 0.5px;
  }
  .draggable-panel :global(label) {
    display: flex;
    align-items: center;
    gap: 2pt;
  }
  .draggable-panel :global(input[type='range']) {
    margin-left: auto;
    width: 100px;
    flex-shrink: 0;
  }
  .draggable-panel :global(.slider-control input[type='range']) {
    margin-left: 0;
  }
  .draggable-panel :global(input[type='number']) {
    box-sizing: border-box;
    text-align: center;
    border-radius: 3pt;
    width: 2.2em;
    margin: 0 3pt 0 6pt;
    flex-shrink: 0;
  }
  .draggable-panel :global(input::-webkit-inner-spin-button) {
    display: none;
  }
  .draggable-panel :global(button) {
    width: max-content;
    background-color: var(--panel-btn-bg, rgba(255, 255, 255, 0.1));
  }
  .draggable-panel :global(button:hover) {
    background-color: var(--panel-btn-hover-bg, rgba(255, 255, 255, 0.2));
  }
  .draggable-panel :global(select) {
    margin: 0 0 0 5pt;
  }
  .draggable-panel :global(input[type='color']) {
    width: 40px;
    height: 16px;
    margin: 0 0 0 5pt;
    border: 1px solid rgba(255, 255, 255, 0.05);
    box-sizing: border-box;
  }
  .draggable-panel :global(.section-heading) {
    margin: 8pt 0 2pt;
    font-size: 0.9em;
  }
  .draggable-panel :global(.panel-row) {
    display: flex;
    gap: 4pt;
    align-items: flex-start;
  }
  .draggable-panel :global(.panel-row label) {
    min-width: 0;
  }
  .draggable-panel :global(.panel-row label.compact) {
    flex: 0 0 auto;
    margin-right: 8pt;
  }
  .draggable-panel :global(.panel-row label.slider-control) {
    flex: 1;
  }
  /* Panel header styling */
  .draggable-panel .panel-header {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    position: absolute;
    top: 5px;
    left: 5px;
    right: 5px;
    height: 1.3em;
    z-index: 10;
    pointer-events: none; /* Allow events to pass through to children */
  }

  /* Control buttons container */
  .draggable-panel .control-buttons {
    display: flex;
    gap: 5px;
    align-items: center;
    pointer-events: auto; /* Re-enable pointer events for buttons */
  }

  /* Drag handle styling */
  .draggable-panel :global(.drag-handle) {
    width: 1.3em;
    height: 1.3em;
    cursor: grab;
    border-radius: 3px;
    padding: 2px;
    box-sizing: border-box;
    opacity: 0.6;
    background-color: color-mix(in srgb, currentColor 10%, transparent);
    pointer-events: auto; /* Re-enable pointer events for drag handle */
  }
  .draggable-panel :global(.drag-handle:hover) {
    opacity: 0.8;
    background-color: color-mix(in srgb, currentColor 20%, transparent);
  }
  /* Ensure drag handle cursor changes properly */
  .draggable-panel :global(.drag-handle:active) {
    cursor: grabbing;
  }

  /* Reset and close button styling */
  .draggable-panel .reset-button,
  .draggable-panel .close-button {
    background: none;
    border: none;
    padding: 2px;
    border-radius: 3px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    width: 1.3em;
    height: 1.3em;
    opacity: 0.6;
    background-color: color-mix(in srgb, currentColor 10%, transparent);
  }
  .draggable-panel :where(.reset-button:hover, .close-button:hover) {
    opacity: 0.8;
    background-color: color-mix(in srgb, currentColor 20%, transparent);
  }
</style>
