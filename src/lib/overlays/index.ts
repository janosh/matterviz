export { default as CopyButton } from './CopyButton.svelte'
export { default as ContextMenu } from './ContextMenu.svelte'
export { default as DraggablePane } from './DraggablePane.svelte'
export { default as InfoPaneCards } from './InfoPaneCards.svelte'

export type InfoPaneRow = {
  label: string
  value: string | number
  key?: string
  tooltip?: string
}

export type InfoPaneCard = {
  title: string
  rows: InfoPaneRow[]
}
