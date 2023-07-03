<script lang="ts">
  import type { Composition } from '$lib'
  import { element_data, get_text_color } from '$lib'
  import { default_element_colors } from '$lib/colors'
  import { element_colors } from '$lib/stores'
  import { Tooltip } from 'svelte-zoo'

  export let elements: Composition
  export let elem_color_picker_title: string = `Double click to reset color`
  export let labels: HTMLLabelElement[] = []
  export let tips_modal: HTMLDialogElement | undefined = undefined
  export let style: string | null = null
</script>

<div {style}>
  {#each Object.entries(elements) as [elem, amt], idx}
    <Tooltip
      text={element_data.find((el) => el.symbol == elem)?.name}
      --zoo-tooltip-bg="rgba(255, 255, 255, 0.3)"
      tip_style="font-size: initial; padding: 0 5pt;"
    >
      <label
        bind:this={labels[idx]}
        style="background-color: {$element_colors[elem]}"
        on:dblclick|preventDefault={() => {
          $element_colors[elem] = default_element_colors[elem]
        }}
        style:color={get_text_color(labels[idx])}
      >
        {elem}{amt}
        <input
          type="color"
          bind:value={$element_colors[elem]}
          title={elem_color_picker_title}
        />
      </label>
    </Tooltip>
  {/each}
</div>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<dialog
  bind:this={tips_modal}
  on:click={tips_modal?.close}
  on:keydown={tips_modal?.close}
  role="tooltip"
>
  <slot name="tips-modal">
    <p>Drop a JSON file onto the canvas to load a new structure.</p>
    <p>
      Click on an atom to make it active. Then hover another atom to get its distance to
      the active atom.
    </p>
  </slot>
</dialog>

<style>
  div {
    display: flex;
    position: absolute;
    bottom: var(--struct-elem-list-bottom, 8pt);
    right: var(--struct-elem-list-right, 8pt);
    gap: var(--struct-elem-list-gap, 8pt);
    font-size: var(--struct-elem-list-font-size, 16pt);
  }
  div label {
    padding: 1pt 4pt;
    border-radius: var(--struct-elem-list-border-radius, 3pt);
  }
  div label input[type='color'] {
    z-index: 1;
    opacity: 0;
    position: absolute;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    cursor: pointer;
  }
  dialog[role='tooltip'] {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    padding: 4pt 1em;
    background-color: rgba(0, 0, 0, 0.8);
    color: white;
    border-radius: 5px;
    transition: all 0.3s;
    overflow: visible;
  }
  /* info icon in top left corner */
  dialog[role='tooltip']::before {
    content: '?';
    position: absolute;
    top: 0;
    left: 0;
    transform: translate(-50%, -50%);
    font-size: 20pt;
    color: white;
    background-color: rgba(0, 0, 0, 0.8);
    border-radius: 50%;
    width: 1em;
    height: 1em;
    line-height: 1em;
    text-align: center;
    border: 1px solid white;
    box-sizing: border-box;
  }
  dialog[role='tooltip']::backdrop {
    background: rgba(0, 0, 0, 0.2);
  }
  dialog[role='tooltip'] p {
    margin: 0;
  }
</style>
