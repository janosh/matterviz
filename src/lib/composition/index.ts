export { default as BarChart } from './BarChart.svelte'
export { default as BubbleChart } from './BubbleChart.svelte'
export { default as Composition } from './Composition.svelte'
export * from './parse'
export { default as PieChart } from './PieChart.svelte'

export function get_chart_font_scale(
  base_scale: number,
  label_text: string,
  available_space: number,
  min_scale_factor = 0.7,
  base_font_size = 16,
): number {
  const text_width = label_text.length * 0.6 * base_font_size * base_scale

  return available_space > 0 && text_width > available_space
    ? Math.max(base_scale * (available_space / text_width), base_scale * min_scale_factor)
    : base_scale
}
