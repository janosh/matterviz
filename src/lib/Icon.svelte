<script lang="ts">
  import type { SVGAttributes } from 'svelte/elements'
  import { ICON_DATA, type IconName } from './icons'

  type IconData = { path: string; viewBox: string; stroke?: string }
  let { icon, path, viewBox = `0 0 24 24`, stroke, ...rest }:
    & { icon?: IconName }
    & Partial<IconData>
    & SVGAttributes<SVGSVGElement> = $props()

  const data: IconData = $derived.by(() => {
    if (path) return { path, viewBox: viewBox ?? `0 0 24 24`, stroke }
    if (icon && icon in ICON_DATA) return ICON_DATA[icon]
    if (icon) console.error(`Icon '${icon}' not found`)
    return ICON_DATA.Alert
  })
</script>

<svg
  role="img"
  fill={data.stroke ? `none` : `currentColor`}
  stroke={data.stroke}
  viewBox={data.viewBox}
  {...rest}
>
  {#if data.path.trim().startsWith(`<`)}
    {@html data.path}
  {:else}
    <path d={data.path} />
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
