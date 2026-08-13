<script lang="ts">
  import { SettingsSection as SharedSettingsSection } from 'svelte-widgets'
  import { type ComponentProps, untrack } from 'svelte'

  let {
    current_values = {},
    reset_values,
    ...rest
  }: ComponentProps<typeof SharedSettingsSection> & {
    reset_values?: Record<string, unknown>
  } = $props()

  // Seed the shared component with an explicit reset baseline, then feed it live values.
  let compared_values = $state(untrack(() => reset_values ?? current_values))
  $effect(() => {
    compared_values = current_values
  })
</script>

<SharedSettingsSection {...rest} current_values={compared_values} />
