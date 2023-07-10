<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'

  if ($page.url.pathname.match(/^\/mp-\d+$/)) {
    goto($page.url.pathname)
  }
</script>
