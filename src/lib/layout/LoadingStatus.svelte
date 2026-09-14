<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import { Progress, Spinner } from 'svelte-widgets'

  let {
    label,
    progress,
    on_cancel,
    cancel_label = `Cancel`,
    overlay = false,
    ...spinner_props
  }: ComponentProps<typeof Spinner> & {
    label: string
    // Undefined hides the bar; null shows indeterminate progress.
    progress?: number | null
    on_cancel?: () => void
    cancel_label?: string
    overlay?: boolean
  } = $props()
</script>

<div class="loading-status" class:loading-overlay={overlay}>
  <Spinner text={label} {...spinner_props} />
  {#if progress !== undefined}<Progress value={progress ?? undefined} {label} />{/if}
  {#if on_cancel}
    <button type="button" aria-label={cancel_label} onclick={on_cancel}>Cancel</button>
  {/if}
</div>

<style>
  .loading-status {
    display: grid;
    justify-items: center;
    gap: 0.75em;
    text-align: center;
    :global(.spinner) {
      max-width: 100%;
      margin: 0;
      overflow-wrap: anywhere;
    }
    :global(.circle-spinner) {
      flex-shrink: 0;
    }
    button {
      font: inherit;
      pointer-events: auto;
    }
    &.loading-overlay {
      position: absolute;
      inset: 0;
      place-content: center;
      grid-template-columns: min(24em, calc(100% - 2em));
      padding-block: 1em;
      box-sizing: border-box;
      pointer-events: none;
      z-index: 1;
    }
  }
</style>
