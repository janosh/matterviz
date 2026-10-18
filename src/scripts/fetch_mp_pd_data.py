"""Fetch quaternary chemical systems from the Materials Project and annotate every entry with
its hull distance for the /convex-hull demo (src/site/convex-hull/quaternaries/<system>.json.gz).

Run with: uv run src/scripts/fetch_mp_pd_data.py
"""

from __future__ import annotations

import gzip
import json
import os

from mp_api.client import MPRester
from pymatgen.analysis.phase_diagram import PhaseDiagram

out_dir = (
    f"{os.path.dirname(os.path.abspath(__file__))}/../site/convex-hull/quaternaries"
)
# Li-Mn-P-O is left out: well explored, gives a very large number of entries
chemical_systems = ("Li-Fe-P-O", "Li-Co-Ni-O", "Na-Fe-P-O", "Si-O-K-Al")
# Serialization fields the demos never read: pymatgen class tags, the per-entry energy
# correction breakdown and the full POTCAR/run parameters. Dropping them (and indentation)
# keeps every page that loads a hull dataset from downloading megabytes it ignores.
unused_keys = ("@module", "@class", "energy_adjustments", "parameters")


def slim_entry(entry_dict: dict) -> dict:
    """Drop unused keys and round lattice and site coordinates to 1e-6 (far below what a
    structure viewer resolves), which cuts each dataset by a further ~25%."""
    slim = {key: val for key, val in entry_dict.items() if key not in unused_keys}
    if structure := slim.get("structure"):
        lattice = structure["lattice"]
        lattice["matrix"] = [
            [round(val, 6) for val in row] for row in lattice["matrix"]
        ]
        for site in structure["sites"]:
            for key in ("abc", "xyz"):
                site[key] = [round(val, 6) for val in site[key]]
    return slim


def main() -> None:
    """Write one gzipped JSON file of hull-annotated ComputedStructureEntry dicts per system."""
    os.makedirs(out_dir, exist_ok=True)
    with MPRester() as mpr:
        for chem_sys in chemical_systems:
            entries = mpr.get_entries_in_chemsys(chem_sys)
            phase_diagram = PhaseDiagram(entries)
            json_data = [
                slim_entry(entry.as_dict())
                | {
                    "e_above_hull": phase_diagram.get_e_above_hull(entry),
                    "is_stable": entry in phase_diagram.stable_entries,
                    "e_form_per_atom": phase_diagram.get_form_energy_per_atom(entry),
                }
                for entry in entries
            ]
            filename = f"{out_dir}/{chem_sys}.json.gz"
            with gzip.open(filename, mode="wt", encoding="utf-8") as file:
                json.dump(json_data, file, separators=(",", ":"))
            print(f"{chem_sys}: wrote {len(entries)} entries to {filename}")


if __name__ == "__main__":
    main()
