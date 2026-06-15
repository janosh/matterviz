<script lang="ts">
  // Minimal stand-in for a real matterviz component: a $bindable interaction
  // trait the component mutates on interaction, exposed via step() so a test can
  // trigger it. Used to verify reactive_widget().props drives a real mount() and
  // the $bindable writeback reaches the model.
  let { current_step_idx = $bindable(0) }: { current_step_idx?: number } = $props()
  export const step = () => {
    current_step_idx += 1
  }
</script>

<span>{current_step_idx}</span>
