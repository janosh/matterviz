import {
  type CameraFlight,
  type CameraKeyframe,
  type CameraPose,
  validate_camera_flight,
} from './camera-flight'

type FlightDraft = {
  views: (CameraKeyframe & { thumbnail: string })[]
  interpolation: CameraFlight[`interpolation`]
  duration: number
  automatic: boolean
}

// Each view owns its thumbnail; immutable drafts keep the pair together through edits and undo.
export function create_camera_flight_editor() {
  let history = $state.raw<FlightDraft[]>([
    { views: [], interpolation: `smooth`, duration: 10, automatic: true },
  ])
  let cursor = $state(0)
  let selected = $state(-1)
  const draft = $derived(history[cursor])
  const flight = $derived<CameraFlight>({
    interpolation: draft.interpolation,
    keyframes: draft.views.map(({ thumbnail: _thumbnail, ...frame }) => frame),
  })
  const commit = (changes: Partial<FlightDraft>) => {
    history = [...history.slice(0, cursor + 1), { ...draft, ...changes }].slice(-50)
    cursor = history.length - 1
    selected = Math.min(selected, draft.views.length - 1)
  }
  // Undo (-1) or redo (+1), a no-op past either end of the history
  const step_history = (delta: -1 | 1) => {
    cursor = Math.min(Math.max(cursor + delta, 0), history.length - 1)
    selected = Math.min(selected, draft.views.length - 1)
  }
  const space_evenly = (views: FlightDraft[`views`], duration: number) =>
    views.map((view, idx) => ({
      ...view,
      time: views.length < 2 ? 0 : (idx / (views.length - 1)) * duration,
    }))
  // the pane's min: shorter flights squeeze interior markers past their 0.01 s drag gap
  const check_duration = (duration: number) => {
    if (!Number.isFinite(duration) || duration < 0.1)
      throw new Error(`Duration must be at least 0.1 s, got ${duration}`)
  }
  const set_views = (views: FlightDraft[`views`]) =>
    commit({
      views: draft.automatic ? space_evenly(views, draft.duration) : views,
      duration:
        !draft.automatic && views.length > 1 ? views[views.length - 1].time : draft.duration,
    })
  return {
    get flight() {
      return flight
    },
    get draft() {
      return draft
    },
    get selected() {
      return selected
    },
    select(idx: number) {
      selected = idx
    },
    get can_undo() {
      return cursor > 0
    },
    get can_redo() {
      return cursor < history.length - 1
    },
    undo: () => step_history(-1),
    redo: () => step_history(1),
    add(pose: CameraPose, thumbnail: string, after = draft.views.length - 1) {
      const views = [...draft.views]
      const idx = after + 1
      const time = !views.length
        ? 0
        : idx < views.length
          ? (views[after].time + views[idx].time) / 2
          : views[after].time + 2
      views.splice(idx, 0, { ...structuredClone(pose), time, thumbnail })
      set_views(views)
      selected = idx
    },
    update(idx: number, pose: CameraPose, thumbnail: string) {
      commit({
        views: draft.views.map((view, view_idx) =>
          view_idx === idx ? { ...structuredClone(pose), time: view.time, thumbnail } : view,
        ),
      })
    },
    remove(idx: number) {
      const views = draft.views.filter((_view, view_idx) => view_idx !== idx)
      const start = views[0]?.time ?? 0
      const span = (views.at(-1)?.time ?? 0) - start
      // deleting an endpoint next to a close view must not leave a manual flight under the
      // 0.1 s floor, so re-space the remaining views over the old duration
      set_views(
        !draft.automatic && span < 0.1
          ? space_evenly(views, draft.duration)
          : views.map((view) => ({ ...view, time: view.time - start })),
      )
    },
    move(from: number, to: number) {
      if (from === to || to < 0 || to >= draft.views.length) return
      const views = [...draft.views]
      views.splice(to, 0, ...views.splice(from, 1))
      commit({ views: views.map((view, idx) => ({ ...view, time: draft.views[idx].time })) })
      selected = to
    },
    set_duration(duration: number) {
      if (duration === draft.duration) return
      check_duration(duration)
      commit({
        duration,
        views: draft.automatic
          ? space_evenly(draft.views, duration)
          : draft.views.map((view) => ({
              ...view,
              time: (view.time / draft.duration) * duration,
            })),
      })
    },
    set_time(idx: number, time: number) {
      const { views } = draft
      if (
        idx === 0 ||
        !Number.isFinite(time) ||
        time <= views[idx - 1].time ||
        (idx < views.length - 1 && time >= views[idx + 1].time)
      )
        throw new Error(`View ${idx + 1} must come after view ${idx} and before the next view`)
      if (time === views[idx].time) return
      if (idx === views.length - 1) check_duration(time)
      commit({
        automatic: false,
        duration: idx === views.length - 1 ? time : draft.duration,
        views: views.map((view, view_idx) => (view_idx === idx ? { ...view, time } : view)),
      })
    },
    set_automatic(automatic: boolean) {
      commit({
        automatic,
        views: automatic ? space_evenly(draft.views, draft.duration) : draft.views,
      })
    },
    set_interpolation(interpolation: CameraFlight[`interpolation`]) {
      commit({ interpolation })
    },
    load(path: CameraFlight, thumbnails: string[], automatic = false) {
      validate_camera_flight(path)
      check_duration(path.keyframes[path.keyframes.length - 1].time)
      commit({
        views: structuredClone(path.keyframes).map((frame, idx) => ({
          ...frame,
          thumbnail: thumbnails[idx],
        })),
        interpolation: path.interpolation,
        duration: path.keyframes[path.keyframes.length - 1].time,
        automatic,
      })
      selected = 0
    },
  }
}
