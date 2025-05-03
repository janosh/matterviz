<script lang="ts">
  import { ColorBar } from '$lib'
  import * as d3_sc from 'd3-scale-chromatic'
  import type { ComponentProps } from 'svelte'
  import Select from 'svelte-multiselect'
  import type { D3InterpolateName } from '../colors'

  interface Props {
    options?: D3InterpolateName[]
    value?: string | null
    selected?: string[]
    minSelect?: number
    placeholder?: string
    colorbar?: ComponentProps<typeof ColorBar>
    [key: string]: unknown
  }
  let {
    options = Object.keys(d3_sc).filter((key) =>
      key.startsWith(`interpolate`),
    ) as D3InterpolateName[],
    value = $bindable(``),
    selected = $bindable([``]),
    minSelect = 0,
    placeholder = `Select a color scale`,
    colorbar = {},
    ...rest
  }: Props = $props()
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
  {#snippet children({ option }: { option: D3InterpolateName })}
    {@const display_name = option.replace(/^interpolate/, ``)}
    <ColorBar
      title={display_name}
      color_scale={display_name}
      tick_labels={0}
      title_side="left"
      wrapper_style="min-width: 18em;"
      {...colorbar}
      range={[0, 1]}
    />
  {/snippet}
</Select>
