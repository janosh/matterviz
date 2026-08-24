<script lang="ts">
  // Docs playground for the periodic table's CSS custom properties: every control writes one
  // variable onto the document root, so all tables on the page follow it. Only the tile font
  // color is bindable: it maps to ElementTile's text_color prop, which the demo passes through.
  import { DEFAULT_CATEGORY_COLORS } from '$lib/colors'
  import type { ElementCategory } from '$lib/element'
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import { colors, selected } from '$lib/state.svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  const defaults = {
    tile_gap: `0.3cqw`,
    tile_border_radius: 1,
    inner_transition_offset: 0.5,
    tile_transition_duration: 0.4,
    hover_border_width: 1,
    symbol_font_size: 40,
    number_font_size: 22,
    name_font_size: 12,
    value_font_size: 18,
    symbol_font_weight: 400,
    number_font_weight: 300,
    tooltip_font_size: 14,
    tooltip_bg_color: `#000000`,
    tooltip_border_radius: 6,
    tooltip_padding: `4px 6px`,
    tooltip_line_height: 1.2,
    tooltip_text_align: `center`,
  }
  type ControlKey = keyof typeof defaults
  // [label, min, max, step] of every slider control
  const RANGES = {
    tile_border_radius: [`Border radius (pt)`, 0, 10, 0.5],
    inner_transition_offset: [`Inner transition offset`, 0.1, 2, 0.1],
    tile_transition_duration: [`Transition duration (s)`, 0.1, 2, 0.1],
    hover_border_width: [`Hover border width (px)`, 0, 5, 1],
    symbol_font_size: [`Symbol size`, 20, 80, 2],
    number_font_size: [`Number size`, 10, 40, 1],
    name_font_size: [`Name size`, 6, 24, 1],
    value_font_size: [`Value size`, 10, 30, 1],
    symbol_font_weight: [`Symbol weight`, 100, 900, 100],
    number_font_weight: [`Number weight`, 100, 900, 100],
    tooltip_font_size: [`Font size (px)`, 8, 24, 1],
    tooltip_border_radius: [`Border radius (px)`, 0, 20, 1],
    tooltip_line_height: [`Line height`, 0.8, 2, 0.1],
  } as const satisfies Partial<Record<ControlKey, readonly [string, number, number, number]>>
  type RangeKey = keyof typeof RANGES
  const TILE_SLIDER_KEYS = [
    `tile_border_radius`,
    `inner_transition_offset`,
    `tile_transition_duration`,
    `hover_border_width`,
  ] as const
  const TILE_KEYS = [`tile_gap`, ...TILE_SLIDER_KEYS] as const
  const FONT_KEYS = [
    `symbol_font_size`,
    `number_font_size`,
    `name_font_size`,
    `value_font_size`,
    `symbol_font_weight`,
    `number_font_weight`,
  ] as const
  const TOOLTIP_KEYS = [
    `tooltip_font_size`,
    `tooltip_bg_color`,
    `tooltip_border_radius`,
    `tooltip_padding`,
    `tooltip_line_height`,
    `tooltip_text_align`,
  ] as const

  let {
    tile_font_color = $bindable(null),
    ...rest
  }: HTMLAttributes<HTMLDivElement> & { tile_font_color?: string | null } = $props()

  let controls = $state({ ...defaults })
  const pick = (keys: readonly ControlKey[]) =>
    Object.fromEntries(keys.map((key) => [key, controls[key]]))

  $effect(() => {
    const css_vars = {
      '--ptable-gap': controls.tile_gap,
      '--ptable-inner-transition-offset': `${controls.inner_transition_offset}`,
      '--elem-tile-border-radius': `${controls.tile_border_radius}pt`,
      '--elem-tile-transition-duration': `${controls.tile_transition_duration}s`,
      '--elem-tile-hover-border-width': `${controls.hover_border_width}px`,
      '--elem-symbol-font-size': `${controls.symbol_font_size}cqw`,
      '--elem-number-font-size': `${controls.number_font_size}cqw`,
      '--elem-name-font-size': `${controls.name_font_size}cqw`,
      '--elem-value-font-size': `${controls.value_font_size}cqw`,
      '--elem-symbol-font-weight': `${controls.symbol_font_weight}`,
      '--elem-number-font-weight': `${controls.number_font_weight}`,
      '--tooltip-font-size': `${controls.tooltip_font_size}px`,
      '--tooltip-bg': controls.tooltip_bg_color,
      '--tooltip-border-radius': `${controls.tooltip_border_radius}px`,
      '--tooltip-padding': controls.tooltip_padding,
      '--tooltip-line-height': `${controls.tooltip_line_height}`,
      '--tooltip-text-align': controls.tooltip_text_align,
    }
    for (const [prop, val] of Object.entries(css_vars)) {
      document.documentElement.style.setProperty(prop, val)
    }
  })

  const reset_control = (
    key: string,
    reference_value: unknown,
    reference_present: boolean,
  ): void => {
    if (!reference_present) throw new Error(`Missing reset value for control ${key}`)
    if (key === `tile_font_color`) tile_font_color = reference_value as string | null
    else if (key in defaults) Reflect.set(controls, key, reference_value)
    else throw new Error(`Unknown control key ${key}`)
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

{#snippet slider(key: RangeKey)}
  {@const [label, min, max, step] = RANGES[key]}
  <NumberRangeInput data-key={key} {min} {max} {step} bind:value={controls[key]}>
    {label}
  </NumberRangeInput>
{/snippet}

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
      current_values={{ ...pick(TILE_KEYS), tile_font_color }}
      reset_values={{ ...defaults, tile_font_color: null }}
      on_reset_key={reset_control}
      layout="grid"
    >
      <label data-key="tile_gap">
        <span>Gap between tiles</span>
        <input type="text" bind:value={controls.tile_gap} placeholder="0.3cqw" />
      </label>
      {#each TILE_SLIDER_KEYS as key (key)}
        {@render slider(key)}
      {/each}
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
      current_values={pick(FONT_KEYS)}
      reset_values={defaults}
      on_reset_key={reset_control}
      layout="grid"
    >
      {#each FONT_KEYS as key (key)}
        {@render slider(key)}
      {/each}
    </SettingsSection>
  </div>

  <div class="settings-card">
    <SettingsSection
      title="Tooltip"
      current_values={pick(TOOLTIP_KEYS)}
      reset_values={defaults}
      on_reset_key={reset_control}
      layout="grid"
    >
      {@render slider(`tooltip_font_size`)}
      <label data-key="tooltip_bg_color">
        <span>Background color</span>
        <input type="color" bind:value={controls.tooltip_bg_color} />
      </label>
      {@render slider(`tooltip_border_radius`)}
      <label data-key="tooltip_padding">
        <span>Padding</span>
        <input type="text" bind:value={controls.tooltip_padding} placeholder="4px 6px" />
      </label>
      {@render slider(`tooltip_line_height`)}
      <label data-key="tooltip_text_align">
        <span>Text align</span>
        <select bind:value={controls.tooltip_text_align}>
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
