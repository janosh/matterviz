<script lang="ts">
  import { fetch_zipped, mp_build_bucket } from '$lib/api'
  import { url_param_store } from 'svelte-zoo'

  let { data = $bindable() } = $props()

  const mp_id = url_param_store(`id`, `mp-1`)
  let aws_url = $derived(`${mp_build_bucket}/summary/${$mp_id}.json.gz`)

  const responses: Record<string, unknown> = $state({})
</script>

<main>
  <h1>API Explorer</h1>
  <center>
    <input
      placeholder="Enter MP material ID"
      bind:value={$mp_id}
      onkeydown={async (event) => {
        if (event.key === `Enter`) data.summary = await fetch_zipped(aws_url)
      }}
    />
    <button onclick={async () => (data.summary = await fetch_zipped(aws_url))}>
      Fetch material
    </button>
  </center>

  <h2>Available AWS Open Data Buckets</h2>
  <ol style="columns: 3;">
    {#each data.buckets as bucket_name (bucket_name)}
      <li>
        <code>{bucket_name}</code>
      </li>
    {/each}
  </ol>
  {#each data.buckets as bucket_name, idx (bucket_name)}
    <details
      ontoggle={async () => {
        let err = true
        let id = 1
        while (err && id < 20) {
          try {
            responses[bucket_name] = await fetch_zipped(
              `${mp_build_bucket}/${bucket_name}/mp-${id}.json.gz`,
            )
            err = false
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (_error) {
            id++
          }
        }
      }}
    >
      <summary>
        <h3>{idx + 1}. <code>{bucket_name}</code> bucket</h3>
      </summary>
      <details open>
        <summary><h4>Top-level keys</h4> </summary>
        <ul>
          {#each Object.entries(responses[bucket_name] ?? {}) as [key, val] (key)}
            <li><span class="key">{key}</span>: <small>{typeof val}</small></li>
          {/each}
        </ul>
      </details>
      <details>
        <summary><h4>Full Response</h4></summary>

        <pre>{JSON.stringify(responses[bucket_name], null, 2)}</pre>
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
  summary :is(:global(h3, h4)) {
    margin: 1ex;
    display: inline-block;
  }
  details > :not(summary) {
    padding-left: 1em;
  }
  pre {
    font-size: 9.5pt;
  }
</style>
