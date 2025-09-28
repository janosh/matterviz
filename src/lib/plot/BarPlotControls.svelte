<script lang="ts">
  import { DraggablePane } from '$lib'
  import type { BarMode, BarOrientation } from '$lib/plot'
  import type { TicksOption } from '$lib/plot/scales'
  import type { ComponentProps, Snippet } from 'svelte'

  interface Props {
    show_controls?: boolean
    controls_open?: boolean
    orientation?: BarOrientation
    mode?: BarMode
    x_grid?: boolean | Record<string, unknown>
    y_grid?: boolean | Record<string, unknown>
    x_ticks?: TicksOption
    y_ticks?: TicksOption
    x_format?: string
    y_format?: string
    x_range?: [number | null, number | null] | undefined
    y_range?: [number | null, number | null] | undefined
    auto_x_range?: [number, number]
    auto_y_range?: [number, number]
    plot_controls?: Snippet<[]> | undefined
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
  }

  let {
    show_controls = $bindable(false),
    controls_open = $bindable(false),
    orientation = $bindable(`vertical` as BarOrientation),
    mode = $bindable(`overlay` as BarMode),
    x_grid = $bindable(true),
    y_grid = $bindable(true),
    x_ticks = $bindable(8),
    y_ticks = $bindable(6),
    x_format = $bindable(``),
    y_format = $bindable(``),
    x_range = $bindable<[number | null, number | null] | undefined>(undefined),
    y_range = $bindable<[number | null, number | null] | undefined>(undefined),
    auto_x_range = [0, 1] as [number, number],
    auto_y_range = [0, 1] as [number, number],
    plot_controls,
    toggle_props,
  }: Props = $props()

  function set_auto_ranges() {
    x_range = [...auto_x_range]
    y_range = [...auto_y_range]
  }
</script>

<DraggablePane bind:show={controls_open} {toggle_props}>
  <div class="controls">
    <div class="row">
      <label>Orientation
        <select bind:value={orientation}>
          <option value="vertical">vertical</option>
          <option value="horizontal">horizontal</option>
        </select>
      </label>
    </div>
    <div class="row">
      <label>Mode
        <select bind:value={mode}>
          <option value="overlay">overlay</option>
          <option value="stacked">stacked</option>
        </select>
      </label>
    </div>
    <div class="row">
      <label><input type="checkbox" bind:checked={x_grid as boolean} /> x grid</label>
      <label><input type="checkbox" bind:checked={y_grid as boolean} /> y grid</label>
    </div>
    <div class="row">
      <label>x ticks
        <input type="number" bind:value={x_ticks as number} min="0" step="1" />
      </label>
      <label>y ticks
        <input type="number" bind:value={y_ticks as number} min="0" step="1" />
      </label>
      <input type="number" bind:value={y_ticks as number} min="0" step="1" />
    </div>
    <div class="row">
      <label>x format
        <input type="text" bind:value={x_format} />
      </label>
      <label>y format
        <input type="text" bind:value={y_format} />
      </label>
    </div>
    <div class="row">
      <label>x range
        <input type="number" bind:value={x_range} min="0" step="1" />
      </label>
      <input
        type="number"
        value={(x_range && x_range[0]) ?? ``}
        oninput={(event) => {
          const raw = (event.target as HTMLInputElement).value
          const val = raw === `` ? null : Number(raw)
          x_range = x_range
            ? [val, x_range[1] ?? auto_x_range[1]]
            : [val, auto_x_range[1]]
        }}
      />
      <input
        type="number"
        value={(x_range && x_range[1]) ?? ``}
        oninput={(event) => {
          const raw = (event.target as HTMLInputElement).value
          const val = raw === `` ? null : Number(raw)
          x_range = x_range
            ? [x_range[0] ?? auto_x_range[0], val]
            : [auto_x_range[0], val]
        }}
      />
    </div>
    <div class="row">
      <label>y range
        <input
          type="number"
          value={(y_range && y_range[0]) ?? ``}
          oninput={(event) => {
            const raw = (event.target as HTMLInputElement).value
            const val = raw === `` ? null : Number(raw)
            y_range = y_range
              ? [val, y_range[1] ?? auto_y_range[1]]
              : [val, auto_y_range[1]]
          }}
        />
        <input
          type="number"
          value={(y_range && y_range[1]) ?? ``}
          oninput={(event) => {
            const raw = (event.target as HTMLInputElement).value
            const val = raw === `` ? null : Number(raw)
            y_range = y_range
              ? [y_range[0] ?? auto_y_range[0], val]
              : [auto_y_range[0], val]
          }}
        />
        <button onclick={set_auto_ranges}>auto</button>
      </label>
    </div>
    {@render plot_controls?.()}
  </div>
</DraggablePane>

<style>
  .controls {
    padding: 8px;
    min-width: 260px;
    color: var(--text-color);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  label {
    font-size: 12px;
  }
  input[type='number'], input[type='text'], select {
    flex: 1;
  }
  button {
    padding: 2px 6px;
  }
</style>
