<script lang="ts">
  import { pretty_num } from '$lib'

  export let data: {
    title: string
    value: string | number | number[]
    unit?: string
    fmt?: string
  }[] = []
  export let title: string = ``
  export let fallback: string = ``
  export let fmt: string = `.2f`
  export let as: string = `section`

  // rename fmt as default_fmt internally
  $: default_fmt = fmt
</script>

<svelte:element this={as} class="info-card">
  {#if title || $$slots.title}
    <h2>
      <slot name="title">
        {@html title}
      </slot>
    </h2>
  {/if}
  {#each data as { title, value, unit, fmt = default_fmt }}
    <div>
      <span class="title" {title}>
        {@html title}
      </span>
      <strong>
        {@html typeof value == `number` ? pretty_num(value, fmt) : value}
        {unit ?? ``}
      </strong>
    </div>
  {:else}
    <slot name="fallback">
      {fallback}
    </slot>
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
    gap: var(--ic-gap, 10pt 1em);
    background-color: var(--ic-bg, rgba(255, 255, 255, 0.1));
    font-size: var(--ic-font-size);
    width: var(--ic-width);
  }
  h2 {
    grid-column: 1 / -1;
    margin: 1ex 0;
    text-align: center;
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
</style>
