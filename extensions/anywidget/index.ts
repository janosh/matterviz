// Build entry: anywidget rejects a model whose _esm module doesn't import within 2 s, so the
// split build's entry stays tiny and loads the widget code (anywidget.ts) on first use
import type { Render } from 'anywidget/types'

const load = () => import(`./anywidget`)

const render: Render = async (props) => (await load()).default.render(props)

// Standalone SVG of a rendered widget (see anywidget.ts' export_svg)
export const export_svg = async (element: HTMLElement, png_dpi?: number): Promise<string> =>
  (await load()).export_svg(element, png_dpi)

// Synced trait names per widget_type (build/widget-model-keys.json)
export const widget_model_keys = async (): Promise<Record<string, readonly string[]>> =>
  (await load()).WIDGET_MODEL_KEYS

export default { render }
