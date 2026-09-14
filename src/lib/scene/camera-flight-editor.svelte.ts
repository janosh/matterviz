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
    {
      views: [],
      interpolation: `smooth`,
      duration: 10,
      automatic: true,
    },
  ])
  let cursor = $state(0)
  let selected = $state(-1)
  const draft = $derived(history[cursor])
  const flight = $derived<CameraFlight>({
    interpolation: draft.interpolation,
    keyframes: draft.views.map(({ thumbnail: _thumbnail, ...frame }) => frame),
  })
  const commit = (next: FlightDraft) => {
    history = [...history.slice(0, cursor + 1), next].slice(-50)
    cursor = history.length - 1
    selected = Math.min(selected, next.views.length - 1)
  }
  const space_evenly = (next: FlightDraft): FlightDraft => ({
    ...next,
    views: next.views.map((view, idx, views) => ({
      ...view,
      time: views.length < 2 ? 0 : (idx / (views.length - 1)) * next.duration,
    })),
  })
  const set_views = (views: FlightDraft[`views`]) => {
    const next = { ...draft, views }
    commit(
      draft.automatic
        ? space_evenly(next)
        : {
            ...next,
            duration: views.length > 1 ? views[views.length - 1].time : draft.duration,
          },
    )
  }
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
    undo() {
      if (cursor > 0) cursor--
      selected = Math.min(selected, draft.views.length - 1)
    },
    redo() {
      if (cursor < history.length - 1) cursor++
      selected = Math.min(selected, draft.views.length - 1)
    },
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
        ...draft,
        views: draft.views.map((view, view_idx) =>
          view_idx === idx ? { ...structuredClone(pose), time: view.time, thumbnail } : view,
        ),
      })
    },
    remove(idx: number) {
      const views = draft.views.filter((_view, view_idx) => view_idx !== idx)
      const start = views[0]?.time ?? 0
      set_views(views.map((view) => ({ ...view, time: view.time - start })))
    },
    move(from: number, to: number) {
      if (from === to || to < 0 || to >= draft.views.length) return
      const views = [...draft.views]
      views.splice(to, 0, ...views.splice(from, 1))
      commit({
        ...draft,
        views: views.map((view, idx) => ({ ...view, time: draft.views[idx].time })),
      })
      selected = to
    },
    set_duration(duration: number) {
      if (!Number.isFinite(duration) || duration <= 0)
        throw new Error(`Duration must be greater than zero`)
      if (duration === draft.duration) return
      const next = {
        ...draft,
        duration,
        views: draft.views.map((view) => ({
          ...view,
          time: (view.time / draft.duration) * duration,
        })),
      }
      commit(draft.automatic ? space_evenly(next) : next)
    },
    set_time(idx: number, time: number) {
      const views = draft.views
      if (
        idx === 0 ||
        !Number.isFinite(time) ||
        time <= views[idx - 1].time ||
        (idx < views.length - 1 && time >= views[idx + 1].time)
      )
        throw new Error(`View ${idx + 1} must come after view ${idx} and before the next view`)
      if (time === views[idx].time) return
      commit({
        ...draft,
        automatic: false,
        duration: idx === views.length - 1 ? time : draft.duration,
        views: views.map((view, view_idx) => (view_idx === idx ? { ...view, time } : view)),
      })
    },
    set_automatic(automatic: boolean) {
      const next = { ...draft, automatic }
      commit(automatic ? space_evenly(next) : next)
    },
    set_interpolation(interpolation: CameraFlight[`interpolation`]) {
      commit({ ...draft, interpolation })
    },
    load(path: CameraFlight, thumbnails: string[], automatic = false) {
      validate_camera_flight(path)
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
