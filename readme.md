<h1 align="center">
  <img src="static/favicon.svg" alt="Logo" height="60">
  <br>
  Periodic Table
</h1>

<h4 align="center">

[![Tests](https://github.com/janosh/periodic-table/actions/workflows/test.yml/badge.svg)](https://github.com/janosh/periodic-table/actions/workflows/test.yml)
[![GH Pages](https://github.com/janosh/periodic-table/actions/workflows/gh-pages.yml/badge.svg)](https://github.com/janosh/periodic-table/actions/workflows/gh-pages.yml)
[![pre-commit.ci status](https://results.pre-commit.ci/badge/github/janosh/periodic-table/main.svg?badge_token=nUqJfPCFS4uyMwcFSDIfdQ)](https://results.pre-commit.ci/latest/github/janosh/periodic-table/main?badge_token=nUqJfPCFS4uyMwcFSDIfdQ)
[![Open in StackBlitz](https://img.shields.io/badge/Open%20in-StackBlitz-darkblue?logo=stackblitz)](https://stackblitz.com/github/janosh/periodic-table)

</h4>

Interactive Periodic Table component written in Svelte. With scatter plot showing periodicity of elemental properties and Bohr atoms showing electron shell configuration of different elements.

![Screenshot of periodic table](static/2022-08-08-screenshot.png)

## 📊 &thinsp; Heatmap

Below a screenshot demonstrating the periodicity of elemental properties, i.e. why the periodic table is called periodic. In this case its showing recurring bumps and valleys in the first ionization energy as a function of atomic number.

![Screenshot of periodic table heatmap](static/2022-08-08-screenshot-heatmap.png)

## ⚛️ &thinsp; Element Details Pages

The details page for gold.

<https://user-images.githubusercontent.com/30958850/186975855-8e0d94f9-e4e3-47a2-9354-9c012b37307c.mp4>

## 🔨 &thinsp; Installation

```sh
npm install --dev periodic-tables
```

## 📙 &thinsp; Usage

Import the `PeriodicTable` component and pass it some heatmap values:

```svelte
<script>
  import PeriodicTable from 'periodic-tables'

  const heatmap_values = { H: 10, He: 4, Li: 8, Fe: 3, O: 24 }
</script>

<PeriodicTable {heatmap_values} />
```

## 🧪 &thinsp; Coverage

| Statements                                                                                 | Branches                                                                          | Lines                                                                            |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ![Statements](https://img.shields.io/badge/statements-99.84%25-brightgreen.svg?style=flat) | ![Branches](https://img.shields.io/badge/branches-82.92%25-yellow.svg?style=flat) | ![Lines](https://img.shields.io/badge/lines-99.84%25-brightgreen.svg?style=flat) |

## 🙏 &thinsp; Acknowledgements

- Element properties in `src/lib/element-data.ts` were combined from [`Bowserinator/Periodic-Table-JSON`](https://github.com/Bowserinator/Periodic-Table-JSON/blob/master/PeriodicTableJSON.json) under Creative Commons license and [`robertwb/Periodic Table of Elements.csv`](https://gist.github.com/robertwb/22aa4dbfb6bcecd94f2176caa912b952) (unlicensed).
- Thanks to [Images of Elements](https://images-of-elements.com) for providing photos of elemental crystals and glowing excited gases.
- Thanks to [@kadinzhang](https://github.com/kadinzhang) and their [Periodicity project](https://ptable.netlify.app) [[code](https://github.com/kadinzhang/Periodicity)] for the idea to display animated Bohr model atoms and inset a scatter plot into the periodic table to visualize the periodic nature of elemental properties.
