# /// script
# requires-python = ">=3.11"
# dependencies = ["requests>=2.31"]
# ///
"""Fetch chemical systems from the Alexandria PBE database through its OPTIMADE API (no API key
needed): ternaries for the /phase-diagram/ternary demo and carbonate-containing quaternaries for
the /synthesis-planning demo.

Each system file holds every sub-system entry within the hull cutoff of the Alexandria hull as
slim convex-hull entries: composition, formation energy, hull distance, volume per atom (for the
SISSO G(T) estimate) and a few descriptors. Unary entries are not exported (Alexandria's OPTIMADE
backend times out on nelements=1 queries), so `energy` is the formation energy per cell relative
to Alexandria's elemental references, which places the pure elements at 0 eV/atom exactly as the
viewer's synthetic corners assume.

Run with: uv run src/scripts/fetch_alexandria_ternaries.py
"""

from __future__ import annotations

import gzip
import itertools
import json
import os
import time
from collections import Counter
from typing import Any
from urllib.parse import urlparse

import requests

BASE_URL = "https://alexandria.icams.rub.de/pbe/v1/structures"
HULL_CUTOFF = 0.3  # eV/atom above the Alexandria hull
PAGE_LIMIT = 500
RESPONSE_FIELDS = (
    "id,species_at_sites,nsites,lattice_vectors,_alexandria_formation_energy_per_atom,"
    "_alexandria_hull_distance,_alexandria_energy_corrected,_alexandria_space_group,"
    "_alexandria_band_gap,_alexandria_magnetization"
)
# Demo categories for these live in src/site/phase-diagrams/ternary/index.ts
SYSTEMS = (
    "Li-Co-O",
    "Li-Mn-O",
    "Li-Ni-O",
    "Li-Ti-O",
    "Na-Fe-O",
    "Li-P-S",
    "Ca-C-O",
    "Mg-Si-O",
    "Ba-Ti-O",
    "Fe-Cr-O",
    "Ti-N-O",
    "Cu-Zn-O",
)
site_dir = f"{os.path.dirname(os.path.abspath(__file__))}/../site"
out_dir = f"{site_dir}/phase-diagrams/ternary"
# Quaternaries with carbonate/oxide precursors for the synthesis planner demo. The tighter hull
# cutoff keeps the files small; the planner only considers near-hull phases anyway.
SYNTHESIS_SYSTEMS = ("Ba-Ti-C-O", "Li-Co-C-O")
SYNTHESIS_HULL_CUTOFF = 0.1
# Raw PBE overbinds O2, so O2-molecular-crystal-like entries (CoO8, LiO8, ...) sit on the Alexandria
# hull. They are artefacts for synthesis purposes; drop anything more O-rich than a superoxide.
MAX_O_FRACTION = 0.75
synthesis_out_dir = f"{site_dir}/synthesis-planning"


def fetch_subsystem(
    elements: tuple[str, ...], hull_cutoff: float = HULL_CUTOFF
) -> list[dict[str, Any]]:
    """All entries of exactly these elements within hull_cutoff of the hull."""
    element_list = ",".join(f'"{el}"' for el in elements)
    params: dict[str, Any] = {
        "filter": (
            f"elements HAS ALL {element_list} AND nelements={len(elements)} "
            f"AND _alexandria_hull_distance<{hull_cutoff}"
        ),
        "page_limit": PAGE_LIMIT,
        "response_fields": RESPONSE_FIELDS,
    }
    entries: list[dict[str, Any]] = []
    url: str | None = BASE_URL
    visited: set[str] = set()
    while url:
        # Next links come from the response: stay on the Alexandria host and never revisit
        if urlparse(url).netloc != urlparse(BASE_URL).netloc or url in visited:
            raise RuntimeError(f"Refusing to follow pagination link for {elements}: {url}")
        visited.add(url)
        payload: dict[str, Any] | None = None
        for attempt in range(4):
            if attempt:
                time.sleep(5 * attempt)
            try:
                response = requests.get(
                    url, params=params if url == BASE_URL else None, timeout=180
                )
                candidate = response.json()
                if response.ok and "errors" not in candidate:
                    payload = candidate
                    break
            except (requests.RequestException, ValueError):
                pass
        if payload is None:
            raise RuntimeError(
                f"Alexandria query failed for {elements} after 4 attempts: {url}"
            )
        entries.extend(payload["data"])
        url = (payload.get("links") or {}).get("next")
        if isinstance(url, dict):
            url = url.get("href")
    return entries


def volume_per_atom(lattice: list[list[float]], n_sites: int) -> float:
    """Cell volume from the lattice vectors' scalar triple product, divided by site count."""
    (ax, ay, az), (bx, by, bz), (cx, cy, cz) = lattice
    volume = abs(
        ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    )
    return volume / n_sites


def to_entry(item: dict[str, Any]) -> dict[str, Any]:
    """Convert one OPTIMADE structure into a slim matterviz convex-hull entry."""
    attrs = item["attributes"]
    composition = dict(Counter(attrs["species_at_sites"]))
    n_sites = attrs["nsites"]
    e_form = attrs["_alexandria_formation_energy_per_atom"]
    e_hull = attrs["_alexandria_hull_distance"]
    return {
        "entry_id": item["id"],
        "composition": composition,
        "energy": e_form * n_sites,
        "e_form_per_atom": e_form,
        "e_above_hull": e_hull,
        "is_stable": e_hull <= 1e-6,
        "volume_per_atom": volume_per_atom(attrs["lattice_vectors"], n_sites),
        "data": {
            "source": "Alexandria PBE",
            "space_group": attrs["_alexandria_space_group"],
            "band_gap": attrs["_alexandria_band_gap"],
            "magnetization": attrs["_alexandria_magnetization"],
            "total_energy_corrected": attrs["_alexandria_energy_corrected"],
        },
    }


def o_fraction(entry: dict[str, Any]) -> float:
    """Atom fraction of oxygen in an entry's composition."""
    composition = entry["composition"]
    return composition.get("O", 0) / sum(composition.values())


def fetch_system(
    system: str, directory: str, hull_cutoff: float, max_o_fraction: float = 1.0
) -> None:
    """Fetch every binary..N-ary sub-system of `system` into <directory>/<system>.json.gz."""
    elements = tuple(system.split("-"))
    filename = f"{directory}/{system}.json.gz"
    if os.path.isfile(filename):
        print(f"{system}: exists, skipping")
        return
    entries: list[dict[str, Any]] = []
    for size in range(2, len(elements) + 1):
        for subset in itertools.combinations(elements, size):
            items = fetch_subsystem(subset, hull_cutoff)
            converted = [to_entry(item) for item in items]
            entries.extend(entry for entry in converted if o_fraction(entry) <= max_o_fraction)
            print(f"{system}: {'-'.join(subset)} -> {len(items)} entries")
    entries.sort(key=lambda entry: (len(entry["composition"]), entry["e_above_hull"]))
    os.makedirs(directory, exist_ok=True)
    with gzip.open(filename, mode="wt", encoding="utf-8") as file:
        json.dump(entries, file, separators=(",", ":"))
    n_stable = sum(entry["is_stable"] for entry in entries)
    print(f"{system}: wrote {len(entries)} entries ({n_stable} stable) to {filename}")


def main() -> None:
    """Fetch the ternary demo systems and the synthesis-planner quaternaries."""
    for system in SYSTEMS:
        fetch_system(system, out_dir, HULL_CUTOFF)
    for system in SYNTHESIS_SYSTEMS:
        fetch_system(system, synthesis_out_dir, SYNTHESIS_HULL_CUTOFF, MAX_O_FRACTION)


if __name__ == "__main__":
    main()
