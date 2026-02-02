"""Tests for ferrox Python API - composition, structure metadata, and symmetry functions."""

from __future__ import annotations

import json

import pytest

try:
    from ferrox import _ferrox as ferrox
except ImportError:
    pytest.skip("ferrox not installed", allow_module_level=True)

# Fixtures imported from conftest.py: nacl_json, fe2o3_json, fcc_cu_json, bcc_fe_json


# parse_composition tests


class TestParseComposition:
    """Tests for parse_composition function."""

    def test_basic_properties(self) -> None:
        """Parse formula and verify all basic properties."""
        result = ferrox.parse_composition("Fe2O3")
        assert result["formula"] == "Fe2 O3"
        assert result["reduced_formula"] == "Fe2O3"
        assert result["chemical_system"] == "Fe-O"
        assert result["num_atoms"] == 5.0
        assert result["num_elements"] == 2
        assert "Fe" in result["species"]
        assert "O" in result["species"]

    def test_formula_anonymous_reduction(self) -> None:
        """Anonymous formula reduces: Fe4O6 and Fe2O3 give same result."""
        large = ferrox.parse_composition("Fe4O6")
        small = ferrox.parse_composition("Fe2O3")
        assert large["formula_anonymous"] == small["formula_anonymous"] == "A2B3"
        assert large["reduced_formula"] == small["reduced_formula"]

    def test_formula_hill(self) -> None:
        """Hill formula: C first, H second, then alphabetical."""
        assert ferrox.parse_composition("C6H12O6")["formula_hill"] == "C6 H12 O6"

    def test_weight(self) -> None:
        """Molecular weight: H2O ≈ 18.015 amu."""
        assert 17.9 < ferrox.parse_composition("H2O")["weight"] < 18.1


# get_structure_metadata tests


class TestGetStructureMetadata:
    """Tests for get_structure_metadata function."""

    def test_all_metadata_fields(self, nacl_json: str) -> None:
        """Verify all metadata fields are correct."""
        result = ferrox.get_structure_metadata(nacl_json)

        # Formula fields (keys match parse_composition for consistency)
        assert result["formula"] == "NaCl"
        assert result["formula_anonymous"] == "AB"  # Na (0.93) < Cl (3.16)
        assert result["formula_hill"] == "Cl Na"
        assert result["chemical_system"] == "Cl-Na"

        # Element/site counts
        assert sorted(result["elements"]) == ["Cl", "Na"]
        assert result["n_elements"] == 2
        assert result["n_sites"] == 2
        assert result["is_ordered"] is True

        # Physical properties
        assert abs(result["volume"] - 5.64**3) < 0.1
        assert result["density"] is not None and result["density"] > 0
        assert 58 < result["mass"] < 59  # Na (~23) + Cl (~35.5)

    def test_binary_structure(self, fe2o3_json: str) -> None:
        """Test Fe2O3 structure metadata."""
        result = ferrox.get_structure_metadata(fe2o3_json)
        assert result["formula_anonymous"] == "A2B3"  # Fe (1.83) < O (3.44)
        assert result["n_sites"] == 5

    def test_spacegroup_optional(self, nacl_json: str) -> None:
        """Spacegroup computation is optional and expensive."""
        without_sg = ferrox.get_structure_metadata(nacl_json, compute_spacegroup=False)
        assert "spacegroup_number" not in without_sg

        with_sg = ferrox.get_structure_metadata(nacl_json, compute_spacegroup=True)
        assert with_sg["spacegroup_number"] == 221  # Pm-3m

    def test_consistency_with_parse_composition(self, nacl_json: str) -> None:
        """Metadata matches parse_composition for same formula."""
        metadata = ferrox.get_structure_metadata(nacl_json)
        comp = ferrox.parse_composition("NaCl")
        assert metadata["formula"] == comp["reduced_formula"]
        assert metadata["formula_anonymous"] == comp["formula_anonymous"]
        assert metadata["chemical_system"] == comp["chemical_system"]


class TestStructureCharge:
    """Tests for structure charge field preservation."""

    def test_default_charge_is_zero(self, nacl_json: str) -> None:
        """Structure without charge field defaults to 0.0."""
        result = ferrox.to_pymatgen_json(nacl_json)
        parsed = json.loads(result)
        assert parsed.get("charge", 0.0) == 0.0

    @pytest.mark.parametrize("charge", [0.0, 1.0, -1.0, 2.5, -0.5])
    def test_charge_roundtrip(self, charge: float) -> None:
        """Various charge values are preserved through JSON roundtrip."""
        struct = json.dumps(
            {
                "@class": "Structure",
                "lattice": {"matrix": [[5.0, 0, 0], [0, 5.0, 0], [0, 0, 5.0]]},
                "sites": [
                    {"species": [{"element": "Li", "occu": 1}], "abc": [0, 0, 0]}
                ],
                "charge": charge,
            }
        )
        result = ferrox.to_pymatgen_json(struct)
        parsed = json.loads(result)
        if abs(charge) > 1e-10:
            assert abs(parsed["charge"] - charge) < 1e-10
        else:
            assert parsed.get("charge", 0.0) == 0.0


class TestFromPymatgenStructure:
    """Tests for from_pymatgen_structure oxidation state extraction."""

    @pytest.mark.parametrize(
        ("element", "oxi_state"),
        [
            ("Fe", 3),
            ("Fe", 2),
            ("O", -2),
            ("Na", 1),
            ("Cl", -1),
        ],
    )
    def test_oxidation_states_preserved(self, element: str, oxi_state: int) -> None:
        """Oxidation states from pymatgen Species are preserved."""
        pytest.importorskip("pymatgen")
        from pymatgen.core import Lattice, Species, Structure

        # Create pymatgen Structure with oxidation state
        lattice = Lattice.cubic(5.0)
        species = Species(element, oxi_state)
        struct = Structure(lattice, [species], [[0, 0, 0]])
        # Convert to ferrox and check oxidation state preserved
        result = ferrox.from_pymatgen_structure(struct)
        site_species = result["sites"][0]["species"][0]
        assert site_species["element"] == element
        assert site_species.get("oxidation_state") == oxi_state

    def test_neutral_species_no_oxi_state(self) -> None:
        """Neutral species (no oxidation state) preserved as neutral."""
        pytest.importorskip("pymatgen")
        from pymatgen.core import Element, Lattice, Structure

        lattice = Lattice.cubic(5.0)
        struct = Structure(lattice, [Element("Fe")], [[0, 0, 0]])
        result = ferrox.from_pymatgen_structure(struct)
        site_species = result["sites"][0]["species"][0]
        assert site_species["element"] == "Fe"
        assert site_species.get("oxidation_state") is None

    def test_mixed_oxi_states_in_structure(self) -> None:
        """Structure with multiple species at different oxidation states (Fe2O3)."""
        pytest.importorskip("pymatgen")
        from pymatgen.core import Lattice, Species, Structure

        # Fe2O3: 2x Fe3+ and 3x O2-
        struct = Structure(
            Lattice.cubic(5.0),
            [Species("Fe", 3)] * 2 + [Species("O", -2)] * 3,
            [
                [0, 0, 0],
                [0.5, 0.5, 0.5],
                [0.25, 0.25, 0.25],
                [0.75, 0.75, 0.25],
                [0.25, 0.75, 0.75],
            ],
        )
        result = ferrox.from_pymatgen_structure(struct)
        # Verify oxidation states by element
        for elem, expected_oxi in [("Fe", 3), ("O", -2)]:
            sites = [s for s in result["sites"] if s["species"][0]["element"] == elem]
            assert all(
                s["species"][0]["oxidation_state"] == expected_oxi for s in sites
            )


# Parametrized anonymous formula tests


@pytest.mark.parametrize(
    ("formula", "expected"),
    [
        # Binary (sorted by electronegativity)
        ("Fe2O3", "A2B3"),
        ("NaCl", "AB"),
        ("H2O", "A2B"),
        ("MgO", "AB"),
        ("SiO2", "AB2"),
        ("Al2O3", "A2B3"),
        # Ternary/quaternary
        ("BaTiO3", "ABC3"),
        ("LiFePO4", "ABCD4"),
        ("CaCO3", "ABC3"),
        # Single element
        ("Cu", "A"),
        # Reduction (Fe4O6 → A2B3, not A4B6)
        ("Fe4O6", "A2B3"),
    ],
)
def test_formula_anonymous(formula: str, expected: str) -> None:
    """Anonymous formula: elements sorted by electronegativity, then A, B, C..."""
    assert ferrox.parse_composition(formula)["formula_anonymous"] == expected


# Symmetry tests (fixtures from conftest.py)


class TestSymmetryFunctions:
    """Tests for symmetry analysis functions."""

    @pytest.mark.parametrize(
        ("fixture", "sg_num", "sg_sym", "pearson", "crystal_sys"),
        [
            ("fcc_cu_json", 225, "F m -3 m", "cF4", "cubic"),
            ("bcc_fe_json", 229, "I m -3 m", "cI2", "cubic"),
        ],
    )
    def test_symmetry_properties(
        self,
        fixture: str,
        sg_num: int,
        sg_sym: str,
        pearson: str,
        crystal_sys: str,
        request: pytest.FixtureRequest,
    ) -> None:
        """Test spacegroup, Pearson symbol, and crystal system."""
        struct = request.getfixturevalue(fixture)
        assert ferrox.get_spacegroup_number(struct) == sg_num
        assert ferrox.get_spacegroup_symbol(struct) == sg_sym
        assert ferrox.get_pearson_symbol(struct) == pearson
        assert ferrox.get_crystal_system(struct) == crystal_sys

    def test_hall_number_range(self, fcc_cu_json: str) -> None:
        """Hall number is in valid range (1-530)."""
        assert 1 <= ferrox.get_hall_number(fcc_cu_json) <= 530

    def test_wyckoff_and_site_symmetry(self, fcc_cu_json: str) -> None:
        """FCC Cu: all 4 atoms have same Wyckoff position and site symmetry."""
        assert len(set(ferrox.get_wyckoff_letters(fcc_cu_json))) == 1
        assert len(set(ferrox.get_site_symmetry_symbols(fcc_cu_json))) == 1

    def test_symmetry_operations(self, fcc_cu_json: str) -> None:
        """Symmetry operations: each is (3x3 rotation, 3-vector translation)."""
        for rot, trans in ferrox.get_symmetry_operations(fcc_cu_json):
            assert len(rot) == 3 and all(len(row) == 3 for row in rot)
            assert len(trans) == 3

    @pytest.mark.parametrize(
        ("fixture", "n_sites", "n_unique"),
        [
            ("fcc_cu_json", 4, 1),  # all equivalent
            ("nacl_json", 2, 2),  # Na and Cl inequivalent
        ],
    )
    def test_equivalent_sites(
        self, fixture: str, n_sites: int, n_unique: int, request: pytest.FixtureRequest
    ) -> None:
        """Equivalent site detection."""
        orbits = ferrox.get_equivalent_sites(request.getfixturevalue(fixture))
        assert len(orbits) == n_sites
        assert len(set(orbits)) == n_unique

    def test_is_periodic_image_same_site(self, fcc_cu_json: str) -> None:
        """Same site is always a periodic image of itself."""
        assert ferrox.is_periodic_image(fcc_cu_json, 0, 0, tolerance=0.01)

    def test_is_periodic_image_different_elements(self, nacl_json: str) -> None:
        """Na and Cl sites are not periodic images."""
        # First site is Na, second is Cl (or vice versa)
        assert not ferrox.is_periodic_image(nacl_json, 0, 1, tolerance=0.01)

    def test_is_periodic_image_tolerance(self, fcc_cu_json: str) -> None:
        """Tolerance parameter affects detection."""
        # With very small tolerance, might still find self as periodic image
        assert ferrox.is_periodic_image(fcc_cu_json, 0, 0, tolerance=1e-6)


class TestGetSymmetryDataset:
    """Tests for get_symmetry_dataset function (returns all symmetry info)."""

    def test_all_fields_present(self, fcc_cu_json: str) -> None:
        """Verify all expected fields in symmetry dataset."""
        dataset = ferrox.get_symmetry_dataset(fcc_cu_json)

        # Check all expected keys are present
        expected_keys = {
            "spacegroup_number",
            "spacegroup_symbol",
            "hall_number",
            "pearson_symbol",
            "crystal_system",
            "wyckoff_letters",
            "site_symmetry_symbols",
            "equivalent_sites",
            "symmetry_operations",
            "num_operations",
        }
        assert expected_keys.issubset(dataset.keys())

    def test_dataset_values(self, fcc_cu_json: str) -> None:
        """Verify symmetry dataset values for FCC Cu."""
        dataset = ferrox.get_symmetry_dataset(fcc_cu_json)

        assert dataset["spacegroup_number"] == 225
        assert dataset["spacegroup_symbol"] == "F m -3 m"
        assert dataset["pearson_symbol"] == "cF4"
        assert dataset["crystal_system"] == "cubic"
        assert len(dataset["wyckoff_letters"]) == 4
        assert len(dataset["equivalent_sites"]) == 4
        assert dataset["num_operations"] == len(dataset["symmetry_operations"])

    def test_dataset_matches_individual_calls(self, nacl_json: str) -> None:
        """Dataset contains same info as individual calls."""
        dataset = ferrox.get_symmetry_dataset(nacl_json)

        assert dataset["spacegroup_number"] == ferrox.get_spacegroup_number(nacl_json)
        assert dataset["spacegroup_symbol"] == ferrox.get_spacegroup_symbol(nacl_json)
        assert dataset["pearson_symbol"] == ferrox.get_pearson_symbol(nacl_json)
        assert dataset["crystal_system"] == ferrox.get_crystal_system(nacl_json)
        assert dataset["wyckoff_letters"] == ferrox.get_wyckoff_letters(nacl_json)
        assert dataset["equivalent_sites"] == ferrox.get_equivalent_sites(nacl_json)


# Structure Writer Tests


class TestStructureWriters:
    """Tests for structure writing functions."""

    def test_to_poscar_format(self, nacl_json: str) -> None:
        """Verify POSCAR format structure."""
        poscar = ferrox.to_poscar(nacl_json)
        lines = poscar.strip().split("\n")
        # Line 1: comment (formula)
        assert "Na" in lines[0] or "Cl" in lines[0]
        # Line 2: scale factor
        assert lines[1].strip() == "1.0"
        # Lines 3-5: lattice vectors
        assert len(lines[2].split()) == 3
        # Check "Direct" keyword
        assert any("Direct" in line for line in lines)

    def test_to_poscar_custom_comment(self, fcc_cu_json: str) -> None:
        """Custom comment line in POSCAR."""
        poscar = ferrox.to_poscar(fcc_cu_json, comment="My custom comment")
        assert poscar.startswith("My custom comment\n")

    def test_to_cif_format(self, nacl_json: str) -> None:
        """Verify CIF format structure."""
        cif = ferrox.to_cif(nacl_json)
        assert cif.startswith("data_")
        assert "_cell_length_a" in cif
        assert "_symmetry_space_group_name_H-M" in cif
        assert "loop_" in cif
        assert "_atom_site_type_symbol" in cif

    def test_to_cif_custom_data_name(self, fcc_cu_json: str) -> None:
        """Custom data block name in CIF."""
        cif = ferrox.to_cif(fcc_cu_json, data_name="my_structure")
        assert cif.startswith("data_my_structure\n")

    def test_to_extxyz_format(self, nacl_json: str) -> None:
        """Verify extXYZ format structure."""
        xyz = ferrox.to_extxyz(nacl_json)
        lines = xyz.strip().split("\n")
        # Line 1: atom count
        assert lines[0] == "2"
        # Line 2: comment with Lattice
        assert "Lattice=" in lines[1]
        assert "pbc=" in lines[1]
        # Atom lines
        assert lines[2].startswith("Na") or lines[2].startswith("Cl")

    def test_to_pymatgen_json_roundtrip(self, nacl_json: str) -> None:
        """JSON output can be parsed back."""
        json_out = ferrox.to_pymatgen_json(nacl_json)
        parsed = json.loads(json_out)
        assert "@module" in parsed
        assert "lattice" in parsed
        assert "sites" in parsed
        assert len(parsed["sites"]) == 2

    def test_write_structure_file(self, nacl_json: str, tmp_path) -> None:
        """Test write_structure_file with auto format detection."""
        for filename in ["test.cif", "test.xyz", "POSCAR", "test.json"]:
            path = tmp_path / filename
            ferrox.write_structure_file(nacl_json, str(path))
            assert path.read_text(), f"{filename} should not be empty"


# RDF Tests

# Skip RDF tests if module not rebuilt with RDF functions
rdf_available = hasattr(ferrox, "compute_rdf")


@pytest.mark.skipif(not rdf_available, reason="ferrox not rebuilt with RDF functions")
class TestRdf:
    """Tests for radial distribution function calculations."""

    def test_compute_rdf_returns_correct_shape(self, rocksalt_nacl_json: str) -> None:
        """RDF returns correct number of bins."""
        radii, g_of_r = ferrox.compute_rdf(rocksalt_nacl_json, r_max=6.0, n_bins=30)
        assert len(radii) == 30
        assert len(g_of_r) == 30

    def test_compute_rdf_bin_centers(self, rocksalt_nacl_json: str) -> None:
        """Bin centers are correctly positioned."""
        r_max, n_bins = 6.0, 30
        radii, _ = ferrox.compute_rdf(rocksalt_nacl_json, r_max=r_max, n_bins=n_bins)
        bin_size = r_max / n_bins
        # First bin center
        assert abs(radii[0] - bin_size / 2) < 1e-10
        # Last bin center
        assert abs(radii[-1] - (r_max - bin_size / 2)) < 1e-10

    def test_compute_rdf_has_peaks(self, rocksalt_nacl_json: str) -> None:
        """RDF should have non-zero peaks for crystal structure."""
        _, g_of_r = ferrox.compute_rdf(rocksalt_nacl_json, r_max=6.0, n_bins=30)
        assert any(g > 0 for g in g_of_r), "RDF should have non-zero values"

    def test_compute_element_rdf(self, rocksalt_nacl_json: str) -> None:
        """Element-resolved RDF for Na-Cl pair."""
        radii, g_of_r = ferrox.compute_element_rdf(
            rocksalt_nacl_json, "Na", "Cl", r_max=6.0, n_bins=30
        )
        assert len(radii) == 30
        assert any(g > 0 for g in g_of_r), "Na-Cl RDF should have peaks"

    def test_compute_element_rdf_nonexistent_element(
        self, rocksalt_nacl_json: str
    ) -> None:
        """RDF for non-existent element returns zeros."""
        _, g_of_r = ferrox.compute_element_rdf(
            rocksalt_nacl_json, "Fe", "O", r_max=6.0, n_bins=30
        )
        assert all(g == 0 for g in g_of_r), "Non-existent element pair should be zero"

    def test_compute_all_element_rdfs(self, rocksalt_nacl_json: str) -> None:
        """All element pair RDFs for NaCl (3 pairs: Na-Na, Na-Cl, Cl-Cl)."""
        results = ferrox.compute_all_element_rdfs(
            rocksalt_nacl_json, r_max=6.0, n_bins=30
        )
        assert len(results) == 3
        pairs = {(rdf["element_a"], rdf["element_b"]) for rdf in results}
        assert ("Na", "Na") in pairs
        assert ("Na", "Cl") in pairs
        assert ("Cl", "Cl") in pairs

    def test_compute_all_element_rdfs_single_element(self, fcc_cu_json: str) -> None:
        """Single element structure has 1 RDF pair."""
        results = ferrox.compute_all_element_rdfs(fcc_cu_json, r_max=5.0, n_bins=25)
        assert len(results) == 1
        assert results[0]["element_a"] == "Cu"
        assert results[0]["element_b"] == "Cu"

    def test_rdf_normalize_option(self, rocksalt_nacl_json: str) -> None:
        """Normalization affects g(r) values."""
        _, g_norm = ferrox.compute_rdf(
            rocksalt_nacl_json, r_max=6.0, n_bins=30, normalize=True
        )
        _, g_raw = ferrox.compute_rdf(
            rocksalt_nacl_json, r_max=6.0, n_bins=30, normalize=False
        )
        # Raw counts should be different from normalized
        assert g_norm != g_raw

    def test_rdf_auto_expand_option(self, nacl_json: str) -> None:
        """Auto-expand option runs without error."""
        # Small structure with auto_expand should work
        radii1, g1 = ferrox.compute_rdf(
            nacl_json, r_max=6.0, n_bins=30, auto_expand=True, expansion_factor=1.5
        )
        radii2, g2 = ferrox.compute_rdf(
            nacl_json, r_max=6.0, n_bins=30, auto_expand=False
        )
        # Both should return valid data
        assert len(radii1) == len(radii2) == 30

    def test_rdf_invalid_r_max(self, nacl_json: str) -> None:
        """Negative r_max raises error."""
        with pytest.raises(ValueError, match="r_max must be positive"):
            ferrox.compute_rdf(nacl_json, r_max=-1.0)

    def test_rdf_invalid_n_bins(self, nacl_json: str) -> None:
        """Zero n_bins raises error."""
        with pytest.raises(ValueError, match="n_bins must be at least 1"):
            ferrox.compute_rdf(nacl_json, n_bins=0)

    def test_element_rdf_invalid_element(self, nacl_json: str) -> None:
        """Invalid element symbol raises error."""
        with pytest.raises(ValueError, match="Unknown element"):
            ferrox.compute_element_rdf(nacl_json, "Xx", "Yy")

    def test_rdf_fcc_first_peak_position(self, fcc_cu_json: str) -> None:
        """FCC Cu first peak near a/√2 ≈ 2.55 Å."""
        lattice_const = 3.6
        expected_nn = lattice_const / (2**0.5)  # ~2.546 Å

        radii, g_of_r = ferrox.compute_rdf(
            fcc_cu_json, r_max=5.0, n_bins=50, auto_expand=False
        )

        # Find peak position
        peak_idx = max(range(len(g_of_r)), key=lambda idx: g_of_r[idx])
        peak_r = radii[peak_idx]

        assert abs(peak_r - expected_nn) < 0.3, (
            f"FCC Cu peak at {peak_r:.2f} Å, expected ~{expected_nn:.2f} Å"
        )

    def test_rdf_empty_structure(self) -> None:
        """Empty structure returns zero RDF."""
        empty_json = json.dumps(
            {
                "@module": "pymatgen.core.structure",
                "@class": "Structure",
                "lattice": {"matrix": [[5, 0, 0], [0, 5, 0], [0, 0, 5]]},
                "sites": [],
            }
        )
        _, g_of_r = ferrox.compute_rdf(empty_json, r_max=5.0, n_bins=25)
        assert all(g == 0 for g in g_of_r)
