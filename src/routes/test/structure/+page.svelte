<script lang="ts">
  import Structure from '$lib/structure/Structure.svelte'
  import initial_structure_data from '$site/structures/mp-1.json'

  let test_structure = $state(initial_structure_data)

  let controls_open = $state(false)
  let canvas = $state({ width: 600, height: 400 })
  let background_color = $state(`#1e1e1e`)
</script>

<svelte:head>
  <title>Structure Component Test</title>
</svelte:head>

<h1>Structure Component Test Page</h1>

<section>
  <h2>Controls for Test Page</h2>
  <label>
    Controls Open:
    <input type="checkbox" bind:checked={controls_open} />
  </label>
  <br />
  <label>
    Structure ID (read-only):
    <input type="text" readonly value={test_structure?.id ?? `N/A`} />
  </label>
  <br />
  <label>
    Canvas Width:
    <input type="number" bind:value={canvas.width} />
  </label>
  <br />
  <label>
    Canvas Height:
    <input type="number" bind:value={canvas.height} />
  </label>
  <br />
  <label>
    Background Color:
    <input type="color" bind:value={background_color} />
  </label>
</section>

<hr />

<div
  id="structure-wrapper"
  style="width: {canvas.width}px; height: {canvas.height}px; border: 1px solid #ccc; margin-top: 20px;"
>
  <Structure
    bind:structure={test_structure}
    bind:controls_open
    bind:width={canvas.width}
    bind:height={canvas.height}
    {background_color}
    reveal_buttons={true}
  />
</div>

<div data-testid="controls-open-status" style="margin-top: 10px;">
  Controls Open Status: {controls_open}
</div>
<div data-testid="structure-id-status">
  Structure ID Status: {test_structure?.id ?? `undefined`}
</div>
<div data-testid="canvas-width-status">Canvas Width Status: {canvas.width}</div>
<div data-testid="canvas-height-status">Canvas Height Status: {canvas.height}</div>

<style>
  section {
    margin-bottom: 20px;
    padding: 10px;
    border: 1px solid lightgray;
    border-radius: 5px;
  }
  label {
    display: inline-block;
    margin-bottom: 5px;
    margin-right: 15px;
  }
  input[type='number'] {
    width: 60px;
  }
</style>
