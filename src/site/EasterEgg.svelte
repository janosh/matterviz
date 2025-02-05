<script lang="ts">
  import { pretty_num } from '$lib/labels'

  export let x_angle = 0
  export let y_angle = 0
  export let auto_rotate: `x` | `y` | `both` | `none` = `none`

  let show_easter_egg = false
</script>

<div class:visible={show_easter_egg}>
  <p>You found the easter egg!</p>
  <label>
    Rotate X = <span>{pretty_num(x_angle)}</span>
    <input type="range" bind:value={x_angle} max={360} />
  </label>
  <label>
    Rotate Y = <span>{pretty_num(y_angle)}</span>
    <input type="range" bind:value={y_angle} max={360} />
  </label>
  <section>
    Auto rotate
    {#each [`x`, `y`, `both`, `none`] as value}
      {@const checked = value === `none`}
      <label>
        <input type="radio" bind:group={auto_rotate} {value} {checked} />{value}
      </label>
    {/each}
  </section>
  <button on:click|stopPropagation={() => (show_easter_egg = !show_easter_egg)}>
    close
  </button>
</div>

<style>
  div {
    position: fixed;
    bottom: 1em;
    right: 1em;
    opacity: 0;
    background-color: rgba(255, 255, 255, 0.1);
    padding: 3pt 8pt;
    border-radius: 3pt;
    transition: opacity 0.3s;
    overflow: hidden;
  }
  div:not(.visible) > :is(label, input) {
    /* don't react to mouse input if easter egg is hidden */
    pointer-events: none;
  }
  div.visible {
    opacity: 1;
    pointer-events: auto;
  }
  div > p {
    margin: 0;
  }
  div > label {
    display: flex;
    align-items: center;
  }
  div > label > span {
    min-width: 3.5ex;
    padding-left: 3pt;
  }
  div > label > input {
    margin-left: 1em;
  }
  div > label > input[type='range'] {
    flex: 1;
    padding: 1ex;
    min-width: 13em;
  }
  div > button {
    position: absolute;
    bottom: 0;
    right: 0;
    background-color: rgba(255, 255, 255, 0.2);
    color: var(--text-color);
    padding: 4pt 6pt;
    border-radius: 1ex 0 0 0;
    cursor: pointer;
  }
</style>
