<script lang="ts">
  import { AXIS_LABEL_CONTAINER } from '$lib/plot/axis-utils'
  import type { AxisOption } from '$lib/plot/types'
  import InteractiveAxisLabel from './InteractiveAxisLabel.svelte'

  let {
    x,
    y,
    rotate = false,
    label = ``,
    options,
    selected_key,
    color,
    loading = false,
    axis_type,
    on_select,
  }: {
    x: number
    y: number
    rotate?: boolean
    label?: string
    options?: AxisOption[]
    selected_key?: string
    color?: string | null
    loading?: boolean
    axis_type: `x` | `y` | `y2`
    on_select?: (key: string) => void
  } = $props()
</script>

<foreignObject
  x={x - AXIS_LABEL_CONTAINER.x_offset}
  y={y - AXIS_LABEL_CONTAINER.y_offset}
  width={AXIS_LABEL_CONTAINER.width}
  height={AXIS_LABEL_CONTAINER.height}
  style="overflow: visible; pointer-events: none"
  transform={rotate ? `rotate(-90, ${x}, ${y})` : undefined}
>
  <div xmlns="http://www.w3.org/1999/xhtml" style="pointer-events: auto">
    <InteractiveAxisLabel
      {label}
      {options}
      {selected_key}
      {loading}
      {axis_type}
      {color}
      {on_select}
      class="axis-label {axis_type}-label"
    />
  </div>
</foreignObject>
