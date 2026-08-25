// Inline code mentions of MatterViz files and exports link to their GitHub source
import { create_source_links } from 'svelte-widgets/source-links'
import * as source_symbols from 'virtual:source-symbols'

export const { link_source_mentions, source_href, source_location } =
  create_source_links(source_symbols)
