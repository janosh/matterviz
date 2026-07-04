<script lang="ts">
  import type { SVGAttributes } from 'svelte/elements'
  import { ICON_DATA, type IconName } from './icons'

  type IconData = { path: string; viewBox: string; stroke?: string }
  let {
    icon,
    path,
    viewBox = `0 0 24 24`,
    stroke,
    ...rest
  }: { icon?: IconName } & Partial<IconData> & SVGAttributes<SVGSVGElement> = $props()

  const data: IconData = $derived.by(() => {
    if (path) return { path, viewBox, stroke }
    if (icon && icon in ICON_DATA) return ICON_DATA[icon]
    if (icon) console.error(`Icon '${icon}' not found`)
    return ICON_DATA.Alert
  })

  // {@html} only ever gets trusted ICON_DATA, never the user `path` prop (which renders as an
  // escaped <path d> below) — so no XSS via path and identical SSR/CSR output (no hydration mismatch)
  const icon_markup = $derived(!path && data.path.trim().startsWith(`<`) ? data.path : null)
</script>

<svg
  role="img"
  fill={data.stroke ? `none` : `currentColor`}
  stroke={data.stroke}
  viewBox={data.viewBox}
  {...rest}
>
  {#if icon_markup != null}
    {@html icon_markup}
  {:else}
    <path d={data.path} />
  {/if}
</svg>

<style>
  svg {
    width: var(--icon-size, 1em);
    height: var(--icon-size, auto);
    display: inline-block;
    vertical-align: middle;
  }
</style>
