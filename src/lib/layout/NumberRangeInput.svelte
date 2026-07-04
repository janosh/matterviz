<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { tooltip } from 'svelte-multiselect/attachments'

  // Paired number + range input bound to the same value, wrapped in a flex <label>.
  // The label text/markup is passed as children (supports inline units like <small>Å</small>).
  // Pass a `title` (via rest) to show a tooltip; wrapping <label> only names the number input
  // so range slider reuses that `title` as its accessible name.
  let {
    value = $bindable(),
    min,
    max,
    step,
    children,
    ...rest
  }: {
    value: number | undefined
    min: number | string
    max: number | string
    step: number | string
    children?: Snippet
  } & HTMLAttributes<HTMLLabelElement> = $props()
</script>

<label {@attach tooltip()} {...rest}>
  {@render children?.()}
  <input type="number" {min} {max} {step} bind:value />
  <input type="range" {min} {max} {step} bind:value aria-label={rest.title} />
</label>

<style>
  label {
    display: flex;
    align-items: center;
    gap: 10pt;
  }
  input {
    font-size: inherit;
    font-family: inherit;
  }
  input[type='range'] {
    flex: 1;
    min-width: 40px;
  }
</style>
