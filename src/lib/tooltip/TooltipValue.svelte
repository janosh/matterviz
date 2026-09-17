<script lang="ts">
  import { parse_axis_label } from '$lib/labels'
  import { sanitize_html } from '$lib/sanitize'

  let {
    label = ``,
    value,
    unit,
  }: {
    label?: string
    value: string | number
    unit?: string
  } = $props()

  const parsed = $derived(parse_axis_label(label))
  // A separate unit leaves qualifiers such as "residual (rms)" in the label.
  const value_label = $derived(unit && parsed.unit !== unit ? label : parsed.name)
  const value_text = $derived(String(value))
  const percent = $derived(/\d%$/.test(value_text))
  const value_unit = $derived(unit || parsed.unit || (percent ? `%` : ``))
</script>

{#if value_label}{@html sanitize_html(value_label)}{`: `}{/if}{percent
  ? value_text.slice(0, -1)
  : value_text}{#if value_unit}{` `}<small>{@html sanitize_html(value_unit)}</small>{/if}
