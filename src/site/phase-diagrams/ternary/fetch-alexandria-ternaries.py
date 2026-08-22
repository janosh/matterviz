# /// script
# requires-python = ">=3.11"
# dependencies = ["requests>=2.31"]
# ///
"""Fetch ternary chemical systems from the Alexandria PBE database through its OPTIMADE API
(no API key needed) for the /phase-diagram/ternary demo.

Each system file holds every binary and ternary entry within HULL_CUTOFF eV/atom of the
Alexandria hull as slim convex-hull entries: composition, formation energy, hull distance,
volume per atom (for the SISSO G(T) estimate) and a few descriptors. Unary entries are not
exported (Alexandria's OPTIMADE backend times out on nelements=1 queries), so `energy` is the
formation energy per cell relative to Alexandria's elemental references, which places the pure
elements at 0 eV/atom exactly as the viewer's synthetic corners assume.

Run with: uv run src/site/phase-diagrams/ternary/fetch-alexandria-ternaries.py
"""

from __future__ import annotations

import gzip
import itertools
import json
import os
import time
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
# Demo categories for these live in index.ts next to this script
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
out_dir = os.path.dirname(os.path.abspath(__file__))


def fetch_subsystem(elements: tuple[str, ...]) -> list[dict[str, Any]]:
    """All entries of exactly these elements within HULL_CUTOFF of the hull."""
    element_list = ",".join(f'"{el}"' for el in elements)
    params: dict[str, Any] = {
        "filter": (
            f"elements HAS ALL {element_list} AND nelements={len(elements)} "
            f"AND _alexandria_hull_distance<{HULL_CUTOFF}"
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
    composition: dict[str, int] = {}
    for species in attrs["species_at_sites"]:
        composition[species] = composition.get(species, 0) + 1
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


def main() -> None:
    """Fetch every system into <A-B-C>.json.gz next to this script."""
    for system in SYSTEMS:
        elements = tuple(system.split("-"))
        filename = f"{out_dir}/{system}.json.gz"
        if os.path.isfile(filename):
            print(f"{system}: exists, skipping")
            continue
        entries: list[dict[str, Any]] = []
        for size in (2, 3):
            for subset in itertools.combinations(elements, size):
                items = fetch_subsystem(subset)
                entries.extend(to_entry(item) for item in items)
                print(f"{system}: {'-'.join(subset)} -> {len(items)} entries")
        entries.sort(
            key=lambda entry: (len(entry["composition"]), entry["e_above_hull"])
        )
        with gzip.open(filename, mode="wt", encoding="utf-8") as file:
            json.dump(entries, file, separators=(",", ":"))
        n_stable = sum(entry["is_stable"] for entry in entries)
        print(
            f"{system}: wrote {len(entries)} entries ({n_stable} stable) to {filename}"
        )


if __name__ == "__main__":
    main()
