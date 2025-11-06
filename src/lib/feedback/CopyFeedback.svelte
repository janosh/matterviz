<script lang="ts">
  import { Icon } from '$lib'

  let { visible = $bindable(false), position = { x: 0, y: 0 } }: {
    visible?: boolean
    position: { x: number; y: number }
  } = $props()
</script>

{#if visible}
  {@const { x, y } = position}
  <div class="copy-feedback" style:left="{x}px" style:top="{y}px">
    <Icon icon="Check" />
  </div>
{/if}

<style>
  .copy-feedback {
    position: fixed;
    width: 24px;
    height: 24px;
    background: var(--success-color, #4caf50);
    color: white;
    border-radius: 50%;
    display: flex;
    place-content: center;
    animation: copy-success 1.5s ease-out forwards;
  }
  @keyframes copy-success {
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
