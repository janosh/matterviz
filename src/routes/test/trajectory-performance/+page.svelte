<script lang="ts">
  import { TrajectoryViewer, type TrajHandlerData } from '$lib/trajectory'

  const data_url = `/tmp/trajectories/large/2025-07-07-extracted_mof5_trajectory.xyz`

  // Event handler for performance testing
  function handle_trajectory_complete(data: TrajHandlerData) {
    const detail = { data, timestamp: Date.now() }
    const event = new CustomEvent(`trajectory-complete`, { detail })
    window.dispatchEvent(event)
  }
</script>

<TrajectoryViewer {data_url} auto_play on_end={handle_trajectory_complete} />
