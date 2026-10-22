<script lang="ts" generics="Props extends Record<string, unknown>">
  import type { Component, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { in_view } from 'svelte-widgets/attachments'

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
  const observe = in_view(() => (visible = true), { once: true, root_margin: `200px` })

  // The wrapper holds `height` until the demo itself has laid out with some height. Dropping it
  // as soon as any child exists let a demo that renders nothing while its own chunk loads
  // collapse to 0, pulling every demo below into view so they all loaded at once.
  let laid_out = $state(false)
  const hold_height = (element: HTMLElement) => {
    const is_demo = (child: Element) =>
      !child.matches(`.placeholder, [role='status']`) &&
      child.getBoundingClientRect().height > 0
    const resize = new ResizeObserver(() => {
      if (![...element.children].some(is_demo)) return
      laid_out = true
      stop()
    })
    const watch_children = () => {
      for (const child of element.children) resize.observe(child)
    }
    const mutation = new MutationObserver(watch_children)
    const stop = () => {
      resize.disconnect()
      mutation.disconnect()
    }
    mutation.observe(element, { childList: true })
    watch_children()
    return stop
  }
</script>

<div
  {...rest}
  class={[`lazy-demo`, rest.class]}
  style:min-height={laid_out ? undefined : height}
  role="region"
  aria-label={label}
  {@attach observe}
  {@attach hold_height}
>
  {#if pending && props}
    {#await pending}
      <p role="status">Loading {label}…</p>
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
    /* the placeholder, or a role="status" loader an async child shows, fills the held height */
    > :is(.placeholder, :global([role='status'])) {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5em;
      min-height: inherit;
      margin: 0;
      padding: 1em;
      box-sizing: border-box;
      text-align: center;
      color: var(--text-muted);
      background: var(--surface-bg);
    }
  }
</style>
