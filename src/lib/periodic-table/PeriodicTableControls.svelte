<script lang="ts">
  import type { ElementCategory } from '$lib/element'
  import { DEFAULT_CATEGORY_COLORS } from '$lib/colors'
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import { colors, selected } from '$lib/state.svelte'
  import type { HTMLAttributes } from 'svelte/elements'

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
    tile_font_color: null as string | null,
    tile_transition_duration: 0.4,
    hover_border_width: 1,
    symbol_font_weight: 400,
    number_font_weight: 300,
    tooltip_border_radius: 6,
    tooltip_padding: `4px 6px`,
    tooltip_line_height: 1.2,
    tooltip_text_align: `center`,
  }
  type ControlKey = keyof typeof defaults
  const range = (data_key: ControlKey, min: number, max: number, step: number) => ({
    'data-key': data_key,
    min,
    max,
    step,
  })
  const range_props = {
    tile_border_radius: range(`tile_border_radius`, 0, 10, 0.5),
    inner_transition_offset: range(`inner_transition_offset`, 0.1, 2, 0.1),
    tile_transition_duration: range(`tile_transition_duration`, 0.1, 2, 0.1),
    hover_border_width: range(`hover_border_width`, 0, 5, 1),
    symbol_font_size: range(`symbol_font_size`, 20, 80, 2),
    number_font_size: range(`number_font_size`, 10, 40, 1),
    name_font_size: range(`name_font_size`, 6, 24, 1),
    value_font_size: range(`value_font_size`, 10, 30, 1),
    symbol_font_weight: range(`symbol_font_weight`, 100, 900, 100),
    number_font_weight: range(`number_font_weight`, 100, 900, 100),
    tooltip_font_size: range(`tooltip_font_size`, 8, 24, 1),
    tooltip_border_radius: range(`tooltip_border_radius`, 0, 20, 1),
    tooltip_line_height: range(`tooltip_line_height`, 0.8, 2, 0.1),
  }

  let {
    tile_gap = $bindable(defaults.tile_gap),
    symbol_font_size = $bindable(defaults.symbol_font_size),
    number_font_size = $bindable(defaults.number_font_size),
    name_font_size = $bindable(defaults.name_font_size),
    value_font_size = $bindable(defaults.value_font_size),
    tooltip_font_size = $bindable(defaults.tooltip_font_size),
    tooltip_bg_color = $bindable(defaults.tooltip_bg_color),
    tile_border_radius = $bindable(defaults.tile_border_radius),
    inner_transition_offset = $bindable(defaults.inner_transition_offset),
    tile_font_color = $bindable(defaults.tile_font_color),
    // Additional Element Tile controls
    tile_transition_duration = $bindable(defaults.tile_transition_duration),
    hover_border_width = $bindable(defaults.hover_border_width),
    symbol_font_weight = $bindable(defaults.symbol_font_weight),
    number_font_weight = $bindable(defaults.number_font_weight),
    // Additional Tooltip controls
    tooltip_border_radius = $bindable(defaults.tooltip_border_radius),
    tooltip_padding = $bindable(defaults.tooltip_padding),
    tooltip_line_height = $bindable(defaults.tooltip_line_height),
    tooltip_text_align = $bindable(defaults.tooltip_text_align),
    ...rest
  }: HTMLAttributes<HTMLDivElement> & Partial<typeof defaults> = $props()

  // Apply CSS custom properties to document root
  $effect(() => {
    const css_vars = {
      '--ptable-gap': tile_gap,
      '--elem-symbol-font-size': `${symbol_font_size}cqw`,
      '--elem-number-font-size': `${number_font_size}cqw`,
      '--elem-name-font-size': `${name_font_size}cqw`,
      '--elem-value-font-size': `${value_font_size}cqw`,
      '--tooltip-font-size': `${tooltip_font_size}px`,
      '--tooltip-bg': tooltip_bg_color,
      '--elem-tile-border-radius': `${tile_border_radius}pt`,
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
  })

  const control_setters = {
    tile_gap: (value) => (tile_gap = value),
    symbol_font_size: (value) => (symbol_font_size = value),
    number_font_size: (value) => (number_font_size = value),
    name_font_size: (value) => (name_font_size = value),
    value_font_size: (value) => (value_font_size = value),
    tooltip_font_size: (value) => (tooltip_font_size = value),
    tooltip_bg_color: (value) => (tooltip_bg_color = value),
    tile_border_radius: (value) => (tile_border_radius = value),
    inner_transition_offset: (value) => (inner_transition_offset = value),
    tile_font_color: (value) => (tile_font_color = value),
    tile_transition_duration: (value) => (tile_transition_duration = value),
    hover_border_width: (value) => (hover_border_width = value),
    symbol_font_weight: (value) => (symbol_font_weight = value),
    number_font_weight: (value) => (number_font_weight = value),
    tooltip_border_radius: (value) => (tooltip_border_radius = value),
    tooltip_padding: (value) => (tooltip_padding = value),
    tooltip_line_height: (value) => (tooltip_line_height = value),
    tooltip_text_align: (value) => (tooltip_text_align = value),
  } satisfies { [Key in ControlKey]: (value: (typeof defaults)[Key]) => void }
  const reset_control = (
    key: string,
    reference_value: unknown,
    reference_present: boolean,
  ): void => {
    const setter = control_setters[key as ControlKey]
    if (!setter) throw new Error(`Unknown fixed control key ${key}`)
    if (!reference_present) throw new Error(`Missing reset value for fixed control ${key}`)
    setter(reference_value as never)
  }
  const reset_category_color = (
    category: string,
    reference_value: unknown,
    reference_present: boolean,
  ): void => {
    if (reference_present) colors.category[category] = reference_value as string
    else Reflect.deleteProperty(colors.category, category)
  }
</script>

<div {...rest} class={[`controls-grid`, rest.class]}>
  <div class="settings-card category-colors">
    <SettingsSection
      title="Element category colors"
      current_values={{ ...colors.category }}
      reset_values={DEFAULT_CATEGORY_COLORS}
      on_reset_key={reset_category_color}
      layout="grid"
    >
      {#each Object.keys(colors.category) as category (category)}
        <label
          data-key={category}
          onmouseenter={() => (selected.category = category as ElementCategory)}
          onfocusin={() => (selected.category = category as ElementCategory)}
          onmouseleave={() => (selected.category = null)}
          onfocusout={() => (selected.category = null)}
        >
          <span>{category}</span>
          <input type="color" bind:value={colors.category[category]} />
        </label>
      {/each}
    </SettingsSection>
  </div>

  <div class="settings-card">
    <SettingsSection
      title="Element tiles"
      current_values={{
        tile_gap,
        tile_border_radius,
        inner_transition_offset,
        tile_transition_duration,
        hover_border_width,
        tile_font_color,
      }}
      reset_values={defaults}
      on_reset_key={reset_control}
      layout="grid"
    >
      <label data-key="tile_gap">
        <span>Gap between tiles</span>
        <input type="text" bind:value={tile_gap} placeholder="0.3cqw" />
      </label>
      <NumberRangeInput {...range_props.tile_border_radius} bind:value={tile_border_radius}
        >Border radius (pt)</NumberRangeInput
      >
      <NumberRangeInput
        {...range_props.inner_transition_offset}
        bind:value={inner_transition_offset}>Inner transition offset</NumberRangeInput
      >
      <NumberRangeInput
        {...range_props.tile_transition_duration}
        bind:value={tile_transition_duration}>Transition duration (s)</NumberRangeInput
      >
      <NumberRangeInput {...range_props.hover_border_width} bind:value={hover_border_width}
        >Hover border width (px)</NumberRangeInput
      >
      <label data-key="tile_font_color">
        <span>Automatic font contrast</span>
        <input
          type="checkbox"
          checked={tile_font_color === null}
          onchange={(event) => {
            tile_font_color = event.currentTarget.checked ? null : `#ffffff`
          }}
        />
      </label>
      <label>
        <span>Font color</span>
        <input
          aria-label="Tile font color"
          type="color"
          value={tile_font_color ?? `#ffffff`}
          disabled={tile_font_color === null}
          oninput={(event) => (tile_font_color = event.currentTarget.value)}
        />
      </label>
    </SettingsSection>
  </div>

  <div class="settings-card">
    <SettingsSection
      title="Font sizes"
      current_values={{
        symbol_font_size,
        number_font_size,
        name_font_size,
        value_font_size,
        symbol_font_weight,
        number_font_weight,
      }}
      reset_values={defaults}
      on_reset_key={reset_control}
      layout="grid"
    >
      <NumberRangeInput {...range_props.symbol_font_size} bind:value={symbol_font_size}
        >Symbol size</NumberRangeInput
      >
      <NumberRangeInput {...range_props.number_font_size} bind:value={number_font_size}
        >Number size</NumberRangeInput
      >
      <NumberRangeInput {...range_props.name_font_size} bind:value={name_font_size}
        >Name size</NumberRangeInput
      >
      <NumberRangeInput {...range_props.value_font_size} bind:value={value_font_size}
        >Value size</NumberRangeInput
      >
      <NumberRangeInput {...range_props.symbol_font_weight} bind:value={symbol_font_weight}
        >Symbol weight</NumberRangeInput
      >
      <NumberRangeInput {...range_props.number_font_weight} bind:value={number_font_weight}
        >Number weight</NumberRangeInput
      >
    </SettingsSection>
  </div>

  <div class="settings-card">
    <SettingsSection
      title="Tooltip"
      current_values={{
        tooltip_font_size,
        tooltip_bg_color,
        tooltip_border_radius,
        tooltip_padding,
        tooltip_line_height,
        tooltip_text_align,
      }}
      reset_values={defaults}
      on_reset_key={reset_control}
      layout="grid"
    >
      <NumberRangeInput {...range_props.tooltip_font_size} bind:value={tooltip_font_size}
        >Font size (px)</NumberRangeInput
      >
      <label data-key="tooltip_bg_color">
        <span>Background color</span>
        <input type="color" bind:value={tooltip_bg_color} />
      </label>
      <NumberRangeInput
        {...range_props.tooltip_border_radius}
        bind:value={tooltip_border_radius}>Border radius (px)</NumberRangeInput
      >
      <label data-key="tooltip_padding">
        <span>Padding</span>
        <input type="text" bind:value={tooltip_padding} placeholder="4px 6px" />
      </label>
      <NumberRangeInput {...range_props.tooltip_line_height} bind:value={tooltip_line_height}
        >Line height</NumberRangeInput
      >
      <label data-key="tooltip_text_align">
        <span>Text align</span>
        <select bind:value={tooltip_text_align}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
    </SettingsSection>
  </div>
</div>

<style>
  .controls-grid {
    display: grid;
    grid-template-columns: var(--ptable-ctrl-columns, repeat(auto-fit, minmax(320px, 1fr)));
    gap: var(--ptable-ctrl-gap, 1.5em);
    margin: var(--ptable-ctrl-margin, 2em auto);
    padding: 0 1em;
    max-width: 1200px;
  }
  .settings-card {
    background: var(--surface-bg);
    border-radius: 6px;
    padding: 6pt 2ex;
    --ctrl-label-w: 10em;
    --ctrl-value-w: 4.2em;
    --settings-row-gap: 0.6em;
  }
  .settings-card :global(h4) {
    margin: 0 0 0.8em 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    padding-bottom: 0.3em;
    max-height: max-content;
  }
  .settings-card :global(.settings-section > label) {
    font-size: 0.9em;
  }
  .settings-card :global(.settings-section > label > span:first-child) {
    font-weight: 500;
    font-size: 0.85em;
  }
  .settings-card :global(.settings-section > label input[type='number']) {
    width: 60px;
    padding: 2px 4px;
    border-radius: 3px;
  }
  .settings-card :global(.settings-section > label :is(input[type='text'], select)) {
    box-sizing: border-box;
    width: 100%;
    padding: 4px 6px;
    border-radius: 3px;
  }
  .settings-card :global(.settings-section > label input[type='color']) {
    width: 50px;
    height: 20px;
    border-radius: 3px;
    border: 1px solid var(--border-color);
  }
  .settings-card :global(.settings-section > label select) {
    cursor: pointer;
  }
  .category-colors :global(.settings-section) {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    column-gap: 1em;
    --ctrl-cols: minmax(0, 1fr) auto 0;
  }
  .category-colors :global(.settings-section > label) {
    text-transform: capitalize;
    transition: background-color 0.2s;
  }
  .category-colors :global(.settings-section > label input[type='color']) {
    width: 25px;
    height: 25px;
    min-width: 25px;
    min-height: 25px;
    border-radius: 50%;
    overflow: hidden;
    cursor: pointer;
  }
</style>
