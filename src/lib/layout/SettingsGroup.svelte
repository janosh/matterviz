<!-- SettingsGroup now exists upstream. Delete this local copy and import it from
svelte-widgets once a version above 1.4.0 is published; its API is unchanged. -->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { Icon } from 'svelte-widgets'
  import { ChevronRight } from 'svelte-widgets/icons'

  let {
    title,
    open = $bindable(false),
    subtitle,
    children,
    ...rest
  }: HTMLAttributes<HTMLDetailsElement> & {
    title: string
    open?: boolean
    // Short right-aligned hint, e.g. a count or the active mode, readable while collapsed
    subtitle?: string
    children: Snippet
  } = $props()
</script>

<details {...rest} class={[`settings-group`, rest.class]} bind:open>
  <summary>
    <Icon icon={ChevronRight} style="width: 0.85em; height: 0.85em" />
    <span class="group-title">{title}</span>
    {#if subtitle}<span class="group-subtitle">{subtitle}</span>{/if}
  </summary>
  <div class="group-body">{@render children()}</div>
</details>

<style>
  .settings-group {
    border-top: 1px solid
      var(--settings-group-border, color-mix(in srgb, currentColor 12%, transparent));
    &:first-of-type {
      border-top: none;
    }
    &[open] > summary :global(svg) {
      transform: rotate(90deg);
    }
  }
  summary {
    display: flex;
    align-items: center;
    gap: 5pt;
    padding: 5pt 2pt;
    cursor: pointer;
    user-select: none;
    border-radius: var(--border-radius, 3pt);
    list-style: none;
    &::-webkit-details-marker {
      display: none;
    }
    &:hover {
      background: color-mix(in srgb, currentColor 7%, transparent);
    }
    :global(svg) {
      flex: none;
      opacity: 0.6;
      transition: transform 0.15s ease;
    }
  }
  .group-title {
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    font-size: 0.85em;
  }
  .group-subtitle {
    margin-left: auto;
    font-size: 0.8em;
    opacity: 0.55;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .group-body {
    display: grid;
    gap: 3pt;
    padding: 2pt 0 8pt 2pt;
  }
</style>
