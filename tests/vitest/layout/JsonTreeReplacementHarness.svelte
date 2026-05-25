<script lang="ts">
  import JsonTree from '$lib/layout/json-tree/JsonTree.svelte'
  import { SvelteSet } from 'svelte/reactivity'

  let value = $state<Record<string, Record<string, string>>>({
    nested: {
      stale: `old`,
      findme: `old`,
    },
  })
  let collapsed_paths = $state(new SvelteSet<string>())
</script>

<button
  type="button"
  data-testid="replace-json"
  onclick={() => (value = { nested: { fresh: `new`, findme: `new` } })}
>
  Replace JSON
</button>
<button
  type="button"
  data-testid="replace-flat-json"
  onclick={() => (value = { other: { fresh: `new` } })}
>
  Replace Flat JSON
</button>
<span data-testid="collapsed-count">{collapsed_paths.size}</span>
<JsonTree {value} bind:collapsed_paths default_fold_level={5} />
