<script lang="ts">
  import { ColorBar } from '$lib'
  import * as d3_sc from 'd3-scale-chromatic'
  import type { ComponentProps } from 'svelte'
  import Select from 'svelte-multiselect'

  interface Props {
    value?: string | null
    selected?: string[]
    minSelect?: number
    placeholder?: string
    cbar_props?: ComponentProps<typeof ColorBar>
  }

  let {
    value = $bindable(null),
    selected = $bindable([`Viridis`]),
    minSelect = 0,
    placeholder = `Select a color scale`,
    cbar_props = {},
    ...rest
  }: Props = $props()

  const options = Object.keys(d3_sc)
    .filter((key) => key.startsWith(`interpolate`))
    .map((key) => key.replace(`interpolate`, ``))
</script>

<Select
  {options}
  maxSelect={1}
  {minSelect}
  bind:value
  bind:selected
  {placeholder}
  {...rest}
>
  {#snippet children({ option }: { option: string })}
    <ColorBar
      label={option}
      color_scale={option}
      tick_labels={0}
      label_side="left"
      wrapper_style="min-width: 18em;"
      {...cbar_props}
    />
  {/snippet}
</Select>
