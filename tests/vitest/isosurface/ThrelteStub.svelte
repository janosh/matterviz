<script lang="ts">
  // Recording node for `threlte_stub.T` (see threlte-stub.ts)
  import type { Snippet } from 'svelte'
  import { type StubNode, stub_state } from './threlte-stub'

  let { children, ...rest }: { children?: Snippet } & Record<string, unknown> = $props()
  const node: StubNode = {
    tag: stub_state.pending_tag,
    get props() {
      return rest
    },
  }
  stub_state.nodes.push(node)
  $effect(() => () => {
    stub_state.nodes.splice(stub_state.nodes.indexOf(node), 1)
  })
</script>

{@render children?.()}
