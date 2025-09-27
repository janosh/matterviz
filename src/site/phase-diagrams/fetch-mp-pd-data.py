"""Fetch quaternary phase diagram data from Materials Project and calculate
e_above_hull for tetrahedron visualization on /phase-diagrams page."""

from __future__ import annotations

import gzip
import json
import os

from mp_api.client import MPRester
from pymatgen.analysis.phase_diagram import PhaseDiagram
from pymatgen.entries.computed_entries import ComputedStructureEntry

out_dir = f"{os.path.dirname(__file__)}/quaternaries"
os.makedirs(out_dir, exist_ok=True)
chemical_systems = (
    "Li-Fe-P-O",
    "Li-Co-Ni-O",
    "Na-Fe-P-O",
    # "Li-Mn-P-O", # well explored, gives large number of entries
    "Si-O-K-Al",
)
all_entries = dict.fromkeys(chemical_systems, None)
mpr = MPRester()


# %%
for chem_sys in chemical_systems:
    if all_entries[chem_sys] is None:
        entries: list[ComputedStructureEntry] = mpr.get_entries_in_chemsys(chem_sys)
        all_entries[chem_sys] = entries

    pd = PhaseDiagram(entries)

    filename = f"{out_dir}/{chem_sys}.json.gz"
    json_data = [
        entry.as_dict()
        | {
            "e_above_hull": pd.get_e_above_hull(entry),
            "is_stable": entry in pd.stable_entries,
            "e_form_per_atom": pd.get_form_energy_per_atom(entry),
        }
        for entry in entries
    ]
    with gzip.open(filename, mode="wt", encoding="utf-8") as file:
        json.dump(json_data, file, indent=2)
