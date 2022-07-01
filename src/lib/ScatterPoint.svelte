<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { tweened } from 'svelte/motion'

  export let x: number
  export let y: number
  export let fill = `gray`
  export let active = false
  export let tween_duration = 600

  const tween_params = { duration: tween_duration, easing: cubicOut }
  const tweened_x = tweened(0, tween_params)
  const tweened_y = tweened(0, tween_params)

  $: tweened_x.set(x)
  $: tweened_y.set(y)
</script>

<g transform="translate({$tweened_x} {$tweened_y})" {fill} on:mouseenter class:active>
  <circle cx="0" cy="0" r="3" />
</g>

<style>
  circle {
    transition: 0.3s;
    stroke: transparent;
    stroke-width: 5px;
  }
  :is(g:hover, g.active) circle {
    fill: orange;
    transform: scale(2);
  }
</style>
