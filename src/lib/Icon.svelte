<script lang="ts">
  import { icon_data, type IconName } from './icons'

  interface Props {
    icon: IconName
    [key: string]: unknown
  }
  let { icon, ...rest }: Props = $props()

  const { path, ...svg_props } = $derived.by(() => {
    if (!(icon in icon_data)) {
      console.error(`Icon '${icon}' not found`)
      return icon_data.Alert // fallback
    }
    return icon_data[icon]
  })
</script>

<svg fill="currentColor" {...svg_props} {...rest}>
  {#if path.trim().startsWith(`<`)}
    {@html path}
  {:else}
    <path d={path} />
  {/if}
</svg>

<style>
  svg {
    width: 1em;
    height: 1em;
    display: inline-block;
    vertical-align: middle;
  }
</style>
