<script lang="ts">
  import type { ChemicalElement } from '$lib/element'
  import { ELEM_HEATMAP_LABELS } from '$lib/labels'
  import type { ComponentProps } from 'svelte'
  import { MultiSelect as Select } from 'svelte-widgets'

  const options = Object.keys(ELEM_HEATMAP_LABELS)
  let {
    min_select = 0,
    key = $bindable(`atomic_radius`),
    ...rest
  }: Omit<
    Extract<ComponentProps<typeof Select<string>>, { mode: `single` }>,
    `options` | `key` | `mode` | `value`
  > & {
    key?: keyof ChemicalElement | null
  } = $props()
</script>

<Select
  {options}
  mode="single"
  max_options={options.length}
  {min_select}
  bind:value={
    () => options.find((label) => ELEM_HEATMAP_LABELS[label] === key) ?? null,
    (label) => (key = ELEM_HEATMAP_LABELS[label ?? ``] ?? null)
  }
  placeholder="Select a heatmap"
  input_style="padding: 3pt 6pt;"
  {...rest}
/>
