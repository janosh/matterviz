<script lang="ts">
  import { fetch_zipped, mp_build_bucket } from '$lib/api'
  import { url_param_store } from 'svelte-zoo'

  export let data

  const mp_id = url_param_store(`id`, `mp-1`)
  $: aws_url = `${mp_build_bucket}/summary/${$mp_id}.json.gz`

  const responses: Record<string, unknown> = {}
</script>

<main>
  <h1>API Explorer</h1>
  <center>
    <input
      placeholder="Enter MP material ID"
      bind:value={$mp_id}
      on:keydown={async (event) => {
        if (event.key === `Enter`) data.summary = await fetch_zipped(aws_url)
      }}
    />
    <button on:click={async () => (data.summary = await fetch_zipped(aws_url))}>
      Fetch material
    </button>
  </center>

  <h2>Available AWS Open Data Buckets</h2>
  <ol style="columns: 3;">
    {#each data.buckets as bucket_name}
      <li>
        <code>{bucket_name}</code>
      </li>
    {/each}
  </ol>
  {#each data.buckets as bucket_name, idx}
    <details
      on:toggle={async () => {
        let err = true
        let id = 1
        while (err && id < 20) {
          try {
            responses[bucket_name] = await fetch_zipped(
              `${mp_build_bucket}/${bucket_name}/mp-${id}.json.gz`
            )
            err = false
          } catch (err) {
            id++
          }
        }
      }}
    >
      <summary>
        <h3>{idx+1}. <code>{bucket_name}</code> bucket</h3>
      </summary>
      <details open>
        <summary><h4>Top-level keys</h4> </summary>
        <ul>
          {#each Object.entries(responses[bucket_name] ?? {}) as [key, val]}
            <li><span class="key">{key}</span>: <small>{typeof val}</small></li>
          {/each}
        </ul>
      </details>
      <details>
        <summary><h4>Full Response</h4></summary>

        <pre>{JSON.stringify(data[bucket_name], null, 2)}</pre>
      </details>
    </details>
  {/each}
</main>

<style>
  h1 {
    text-align: center;
  }
  ul {
    list-style: none;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 5pt 3ex;
  }
  ul li .key {
    font-weight: bold;
    font-family: monospace;
  }
  ul li small {
    font-weight: lighter;
  }
  summary :is(h3, h4) {
    margin: 1ex;
    display: inline-block;
  }
  details > :not(summary) {
    padding-left: 1em;
  }
</style>
