<script lang="ts" generics="Value extends string">
  // Labelled dropdown over a value -> label map, e.g. SETTINGS_CONFIG enums or the
  // SPLIT_MODES/NORMALIZE_MODES constants the plot modules export
  interface Props {
    label: string
    options: Readonly<Partial<Record<Value, string>>>
    value: Value
  }
  let { label, options, value = $bindable() }: Props = $props()
</script>

<label>
  {label}:
  <select bind:value>
    {#each Object.entries(options) as [option_value, option_label] (option_value)}
      <option value={option_value}>{option_label}</option>
    {/each}
  </select>
</label>
