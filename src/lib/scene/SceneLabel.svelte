<script lang="ts">
  // Threlte <HTML> overlay for labels and tooltips in 3D scenes. Pointer-transparent unless
  // `interactive`: HTML sits over the canvas, so a label would otherwise swallow the hovers and
  // clicks meant for the geometry under it. HTML's own `pointerEvents` prop only applies in
  // CSS-3D (`transform`) mode, so the wrapper's style carries it instead.
  import { HTML } from '@threlte/extras'
  import type { ComponentProps } from 'svelte'

  let {
    interactive = false,
    style = ``,
    ...rest
  }: ComponentProps<typeof HTML> & { interactive?: boolean; style?: string } = $props()
</script>

<HTML {...rest} style={interactive ? style : `pointer-events: none; ${style}`} />
