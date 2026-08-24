<script lang="ts">
  // Type-level pin, enforced by svelte-check over tests/: ThemeControl omits the native
  // `onchange` from its props, so `onchange={…}` is a compile error rather than a handler that
  // silently receives a DOM Event instead of the ThemeMode that `on_change` delivers
  import type { ThemeMode } from '$lib/theme'
  import ThemeControl from '$lib/theme/ThemeControl.svelte'
  import { type ComponentProps, untrack } from 'svelte'

  let { on_change }: { on_change: (mode: ThemeMode) => void } = $props()
  type Props = ComponentProps<typeof ThemeControl>
  // Props are read once on purpose: this fixture pins types, not reactivity
  const typed: Props = { on_change: untrack(() => on_change), class: `typed` }
  // A no-arg handler would satisfy the native select attribute, so only the Omit rejects it
  const noop = () => {}
  // @ts-expect-error onchange is not a ThemeControl prop
  const native: Props = { onchange: noop, class: `native` }
</script>

<ThemeControl {...typed} />
<ThemeControl {...native} />
