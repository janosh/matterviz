<script lang="ts">
  // Dashed horizontal guide drawn inside a ScatterPlot's user_content snippet, marking the
  // ideal-gas baseline g(r) = 1 or the reduced-PDF baseline G(r) = 0.
  let {
    width,
    pad,
    y_value,
    label,
  }: {
    width: number
    pad: { l: number; r: number }
    // already in pixel space, i.e. y_scale_fn(baseline)
    y_value: number
    label: string
  } = $props()
</script>

{#if isFinite(y_value)}
  <line
    x1={pad.l}
    x2={width - pad.r}
    y1={y_value}
    y2={y_value}
    stroke="gray"
    stroke-dasharray="4"
    opacity="0.5"
  />
  <text x={width - pad.r - 5} y={y_value - 5} text-anchor="end" fill="gray" font-size="0.8em">
    {label}
  </text>
{/if}
