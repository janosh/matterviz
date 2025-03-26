<script lang="ts">
  import 'iconify-icon'
  interface Props {
    [key: string]: unknown
  }
  let { ...props }: Props = $props()
</script>

<iconify-icon inline {...props} style="padding: 0 5pt 0 0;"></iconify-icon>
