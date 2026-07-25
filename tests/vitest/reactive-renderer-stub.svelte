<script lang="ts">
  // Recording stub for real matterviz components: verifies exact anywidget
  // renderer wiring (drive/writeback keys, scatter callbacks/event_id) without
  // mounting WebGL/SVG components. Declares interaction $bindables so tests can
  // simulate component-side mutations and assert model writeback. $bindable() has
  // no fallback, so absent keys (e.g. on scatter) remain undefined without
  // Svelte props_invalid_value; all other props land in rest (drive props + callbacks).
  import { register_stub } from './reactive-renderer-registry'

  let {
    selected_sites = $bindable(),
    hovered_site_idx = $bindable(),
    current_step_idx = $bindable(),
    active_volume_idx = $bindable(),
    display_mode = $bindable(),
    slice_settings = $bindable(),
    zoom_root_id = $bindable(),
    ...rest
  }: Record<string, unknown> = $props()

  const write = (key: string, value: unknown): void => {
    if (key === `selected_sites`) selected_sites = value
    else if (key === `hovered_site_idx`) hovered_site_idx = value
    else if (key === `current_step_idx`) current_step_idx = value
    else if (key === `active_volume_idx`) active_volume_idx = value
    else if (key === `display_mode`) display_mode = value
    else if (key === `slice_settings`) slice_settings = value
    else if (key === `zoom_root_id`) zoom_root_id = value
    else throw new Error(`reactive-renderer-stub has no $bindable for '${key}'`)
  }
  const read = (): Record<string, unknown> => ({
    ...rest,
    selected_sites,
    hovered_site_idx,
    current_step_idx,
    active_volume_idx,
    display_mode,
    slice_settings,
    zoom_root_id,
  })
  register_stub({ read, write })
</script>
