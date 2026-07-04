<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  let {
    copied = false,
    label,
    title = label,
    onclick,
    ...rest
  }: Omit<HTMLButtonAttributes, `type` | `aria-label`> & {
    copied?: boolean
    label: string
  } = $props()
</script>

<button
  {...rest}
  type="button"
  class={[`copy-button`, rest.class]}
  aria-label={label}
  {title}
  {onclick}
>
  <Icon icon={copied ? `Check` : `Copy`} />
</button>

<style>
  .copy-button {
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
    width: 1.6em;
    height: 1.6em;
    border: 0;
    border-radius: var(--border-radius, 3pt);
    background: color-mix(in srgb, currentColor 8%, transparent);
    color: inherit;
    cursor: pointer;
    opacity: 0.75;
    padding: 0;
    &:is(:hover, :focus-visible) {
      opacity: 1;
      background: color-mix(in srgb, currentColor 14%, transparent);
    }
    :global(svg) {
      width: 0.9em;
      height: 0.9em;
    }
  }
</style>
