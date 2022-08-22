export const default_category_colors: Record<string, string> = {
  'diatomic-nonmetal': `#ff8c00`, // darkorange
  'noble-gas': `#9932cc`, // darkorchid
  'alkali-metal': `#006400`, // darkgreen
  'alkaline-earth-metal': `#483d8b`, // darkslateblue
  metalloid: `#b8860b`, // darkgoldenrod
  'polyatomic-nonmetal': `#a52a2a`, // brown
  'transition-metal': `#008080`, // teal
  'post-transition-metal': `#938d4a`,
  lanthanide: `#58748e`,
  actinide: `#6495ed`, // cornflowerblue
}
export const category_colors: Record<string, string> = {
  ...default_category_colors,
}
