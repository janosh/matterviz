<script lang="ts" generics="Props extends Record<string, unknown>">
  import type { Component, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    load,
    props,
    children,
    label,
    height = `500px`,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    label: string
    height?: string
  } & (
      | {
          load: () => Promise<{ default: Component<Props>; props?: Partial<Props> }>
          props: Props
          children?: never
        }
      | { children: Snippet; load?: never; props?: never }
    ) = $props()

  let visible = $state(false)
  const pending = $derived(visible && load ? load() : undefined)

  // Start just before the demo enters view, and retain it after scrolling away so user
  // selections and loaded files survive. No imports, data fetching or GPU work during SSR.
  const observe = (element: HTMLElement) => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        visible = true
        observer.disconnect()
      },
      { rootMargin: `200px` },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }
</script>

<div
  {...rest}
  class={[`lazy-demo`, rest.class]}
  style:--demo-height={height}
  role="region"
  aria-label={label}
  {@attach observe}
>
  {#if pending && props}
    {#await pending}
      <p class="placeholder" role="status">Loading {label}…</p>
    {:then { default: Demo, props: loaded_props }}
      <Demo {...loaded_props} {...props} />
    {:catch error}
      <p role="alert">
        Failed to load {label}: {error instanceof Error ? error.message : String(error)}
      </p>
    {/await}
  {:else if visible && children}
    {@render children()}
  {:else}
    <p class="placeholder">{label}</p>
  {/if}
</div>

<style>
  .lazy-demo {
    min-width: 0;
    min-height: var(--demo-height);
    /* Retain the placeholder's space while an async snippet imports its component. */
    &:has(> :not(.placeholder, [role='status'])) {
      min-height: 0;
    }
    .placeholder {
      display: grid;
      place-items: center;
      min-height: inherit;
      margin: 0;
      color: var(--text-muted);
      background: var(--surface-bg);
    }
  }
</style>
