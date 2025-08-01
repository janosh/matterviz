<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { format_num, MaterialCard, Structure } from '$lib'
  import { download, fetch_zipped } from '$lib/io/fetch'
  import { fetch_material_data, mp_bucket } from '$lib/mp-api'
  import type { RobocrystallogapherDoc, SimilarityDoc, SummaryDoc } from '$types'

  const file = `mp-${page.params.slug}.json.gz`
  const summary_url = `${mp_bucket}/summary/${file}`
  const similarity_url = `${mp_bucket}/similarity/${file}`
  const robocrys_url = `${mp_bucket}/robocrys/${file}`

  let summary = $state(await fetch_zipped<SummaryDoc>(summary_url))
  let similarity = $state(await fetch_zipped<SimilarityDoc>(similarity_url))
  let robocrys = $state(await fetch_zipped<RobocrystallogapherDoc>(robocrys_url))

  let input_value = $state(`mp-${page.params.slug}`)
  let mp_id = $derived(input_value.trim().toLowerCase())
  let href = $derived(`https://materialsproject.org/materials/${mp_id}`)
  let aws_url = $derived(`${mp_bucket}/summary/${mp_id}.json.gz`)
</script>

<main>
  <center style="margin: 1em 0">
    <h1>
      Materials Explorer - {summary?.formula_pretty}
      <span style="font-weight: lighter">(<a {href}>{mp_id}</a>)</span>
    </h1>

    <input
      placeholder="Enter MP material ID"
      bind:value={input_value}
      onkeydown={async (event) => {
        if (event.key === `Enter`) {
          goto(`/${mp_id}`)
          ;({ summary, similarity, robocrys } = await fetch_material_data(mp_id))
        }
      }}
    />
    <button
      onclick={async () => {
        goto(`/${mp_id}`)
        ;({ summary, similarity, robocrys } = await fetch_material_data(mp_id))
      }}
    >
      Fetch material
    </button>
    <span class="download">
      <button>Save material summary</button>
      <div>
        <button
          onclick={() => {
            if (!summary) return alert(`No data to download`)
            download(
              JSON.stringify(summary, null, 2),
              `${mp_id}.json`,
              `application/json`,
            )
          }}
        >
          JSON
        </button>
        <button
          onclick={async () => {
            const blob = await fetch_zipped(aws_url, { unzip: false })
            if (!blob) return
            download(blob, `${mp_id}.json.gz`, `application/gzip`)
          }}
        >
          Zipped JSON
        </button>
      </div>
    </span>
  </center>
  {#if summary?.structure}
    <Structure structure={summary.structure} />
  {/if}

  {#if summary}
    <MaterialCard material={summary} />
  {/if}

  {#if robocrys?.description}
    <h3>
      Crystal description
      <small>
        (generated by <a
          href="https://github.com/hackingmaterials/robocrystallographer"
        >Robocrystallographer
        </a>)
      </small>
    </h3>
    <p>{robocrys.description}</p>
  {/if}

  {#if similarity}
    <h2>Similar structures</h2>
    <ol class="similar-structures">
      {#each similarity.sim?.slice(0, 6) ?? [] as
        { task_id, dissimilarity, formula }
        (task_id + formula + dissimilarity)
      }
        <li>
          <strong>
            <a href="https://materialsproject.org/tasks/{task_id}">{task_id}</a>
          </strong>
          <span>{formula}</span>
          <br />
          <small>dissimilarity: {format_num(dissimilarity)}</small>
        </li>
      {:else}
        <li>No similar structures found</li>
      {/each}
    </ol>
  {/if}
</main>

<style>
  .download {
    position: relative;
  }
  .download div {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    opacity: 0;
    transition: opacity 0.3s ease-in-out;
  }
  .download div::before {
    /* increase top hover area */
    content: '';
    position: absolute;
    top: -6pt;
    left: 0;
    width: 100%;
    height: 100%;
  }
  .download:hover div {
    display: grid;
    gap: 3pt;
    opacity: 1;
    background-color: rgba(255, 255, 255, 0.12);
    margin: 4pt 0 0;
    padding: 3pt;
    border-radius: 3pt;
  }
  .download button {
    z-index: 1;
  }
  .similar-structures {
    display: flex;
    justify-content: space-around;
    flex-wrap: wrap;
    gap: 1em;
  }
  ol {
    list-style: none;
    text-align: center;
  }
  ol li span {
    font-weight: lighter;
    margin-left: 1em;
  }
</style>
