<script lang="ts">
  import type { SVGAttributes } from 'svelte/elements'
  import { ICON_DATA, type IconName } from './icons'

  type IconData = { path: string; viewBox: string; stroke?: string }
  let { icon, path, viewBox = `0 0 24 24`, stroke, ...rest }:
    & { icon?: IconName }
    & Partial<IconData>
    & SVGAttributes<SVGSVGElement> = $props()

  const data: IconData = $derived.by(() => {
    if (path) return { path, viewBox, stroke }
    if (icon && icon in ICON_DATA) return ICON_DATA[icon]
    if (icon) console.error(`Icon '${icon}' not found`)
    return ICON_DATA.Alert
  })

  // Multi-element inline SVG is rendered via {@html}, which by construction only ever receives our
  // own trusted ICON_DATA constants — never the user-facing `path` prop. `path` is always treated as
  // a path `d` string rendered as an escaped <path d> attribute below, so untrusted input cannot
  // reach {@html} (no XSS, even during SSR) and the markup is byte-identical on server and client
  // (no hydration_html mismatch — no client-only sanitization that would diverge from raw SSR).
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
