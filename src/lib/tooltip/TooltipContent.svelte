<script lang="ts" generics="T, SnippetArg = T">
  // Wrapper component that handles the common tooltip pattern:
  // - If tooltip is a snippet function, render it exclusively (replaces default content)
  // - If tooltip is a config object, render prefix/suffix around the default content
  // - Otherwise, render just the default content
  import type { Snippet } from 'svelte'
  import type { TooltipConfig } from './types'

  let {
    data,
    snippet_arg,
    tooltip,
    children,
  }: {
    data: T // Data passed to config prefix/suffix functions
    snippet_arg: SnippetArg // Single arg passed to custom snippet (can differ from data)
    tooltip?: Snippet<[SnippetArg]> | TooltipConfig<T>
    children: Snippet
  } = $props()

  const is_snippet = $derived(typeof tooltip === `function`)
  const config = $derived(
    !is_snippet && tooltip ? (tooltip as TooltipConfig<T>) : null,
  )
  const prefix = $derived(
    typeof config?.prefix === `function` ? config.prefix(data) : config?.prefix,
  )
  const suffix = $derived(
    typeof config?.suffix === `function` ? config.suffix(data) : config?.suffix,
  )
</script>

{#if is_snippet}
  {@render (tooltip as Snippet<[SnippetArg]>)(snippet_arg)}
{:else}
  {#if prefix}
    <div class="tooltip-prefix">{@html prefix}</div>
  {/if}
  {@render children()}
  {#if suffix}
    <div class="tooltip-suffix">{@html suffix}</div>
  {/if}
{/if}

<style>
  .tooltip-prefix {
    margin-bottom: 6px;
    padding-bottom: 6px;
    border-bottom: 1px solid
      var(--tooltip-border, var(--border, rgba(128, 128, 128, 0.3)));
  }
  .tooltip-suffix {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--tooltip-border, var(--border, rgba(128, 128, 128, 0.3)));
  }
</style>
