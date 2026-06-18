<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { tooltip } from 'svelte-multiselect/attachments'

  // Paired number + range input bound to the same value, wrapped in a flex <label>.
  // The label text/markup is passed as children (supports inline units like <small>Å</small>).
  let {
    value = $bindable(),
    min,
    max,
    step,
    tooltip_content,
    range_aria_label,
    children,
    ...rest
  }: {
    value: number | undefined
    min: number | string
    max: number | string
    step: number | string
    tooltip_content?: string
    range_aria_label?: string
    children?: Snippet
  } & HTMLAttributes<HTMLLabelElement> = $props()

  const tip = $derived(tooltip_content ? tooltip({ content: tooltip_content }) : () => {})
</script>

<label {@attach tip} {...rest}>
  {@render children?.()}
  <input type="number" {min} {max} {step} bind:value />
  <input type="range" {min} {max} {step} bind:value aria-label={range_aria_label} />
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
