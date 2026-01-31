"""Tests for ferrox Python API - structure transformation functions."""

from __future__ import annotations

import json

import pytest

try:
    import ferrox
except ImportError:
    pytest.skip("ferrox not installed", allow_module_level=True)

# Fixtures from conftest.py: nacl_json, nacl_with_oxi_json, fcc_cu_json, lifepo4_json,
#                            disordered_json, single_fe_json


# to_primitive Tests


class TestToPrimitive:
    """Tests for to_primitive function."""

    def test_fcc_reduces_to_primitive(self, fcc_cu_json: str) -> None:
        """FCC conventional cell with 4 atoms should reduce to primitive with 1."""
        result = ferrox.to_primitive(fcc_cu_json)
        # Primitive FCC has 1 atom
        assert len(result["sites"]) < 4

    def test_already_primitive(self, nacl_json: str) -> None:
        """NaCl primitive cell should stay the same size."""
        original = json.loads(nacl_json)
        result = ferrox.to_primitive(nacl_json)
        # Should have same number of sites (already primitive)
        assert len(result["sites"]) <= len(original["sites"])

    def test_symprec_parameter(self, fcc_cu_json: str) -> None:
        """Different symprec should work."""
        result_tight = ferrox.to_primitive(fcc_cu_json, symprec=0.001)
        result_loose = ferrox.to_primitive(fcc_cu_json, symprec=0.1)
        # Both should reduce the cell
        assert len(result_tight["sites"]) < 4
        assert len(result_loose["sites"]) < 4



class TestToConventional:
    """Tests for to_conventional function."""

    def test_basic_operation(self, nacl_json: str) -> None:
        """to_conventional should return a valid structure."""
        result = ferrox.to_conventional(nacl_json)
        assert "lattice" in result
        assert "sites" in result



class TestSubstituteSpecies:
    """Tests for substitute_species function."""

    def test_basic_substitution(self, nacl_json: str) -> None:
        """Substitute Na with K."""
        result = ferrox.substitute_species(nacl_json, "Na", "K")
        # Check that K is now present
        elements = [site["species"][0]["element"] for site in result["sites"]]
        assert "K" in elements
        assert "Na" not in elements

    def test_substitute_preserves_structure(self, nacl_json: str) -> None:
        """Substitution should preserve number of sites."""
        original = json.loads(nacl_json)
        result = ferrox.substitute_species(nacl_json, "Na", "K")
        assert len(result["sites"]) == len(original["sites"])

    def test_substitute_nonexistent_species(self, nacl_json: str) -> None:
        """Substituting non-existent species should not crash."""
        result = ferrox.substitute_species(nacl_json, "Fe", "Co")
        # Should be unchanged
        elements = {site["species"][0]["element"] for site in result["sites"]}
        assert elements == {"Na", "Cl"}



class TestRemoveSpecies:
    """Tests for remove_species function."""

    def test_remove_single_species(self, nacl_json: str) -> None:
        """Remove Na from NaCl."""
        result = ferrox.remove_species(nacl_json, ["Na"])
        assert len(result["sites"]) == 1
        assert result["sites"][0]["species"][0]["element"] == "Cl"

    def test_remove_multiple_species(self, lifepo4_json: str) -> None:
        """Remove both Li and Fe."""
        result = ferrox.remove_species(lifepo4_json, ["Li", "Fe"])
        elements = {site["species"][0]["element"] for site in result["sites"]}
        assert "Li" not in elements
        assert "Fe" not in elements

    def test_remove_all_species(self, nacl_json: str) -> None:
        """Removing all species should result in empty structure."""
        result = ferrox.remove_species(nacl_json, ["Na", "Cl"])
        assert len(result["sites"]) == 0



class TestRemoveSites:
    """Tests for remove_sites function."""

    def test_remove_single_site(self, nacl_json: str) -> None:
        """Remove first site."""
        result = ferrox.remove_sites(nacl_json, [0])
        assert len(result["sites"]) == 1

    def test_remove_multiple_sites(self, fcc_cu_json: str) -> None:
        """Remove multiple sites."""
        result = ferrox.remove_sites(fcc_cu_json, [0, 1])
        assert len(result["sites"]) == 2

    def test_remove_all_sites(self, nacl_json: str) -> None:
        """Remove all sites."""
        result = ferrox.remove_sites(nacl_json, [0, 1])
        assert len(result["sites"]) == 0



class TestDeform:
    """Tests for deform function."""

    def test_volumetric_expansion(self, nacl_json: str) -> None:
        """10% volumetric expansion."""
        original_volume = 5.64**3

        # Apply 10% volumetric strain (1.1^(1/3) along each axis)
        scale = 1.1 ** (1 / 3)
        gradient = [[scale, 0, 0], [0, scale, 0], [0, 0, scale]]
        result = ferrox.deform(nacl_json, gradient)

        # Calculate new volume
        new_mat = result["lattice"]["matrix"]
        new_volume = abs(
            new_mat[0][0] * (new_mat[1][1] * new_mat[2][2] - new_mat[1][2] * new_mat[2][1])
            - new_mat[0][1] * (new_mat[1][0] * new_mat[2][2] - new_mat[1][2] * new_mat[2][0])
            + new_mat[0][2] * (new_mat[1][0] * new_mat[2][1] - new_mat[1][1] * new_mat[2][0])
        )

        assert abs(new_volume / original_volume - 1.1) < 0.01

    def test_uniaxial_strain(self, nacl_json: str) -> None:
        """1% uniaxial strain along a."""
        gradient = [[1.01, 0, 0], [0, 1, 0], [0, 0, 1]]
        result = ferrox.deform(nacl_json, gradient)
        assert abs(result["lattice"]["matrix"][0][0] - 5.64 * 1.01) < 0.01

    def test_identity_deformation(self, nacl_json: str) -> None:
        """Identity deformation should preserve structure."""
        original = json.loads(nacl_json)
        result = ferrox.deform(nacl_json, [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
        for row_idx in range(3):
            for col_idx in range(3):
                orig_val = original["lattice"]["matrix"][row_idx][col_idx]
                new_val = result["lattice"]["matrix"][row_idx][col_idx]
                assert abs(new_val - orig_val) < 1e-10



class TestEwaldEnergy:
    """Tests for ewald_energy function."""

    def test_nacl_negative_energy(self, nacl_with_oxi_json: str) -> None:
        """NaCl should have negative Coulomb energy."""
        energy = ferrox.ewald_energy(nacl_with_oxi_json)
        assert energy < 0

    def test_nacl_reasonable_energy(self, nacl_with_oxi_json: str) -> None:
        """Energy should be in reasonable range."""
        energy = ferrox.ewald_energy(nacl_with_oxi_json)
        # Typical Ewald energy for ionic crystals is on order of -10 to -100 eV
        assert -100 < energy < 0

    def test_custom_parameters(self, nacl_with_oxi_json: str) -> None:
        """Custom accuracy and cutoff should work."""
        energy1 = ferrox.ewald_energy(nacl_with_oxi_json, accuracy=1e-4, real_cutoff=8.0)
        energy2 = ferrox.ewald_energy(nacl_with_oxi_json, accuracy=1e-5, real_cutoff=10.0)
        # Results should be similar
        assert abs(energy1 - energy2) < 0.5



class TestOrderDisordered:
    """Tests for order_disordered function."""

    def test_basic_ordering(self, disordered_json: str) -> None:
        """Disordered Fe0.5Co0.5 should produce 2 orderings."""
        results = ferrox.order_disordered(disordered_json)
        assert len(results) == 2

    def test_all_orderings_ordered(self, disordered_json: str) -> None:
        """All returned structures should be ordered."""
        results = ferrox.order_disordered(disordered_json)
        for struct in results:
            for site in struct["sites"]:
                # Each site should have single species with occupancy 1
                assert len(site["species"]) == 1
                assert site["species"][0]["occu"] == 1.0

    def test_max_structures(self, disordered_json: str) -> None:
        """max_structures parameter should limit results."""
        results = ferrox.order_disordered(disordered_json, max_structures=1)
        assert len(results) == 1

    def test_already_ordered(self, nacl_json: str) -> None:
        """Already ordered structure should return itself."""
        results = ferrox.order_disordered(nacl_json)
        assert len(results) == 1



class TestEnumerateDerivatives:
    """Tests for enumerate_derivatives function."""

    def test_basic_enumeration(self, single_fe_json: str) -> None:
        """Enumerate derivatives of simple Fe structure."""
        results = ferrox.enumerate_derivatives(single_fe_json, min_size=1, max_size=2)
        assert len(results) > 1

    def test_derivative_sizes(self, single_fe_json: str) -> None:
        """Derivatives should have correct size multipliers."""
        results = ferrox.enumerate_derivatives(single_fe_json, min_size=2, max_size=2)
        for struct in results:
            assert len(struct["sites"]) == 2  # 2x original atoms

    def test_identity_included(self, single_fe_json: str) -> None:
        """min_size=1 should include the original structure."""
        results = ferrox.enumerate_derivatives(single_fe_json, min_size=1, max_size=1)
        assert len(results) == 1
        assert len(results[0]["sites"]) == 1



class TestTransformationChains:
    """Tests for chaining multiple transformations."""

    def test_substitute_then_remove(self, nacl_json: str) -> None:
        """Substitute Na->K, then remove K."""
        step1 = ferrox.substitute_species(nacl_json, "Na", "K")
        step2 = ferrox.remove_species(json.dumps(step1), ["K"])
        assert len(step2["sites"]) == 1
        assert step2["sites"][0]["species"][0]["element"] == "Cl"

    def test_primitive_then_supercell(self, fcc_cu_json: str) -> None:
        """Get primitive, then make supercell."""
        primitive = ferrox.to_primitive(fcc_cu_json)
        # Make 2x2x2 supercell using make_supercell
        supercell = ferrox.make_supercell(json.dumps(primitive), [[2, 0, 0], [0, 2, 0], [0, 0, 2]])
        # Should have 8x more atoms than primitive
        assert len(supercell["sites"]) == 8 * len(primitive["sites"])



class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_empty_remove_species_list(self, nacl_json: str) -> None:
        """Removing no species should return unchanged structure."""
        original = json.loads(nacl_json)
        result = ferrox.remove_species(nacl_json, [])
        assert len(result["sites"]) == len(original["sites"])

    def test_single_atom_structure(self, single_fe_json: str) -> None:
        """Single atom structures should work."""
        result = ferrox.to_primitive(single_fe_json)
        assert len(result["sites"]) == 1


class TestErrorHandling:
    """Tests for error conditions."""

    def test_ewald_requires_oxidation_states(self, nacl_json: str) -> None:
        """Ewald energy should fail without oxidation states."""
        with pytest.raises(ValueError, match="oxidation state"):
            ferrox.ewald_energy(nacl_json)

    def test_invalid_species_string(self, nacl_json: str) -> None:
        """Invalid species string should raise ValueError."""
        with pytest.raises(ValueError, match="Invalid species"):
            ferrox.substitute_species(nacl_json, "InvalidElement123", "Fe")

    def test_remove_sites_out_of_bounds(self, nacl_json: str) -> None:
        """Out-of-bounds site index should raise error."""
        with pytest.raises((ValueError, IndexError)):
            ferrox.remove_sites(nacl_json, [999])

    def test_ewald_invalid_accuracy(self, nacl_with_oxi_json: str) -> None:
        """Invalid accuracy should raise ValueError."""
        with pytest.raises(ValueError, match="accuracy must be"):
            ferrox.ewald_energy(nacl_with_oxi_json, accuracy=0.0)
        with pytest.raises(ValueError, match="accuracy must be"):
            ferrox.ewald_energy(nacl_with_oxi_json, accuracy=-1e-5)

    def test_ewald_invalid_real_cutoff(self, nacl_with_oxi_json: str) -> None:
        """Non-positive real_cutoff should raise ValueError."""
        with pytest.raises(ValueError, match="real_cutoff must be positive"):
            ferrox.ewald_energy(nacl_with_oxi_json, real_cutoff=0.0)
        with pytest.raises(ValueError, match="real_cutoff must be positive"):
            ferrox.ewald_energy(nacl_with_oxi_json, real_cutoff=-5.0)

    def test_ewald_non_neutral_system(self) -> None:
        """Non-neutral systems should raise ValueError."""
        # Structure with only Na+ (no compensating negative charge)
        non_neutral = json.dumps({
            "@module": "pymatgen.core.structure",
            "@class": "Structure",
            "lattice": {"matrix": [[5.0, 0, 0], [0, 5.0, 0], [0, 0, 5.0]]},
            "sites": [
                {
                    "species": [{"element": "Na", "oxidation_state": 1, "occu": 1}],
                    "abc": [0, 0, 0],
                },
            ],
        })
        with pytest.raises(ValueError, match="charge-neutral"):
            ferrox.ewald_energy(non_neutral)
