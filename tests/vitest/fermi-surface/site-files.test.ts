import { fermi_file_colors, fermi_surface_files } from '$site/fermi-surfaces'
import { describe, expect, it } from 'vitest'

// Regression test for production bug where fermi_surface_files derived their `url`
// from import.meta.glob's `?url` values. The rolldown production build treats
// .json/.json.gz as JSON modules and drops the `?url` query, so the value became the
// parsed object instead of a URL string, and load_from_url() threw
// `url.split is not a function`. URLs must be path-derived strings served from
// /fermi-surfaces/ (the static symlink), like the structures/molecules/trajectories demos.
describe(`fermi_surface_files`, () => {
  it(`discovers example data files`, () => {
    expect(fermi_surface_files.length).toBeGreaterThan(0)
  })

  it.each([
    [`pb.bxsf.gz`, `BXSF`],
    [`fs_BaFe2As2_reciprocal.json.gz`, `IFermi`],
    [`mgb2_vfz.frmsf.gz`, `FRMSF Color`], // listed in FRMSF_COLOR_DATA_FILES
  ])(`discovers %s categorized as %s`, (name, category) => {
    expect(fermi_surface_files.find((file) => file.name === name)?.category).toBe(category)
  })

  it.each(
    // exercise every discovered file so a non-string field anywhere fails the suite
    [`name`, `url`, `type`, `category`, `category_icon`] as const,
  )(`every file has a string %s`, (field) => {
    for (const file of fermi_surface_files) {
      expect(typeof file[field], `${file.name}.${field}`).toBe(`string`)
    }
  })

  it(`serves every file from a path-derived /fermi-surfaces/ url, no .json duplicates`, () => {
    // the prod bug produced non-string urls; CI also gunzips .json.gz, which must not leak
    for (const file of fermi_surface_files) {
      expect(file.url).toBe(`/fermi-surfaces/${file.name}`)
      expect(file.name.endsWith(`.json`)).toBe(false)
    }
  })

  it(`exposes file type colors`, () => {
    expect(Object.keys(fermi_file_colors).sort()).toEqual([`bxsf`, `frmsf`, `json`])
  })
})
