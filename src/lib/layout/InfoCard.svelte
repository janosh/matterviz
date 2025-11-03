<script lang="ts">
  import { format_num } from '$lib'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props<T extends keyof HTMLElementTagNameMap = `section`>
    extends HTMLAttributes<HTMLElementTagNameMap[T]> {
    data?: {
      title: string
      value?: string | number | number[] | null
      unit?: string
      fmt?: string
      condition?: boolean | number | null
      tooltip?: string
    }[]
    title?: string
    fallback?: string
    fmt?: string
    as?: T
    title_snippet?: Snippet
    fallback_snippet?: Snippet
  }
  let {
    data = [],
    title = ``,
    fallback = ``,
    fmt = `.2f`,
    as = `section`,
    title_snippet,
    fallback_snippet,
    ...rest
  }: Props = $props()

  let default_fmt = $derived(fmt) // rename fmt to default_fmt for internal use
</script>

<svelte:element this={as} {...rest} class="info-card {rest.class ?? ``}">
  {#if title || title_snippet}
    <h2>
      {#if title_snippet}{@render title_snippet()}{:else}
        {@html title}
      {/if}
    </h2>
  {/if}
  {#each data.filter((itm) =>
      (!(`condition` in itm) || itm?.condition) && itm.value !== undefined &&
      itm.value !== null
    ) as
    { title, value, unit, fmt = default_fmt, tooltip }
    (title + value + unit + fmt)
  }
    <div>
      <span class="title" {title}>
        {@html title}
      </span>
      <strong title={tooltip ?? null}>
        {@html typeof value == `number` ? format_num(value, fmt) : value}
        {#if unit}
          <small>{unit}</small>
        {/if}
      </strong>
    </div>
  {:else}
    {#if fallback_snippet}{@render fallback_snippet()}{:else}
      {fallback}
    {/if}
  {/each}
</svelte:element>

<style>
  .info-card {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    box-sizing: border-box;
    border-radius: var(--ic-radius, 3pt);
    padding: var(--ic-padding, 10pt 12pt);
    margin: var(--ic-margin, 1em 0);
    gap: var(--ic-gap, 10pt 5%);
    background-color: var(--ic-bg, rgba(255, 255, 255, 0.1));
    font-size: var(--ic-font-size);
    width: var(--ic-width);
  }
  h2 {
    grid-column: 1 / -1;
    margin: 0;
    border-bottom: 1px solid var(--ic-title-border-color, rgba(255, 255, 255, 0.3));
  }
  div {
    display: flex;
    justify-content: space-between;
    align-items: center;
    white-space: nowrap;
    gap: var(--ic-value-gap);
  }
  div > span.title {
    text-overflow: ellipsis;
    overflow: hidden;
  }
  strong {
    font-weight: 600;
    margin: var(--ic-value-margin);
    background-color: var(--ic-value-bg, rgba(255, 255, 255, 0.1));
    padding: var(--ic-value-padding, 0 4pt);
    border-radius: var(--ic-value-radius, 3pt);
  }
  strong small {
    font-weight: normal;
  }
</style>
