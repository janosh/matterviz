<script lang="ts">
  import type { ElementCategory } from '$lib'
  import { default_category_colors } from '$lib/colors'
  import { colors, selected } from '$lib/state.svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    tile_gap = $bindable(`0.3cqw`),
    symbol_font_size = $bindable(40),
    number_font_size = $bindable(22),
    name_font_size = $bindable(12),
    value_font_size = $bindable(18),
    tooltip_font_size = $bindable(14),
    tooltip_bg_color = $bindable(`#000000`),
    tile_border_radius = $bindable(1),
    inner_transition_offset = $bindable(0.5),
    tile_font_color = $bindable(`#ffffff`),
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
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    // Appearance control values
    tile_gap?: string
    symbol_font_size?: number
    number_font_size?: number
    name_font_size?: number
    value_font_size?: number
    tooltip_font_size?: number
    tooltip_bg_color?: string
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
  } = $props()

  // Default values for easy reset
  const defaults = {
    tile_gap: `0.3cqw`,
    symbol_font_size: 40,
    number_font_size: 22,
    name_font_size: 12,
    value_font_size: 18,
    tooltip_font_size: 14,
    tooltip_bg_color: `#000000`,
    tile_border_radius: 1,
    inner_transition_offset: 0.5,
    tile_font_color: `#ffffff`,
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
    else if (prop === `tile_border_radius`) tile_border_radius = Number(default_value)
    else if (prop === `inner_transition_offset`) {
      inner_transition_offset = Number(default_value)
    } else if (prop === `tile_font_color`) tile_font_color = String(default_value)
    else if (prop === `tile_transition_duration`) {
      tile_transition_duration = Number(default_value)
    } else if (prop === `hover_border_width`) {
      hover_border_width = Number(default_value)
    } else if (prop === `symbol_font_weight`) {
      symbol_font_weight = Number(default_value)
    } else if (prop === `number_font_weight`) {
      number_font_weight = Number(default_value)
    } else if (prop === `tooltip_border_radius`) {
      tooltip_border_radius = Number(default_value)
    } else if (prop === `tooltip_padding`) tooltip_padding = String(default_value)
    else if (prop === `tooltip_line_height`) {
      tooltip_line_height = Number(default_value)
    } else if (prop === `tooltip_text_align`) {
      tooltip_text_align = String(default_value)
    }
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
    tooltip_border_radius = defaults.tooltip_border_radius
    tooltip_padding = defaults.tooltip_padding
    tooltip_line_height = defaults.tooltip_line_height
    tooltip_text_align = defaults.tooltip_text_align
  }
</script>

<div {...rest} class="controls-grid {rest.class ?? ``}">
  <section class="category-colors">
    <h3 style="grid-column: span 2">
      Element Category Colors
      {#if category_colors_modified}
        <button class="section-reset" onclick={reset_category_colors}>reset</button>
      {/if}
    </h3>
    {#each Object.keys(colors.category) as category (category)}
      <label
        for="{category}-color"
        onmouseenter={() => (selected.category = category as ElementCategory)}
        onfocus={() => (selected.category = category as ElementCategory)}
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
  </section>

  <section>
    <h3>
      Element Tiles
      {#if tiles_modified}
        <button class="section-reset" onclick={reset_tiles}>reset</button>
      {/if}
    </h3>

    <label>
      <span>Gap between tiles</span>
      <input type="text" bind:value={tile_gap} placeholder="0.3cqw" />
      <button onclick={() => reset_property(`tile_gap`)}>reset</button>
    </label>

    <label>
      <span>Border radius (pt)</span>
      <input type="range" min="0" max="10" step="0.5" bind:value={tile_border_radius} />
      <input type="number" min="0" max="10" step="0.5" bind:value={tile_border_radius} />
      <button onclick={() => reset_property(`tile_border_radius`)}>reset</button>
    </label>

    <label>
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

    <label>
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

    <label>
      <span>Hover border width (px)</span>
      <input type="range" min="0" max="5" step="1" bind:value={hover_border_width} />
      <input type="number" min="0" max="5" step="1" bind:value={hover_border_width} />
      <button onclick={() => reset_property(`hover_border_width`)}>reset</button>
    </label>

    <label>
      <span>Font color</span>
      <input type="color" bind:value={tile_font_color} />
      <button onclick={() => reset_property(`tile_font_color`)}>reset</button>
    </label>
  </section>

  <section>
    <h3>
      Font Sizes
      {#if fonts_modified}
        <button class="section-reset" onclick={reset_fonts}>reset</button>
      {/if}
    </h3>

    <label>
      <span>Symbol size</span>
      <input type="range" min="20" max="80" step="2" bind:value={symbol_font_size} />
      <input type="number" min="20" max="80" step="2" bind:value={symbol_font_size} />
      <button onclick={() => reset_property(`symbol_font_size`)}>reset</button>
    </label>

    <label>
      <span>Number size</span>
      <input type="range" min="10" max="40" step="1" bind:value={number_font_size} />
      <input type="number" min="10" max="40" step="1" bind:value={number_font_size} />
      <button onclick={() => reset_property(`number_font_size`)}>reset</button>
    </label>

    <label>
      <span>Name size</span>
      <input type="range" min="6" max="24" step="1" bind:value={name_font_size} />
      <input type="number" min="6" max="24" step="1" bind:value={name_font_size} />
      <button onclick={() => reset_property(`name_font_size`)}>reset</button>
    </label>

    <label>
      <span>Value size</span>
      <input type="range" min="10" max="30" step="1" bind:value={value_font_size} />
      <input type="number" min="10" max="30" step="1" bind:value={value_font_size} />
      <button onclick={() => reset_property(`value_font_size`)}>reset</button>
    </label>

    <label>
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

    <label>
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
  </section>

  <section>
    <h3>
      Tooltip
      {#if tooltip_modified}
        <button class="section-reset" onclick={reset_tooltip}>reset</button>
      {/if}
    </h3>

    <label>
      <span>Font size (px)</span>
      <input type="range" min="8" max="24" step="1" bind:value={tooltip_font_size} />
      <input type="number" min="8" max="24" step="1" bind:value={tooltip_font_size} />
      <button onclick={() => reset_property(`tooltip_font_size`)}>reset</button>
    </label>

    <label>
      <span>Background color</span>
      <input type="color" bind:value={tooltip_bg_color} />
      <button onclick={() => reset_property(`tooltip_bg_color`)}>reset</button>
    </label>

    <label>
      <span>Border radius (px)</span>
      <input type="range" min="0" max="20" step="1" bind:value={tooltip_border_radius} />
      <input type="number" min="0" max="20" step="1" bind:value={tooltip_border_radius} />
      <button onclick={() => reset_property(`tooltip_border_radius`)}>reset</button>
    </label>

    <label>
      <span>Padding</span>
      <input type="text" bind:value={tooltip_padding} placeholder="4px 6px" />
      <button onclick={() => reset_property(`tooltip_padding`)}>reset</button>
    </label>

    <label>
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

    <label>
      <span>Text align</span>
      <select bind:value={tooltip_text_align}>
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
      </select>
      <button onclick={() => reset_property(`tooltip_text_align`)}>reset</button>
    </label>
  </section>
</div>

<style>
  .controls-grid {
    display: grid;
    grid-template-columns:
      var(--ptable-ctrl-columns, repeat(auto-fit, minmax(320px, 1fr)));
    gap: var(--ptable-ctrl-gap, 1.5em);
    margin: var(--ptable-ctrl-margin, 2em auto);
    padding: 0 1em;
    max-width: 1200px;
  }
  section {
    background: var(--surface-bg);
    border-radius: 6px;
    padding: 6pt 2ex;
  }
  section h3 {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 0 0 0.8em 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    padding-bottom: 0.3em;
    max-height: max-content;
  }
  button.section-reset {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  section > label {
    display: flex;
    align-items: center;
    gap: 0.5em;
    margin: 0.6em 0;
    font-size: 0.9em;
    flex-wrap: wrap;
  }
  section > label > span {
    min-width: 100px;
    font-weight: 500;
    font-size: 0.85em;
  }
  section > label input[type='range'] {
    flex: 1;
    margin: 0 0.3em;
  }
  section > label input[type='number'] {
    width: 60px;
    padding: 2px 4px;
    border-radius: 3px;
  }
  section > label input[type='text'] {
    flex: 1;
    padding: 4px 6px;
    border-radius: 3px;
  }
  section > label input[type='color'] {
    width: 50px;
    height: 20px;
    border-radius: 3px;
    border: 1px solid var(--border-color);
  }
  section > label select {
    flex: 1;
    padding: 4px 6px;
    border-radius: 3px;
    cursor: pointer;
  }
  section > label button {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    padding: 3px 6px;
    font-size: 0.8em;
    opacity: 0.7;
    transition: opacity 0.2s;
  }
  section > label button:hover {
    opacity: 1;
  }
  .category-colors {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }
  .category-colors label {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6pt;
    flex-wrap: nowrap;
    text-transform: capitalize;
    transition: background-color 0.2s;
  }
  .category-colors label span {
    flex: 1;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }
  .category-colors input[type='color'] {
    width: 25px;
    height: 25px;
    border-radius: 50%;
  }
</style>
