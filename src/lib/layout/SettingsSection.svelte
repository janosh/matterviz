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

  // Seed the shared component with this section's reset baseline, then feed it live values.
  let compared_values = $derived(
    untrack(() =>
      reset_values
        ? Object.fromEntries(
            Object.entries(reset_values).filter(([key]) => Object.hasOwn(current_values, key)),
          )
        : current_values,
    ),
  )
  $effect(() => {
    compared_values = current_values
  })
</script>

<SharedSettingsSection {...rest} current_values={compared_values} />
