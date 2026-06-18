<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'

  if (/^\/mp-\d+$/.test(page.url.pathname)) {
    goto(page.url.pathname)
  }
</script>
