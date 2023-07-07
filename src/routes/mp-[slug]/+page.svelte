<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import { MaterialCard, Structure, StructureCard } from '$lib'
  import { aws_bucket, download, fetch_zipped } from '$lib/api'

  export let data

  let mp_id: string = `mp-${$page.params.slug}`
  $: href = `https://materialsproject.org/materials/${mp_id}`
  $: aws_url = `${aws_bucket}/summary/${mp_id}.json.gz`
</script>

<main>
  <center>
    <h1>Materials Explorer</h1>

    <input
      placeholder="Enter MP material ID"
      bind:value={mp_id}
      on:keydown={async (event) => {
        if (event.key === `Enter`) {
          goto(`/${mp_id}`)
          data.summary = await fetch_zipped(aws_url)
        }
      }}
    />
    <button
      on:click={async () => {
        goto(`/${mp_id}`)
        data.summary = await fetch_zipped(aws_url)
      }}
    >
      Fetch material
    </button>
    <span class="download">
      <button>Save material summary</button>
      <div>
        <button
          on:click={() => {
            if (!data.summary) return alert(`No data to download`)
            download(
              JSON.stringify(data.summary, null, 2),
              `${mp_id}.json`,
              `application/json`
            )
          }}>JSON</button
        >
        <button
          on:click={async () => {
            const blob = await fetch_zipped(aws_url, { unzip: false })
            if (!blob) return
            download(blob, `${mp_id}.json.gz`, `application/gzip`)
          }}>Zipped JSON</button
        >
      </div>
    </span>
  </center>
  <MaterialCard material={data.summary} />
  <StructureCard structure={data.summary.structure}>
    <a slot="title" {href}>{mp_id}</a>
  </StructureCard>
  <Structure structure={data.summary.structure} show_image_atoms={false} />
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
</style>
