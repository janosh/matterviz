"""Generate a vaspout.h5 fixture containing INCAR POTIM."""

# /// script
# requires-python = ">=3.11"
# dependencies = ["h5py"]
# ///

import os
import shutil

import h5py


def main() -> None:
    """Write vaspout-si-potim.h5 next to this script."""
    fixture_dir = os.path.dirname(os.path.abspath(__file__))
    source_path = f"{fixture_dir}/vaspout-si-static.h5"
    output_path = f"{fixture_dir}/vaspout-si-potim.h5"

    shutil.copyfile(source_path, output_path)
    with h5py.File(output_path, "a") as h5_file:
        h5_file.create_dataset("input/incar/POTIM", data=2.5, dtype="f8")


if __name__ == "__main__":
    main()
