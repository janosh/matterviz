import json
import os
from glob import glob

from pymatgen.analysis.diffraction.xrd import XRDCalculator
from pymatgen.core import Structure

module_dir = os.path.dirname(__file__)
struct_files = glob(f"{module_dir}/../structures/*.json")

for struct_file in struct_files:
    structure = Structure.from_file(struct_file)
    xrd_pattern = XRDCalculator().get_pattern(structure)
    with open(struct_file.replace("/structures/", "/xrd/"), "w") as file:
        json.dump(
            {
                "x": xrd_pattern.x.tolist(),
                "y": xrd_pattern.y.tolist(),
                "hkls": xrd_pattern.hkls,
                "d_hkls": xrd_pattern.d_hkls,
            },
            file,
        )
