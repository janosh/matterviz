"""Tests for molecule I/O and ASE conversion functions."""

from __future__ import annotations

import json

import pytest

try:
    from ferrox import _ferrox as ferrox
except ImportError:
    pytest.skip("ferrox not installed", allow_module_level=True)


def _mol_json(element: str = "H", charge: float = 0.0) -> str:
    """Helper to create single-atom molecule JSON."""
    return json.dumps({
        "@class": "Molecule",
        "sites": [{"species": [{"element": element, "occu": 1}], "xyz": [0, 0, 0]}],
        "charge": charge,
    })


def _water_json() -> str:
    """Water molecule JSON."""
    return json.dumps({
        "@module": "pymatgen.core.structure",
        "@class": "Molecule",
        "sites": [
            {"species": [{"element": "O", "occu": 1}], "xyz": [0.0, 0.0, 0.0]},
            {"species": [{"element": "H", "occu": 1}], "xyz": [0.96, 0.0, 0.0]},
            {"species": [{"element": "H", "occu": 1}], "xyz": [-0.24, 0.93, 0.0]},
        ],
        "charge": 0,
    })


# === Molecule JSON Parsing Tests ===


class TestParseMoleculeJson:
    """Tests for parse_molecule_json function."""

    def test_water_molecule(self) -> None:
        """Parse water molecule: verify sites, species, and coordinates."""
        result = ferrox.parse_molecule_json(_water_json())
        assert len(result["sites"]) == 3
        species = sorted(s["species"][0]["element"] for s in result["sites"])
        assert species == ["H", "H", "O"]
        # Check H coordinate preserved
        h_coords = [s["xyz"] for s in result["sites"] if s["species"][0]["element"] == "H"]
        assert any(abs(c[0] - 0.96) < 1e-10 for c in h_coords)

    def test_invalid_json_error(self) -> None:
        """Invalid JSON raises error."""
        with pytest.raises(ValueError, match="Error parsing molecule"):
            ferrox.parse_molecule_json("not valid json")

    @pytest.mark.parametrize("charge", [0.0, 1.0, -1.0, 2.5, -0.5])
    def test_charge_preserved(self, charge: float) -> None:
        """Various charge values are preserved."""
        result = ferrox.parse_molecule_json(_mol_json(charge=charge))
        assert abs(result["charge"] - charge) < 1e-10


# === Molecule to XYZ Tests ===


class TestMoleculeToXyz:
    """Tests for molecule_to_xyz function."""

    def test_xyz_format(self) -> None:
        """Verify XYZ format: atom count, comment, atom lines."""
        xyz = ferrox.molecule_to_xyz(_water_json())
        lines = xyz.strip().split("\n")
        assert lines[0] == "3"  # atom count
        assert len(lines) == 5  # count + comment + 3 atoms
        # Atom line format: symbol x y z
        parts = lines[2].split()
        assert len(parts) == 4 and parts[0] in ("O", "H")
        float(parts[1]), float(parts[2]), float(parts[3])  # parseable coords

    def test_custom_comment(self) -> None:
        """Custom comment is used."""
        xyz = ferrox.molecule_to_xyz(_water_json(), comment="My Water")
        assert xyz.strip().split("\n")[1] == "My Water"


# === ASE Dict Parsing Tests ===


class TestParseAseDict:
    """Tests for parse_ase_dict function."""

    @pytest.mark.parametrize(("pbc", "expected_type", "n_sites"), [
        ([True, True, True], "Structure", 2),    # fully periodic
        ([False, False, False], "Molecule", 3),  # non-periodic
        ([True, True, False], "Structure", 2),   # 2D material
    ])
    def test_periodicity_detection(self, pbc: list, expected_type: str, n_sites: int) -> None:
        """Parse ASE dict with various PBC settings."""
        ase_dict = {
            "symbols": ["Na", "Cl"][:n_sites] if expected_type == "Structure" else ["O", "H", "H"],
            "positions": [[0.0, 0.0, 0.0], [2.82, 2.82, 2.82]][:n_sites] if expected_type == "Structure"
                else [[0.0, 0.0, 0.0], [0.96, 0.0, 0.0], [-0.24, 0.93, 0.0]],
            "cell": [[5.64, 0.0, 0.0], [0.0, 5.64, 0.0], [0.0, 0.0, 5.64]] if any(pbc)
                else [[0.0, 0.0, 0.0]] * 3,
            "pbc": pbc,
            "info": {},
        }
        type_name, result = ferrox.parse_ase_dict(ase_dict)
        assert type_name == expected_type
        assert len(result["sites"]) == n_sites

    def test_charge_from_info(self) -> None:
        """Charge is extracted from info dict."""
        ase_charged = {
            "symbols": ["Na"],
            "positions": [[0.0, 0.0, 0.0]],
            "pbc": [False, False, False],
            "info": {"charge": 1.0},
        }
        type_name, result = ferrox.parse_ase_dict(ase_charged)
        assert type_name == "Molecule"
        assert result["charge"] == 1.0


class TestFromAseAtoms:
    """Tests for from_ase_atoms function with actual ASE Atoms objects."""

    @pytest.mark.parametrize(("charge", "pbc"), [(1.0, False), (-1.0, True), (None, False)])
    def test_charge_extraction(self, charge: float | None, pbc: bool) -> None:
        """Charge is extracted from atoms.info or defaults to 0."""
        ase = pytest.importorskip("ase")
        atoms = ase.Atoms("NaCl", positions=[[0, 0, 0], [2.8, 2.8, 2.8]],
                          cell=[5.6, 5.6, 5.6] if pbc else None, pbc=pbc)
        if charge is not None:
            atoms.info["charge"] = charge
        result = ferrox.from_ase_atoms(atoms)
        assert result.get("charge", 0.0) == (charge or 0.0)


# === Roundtrip Tests ===


class TestRoundtrips:
    """Tests for roundtrip conversions."""

    def test_molecule_json_roundtrip(self) -> None:
        """Molecule JSON -> parse -> JSON preserves data."""
        parsed = ferrox.parse_molecule_json(_water_json())
        json_str = ferrox.molecule_to_json(json.dumps(parsed))
        reparsed = ferrox.parse_molecule_json(json_str)
        assert len(reparsed["sites"]) == len(parsed["sites"])
        assert reparsed["charge"] == parsed["charge"]

    def test_xyz_roundtrip(self) -> None:
        """Molecule JSON -> XYZ -> parse preserves atoms."""
        xyz = ferrox.molecule_to_xyz(_water_json())
        parsed = ferrox.parse_xyz_str(xyz)
        assert len(parsed["sites"]) == 3

    @pytest.mark.parametrize(("charge", "is_structure"), [
        (1.0, True), (-1.0, True), (2.5, True),   # structures
        (1.0, False), (-1.0, False), (0.5, False), # molecules
        (0.0, False),  # zero charge should not be in info
    ])
    def test_to_ase_atoms_charge_roundtrip(self, charge: float, is_structure: bool) -> None:
        """to_ase_atoms -> from_ase_atoms preserves charge for structures and molecules."""
        pytest.importorskip("ase")
        if is_structure:
            input_json = json.dumps({
                "@class": "Structure",
                "lattice": {"matrix": [[5.0, 0, 0], [0, 5.0, 0], [0, 0, 5.0]]},
                "sites": [{"species": [{"element": "Li", "occu": 1}], "abc": [0, 0, 0]}],
                "charge": charge,
            })
        else:
            input_json = _mol_json("Na", charge=charge)
        atoms = ferrox.to_ase_atoms(input_json)
        # Zero charge should not be in info dict (consistent with Rust side)
        if abs(charge) < 1e-10:
            assert "charge" not in atoms.info
        else:
            assert atoms.info.get("charge") == charge
            result = ferrox.from_ase_atoms(atoms)
            assert abs(result["charge"] - charge) < 1e-10


# === Edge Cases ===


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_single_atom_molecule(self) -> None:
        """Single-atom molecule is parsed correctly."""
        mol = _mol_json("He")
        result = ferrox.parse_molecule_json(mol)
        assert len(result["sites"]) == 1
        assert result["sites"][0]["species"][0]["element"] == "He"

    def test_empty_molecule_returns_empty(self) -> None:
        """Empty molecule (no atoms) returns a molecule with zero sites."""
        mol = json.dumps({"@class": "Molecule", "sites": [], "charge": 0})
        result = ferrox.parse_molecule_json(mol)
        assert len(result["sites"]) == 0
        assert result["charge"] == 0
