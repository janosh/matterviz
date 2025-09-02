<script lang="ts">
  import { ColorBar } from '$lib'
  import * as d3_sc from 'd3-scale-chromatic'
  import type { ComponentProps } from 'svelte'
  import Select from 'svelte-multiselect'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { D3InterpolateName } from '../colors'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    options?: D3InterpolateName[]
    value?: string | null
    selected?: string[]
    minSelect?: number
    placeholder?: string
    colorbar?: ComponentProps<typeof ColorBar>
  }
  let {
    options = Object.keys(d3_sc).filter((key) =>
      key.startsWith(`interpolate`)
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
  liOptionStyle="padding: 3pt 6pt;"
  liSelectedStyle="width: 100%;"
  ulSelectedStyle="display: contents;"
  inputStyle="min-width: 0;"
  {...rest}
>
  {#snippet children({ option }: { option: D3InterpolateName })}
    <ColorBar
      title={option.replace(/^interpolate/, ``)}
      color_scale={option}
      tick_labels={0}
      title_side="left"
      wrapper_style="width: 100%;"
      title_style="width: 6em; font-size: 1.2em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;"
      {...colorbar}
    />
  {/snippet}
</Select>
