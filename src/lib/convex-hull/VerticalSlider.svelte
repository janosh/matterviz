<script lang="ts">
  // Vertical range input with a value readout above it and a rotated range label beside it,
  // shared by the temperature and gas-pressure controls. Dragging previews locally and
  // commits to `value` at most every THROTTLE_MS so the hull pipeline doesn't recompute on
  // every pixel; releasing always commits.
  import type { Snippet } from 'svelte'
  import { tooltip } from 'svelte-widgets/attachments'
  import type { HTMLAttributes } from 'svelte/elements'

  const THROTTLE_MS = 100

  let {
    value = $bindable(),
    min,
    max,
    step = 1,
    aria_label,
    tooltip_content,
    header,
    range_label,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    value: number // slider position (committed)
    min: number
    max: number
    step?: number
    aria_label: string
    tooltip_content: string
    header: Snippet<[shown_value: number]> // readout, fed the previewed position while dragging
    range_label: Snippet
  } = $props()

  let preview = $state<number | null>(null)
  let last_commit = 0
  const shown = $derived(preview ?? value)

  function handle_input(event: Event & { currentTarget: HTMLInputElement }): void {
    preview = Number(event.currentTarget.value)
    const now = Date.now()
    if (now - last_commit < THROTTLE_MS) return
    last_commit = now
    value = preview
  }

  function handle_end(event: Event & { currentTarget: HTMLInputElement }): void {
    value = Number(event.currentTarget.value)
    preview = null
  }
</script>

<div
  {...rest}
  class={[`vertical-slider`, rest.class]}
  {@attach tooltip({ content: tooltip_content })}
>
  <label class="slider-header">{@render header(shown)}</label>
  <div class="slider-wrapper">
    <span class="slider-range">{@render range_label()}</span>
    <input
      type="range"
      {min}
      {max}
      {step}
      value={shown}
      oninput={handle_input}
      onchange={handle_end}
      onmouseup={handle_end}
      ontouchend={handle_end}
      aria-label={aria_label}
    />
  </div>
</div>

<style>
  .vertical-slider {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    background: color-mix(in srgb, var(--hull-bg, transparent) 80%, transparent);
    padding: 3px 5px;
    border-radius: var(--border-radius, 6pt);
    backdrop-filter: blur(2px);
  }
  .slider-header {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .slider-header :global(input) {
    border: 1px solid color-mix(in srgb, currentColor 5%, transparent);
    border-radius: 3px;
    background: transparent;
    text-align: center;
  }
  .slider-header :global(input::-webkit-outer-spin-button),
  .slider-header :global(input::-webkit-inner-spin-button) {
    -webkit-appearance: none;
    margin: 0;
  }
  /* both range inputs of a control column line up at the same x */
  .slider-wrapper {
    display: flex;
    place-items: center;
    justify-content: flex-end;
    line-height: 1;
  }
  input[type='range'] {
    writing-mode: vertical-lr;
    direction: rtl;
  }
  .slider-range {
    font-size: 0.7em;
    opacity: 0.7;
    white-space: nowrap;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
  }
</style>
