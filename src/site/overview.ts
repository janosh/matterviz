// Overview pages: their cards, plus icons for tiles that svelte-widgets' generic glyphs (panel
// layouts, a plain DOS curve) can't tell apart, in the same 24x24 stroke style
import type { Subpage } from 'svelte-widgets'
import type { IconData } from 'svelte-widgets/icons'
import { markup_icon } from 'svelte-widgets/icons/builders'

// One [href, label, icon, description] row per card, so each page's list reads a line per card
export const to_subpages = (
  rows: [href: string, label: string, icon: IconData, description: string][],
): Subpage[] =>
  rows.map(([href, label, icon, description]) => ({ href, label, icon, description }))

const glyph = (markup: string) => markup_icon(markup, { stroke: `currentColor` })
// two bands across the gap on the left, the DOS on its side to the right sharing their energy axis
export const BandsDosIcon = glyph(
  `<g fill="none" stroke-width="1.5" stroke-linecap="round"><path d="M2 4q5 8 10 0"/><path d="M2 20q5-8 10 0"/><line x1="15" y1="2" x2="15" y2="22" stroke-width="1" opacity="0.4"/><path d="M15 3q9 4.5 0 9q8 4.5 0 9" fill="currentColor" fill-opacity="0.2"/></g>`,
)

// a hexagonal Brillouin zone beside its bands and DOS
export const BrillouinBandsDosIcon = glyph(
  `<g fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="4.5,8.5 7.5,10.25 7.5,13.75 4.5,15.5 1.5,13.75 1.5,10.25"/><path d="M10 5q3.25 6 6.5 0"/><path d="M10 19q3.25-6 6.5 0"/><line x1="18" y1="3" x2="18" y2="21" stroke-width="1" opacity="0.4"/><path d="M18 4q6.5 4 0 8q6 4 0 8" fill="currentColor" fill-opacity="0.2"/></g>`,
)

// one calculation's crystal, Fermi surface, bands and DOS as four linked panels
export const ElectronicStructureIcon = glyph(
  `<g fill="none" stroke-width="1" opacity="0.4"><rect x="1.5" y="1.5" width="9.5" height="9.5" rx="1.5"/><rect x="13" y="1.5" width="9.5" height="9.5" rx="1.5"/><rect x="1.5" y="13" width="9.5" height="9.5" rx="1.5"/><rect x="13" y="13" width="9.5" height="9.5" rx="1.5"/></g><g fill="currentColor" stroke="none"><circle cx="4.5" cy="4.5" r="1.2"/><circle cx="8" cy="4.5" r="1.2"/><circle cx="4.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/></g><g fill="none" stroke-width="1.3" stroke-linecap="round"><circle cx="17.75" cy="6.25" r="3"/><ellipse cx="17.75" cy="6.25" rx="3" ry="1.1"/><path d="M3.5 14.75q2.75 3 5.5 0"/><path d="M3.5 20.75q2.75-3 5.5 0"/><path d="M14.5 21c1.5 0 2-5.5 3.25-5.5s1.75 5.5 3.25 5.5"/></g>`,
)

// a bonded atom pair over -COHP vs energy: shaded where bonding, outlined where antibonding
export const CohpIcon = glyph(
  `<line x1="6" y1="5" x2="18" y2="5" stroke-width="1.6"/><g fill="currentColor" stroke="none"><circle cx="6" cy="5" r="2.6"/><circle cx="18" cy="5" r="2.6" opacity="0.7"/></g><line x1="2" y1="15.5" x2="22" y2="15.5" stroke-width="1" opacity="0.4"/><path d="M2 15.5c2 0 3-5 5-5s3 5 4.5 5" fill="currentColor" stroke="none" opacity="0.35"/><path d="M2 15.5c2 0 3-5 5-5s3 5 4.5 5c1.5 0 2.5 5 4.5 5s2.5-3.5 6-5" fill="none" stroke-width="1.4" stroke-linecap="round"/>`,
)

// mirrored stick spectra: IR absorption dips from the top, Raman peaks from the bottom
export const IrRamanIcon = glyph(
  `<g stroke-width="1" opacity="0.4"><line x1="2" y1="3" x2="22" y2="3"/><line x1="2" y1="21" x2="22" y2="21"/></g><g stroke-width="1.7" stroke-linecap="round"><line x1="5" y1="3" x2="5" y2="8"/><line x1="10" y1="3" x2="10" y2="11"/><line x1="17" y1="3" x2="17" y2="6.5"/></g><g stroke-width="1.7" stroke-linecap="round" opacity="0.7"><line x1="7.5" y1="21" x2="7.5" y2="14"/><line x1="13" y1="21" x2="13" y2="17"/><line x1="19.5" y1="21" x2="19.5" y2="12"/></g>`,
)

// bonded atoms with the alternating displacement arrows of one phonon eigenvector
export const PhononModeIcon = glyph(
  `<path d="M5 16L12 8l7 8" fill="none" stroke-width="1.2" opacity="0.45"/><g fill="currentColor" stroke="none"><circle cx="5" cy="16" r="2.4"/><circle cx="12" cy="8" r="2.4" opacity="0.75"/><circle cx="19" cy="16" r="2.4"/></g><g fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19.5v3m-1.5-1.5L5 22.5l1.5-1.5"/><path d="M12 4.5v-3m-1.5 1.5L12 1.5l1.5 1.5"/><path d="M19 19.5v3m-1.5-1.5l1.5 1.5l1.5-1.5"/></g>`,
)

// two scatter panels: a brush selects points in one, the same points light up in the other
export const LinkedBrushingIcon = glyph(
  `<g fill="none" stroke-width="1.1" stroke-linecap="round" opacity="0.6"><path d="M2 3v17h8.5"/><path d="M13.5 3v17H22"/></g><rect x="3.5" y="4" width="6.5" height="7.5" rx="0.6" fill="currentColor" fill-opacity="0.15" stroke-width="1" stroke-dasharray="1.5 1.1"/><g fill="currentColor" stroke="none"><circle cx="5.6" cy="6.4" r="1.4"/><circle cx="8" cy="9.2" r="1.4"/><circle cx="6" cy="16.5" r="1.1" opacity="0.3"/><circle cx="16.5" cy="8" r="1.6"/><circle cx="20" cy="13" r="1.6"/><circle cx="17" cy="17" r="1.1" opacity="0.3"/></g>`,
)

// an energy-volume scan with its asymmetric equation-of-state fit and the equilibrium volume
export const EquationOfStateIcon = glyph(
  `<path d="M3 3v18h18" fill="none" stroke-width="1.4" stroke-linecap="round"/><line x1="10" y1="16" x2="10" y2="21" stroke-width="1" stroke-dasharray="1.2 1.2" opacity="0.5"/><path d="M5 4c1 7 2.5 12 5 12s6-4 10-7" fill="none" stroke-width="1.4" stroke-linecap="round"/><g fill="currentColor" stroke="none"><circle cx="5.6" cy="7" r="1.3"/><circle cx="7.3" cy="12.6" r="1.3"/><circle cx="10" cy="16" r="1.3"/><circle cx="13.5" cy="15" r="1.3"/><circle cx="17" cy="12.2" r="1.3"/><circle cx="20" cy="9" r="1.3"/></g>`,
)

// a binary formation-energy hull: stable phases on the lower envelope, unstable ones above it
export const ConvexHullIcon = glyph(
  `<line x1="3" y1="5" x2="21" y2="5" stroke-width="1" opacity="0.4"/><path d="M3 5l5 10l6 4l5-6l2-8" fill="none" stroke-width="1.5" stroke-linejoin="round"/><g fill="currentColor" stroke="none"><circle cx="8" cy="15" r="1.7"/><circle cx="14" cy="19" r="1.7"/><circle cx="19" cy="13" r="1.7"/><g opacity="0.45"><circle cx="8.5" cy="9" r="1.3"/><circle cx="12.5" cy="12.5" r="1.3"/><circle cx="16.5" cy="8.5" r="1.3"/></g></g>`,
)

// chemical-potential space split into the stability domains of competing phases
export const ChemPotIcon = glyph(
  `<rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke-width="1" opacity="0.45"/><path d="M3 13l7-2l5 5l-2 5H3z" fill="currentColor" stroke="none" opacity="0.18"/><path d="M3 13l7-2l3-8M10 11l5 5l6-1M15 16l-2 5" fill="none" stroke-width="1.5" stroke-linejoin="round"/>`,
)

// two precursors react into a bonded product
export const SynthesisIcon = glyph(
  `<g fill="none" stroke-width="1.4"><circle cx="4.5" cy="7.5" r="2.5"/><circle cx="19.5" cy="9" r="2.3"/></g><g fill="currentColor" stroke="none" opacity="0.7"><circle cx="4.5" cy="16.5" r="2.5"/><circle cx="19.5" cy="15" r="2.3"/></g><g fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12h6.5m-2.5-2.5l2.5 2.5l-2.5 2.5"/><path d="M19.5 11.3v1.4"/></g>`,
)

// temperature vs composition: two liquidus curves meeting at a eutectic
export const BinaryPhaseDiagramIcon = glyph(
  `<rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke-width="1" opacity="0.45"/><path d="M3 6q6 2 8.5 9.5M21 8.5q-6 1-9.5 7" fill="none" stroke-width="1.5" stroke-linecap="round"/><line x1="3" y1="15.5" x2="21" y2="15.5" stroke-width="1.2"/><circle cx="11.5" cy="15.5" r="1.5" fill="currentColor" stroke="none"/>`,
)

// potential vs pH: straight domain boundaries between dashed water-stability lines
export const PourbaixIcon = glyph(
  `<rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke-width="1" opacity="0.45"/><g stroke-width="1" stroke-dasharray="2 1.5" opacity="0.55"><line x1="3" y1="6" x2="21" y2="11"/><line x1="3" y1="13" x2="21" y2="18"/></g><path d="M3 11.5h7.5V3M10.5 11.5L21 15" fill="none" stroke-width="1.5" stroke-linejoin="round"/>`,
)

// pressure vs temperature: three coexistence curves from the triple point, one ending at the critical point
export const PressureTemperatureIcon = glyph(
  `<path d="M3 3v18h18" fill="none" stroke-width="1" opacity="0.45"/><path d="M4 20q5-2 6.5-7.5M10.5 12.5q1.2-4 .5-9M10.5 12.5q5-1 8.5-5.5" fill="none" stroke-width="1.5" stroke-linecap="round"/><g fill="currentColor" stroke="none"><circle cx="10.5" cy="12.5" r="1.6"/><circle cx="19" cy="7" r="1.6"/></g>`,
)

// a ternary composition triangle stacked along temperature, cut by a liquidus surface
export const TernaryTemperatureIcon = glyph(
  `<g fill="none" stroke-width="1.2" stroke-linejoin="round" opacity="0.6"><path d="M3 19l11 2.5l7-4.5M3 6l11 2.5l7-4.5L3 6"/><path d="M3 6v13M14 8.5v13M21 4v13"/></g><line x1="3" y1="19" x2="21" y2="17" stroke-width="1" stroke-dasharray="1.5 1.5" opacity="0.4"/><path d="M3 12.5q6 4.5 11 3.5t7-5" fill="none" stroke-width="1.6" stroke-linecap="round"/>`,
)
