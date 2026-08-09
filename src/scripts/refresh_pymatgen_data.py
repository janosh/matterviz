"""Refresh pymatgen properties in MatterViz data (`uv run src/scripts/refresh_pymatgen_data.py`)."""

import gzip
import json
from pathlib import Path
from typing import Any


def extract_pymatgen_properties(
    pymatgen_data: dict[str, Any], symbol: str
) -> dict[str, Any]:
    """Extract relevant properties from pymatgen data for a given element."""
    elem_data = pymatgen_data.get(symbol, {})
    key_map = {
        "Mendeleev no": "mendeleev_number",
        "Oxidation states": "oxidation_states",
        "Common oxidation states": "common_oxidation_states",
        "ICSD oxidation states": "icsd_oxidation_states",
        "Ionic radii": "ionic_radii",
        "Shannon radii": "shannon_radii",
    }
    result = {
        output_key: (
            sorted(elem_data[input_key])
            if output_key.endswith("_states")
            else elem_data[input_key]
        )
        for input_key, output_key in key_map.items()
        if input_key in elem_data
    }
    if "ionic_radii" in result:
        result["ionic_radii"] = {
            str(oxi_state): radius
            for oxi_state, radius in result["ionic_radii"].items()
        }

    return result


def main() -> None:
    """Main entry point."""
    gz_path = Path(__file__).parents[1] / "lib" / "element" / "data.json.gz"

    print(f"Loading existing data from {gz_path}")
    existing_data: list[dict[str, Any]] = json.loads(
        gzip.decompress(gz_path.read_bytes())
    )
    print(f"Loaded {len(existing_data)} elements")

    print("Loading pymatgen periodic table data...")
    try:
        import pymatgen.core
    except ImportError as error:
        raise ImportError("pymatgen is required to refresh element data") from error
    pymatgen_path = Path(pymatgen.core.__file__).parent / "periodic_table.json.gz"
    pymatgen_data: dict[str, Any] = json.loads(
        gzip.decompress(pymatgen_path.read_bytes())
    )
    pymatgen_data.pop("_unit", None)
    print(f"Loaded pymatgen data for {len(pymatgen_data)} elements")

    print("Merging data...")
    merged_data = [
        {**elem, **extract_pymatgen_properties(pymatgen_data, elem["symbol"])}
        for elem in existing_data
    ]

    json_bytes = json.dumps(merged_data, indent=2, ensure_ascii=False).encode("utf-8")
    print(f"Writing gzipped output to {gz_path}")
    gz_path.write_bytes(gzip.compress(json_bytes, mtime=0))
    print(f"Done! {len(json_bytes):,} bytes -> {gz_path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
