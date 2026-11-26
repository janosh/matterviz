// Display helpers shared by the Wulff viewer, facet editor, area plot and tooltip
import { format_num } from 'svelte-widgets/format'
import { PLOT_COLORS } from '#lib/colors/index'
import { schemeDark2 } from 'd3-scale-chromatic'
import type { Vec3 } from '#lib/math'
import { format_hkl } from '#lib/xrd/index'
import type { WulffFacetInput } from './types'

// Family label {hkl} and plane label (hkl)
// compact bar notation, spaced once an index has two digits: (1 10 0) is not (11 0 0)
const hkl = (miller: Vec3): string =>
  miller.some((val) => Math.abs(val) > 9) ? miller.join(` `) : format_hkl(miller, `compact`)
export const family_label = (miller: Vec3): string => `{${hkl(miller)}}`
export const plane_label = (miller: Vec3): string => `(${hkl(miller)})`

// Each family's color: its own, else by input position the 10-color plot palette, then d3's
// 8-color Dark2, whose darker tones stay apart from it (colors repeat past 18 families)
const FAMILY_PALETTE = [...PLOT_COLORS, ...schemeDark2]
export const family_colors = (facets: WulffFacetInput[]): string[] =>
  facets.map(({ color }, idx) => color ?? FAMILY_PALETTE[idx % FAMILY_PALETTE.length])

// Share of the surface as a percentage; a facet family too small to show at that precision
// still reads as present ("<0.1%") rather than as absent "0%"
export const format_fraction = (fraction: number): string =>
  fraction > 0 && fraction < 0.001 ? `<0.1%` : format_num(fraction, `.1~%`)
