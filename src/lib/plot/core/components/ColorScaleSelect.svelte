<script lang="ts">
  import { ColorBar } from '$lib/plot'
  import * as d3_sc from 'd3-scale-chromatic'
  import type { ComponentProps } from 'svelte'
  import { MultiSelect as Select } from 'svelte-widgets'
  import type { D3InterpolateName } from '$lib/colors'

  let {
    options = Object.keys(d3_sc).filter((key) =>
      key.startsWith(`interpolate`),
    ) as D3InterpolateName[],
    value = $bindable(options[0]),
    // Seeded from `value`, the way MultiSelect seeds its own `selected` default. Hardcoding
    // `[]` overrides that default, and MultiSelect's selected -> value sync then writes the
    // empty selection back, nulling the caller's value on mount unless they also bind
    // `selected` purely to work around it.
    selected = $bindable(value == null ? [] : [value]),
    minSelect = 1,
    placeholder = `Select a color scale`,
    color_bar = {},
    open = $bindable(false),
    ...rest
  }: Omit<ComponentProps<typeof Select>, `options`> & {
    options?: D3InterpolateName[]
    value?: D3InterpolateName
    selected?: D3InterpolateName[]
    minSelect?: number
    placeholder?: string
    color_bar?: ComponentProps<typeof ColorBar>
  } = $props()

  // MultiSelect keeps its option list mounted while closed, so a ColorBar per scheme costs
  // ~40 components and their gradients (measured 6 ms, 555 nodes) on every mount of a
  // dropdown the user may never open. Latched once opened so reopening stays free.
  let previews_built = $state(false)
  $effect(() => {
    if (open) previews_built = true
  })
</script>

<Select
  {options}
  maxSelect={1}
  maxOptions={options.length}
  {minSelect}
  bind:value
  bind:selected
  {placeholder}
  liOptionStyle="padding: 3pt 6pt;"
  liSelectedStyle="width: 100%; background-color: transparent;"
  ulSelectedStyle="display: contents;"
  inputStyle="min-width: 0; width: 0; padding: 0; border: none; caret-color: transparent;"
  bind:open
  {...rest}
  style={`min-width: 0; ${rest.style ?? ``}`}
>
  {#snippet children(ctx: { option: unknown; idx: number; type: `selected` | `option` })}
    {@const scheme = ctx.option as D3InterpolateName}
    {@const label = scheme.replace(/^interpolate/, ``)}
    <!-- `open` covers the first open, which renders before the latch effect runs -->
    {#if ctx.type === `selected` || open || previews_built}
      <ColorBar
        title={label}
        color_scale={scheme}
        tick_labels={0}
        title_side="left"
        wrapper_style="width: 100%;"
        title_style="width: 6em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; font-size: 0.9rem;"
        {...color_bar}
      />
    {:else}
      {label}
    {/if}
  {/snippet}
</Select>
