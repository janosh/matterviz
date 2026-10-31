<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  // One test case: a titled card around the component(s) a Playwright test targets.
  // Extra attributes (id, data-testid, style) land on the <section>.
  let {
    title,
    description,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLElement>, `title`> & {
    title: string
    description?: string
    children?: Snippet<[]>
  } = $props()
</script>

<section {...rest}>
  <h2>{title}</h2>
  {#if description}<p>{description}</p>{/if}
  {@render children?.()}
</section>

<style>
  section {
    margin-block: 1.5em;
    padding: 1em;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
  }
  h2 {
    margin: 0 0 0.75em;
    font-size: 1.15em;
  }
  p {
    margin: 0 0 1em;
    color: var(--text-muted);
    font-size: 0.9em;
  }
</style>
