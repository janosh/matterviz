// Each mounted SceneCamera's reset, keyed by its canvas, so a viewer resets the camera of the
// scene inside it (its `r` key) without threading a ref through its scene component
export const camera_resets = new WeakMap<HTMLCanvasElement, () => void>()

// Reset every scene camera inside `root` to the framing its props describe; false if none
export const reset_scene_cameras = (root: Element | undefined): boolean => {
  const resets = [...(root?.querySelectorAll(`canvas`) ?? [])].flatMap(
    (canvas) => camera_resets.get(canvas) ?? [],
  )
  for (const reset of resets) reset()
  return resets.length > 0
}
