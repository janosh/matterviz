<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { normalize_static_url } from '$site/state.svelte'

  const pathname = normalize_static_url(page.url.pathname)
  if (/^\/mp-\d+$/.test(pathname)) {
    goto(pathname)
  }
</script>
