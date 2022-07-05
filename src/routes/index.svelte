<script lang="ts">
  import '../app.css'
  import EasterEgg from '../lib/EasterEgg.svelte'
  import PeriodicTable from '../lib/PeriodicTable.svelte'
  import PropertySelect from '../lib/PropertySelect.svelte'

  let windowWidth: number
  let x_angle = 0
  let y_angle = 0
  let auto_rotate: 'x' | 'y' | 'both' | 'none' = `none`
</script>

<svelte:window bind:innerWidth={windowWidth} />

<h1>Periodic Table of Elements</h1>

<PropertySelect />

<div
  style:transform="rotateX({x_angle}deg) rotateY({y_angle}deg)"
  class="auto-rotate-{auto_rotate}"
>
  <PeriodicTable show_names={windowWidth > 1000} />
</div>

<EasterEgg bind:x_angle bind:y_angle bind:auto_rotate />

<style>
  h1 {
    text-align: center;
    line-height: 1.1;
    font-size: clamp(20pt, 5.5vw, 50pt);
  }
  div.auto-rotate-x {
    animation: spin-x 30s linear infinite;
  }
  div.auto-rotate-y {
    animation: spin-y 30s linear infinite;
  }
  div.auto-rotate-both {
    animation: spin-both 30s linear infinite;
  }
  @keyframes spin-x {
    100% {
      transform: rotateX(360deg);
    }
  }
  @keyframes spin-y {
    100% {
      transform: rotateY(360deg);
    }
  }
  @keyframes spin-both {
    100% {
      transform: rotateX(360deg) rotateY(360deg);
    }
  }
</style>
