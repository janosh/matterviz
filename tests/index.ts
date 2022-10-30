import type { ChemicalElement } from '$lib/types'

import { readFileSync } from 'fs'
import yaml from 'js-yaml'

export const element_data = yaml.load(
  readFileSync(`./src/lib/element-data.yml`)
) as ChemicalElement[]
