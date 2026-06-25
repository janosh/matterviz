<script lang="ts">
  import { AXIS_LABEL_CONTAINER } from '$lib/plot/core/axis-utils'
  import type { AxisOption } from '$lib/plot/core/types'
  import InteractiveAxisLabel from '$lib/plot/core/components/InteractiveAxisLabel.svelte'

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
    width = AXIS_LABEL_CONTAINER.width,
  }: {
    x: number
    y: number
    rotate?: boolean
    label?: string
    options?: AxisOption[]
    selected_key?: string
    color?: string | null
    loading?: boolean
    axis_type: `x` | `x2` | `y` | `y2`
    on_select?: (key: string) => void
    // container width for centering/wrapping; wider lets long horizontal titles fit on one line
    width?: number
  } = $props()
</script>

<foreignObject
  x={x - width / 2}
  y={y - AXIS_LABEL_CONTAINER.y_offset}
  {width}
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
