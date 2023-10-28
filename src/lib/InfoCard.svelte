<script lang="ts">
  import { pretty_num } from '$lib'
  import type { PropertyOrigin } from '$types'

  export let data: {
    title: string
    value?: string | number | number[] | null | PropertyOrigin
    unit?: string
    fmt?: string
    condition?: boolean | number | null
    tooltip?: string
  }[] = []
  export let title: string = ``
  export let fallback: string = ``
  export let fmt: string = `.2f`
  export let as: string = `section`
  export let style: string | null = null

  // rename fmt as default_fmt internally
  $: default_fmt = fmt
</script>

<svelte:element this={as} class="info-card" {style}>
  {#if title || $$slots.title}
    <h2>
      <slot name="title">
        {@html title}
      </slot>
    </h2>
  {/if}
  {#each data.filter((itm) => (!(`condition` in itm) || itm?.condition) && ![undefined, null].includes(itm.value)) as { title, value, unit, fmt = default_fmt, tooltip }}
    <div>
      <span class="title" {title}>
        {@html title}
      </span>
      <strong title={tooltip ?? null}>
        {@html typeof value == `number` ? pretty_num(value, fmt) : value}
        {#if unit}
          <small>{unit}</small>
        {/if}
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
