<script lang="ts">
  // Camera settings section: projection select plus children (pass changed_keys/on_reset for them)
  import { SettingsSection } from '#lib/layout/index.js'
  import type { CameraProjection } from '#lib/settings.js'
  import type { ComponentProps } from 'svelte'

  let {
    camera_projection = $bindable(),
    default_projection,
    children,
    ...rest
  }: Partial<ComponentProps<typeof SettingsSection>> & {
    camera_projection: CameraProjection
    default_projection: CameraProjection
  } = $props()
</script>

<SettingsSection
  title="Camera"
  changed_keys={camera_projection === default_projection ? [] : [`camera_projection`]}
  on_reset={() => (camera_projection = default_projection)}
  layout="grid"
  {...rest}
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
