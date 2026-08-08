<!-- NumberRangeInput now exists upstream. Delete this local copy and import it from
svelte-widgets once a version above 1.4.0 is published. The upstream one additionally accepts
`setting` + `schema` to resolve bounds itself; this pane resolves them at the call site via
`setting_range()`, and upstream still honours plain min/max/step, so either style migrates. -->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { tooltip } from 'svelte-widgets/attachments'

  // Paired number + range input bound to the same value, wrapped in a flex <label>.
  // The label text/markup is passed as children (supports inline units like <small>Å</small>).
  // Pass a `title` to show a tooltip; the wrapping <label> only names the number input,
  // so the range slider reuses that `title` as its accessible name.
  // Children go in their own <span> so the label is exactly three elements (text, number,
  // range), which lets a settings pane put every row on one shared column grid.
  let {
    value = $bindable(),
    min,
    max,
    step,
    title,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLLabelElement>, `title`> & {
    value: number | undefined
    min?: number | string
    max?: number | string
    step?: number | string
    title?: string
    children?: Snippet
  } = $props()
</script>

<label {@attach tooltip()} {title} {...rest}>
  <span class="label-text">{@render children?.()}</span>
  <input type="number" {min} {max} {step} bind:value />
  <input type="range" {min} {max} {step} bind:value aria-label={title} />
</label>

<style>
  label {
    display: flex;
    align-items: center;
    gap: 10pt;
  }
  /* no children means no label cell, so the flex gap shouldn't reserve one either */
  .label-text:empty {
    display: none;
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
