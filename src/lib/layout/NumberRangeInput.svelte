<!-- Keep local until upstream rejects null/invalid numeric updates instead of writing them. -->
<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import { NumberRangeInput as UpstreamNumberRangeInput } from 'svelte-widgets'

  let { value = $bindable(), ...rest }: ComponentProps<typeof UpstreamNumberRangeInput> =
    $props()

  const update_value = (next_value: number | null | undefined): void => {
    if (typeof next_value === `number` && Number.isFinite(next_value)) value = next_value
  }
</script>

<UpstreamNumberRangeInput {...rest} bind:value={() => value, update_value} />
