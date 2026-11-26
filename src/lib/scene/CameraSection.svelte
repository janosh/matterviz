<script lang="ts">
  // Camera settings section: projection select plus children. Callers pass changed_keys/on_reset
  // for their children's settings; they're merged with the projection's own tracking and reset.
  import SettingsSection from 'svelte-widgets/SettingsSection.svelte'
  import type { CameraProjection } from '#lib/settings'
  import type { ComponentProps } from 'svelte'

  let {
    camera_projection = $bindable(),
    default_projection,
    changed_keys = [],
    on_reset,
    children,
    ...rest
  }: Partial<ComponentProps<typeof SettingsSection>> & {
    camera_projection: CameraProjection
    default_projection: CameraProjection
  } = $props()
</script>

<SettingsSection
  title="Camera"
  layout="grid"
  {...rest}
  changed_keys={camera_projection === default_projection
    ? changed_keys
    : [`camera_projection`, ...changed_keys]}
  on_reset={() => {
    camera_projection = default_projection
    on_reset?.()
  }}
>
  <label>
    <span>Projection</span>
    <select bind:value={camera_projection}>
      <option value="perspective">Perspective</option>
      <option value="orthographic">Orthographic</option>
    </select>
  </label>
  {@render children?.()}
</SettingsSection>
