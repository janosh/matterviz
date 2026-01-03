<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import type { IconName } from '$lib/icons'

  // Generic feedback component that shows a transient icon at a specific position.
  // Commonly used for copy-to-clipboard feedback, but can display icons for
  // various user interactions.
  let {
    visible = $bindable(false),
    position = { x: 0, y: 0 },
    icon = `Check`,
  }: {
    visible?: boolean
    position: { x: number; y: number }
    icon?: IconName
  } = $props()
</script>

{#if visible}
  {@const { x, y } = position}
  <div class="click-feedback" style:left="{x}px" style:top="{y}px">
    <Icon {icon} />
  </div>
{/if}

<style>
  .click-feedback {
    position: fixed;
    width: 24px;
    height: 24px;
    background: var(--success-color, #4caf50);
    color: white;
    border-radius: 50%;
    display: flex;
    place-content: center;
    animation: click-success 1.5s ease-out forwards;
    pointer-events: none;
    z-index: 10000;
  }
  @keyframes click-success {
    0% {
      transform: translate(-50%, -50%) scale(0);
      opacity: 0;
    }
    20% {
      transform: translate(-50%, -50%) scale(1.2);
      opacity: 1;
    }
    40% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 1;
    }
    100% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 0;
    }
  }
</style>
