<script lang="ts">
  import { Icon, type IconData } from 'svelte-widgets'
  import { Check } from 'svelte-widgets/icons'
  // Transient icon popping up at a screen position, e.g. copy-to-clipboard confirmation.
  // The caller owns `visible`; the CSS animation fades the icon out and holds it hidden.
  let {
    visible = false,
    position,
    icon = Check,
  }: { visible?: boolean; position: { x: number; y: number }; icon?: IconData } = $props()
</script>

{#if visible}
  <div
    class="click-feedback"
    style="left: {position.x}px; top: {position.y}px"
    aria-hidden="true"
  >
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
