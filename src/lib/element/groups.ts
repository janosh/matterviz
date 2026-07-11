import element_data from './data'
import type { ChemicalElement, ElementSymbol } from './types'

export const element_by_symbol: ReadonlyMap<ElementSymbol, ChemicalElement> = new Map(
  element_data.map((element) => [element.symbol, element]),
)
