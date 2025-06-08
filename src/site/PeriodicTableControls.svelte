<script lang="ts">
  import type { Category } from '$lib'
  import { default_category_colors } from '$lib/colors'
  import { colors, selected } from '$lib/state.svelte'

  interface Props {
    // Appearance control values
    tile_gap?: string
    symbol_font_size?: number
    number_font_size?: number
    name_font_size?: number
    value_font_size?: number
    tooltip_font_size?: number
    tooltip_bg_color?: string
    tooltip_text_color?: string
    tile_border_radius?: number
    inner_transition_offset?: number
    tile_font_color?: string
    // Additional Element Tile controls
    tile_transition_duration?: number
    hover_border_width?: number
    symbol_font_weight?: number
    number_font_weight?: number
    // Additional Tooltip controls
    tooltip_border_radius?: number
    tooltip_padding?: string
    tooltip_line_height?: number
    tooltip_text_align?: string
  }

  let {
    tile_gap = $bindable(`0.3cqw`),
    symbol_font_size = $bindable(40),
    number_font_size = $bindable(22),
    name_font_size = $bindable(12),
    value_font_size = $bindable(18),
    tooltip_font_size = $bindable(14),
    tooltip_bg_color = $bindable(`rgba(0, 0, 0, 0.8)`),
    tooltip_text_color = $bindable(`white`),
    tile_border_radius = $bindable(1),
    inner_transition_offset = $bindable(0.5),
    tile_font_color = $bindable(`white`),
    // Additional Element Tile controls
    tile_transition_duration = $bindable(0.4),
    hover_border_width = $bindable(1),
    symbol_font_weight = $bindable(400),
    number_font_weight = $bindable(300),
    // Additional Tooltip controls
    tooltip_border_radius = $bindable(6),
    tooltip_padding = $bindable(`4px 6px`),
    tooltip_line_height = $bindable(1.2),
    tooltip_text_align = $bindable(`center`),
  }: Props = $props()

  // Default values for easy reset
  const defaults = {
    tile_gap: `0.3cqw`,
    symbol_font_size: 40,
    number_font_size: 22,
    name_font_size: 12,
    value_font_size: 18,
    tooltip_font_size: 14,
    tooltip_bg_color: `rgba(0, 0, 0, 0.8)`,
    tooltip_text_color: `white`,
    tile_border_radius: 1,
    inner_transition_offset: 0.5,
    tile_font_color: `white`,
    tile_transition_duration: 0.4,
    hover_border_width: 1,
    symbol_font_weight: 400,
    number_font_weight: 300,
    tooltip_border_radius: 6,
    tooltip_padding: `4px 6px`,
    tooltip_line_height: 1.2,
    tooltip_text_align: `center`,
  }

  // Apply CSS custom properties to document root
  $effect(() => {
    if (typeof document !== `undefined`) {
      const css_vars = {
        '--ptable-gap': tile_gap,
        '--elem-symbol-font-size': `${symbol_font_size}cqw`,
        '--elem-number-font-size': `${number_font_size}cqw`,
        '--elem-name-font-size': `${name_font_size}cqw`,
        '--elem-value-font-size': `${value_font_size}cqw`,
        '--tooltip-font-size': `${tooltip_font_size}px`,
        '--tooltip-bg': tooltip_bg_color,
        '--tooltip-color': tooltip_text_color,
        '--elem-tile-border-radius': `${tile_border_radius}pt`,
        '--ptable-spacer-ratio': `${1 / inner_transition_offset}`,
        '--elem-tile-font-color': tile_font_color,
        '--elem-tile-transition-duration': `${tile_transition_duration}s`,
        '--elem-tile-hover-border-width': `${hover_border_width}px`,
        '--elem-symbol-font-weight': `${symbol_font_weight}`,
        '--elem-number-font-weight': `${number_font_weight}`,
        '--tooltip-border-radius': `${tooltip_border_radius}px`,
        '--tooltip-padding': tooltip_padding,
        '--tooltip-line-height': `${tooltip_line_height}`,
        '--tooltip-text-align': tooltip_text_align,
      }

      for (const [prop, val] of Object.entries(css_vars)) {
        document.documentElement.style.setProperty(prop, val)
      }
    }
  })

  // Apply category colors to CSS custom properties
  $effect.pre(() => {
    if (typeof document !== `undefined`) {
      for (const [key, val] of Object.entries(colors.category)) {
        document.documentElement.style.setProperty(`--${key}-bg-color`, val)
      }
    }
  })

  // Generic reset function using simple object key access
  function reset_property(prop: keyof typeof defaults): void {
    const default_value = defaults[prop]

    // Use simple assignment based on property name
    if (prop === `tile_gap`) tile_gap = default_value as string
    else if (prop === `symbol_font_size`) symbol_font_size = default_value as number
    else if (prop === `number_font_size`) number_font_size = default_value as number
    else if (prop === `name_font_size`) name_font_size = default_value as number
    else if (prop === `value_font_size`) value_font_size = default_value as number
    else if (prop === `tooltip_font_size`) tooltip_font_size = default_value as number
    else if (prop === `tooltip_bg_color`) tooltip_bg_color = default_value as string
    else if (prop === `tooltip_text_color`) tooltip_text_color = default_value as string
    else if (prop === `tile_border_radius`) tile_border_radius = default_value as number
    else if (prop === `inner_transition_offset`)
      inner_transition_offset = default_value as number
    else if (prop === `tile_font_color`) tile_font_color = default_value as string
    else if (prop === `tile_transition_duration`)
      tile_transition_duration = default_value as number
    else if (prop === `hover_border_width`) hover_border_width = default_value as number
    else if (prop === `symbol_font_weight`) symbol_font_weight = default_value as number
    else if (prop === `number_font_weight`) number_font_weight = default_value as number
    else if (prop === `tooltip_border_radius`)
      tooltip_border_radius = default_value as number
    else if (prop === `tooltip_padding`) tooltip_padding = default_value as string
    else if (prop === `tooltip_line_height`) tooltip_line_height = default_value as number
    else if (prop === `tooltip_text_align`) tooltip_text_align = default_value as string
  }

  // Check if settings in each section have been modified from defaults
  let category_colors_modified = $derived(
    Object.keys(colors.category).some(
      (key) => colors.category[key] !== default_category_colors[key],
    ),
  )

  let tiles_modified = $derived(
    tile_gap !== defaults.tile_gap ||
      tile_border_radius !== defaults.tile_border_radius ||
      inner_transition_offset !== defaults.inner_transition_offset ||
      tile_transition_duration !== defaults.tile_transition_duration ||
      hover_border_width !== defaults.hover_border_width ||
      tile_font_color !== defaults.tile_font_color,
  )

  let fonts_modified = $derived(
    symbol_font_size !== defaults.symbol_font_size ||
      number_font_size !== defaults.number_font_size ||
      name_font_size !== defaults.name_font_size ||
      value_font_size !== defaults.value_font_size ||
      symbol_font_weight !== defaults.symbol_font_weight ||
      number_font_weight !== defaults.number_font_weight,
  )

  let tooltip_modified = $derived(
    tooltip_font_size !== defaults.tooltip_font_size ||
      tooltip_bg_color !== defaults.tooltip_bg_color ||
      tooltip_text_color !== defaults.tooltip_text_color ||
      tooltip_border_radius !== defaults.tooltip_border_radius ||
      tooltip_padding !== defaults.tooltip_padding ||
      tooltip_line_height !== defaults.tooltip_line_height ||
      tooltip_text_align !== defaults.tooltip_text_align,
  )

  // Reset functions for each section
  function reset_category_colors(): void {
    for (const key of Object.keys(colors.category)) {
      colors.category[key] = default_category_colors[key]
    }
  }

  function reset_tiles(): void {
    tile_gap = defaults.tile_gap
    tile_border_radius = defaults.tile_border_radius
    inner_transition_offset = defaults.inner_transition_offset
    tile_transition_duration = defaults.tile_transition_duration
    hover_border_width = defaults.hover_border_width
    tile_font_color = defaults.tile_font_color
  }

  function reset_fonts(): void {
    symbol_font_size = defaults.symbol_font_size
    number_font_size = defaults.number_font_size
    name_font_size = defaults.name_font_size
    value_font_size = defaults.value_font_size
    symbol_font_weight = defaults.symbol_font_weight
    number_font_weight = defaults.number_font_weight
  }

  function reset_tooltip(): void {
    tooltip_font_size = defaults.tooltip_font_size
    tooltip_bg_color = defaults.tooltip_bg_color
    tooltip_text_color = defaults.tooltip_text_color
    tooltip_border_radius = defaults.tooltip_border_radius
    tooltip_padding = defaults.tooltip_padding
    tooltip_line_height = defaults.tooltip_line_height
    tooltip_text_align = defaults.tooltip_text_align
  }
</script>

<div class="controls-grid">
  <div class="controls-section category-colors">
    <div class="section-header">
      <h3>Element Category Colors</h3>
      {#if category_colors_modified}
        <button class="section-reset-btn" onclick={reset_category_colors}>reset</button>
      {/if}
    </div>
    <div class="color-grid">
      {#each Object.keys(colors.category) as category (category)}
        <label
          class="color-label"
          for="{category}-color"
          onmouseenter={() => (selected.category = category as Category)}
          onfocus={() => (selected.category = category as Category)}
          onmouseleave={() => (selected.category = null)}
          onblur={() => (selected.category = null)}
        >
          <input
            type="color"
            id="{category}-color"
            bind:value={colors.category[category]}
          />
          <span>{category.replaceAll(`-`, ` `)}</span>
          {#if colors.category[category] !== default_category_colors[category]}
            <button
              onclick={(event) => {
                event.preventDefault()
                colors.category[category] = default_category_colors[category]
              }}
            >
              reset
            </button>
          {/if}
        </label>
      {/each}
    </div>
  </div>

  <div class="controls-section">
    <div class="section-header">
      <h3>Element Tiles</h3>
      {#if tiles_modified}
        <button class="section-reset-btn" onclick={reset_tiles}>reset</button>
      {/if}
    </div>

    <label class="control-row">
      <span>Gap between tiles</span>
      <input type="text" bind:value={tile_gap} placeholder="0.3cqw" />
      <button onclick={() => reset_property(`tile_gap`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Border radius (pt)</span>
      <input type="range" min="0" max="10" step="0.5" bind:value={tile_border_radius} />
      <input type="number" min="0" max="10" step="0.5" bind:value={tile_border_radius} />
      <button onclick={() => reset_property(`tile_border_radius`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Inner transition offset</span>
      <input
        type="range"
        min="0.1"
        max="2"
        step="0.1"
        bind:value={inner_transition_offset}
      />
      <input
        type="number"
        min="0.1"
        max="2"
        step="0.1"
        bind:value={inner_transition_offset}
      />
      <button onclick={() => reset_property(`inner_transition_offset`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Transition duration (s)</span>
      <input
        type="range"
        min="0.1"
        max="2"
        step="0.1"
        bind:value={tile_transition_duration}
      />
      <input
        type="number"
        min="0.1"
        max="2"
        step="0.1"
        bind:value={tile_transition_duration}
      />
      <button onclick={() => reset_property(`tile_transition_duration`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Hover border width (px)</span>
      <input type="range" min="0" max="5" step="1" bind:value={hover_border_width} />
      <input type="number" min="0" max="5" step="1" bind:value={hover_border_width} />
      <button onclick={() => reset_property(`hover_border_width`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Font color</span>
      <input type="color" bind:value={tile_font_color} />
      <button onclick={() => reset_property(`tile_font_color`)}>reset</button>
    </label>
  </div>

  <div class="controls-section">
    <div class="section-header">
      <h3>Font Sizes (cqw)</h3>
      {#if fonts_modified}
        <button class="section-reset-btn" onclick={reset_fonts}>reset</button>
      {/if}
    </div>

    <label class="control-row">
      <span>Symbol size</span>
      <input type="range" min="20" max="80" step="2" bind:value={symbol_font_size} />
      <input type="number" min="20" max="80" step="2" bind:value={symbol_font_size} />
      <button onclick={() => reset_property(`symbol_font_size`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Number size</span>
      <input type="range" min="10" max="40" step="1" bind:value={number_font_size} />
      <input type="number" min="10" max="40" step="1" bind:value={number_font_size} />
      <button onclick={() => reset_property(`number_font_size`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Name size</span>
      <input type="range" min="6" max="24" step="1" bind:value={name_font_size} />
      <input type="number" min="6" max="24" step="1" bind:value={name_font_size} />
      <button onclick={() => reset_property(`name_font_size`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Value size</span>
      <input type="range" min="10" max="30" step="1" bind:value={value_font_size} />
      <input type="number" min="10" max="30" step="1" bind:value={value_font_size} />
      <button onclick={() => reset_property(`value_font_size`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Symbol weight</span>
      <input
        type="range"
        min="100"
        max="900"
        step="100"
        bind:value={symbol_font_weight}
      />
      <input
        type="number"
        min="100"
        max="900"
        step="100"
        bind:value={symbol_font_weight}
      />
      <button onclick={() => reset_property(`symbol_font_weight`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Number weight</span>
      <input
        type="range"
        min="100"
        max="900"
        step="100"
        bind:value={number_font_weight}
      />
      <input
        type="number"
        min="100"
        max="900"
        step="100"
        bind:value={number_font_weight}
      />
      <button onclick={() => reset_property(`number_font_weight`)}>reset</button>
    </label>
  </div>

  <div class="controls-section">
    <div class="section-header">
      <h3>Tooltip</h3>
      {#if tooltip_modified}
        <button class="section-reset-btn" onclick={reset_tooltip}>reset</button>
      {/if}
    </div>

    <label class="control-row">
      <span>Font size (px)</span>
      <input type="range" min="8" max="24" step="1" bind:value={tooltip_font_size} />
      <input type="number" min="8" max="24" step="1" bind:value={tooltip_font_size} />
      <button onclick={() => reset_property(`tooltip_font_size`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Background color</span>
      <input type="color" bind:value={tooltip_bg_color} />
      <button onclick={() => reset_property(`tooltip_bg_color`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Text color</span>
      <input type="color" bind:value={tooltip_text_color} />
      <button onclick={() => reset_property(`tooltip_text_color`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Border radius (px)</span>
      <input type="range" min="0" max="20" step="1" bind:value={tooltip_border_radius} />
      <input type="number" min="0" max="20" step="1" bind:value={tooltip_border_radius} />
      <button onclick={() => reset_property(`tooltip_border_radius`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Padding</span>
      <input type="text" bind:value={tooltip_padding} placeholder="4px 6px" />
      <button onclick={() => reset_property(`tooltip_padding`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Line height</span>
      <input type="range" min="0.8" max="2" step="0.1" bind:value={tooltip_line_height} />
      <input
        type="number"
        min="0.8"
        max="2"
        step="0.1"
        bind:value={tooltip_line_height}
      />
      <button onclick={() => reset_property(`tooltip_line_height`)}>reset</button>
    </label>

    <label class="control-row">
      <span>Text align</span>
      <select bind:value={tooltip_text_align}>
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
      </select>
      <button onclick={() => reset_property(`tooltip_text_align`)}>reset</button>
    </label>
  </div>
</div>

<style>
  .controls-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: var(--appearance-controls-gap, 1.5em);
    max-width: var(--appearance-controls-width, 100%);
    margin: var(--appearance-controls-margin, 1em auto);
    padding: var(--appearance-controls-padding, 0 1em);
    box-sizing: border-box;
    overflow-x: auto;
  }

  .controls-section {
    background: var(--appearance-controls-section-bg, rgba(255, 255, 255, 0.02));
    border-radius: var(--appearance-controls-section-radius, 6px);
    padding: var(--appearance-controls-section-padding, 0.75em);
    border: var(
      --appearance-controls-section-border,
      1px solid rgba(255, 255, 255, 0.05)
    );
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.8em;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    padding-bottom: 0.3em;
  }

  .section-header h3 {
    margin: 0;
    font-size: var(--appearance-controls-h3-size, 1.1em);
    color: var(--appearance-controls-h3-color, var(--text-color));
  }

  .section-reset-btn {
    background: var(--appearance-controls-btn-bg, rgba(255, 255, 255, 0.1));
    color: var(--appearance-controls-btn-color, var(--text-color));
    border: var(--appearance-controls-btn-border, 1px solid rgba(255, 255, 255, 0.2));
    border-radius: var(--appearance-controls-btn-radius, 3px);
    padding: 2px 8px;
    font-size: 0.75em;
    cursor: pointer;
    opacity: 0.8;
    transition: opacity 0.2s;
  }

  .section-reset-btn:hover {
    opacity: 1;
    background: var(--appearance-controls-btn-hover-bg, rgba(255, 255, 255, 0.2));
  }

  .control-row {
    display: flex;
    align-items: center;
    gap: var(--appearance-controls-row-gap, 0.5em);
    margin: var(--appearance-controls-row-margin, 0.6em 0);
    font-size: var(--appearance-controls-row-font-size, 0.9em);
    min-width: 0;
    flex-wrap: wrap;
  }

  .control-row span {
    flex: 0 0 auto;
    min-width: var(--appearance-controls-label-width, 100px);
    font-weight: var(--appearance-controls-label-weight, 500);
    font-size: 0.85em;
  }

  .control-row input[type='range'] {
    flex: 1;
    margin: var(--appearance-controls-range-margin, 0 0.3em);
  }

  .control-row input[type='number'] {
    width: var(--appearance-controls-number-width, 60px);
    padding: var(--appearance-controls-number-padding, 2px 4px);
    border: var(--appearance-controls-number-border, 1px solid rgba(255, 255, 255, 0.2));
    border-radius: var(--appearance-controls-number-radius, 3px);
    background: var(--appearance-controls-number-bg, rgba(255, 255, 255, 0.1));
    color: var(--appearance-controls-number-color, var(--text-color));
  }

  .control-row input[type='text'] {
    flex: 1;
    padding: var(--appearance-controls-text-padding, 4px 6px);
    border: var(--appearance-controls-text-border, 1px solid rgba(255, 255, 255, 0.2));
    border-radius: var(--appearance-controls-text-radius, 3px);
    background: var(--appearance-controls-text-bg, rgba(255, 255, 255, 0.1));
    color: var(--appearance-controls-text-color, var(--text-color));
  }

  .control-row input[type='color'] {
    width: var(--appearance-controls-color-width, 40px);
    height: var(--appearance-controls-color-height, 30px);
    border-radius: var(--appearance-controls-color-radius, 3px);
    border: var(--appearance-controls-color-border, 1px solid rgba(255, 255, 255, 0.2));
    background: transparent;
    cursor: pointer;
  }

  .control-row select {
    flex: 1;
    padding: var(--appearance-controls-select-padding, 4px 6px);
    border: var(--appearance-controls-select-border, 1px solid rgba(255, 255, 255, 0.2));
    border-radius: var(--appearance-controls-select-radius, 3px);
    background: var(--appearance-controls-select-bg, rgba(255, 255, 255, 0.1));
    color: var(--appearance-controls-select-color, var(--text-color));
    cursor: pointer;
  }

  .control-row button {
    background: var(--appearance-controls-btn-bg, rgba(255, 255, 255, 0.1));
    color: var(--appearance-controls-btn-color, var(--text-color));
    border: var(--appearance-controls-btn-border, 1px solid rgba(255, 255, 255, 0.2));
    border-radius: var(--appearance-controls-btn-radius, 3px);
    padding: var(--appearance-controls-btn-padding, 3px 6px);
    font-size: var(--appearance-controls-btn-font-size, 0.8em);
    cursor: pointer;
    opacity: 0.7;
    transition: var(--appearance-controls-btn-transition, opacity 0.2s);
  }

  .control-row button:hover {
    opacity: 1;
    background: var(--appearance-controls-btn-hover-bg, rgba(255, 255, 255, 0.2));
  }

  .color-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.5em;
  }

  .color-label {
    display: flex;
    align-items: center;
    gap: 0.4em;
    padding: 0.3em 0.4em;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.8em;
    text-transform: capitalize;
    transition: background-color 0.2s;
  }

  .color-label:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  .color-label input[type='color'] {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: transparent;
    cursor: pointer;
  }

  .color-label span {
    flex: 1;
    font-weight: 400;
  }

  .color-label button {
    background: var(--appearance-controls-btn-bg, rgba(255, 255, 255, 0.1));
    color: var(--appearance-controls-btn-color, var(--text-color));
    border: var(--appearance-controls-btn-border, 1px solid rgba(255, 255, 255, 0.2));
    border-radius: var(--appearance-controls-btn-radius, 3px);
    padding: 2px 6px;
    font-size: 0.75em;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .color-label button:hover {
    opacity: 1;
    background: var(--appearance-controls-btn-hover-bg, rgba(255, 255, 255, 0.2));
  }
</style>
