<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import type { IconName } from '$lib/icons'
  import type { Snippet } from 'svelte'
  import { draggable, tooltip } from 'svelte-multiselect/attachments'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    show = $bindable(false),
    show_pane = true,
    children,
    toggle_props = {},
    open_icon = `Cross`,
    closed_icon = `Settings`,
    icon_style = ``,
    offset = { x: 5, y: 5 },
    max_width = `450px`,
    pane_props = {},
    onclose = () => {},
    on_drag_start = () => {},
    toggle_pane_btn = $bindable(),
    pane_div = $bindable(),
    persistent = false,
    has_been_dragged = $bindable(false),
    currently_dragging = $bindable(false),
    resizable = `none`,
  }: {
    show?: boolean
    show_pane?: boolean
    children: Snippet<
      [{
        show: boolean
        show_control_buttons: boolean
        has_been_dragged: boolean
        currently_dragging: boolean
      }]
    >
    // Toggle button
    toggle_props?: HTMLAttributes<HTMLButtonElement>
    open_icon?: IconName
    closed_icon?: IconName
    icon_style?: string
    // Pane positioning and styling
    offset?: { x?: number; y?: number }
    max_width?: string
    pane_props?: HTMLAttributes<HTMLDivElement>
    // If true, only closes via Escape or explicit close button (not click-outside)
    persistent?: boolean
    // Resize mode: 'both' | 'width' | 'height' | 'none'
    resizable?: `both` | `width` | `height` | `none`
    // Callbacks
    onclose?: () => void
    on_drag_start?: () => void
    // Bindable state
    toggle_pane_btn?: HTMLButtonElement
    pane_div?: HTMLDivElement
    has_been_dragged?: boolean
    currently_dragging?: boolean
  } = $props()

  let initial_position = $state({ left: `50px`, top: `50px` })
  let show_control_buttons = $state(false)
  let resizing = $state(false)
  let resize_end_time = 0

  // Resize via bottom-right grip
  function handle_resize_start(event: PointerEvent) {
    if (resizable === `none` || !pane_div) return
    event.preventDefault()
    event.stopPropagation()
    resizing = true
    has_been_dragged = true
    show_control_buttons = true
    const start_x = event.clientX
    const start_y = event.clientY
    const start_w = pane_div.offsetWidth
    const start_h = pane_div.offsetHeight

    function on_move(evt: PointerEvent) {
      if (!pane_div) return
      if (resizable !== `height`) {
        pane_div.style.width = `${Math.max(200, start_w + evt.clientX - start_x)}px`
      }
      if (resizable !== `width`) {
        pane_div.style.maxHeight = `${
          Math.max(100, start_h + evt.clientY - start_y)
        }px`
      }
    }
    function on_up() {
      document.removeEventListener(`pointermove`, on_move)
      document.removeEventListener(`pointerup`, on_up)
      resize_end_time = Date.now()
      requestAnimationFrame(() => {
        resizing = false
      })
    }
    document.addEventListener(`pointermove`, on_move)
    document.addEventListener(`pointerup`, on_up)
  }

  function toggle_pane(event: MouseEvent) {
    event.stopPropagation()
    show = !show
    if (!show) onclose()
  }

  function close_pane() {
    show = false
    onclose()
  }

  function reset_position() {
    if (toggle_pane_btn) {
      const pos = calculate_position()
      initial_position = pos
      if (pane_div) {
        Object.assign(pane_div.style, {
          left: pos.left,
          top: pos.top,
          right: `auto`,
          bottom: `auto`,
          width: ``,
          maxHeight: ``,
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

  // Position calculation
  function calculate_position() {
    if (!toggle_pane_btn) return { left: `50px`, top: `50px` }

    const toggle_rect = toggle_pane_btn.getBoundingClientRect()
    const pane_width = pane_div?.getBoundingClientRect().width || 450
    const ox = offset.x ?? 5
    const oy = offset.y ?? 5
    const positioned_ancestor = toggle_pane_btn.offsetParent
    const ancestor_rect = positioned_ancestor?.getBoundingClientRect()

    if (!ancestor_rect) { // Fallback to document positioning
      const scroll_x = window.scrollX || document.documentElement.scrollLeft
      const scroll_y = window.scrollY || document.documentElement.scrollTop
      return {
        left: `${toggle_rect.right - pane_width + ox + scroll_x}px`,
        top: `${toggle_rect.bottom + oy + scroll_y}px`,
      }
    }

    return {
      left: `${toggle_rect.right - ancestor_rect.left - pane_width + ox}px`,
      top: `${toggle_rect.bottom - ancestor_rect.top + oy}px`,
    }
  }

  // Click outside handler (skipped when persistent)
  function handle_click_outside(event: MouseEvent) {
    if (!show || persistent) return
    // Ignore click events fired shortly after a resize/drag operation ends
    // (Playwright and some browsers synthesize a click after pointer up)
    if (Date.now() - resize_end_time < 200) return

    const target = event.target
    const is_toggle_button = target instanceof Node && toggle_pane_btn &&
      (target === toggle_pane_btn || toggle_pane_btn.contains(target))
    const is_inside_pane = target instanceof Node && pane_div &&
      (target === pane_div || pane_div.contains(target))

    if (!is_toggle_button && !is_inside_pane && !currently_dragging && !resizing) {
      close_pane()
    }
  }

  // Debounced resize handler for better performance
  let resize_timeout: ReturnType<typeof setTimeout> | undefined = $state(undefined)

  function handle_resize() { // Only reposition if pane is visible and hasn't been manually dragged
    if (!show || has_been_dragged || currently_dragging) return

    if (resize_timeout) clearTimeout(resize_timeout)
    const current_timeout = setTimeout(() => {
      if (resize_timeout !== current_timeout) return
      if (show && toggle_pane_btn && !has_been_dragged && pane_div) {
        const pos = calculate_position()
        initial_position = pos
        pane_div.style.left = pos.left
        pane_div.style.top = pos.top
      }
    }, 50) // Debounce resize events
    resize_timeout = current_timeout
  }

  // Position pane when shown
  $effect(() => {
    if (show && toggle_pane_btn && !has_been_dragged) {
      const pos = calculate_position()
      initial_position = pos
      if (pane_div) {
        Object.assign(pane_div.style, {
          left: pos.left,
          top: pos.top,
          right: `auto`,
          bottom: `auto`,
          width: ``,
          maxHeight: ``,
        })
      }
    }
  })
</script>

<svelte:window
  onkeydown={(event: KeyboardEvent) => {
    if (event.key === `Escape` && show) {
      event.preventDefault()
      close_pane()
    }
  }}
  onresize={handle_resize}
/>
<svelte:document onclick={handle_click_outside} />

{#if show_pane}
  <button
    type="button"
    bind:this={toggle_pane_btn}
    aria-expanded={show}
    {...toggle_props}
    style={toggle_props.style ?? ``}
    onclick={toggle_pane}
    class="pane-toggle {toggle_props.class ?? ``}"
    {@attach tooltip({ content: toggle_props.title ?? (show ? `Close pane` : `Open pane`) })}
  >
    <Icon icon={show ? open_icon : closed_icon} style={icon_style} />
  </button>

  <div
    {@attach draggable({
      handle_selector: `.drag-handle`,
      on_drag_start: handle_drag_start,
      on_drag_end: () => (currently_dragging = false),
    })}
    bind:this={pane_div}
    role="dialog"
    aria-label="Draggable pane"
    aria-modal="false"
    style:max-width={max_width}
    style:top={initial_position.top}
    style:left={initial_position.left}
    style:display={show ? `grid` : `none`}
    {...pane_props}
    class="draggable-pane {show ? `pane-open` : ``} {pane_props.class ?? ``}"
  >
    <div class="control-tab">
      <Icon
        icon="DragIndicator"
        class="drag-handle"
        style="width: 1em; height: 1em"
      />
      {#if show_control_buttons}
        <button
          type="button"
          class="reset-button"
          onclick={(event: MouseEvent) => {
            event.stopPropagation()
            reset_position()
          }}
          title="Reset pane position"
          aria-label="Reset pane position"
        >
          <Icon icon="Reset" style="width: 1em; height: 1em" />
        </button>
        <button
          type="button"
          class="close-button"
          onclick={close_pane}
          title="Close pane"
          aria-label="Close pane"
        >
          <Icon icon="Cross" style="width: 1em; height: 1em" />
        </button>
      {/if}
    </div>
    <div class="pane-content">
      {@render children?.({
        show,
        show_control_buttons,
        has_been_dragged,
        currently_dragging,
      })}
    </div>
    {#if resizable !== `none`}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="resize-grip"
        class:resize-width={resizable === `width`}
        class:resize-height={resizable === `height`}
        onpointerdown={handle_resize_start}
        ondblclick={() => {
          if (pane_div) {
            pane_div.style.width = ``
            pane_div.style.maxHeight = ``
          }
        }}
      >
        <svg viewBox="0 0 10 10" width="10" height="10">
          <line x1="9" y1="1" x2="1" y2="9" />
          <line x1="9" y1="4" x2="4" y2="9" />
          <line x1="9" y1="7" x2="7" y2="9" />
        </svg>
      </div>
    {/if}
  </div>
{/if}

<style>
  :global(.hover-visible:has(.draggable-pane.pane-open)) {
    opacity: 1;
    pointer-events: auto;
  }
  button.pane-toggle {
    box-sizing: border-box;
    display: flex;
    place-items: center;
    padding: var(--pane-toggle-padding, 2pt);
    border-radius: var(--pane-toggle-border-radius, var(--border-radius, 3pt));
    background-color: transparent;
    transition: var(--pane-toggle-transition, background-color 0.2s);
    font-size: var(--pane-toggle-font-size, 0.875rem);
  }
  button.pane-toggle:hover {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
  }
  div.draggable-pane {
    position: absolute; /* Use absolute so pane scrolls with page content */
    background: var(--pane-bg, var(--page-bg, light-dark(white, black)));
    border: var(
      --pane-border,
      1px solid light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.15))
    );
    border-radius: var(--pane-border-radius, var(--border-radius, 3pt));
    box-sizing: border-box;
    box-shadow: var(
      --pane-box-shadow,
      light-dark(
        0 4px 20px -4px rgba(0, 0, 0, 0.15),
        0 8px 16px -4px rgba(0, 0, 0, 0.3)
      )
    );
    z-index: var(--pane-z-index, 10);
    display: grid;
    text-align: left;
    /* Exclude position from being transitioned to prevent sluggish dragging */
    transition: opacity 0.3s, background-color 0.3s, border-color 0.3s, box-shadow 0.3s;
    width: 28em;
    max-width: var(--pane-max-width, 80cqw);
    overflow: visible; /* Allow control-tab to protrude above the pane border */
    min-height: var(--pane-min-height, auto);
    max-height: var(--pane-max-height, 80vh);
  }
  .draggable-pane .pane-content {
    padding: var(--pane-padding, 1ex);
    display: grid;
    gap: var(--pane-gap, 4pt);
    overflow-x: var(--pane-overflow-x, hidden);
    overflow-y: var(--pane-overflow-y, auto);
    max-height: inherit;
    box-sizing: border-box;
    overscroll-behavior: contain;
  }
  :global(body.fullscreen) .draggable-pane {
    position: fixed !important; /* In fullscreen, we want viewport-relative positioning */
    top: 3.3em !important;
    right: 1em !important;
    left: auto !important;
  }
  /* Pane content styling */
  .draggable-pane :global(h4) {
    margin: var(--pane-h4-margin, 2pt 0);
    font-size: var(--pane-h4-font-size, 0.95em);
  }
  .draggable-pane :global(hr) {
    border: none;
    background: var(
      --pane-hr-bg,
      light-dark(rgba(0, 0, 0, 0.08), rgba(255, 255, 255, 0.1))
    );
    margin: var(--pane-hr-margin, 4pt 0);
    height: 1px;
  }
  .draggable-pane :global(section > div) {
    text-align: right; /* right align long line-breaking trajectory file names */
  }
  .draggable-pane :global(:where(label)) {
    display: inline-flex;
    align-items: center;
    gap: var(--pane-label-gap, 2pt);
  }
  .draggable-pane :global(:where(input[type='text'])) {
    flex: 1;
    padding: var(--pane-input-padding, 4px 6px);
    margin: var(--pane-input-margin, 0 0 0 5pt);
  }
  .draggable-pane :global(input[type='text'].invalid) {
    border-color: var(--error-color, #ff6b6b);
    background: rgba(255, 107, 107, 0.1);
  }
  .draggable-pane :global(input[type='text'].invalid):focus {
    outline-color: var(--error-color, #ff6b6b);
    box-shadow: 0 0 0 2px rgba(255, 107, 107, 0.2);
  }
  .draggable-pane :global(input[type='range']) {
    margin-left: 4pt;
    width: 100px;
    flex-shrink: 0;
    flex: 1;
    min-width: 60px;
  }
  .draggable-pane :global(input[type='color']) {
    width: 2.5em;
    height: 1.3em;
    margin: 0 5pt;
  }
  .draggable-pane :global(input[type='number']) {
    box-sizing: border-box;
    text-align: center;
    width: 2.2em;
    margin: 0 3pt;
    flex-shrink: 0;
  }
  .draggable-pane :global(input::-webkit-inner-spin-button) {
    display: none;
  }
  .draggable-pane :global(:where(button)) {
    background-color: var(
      --pane-btn-bg,
      var(--btn-bg, light-dark(rgba(0, 0, 0, 0.04), rgba(255, 255, 255, 0.1)))
    );
  }
  .draggable-pane .pane-content :global(:where(button)) {
    font-size: 1em;
    padding: var(--pane-btn-padding, 3px 6px);
  }
  .draggable-pane :global(:where(button:hover)) {
    background-color: var(
      --pane-btn-bg-hover,
      var(--btn-bg-hover, light-dark(rgba(0, 0, 0, 0.08), rgba(255, 255, 255, 0.2)))
    );
  }
  .draggable-pane :global(select) {
    margin: 0 0 0 5pt;
    flex: 1;
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 0.8em;
  }
  .draggable-pane :global(.pane-row) {
    display: flex;
    gap: 8pt;
    align-items: center;
  }
  .draggable-pane :global(.pane-grid) {
    display: grid;
    gap: 8pt;
    align-items: center;
  }
  .draggable-pane :global(.control-group) {
    display: inline-flex;
    gap: 0.5em;
    align-items: center;
  }
  /* Labels containing range inputs should fill available width */
  .draggable-pane :global(label:has(input[type='range'])) {
    flex: 1;
  }
  .draggable-pane .control-tab {
    position: absolute;
    top: 6px;
    right: -1px;
    transform: translateX(100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 3px 2px;
    background: var(--pane-bg, var(--page-bg, light-dark(white, black)));
    border: var(
      --pane-border,
      1px solid light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.15))
    );
    border-left: none;
    border-radius: 0 5px 5px 0;
    z-index: var(--pane-control-tab-z-index, var(--pane-control-buttons-z-index, 1));
  }
  .draggable-pane :global(.drag-handle) {
    width: 1.1em;
    height: 1.1em;
    cursor: grab;
    border-radius: 3px;
    padding: 1px;
    box-sizing: border-box;
    opacity: 0.5;
    pointer-events: auto;
  }
  .draggable-pane :global(.drag-handle:hover) {
    opacity: 0.8;
    background-color: color-mix(in srgb, currentColor 15%, transparent);
  }
  .draggable-pane :global(.drag-handle:active) {
    cursor: grabbing;
  }
  .draggable-pane :where(.reset-button, .close-button) {
    background: none;
    border: none;
    padding: 1px;
    border-radius: 3px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.1em;
    height: 1.1em;
    opacity: 0.5;
  }
  .draggable-pane :where(.reset-button:hover, .close-button:hover) {
    opacity: 0.8;
    background-color: color-mix(in srgb, currentColor 15%, transparent);
  }
  .draggable-pane .resize-grip {
    position: absolute;
    bottom: 0;
    right: 0;
    padding: 2px;
    cursor: nwse-resize;
    opacity: 0.3;
    touch-action: none;
    line-height: 0;
    svg {
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
    }
  }
  .draggable-pane .resize-grip:hover {
    opacity: 0.6;
  }
  .draggable-pane .resize-grip.resize-width {
    cursor: ew-resize;
  }
  .draggable-pane .resize-grip.resize-height {
    cursor: ns-resize;
  }
</style>
