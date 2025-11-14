<script lang="ts">
  import type { SVGAttributes } from 'svelte/elements'
  import { ICON_DATA, type IconName } from './icons'

  let { icon, ...rest }: { icon: IconName } & SVGAttributes<SVGSVGElement> = $props()

  const { path, ...svg_props } = $derived.by(() => {
    if (!(icon in ICON_DATA)) {
      console.error(`Icon '${icon}' not found`)
      return ICON_DATA.Alert // fallback
    }
    return ICON_DATA[icon]
  })
</script>

<svg role="img" fill="currentColor" {...svg_props} {...rest}>
  {#if path.trim().startsWith(`<`)}
    {@html path}
  {:else}
    <path d={path} />
  {/if}
</svg>

<style>
  svg {
    width: 1em;
    height: auto;
    display: inline-block;
    vertical-align: middle;
  }
</style>
