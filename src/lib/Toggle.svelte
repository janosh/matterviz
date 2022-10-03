<script lang="ts">
  export let checked = false // whether the toggle is on or off
  export let required = false
  export let style = ``
  export let id = ``

  // normally input type=checkbox toggles on space bar, thids handler also responds to enter
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === `Enter`) {
      checked = !checked
      event.preventDefault()
    }
  }
</script>

<label {style}>
  <slot />
  <input type="checkbox" bind:checked {id} {required} on:keydown={handleKeydown} />
  <span />
</label>

<style>
  label {
    display: inline-flex;
    align-items: center;
    width: max-content;
  }
  span {
    height: 1.5em;
    width: 2.7em;
    padding: 0.1em;
    box-sizing: border-box;
    border: 1px solid lightgray;
    border-radius: 0.75em;
    transition: 0.3s;
  }
  input:checked + span {
    background: black;
  }
  input {
    position: absolute;
    opacity: 0;
    width: 1em;
  }
  input + span::after {
    content: '';
    display: block;
    height: 1.2em;
    width: 1.2em;
    border-radius: 50%;
    background: gray;
    transition: 0.3s;
  }
  input:checked + span::after {
    background: green;
    transform: translate(100%);
  }
  input:focus + span {
    border: 1px solid cornflowerblue;
  }
</style>
