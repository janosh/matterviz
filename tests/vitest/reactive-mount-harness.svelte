<script lang="ts">
  // Minimal stand-in for a real matterviz component: a $bindable interaction
  // trait the component mutates on interaction, exposed via step() so a test can
  // trigger it. Used to verify reactive_widget().props drives a real mount() and
  // the $bindable writeback reaches the model.
  let {
    current_step_idx = $bindable(0),
    structure = $bindable(),
  }: { current_step_idx?: number; structure?: object } = $props()
  export const step = () => {
    current_step_idx += 1
  }
  // as Structure assigns what it loads from a data_url
  export const load = (value: object) => {
    structure = value
  }
  export const read = () => structure
</script>

<span>{current_step_idx}</span>
