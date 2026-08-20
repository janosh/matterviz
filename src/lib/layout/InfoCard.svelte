<script lang="ts">
  import { format_num } from '$lib/labels'
  import { sanitize_html } from '$lib/sanitize'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    data = [],
    title = ``,
    fallback = ``,
    fmt: default_fmt = `.2f`,
    ...rest
  }: HTMLAttributes<HTMLElement> & {
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
  } = $props()

  // A present-but-falsy condition or a missing value hides an item; the fallback shows if none remain
  const shown = $derived(
    data.filter((item) => (!(`condition` in item) || item.condition) && item.value != null),
  )
  const format_value = (value: string | number | number[], fmt: string): string =>
    typeof value === `number`
      ? format_num(value, fmt)
      : Array.isArray(value)
        ? value.map((num) => format_num(num, fmt)).join(`, `)
        : value
</script>

<section {...rest} class={[`info-card`, rest.class]}>
  {#if title}
    <h2>{@html sanitize_html(title)}</h2>
  {/if}
  {#each shown as { title, value, unit, fmt = default_fmt, tooltip }}
    <div>
      <span class="title" {title}>{@html sanitize_html(title)}</span>
      <strong title={tooltip ?? null}>
        {@html sanitize_html(format_value(value ?? ``, fmt))}
        {#if unit}<small>{unit}</small>{/if}
      </strong>
    </div>
  {:else}
    {fallback}
  {/each}
</section>

<style>
  .info-card {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    box-sizing: border-box;
    border-radius: var(--ic-radius, 3pt);
    padding: var(--ic-padding, 10pt 12pt);
    margin: var(--ic-margin, 1em 0);
    gap: var(--ic-gap, 10pt 5%);
    background-color: var(--ic-bg, light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.1)));
    font-size: var(--ic-font-size);
    width: var(--ic-width);
    h2 {
      grid-column: 1 / -1;
      margin: 0;
      border-bottom: 1px solid
        var(--ic-title-border-color, light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.3)));
    }
    div {
      display: flex;
      justify-content: space-between;
      align-items: center;
      white-space: nowrap;
      gap: var(--ic-value-gap);
    }
    .title {
      text-overflow: ellipsis;
      overflow: hidden;
    }
    strong {
      font-weight: 600;
      margin: var(--ic-value-margin);
      background-color: var(
        --ic-value-bg,
        light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.1))
      );
      padding: var(--ic-value-padding, 0 4pt);
      border-radius: var(--ic-value-radius, 3pt);
      small {
        font-weight: normal;
      }
    }
  }
</style>
