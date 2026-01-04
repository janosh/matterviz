<script lang="ts">
  import { ColorBar } from '$lib/plot'
  import * as d3_sc from 'd3-scale-chromatic'
  import type { ComponentProps } from 'svelte'
  import Select from 'svelte-multiselect'
  import type { D3InterpolateName } from '../colors'

  let {
    options = Object.keys(d3_sc).filter((key) =>
      key.startsWith(`interpolate`)
    ) as D3InterpolateName[],
    value = $bindable(options[0]),
    selected = $bindable([]),
    minSelect = 1,
    placeholder = `Select a color scale`,
    colorbar = {},
    ...rest
  }: Omit<ComponentProps<typeof Select>, `options`> & {
    options?: D3InterpolateName[]
    value?: D3InterpolateName
    selected?: D3InterpolateName[]
    minSelect?: number
    placeholder?: string
    colorbar?: ComponentProps<typeof ColorBar>
  } = $props()
</script>

<Select
  {options}
  maxSelect={1}
  {minSelect}
  bind:value
  bind:selected
  {placeholder}
  liOptionStyle="padding: 3pt 6pt;"
  liSelectedStyle="width: 100%; background-color: transparent;"
  ulSelectedStyle="display: contents;"
  inputStyle="min-width: 0;"
  {...rest}
  style={`min-width: 0; ${rest.style ?? ``}`}
>
  {#snippet children({ option }: { option: unknown; idx: number })}
    {@const d3_option = option as D3InterpolateName}
    <ColorBar
      title={d3_option.replace(/^interpolate/, ``)}
      color_scale={d3_option}
      tick_labels={0}
      title_side="left"
      wrapper_style="width: 100%;"
      title_style="width: 6em; font-size: 1.5em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;"
      {...colorbar}
    />
  {/snippet}
</Select>
