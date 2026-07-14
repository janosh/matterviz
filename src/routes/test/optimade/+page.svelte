<script lang="ts">
  import { goto } from '$app/navigation'
</script>

<div style="text-align: center; padding: 2em">
  <h1>OPTIMADE Route Test</h1>

  <p>
    Test the OPTIMADE structure viewer with these example structure IDs from different
    providers:
  </p>

  <div
    style="display: flex; gap: 1em; justify-content: center; flex-wrap: wrap; margin: 2em 0"
  >
    {#each [`mp-1`, `mp-149`, `mp-12263251`, `cod-1000000`] as id (id)}
      <button
        onclick={() => goto(`/optimade-${id}`)}
        style="padding: 0.5em 1em; border: 1px solid #ccc; border-radius: 4pt; background: #f0f0f0; cursor: pointer"
      >
        {id}
      </button>
    {/each}
  </div>
</div>
