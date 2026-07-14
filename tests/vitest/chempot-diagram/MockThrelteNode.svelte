<script lang="ts">
  let { children, ref = $bindable(), ...rest } = $props()
</script>

{@render children?.()}
