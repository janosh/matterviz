<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import CodeExample from 'svelte-widgets/CodeExample.svelte'
  import LazyDemo from './LazyDemo.svelte'

  let { example: demo, ...props }: ComponentProps<typeof CodeExample> = $props()
</script>

<CodeExample {...props}>
  {#snippet example()}
    {#if demo}
      <LazyDemo label="Interactive example" height="350px">
        {@render demo()}
      </LazyDemo>
    {/if}
  {/snippet}
</CodeExample>
