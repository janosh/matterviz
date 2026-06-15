<script lang="ts">
  // Recording stub standing in for the real matterviz components, so a test can
  // assert the exact drive/writeback wiring of the anywidget renderers (key-name
  // typos, drive-vs-writeback mistakes, scatter callbacks/event_id) without
  // mounting the real WebGL/SVG components. Declares the interaction $bindables
  // used across the reactive renderers so the test can mutate them (simulating
  // component-side interaction) and assert the value flows back to the model.
  // $bindable() has no fallback, so an absent key (e.g. these on the scatter
  // renderer) stays undefined without tripping Svelte's props_invalid_value.
  // Everything else lands in `rest` (drive props + extra callbacks).
  import { register_stub } from './reactive-renderer-registry'

  let {
    selected_sites = $bindable(),
    hovered_site_idx = $bindable(),
    current_step_idx = $bindable(),
    ...rest
  }: Record<string, unknown> = $props()

  const write = (key: string, value: unknown): void => {
    if (key === `selected_sites`) selected_sites = value
    else if (key === `hovered_site_idx`) hovered_site_idx = value
    else if (key === `current_step_idx`) current_step_idx = value
    else throw new Error(`reactive-renderer-stub has no $bindable for '${key}'`)
  }
  const read = (): Record<string, unknown> => ({
    ...rest,
    selected_sites,
    hovered_site_idx,
    current_step_idx,
  })
  register_stub({ read, write })
</script>
