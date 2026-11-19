// Front-face alpha of a translucent shell pass at `facing` (1 face-on, 0 at the silhouette):
// the pass `opacity` face-on, thickening toward the rim up to RIM_ALPHA times it, so the
// slider scales the whole curve while the rim still outlines each lobe. Generic over the few
// node methods it uses, so tests can evaluate the curve on numbers
const RIM_ALPHA = 3
type AlphaTerm<Term> = {
  oneMinus: () => Term
  mul: (factor: Term | number) => Term
  add: (term: number) => Term
  min: (cap: number) => Term
}
export const shell_front_alpha = <Term extends AlphaTerm<Term>>(
  facing: Term,
  opacity: Term,
): Term => {
  const edge = facing.oneMinus()
  return edge
    .mul(edge)
    .mul(RIM_ALPHA - 1)
    .add(1)
    .mul(opacity)
    .min(1)
}
