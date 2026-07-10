import element_data from './data'

export const element_by_symbol = new Map(
  element_data.map((element) => [element.symbol, element]),
)
