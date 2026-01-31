"""Tests for oxidation state guessing functionality comparing ferrox with pymatgen."""

import json

import numpy as np
import pytest
from pymatgen.core import Composition, Element, Structure

import ferrox


class TestOxiStateGuesses:
    """Test composition-based oxidation state guessing."""

    def test_nacl_guesses_correct_oxi_states(self) -> None:
        """NaCl should guess Na+ and Cl-."""
        guesses = ferrox.oxi_state_guesses("NaCl")
        assert len(guesses) > 0
        best = guesses[0]
        assert np.isclose(best["oxidation_states"]["Na"], 1.0, atol=0.01)
        assert np.isclose(best["oxidation_states"]["Cl"], -1.0, atol=0.01)

    def test_fe2o3_guesses_fe3_plus(self) -> None:
        """Fe2O3 should guess Fe3+ and O2-."""
        guesses = ferrox.oxi_state_guesses("Fe2O3")
        assert len(guesses) > 0
        best = guesses[0]
        assert np.isclose(best["oxidation_states"]["Fe"], 3.0, atol=0.01)
        assert np.isclose(best["oxidation_states"]["O"], -2.0, atol=0.01)

    def test_mgo_guesses_correct_oxi_states(self) -> None:
        """MgO should guess Mg2+ and O2-."""
        guesses = ferrox.oxi_state_guesses("MgO")
        assert len(guesses) > 0
        best = guesses[0]
        assert np.isclose(best["oxidation_states"]["Mg"], 2.0, atol=0.01)
        assert np.isclose(best["oxidation_states"]["O"], -2.0, atol=0.01)

    def test_lifepo4_matches_pymatgen(self) -> None:
        """Compare LiFePO4 guesses with pymatgen."""
        ferrox_guesses = ferrox.oxi_state_guesses("LiFePO4")

        # Get pymatgen result
        comp = Composition("LiFePO4")
        pymatgen_guesses = comp.oxi_state_guesses()

        # Both should find solutions
        assert len(ferrox_guesses) > 0
        assert len(pymatgen_guesses) > 0

        # Best ferrox solution
        ferrox_best = ferrox_guesses[0]["oxidation_states"]

        # Pymatgen returns list of dicts, first is most likely
        pymatgen_best = pymatgen_guesses[0]

        # Elements should match (convert pymatgen to simpler format)
        for elem in ["Li", "P", "O"]:
            pymatgen_val = pymatgen_best.get(Element(elem), 0)
            ferrox_val = ferrox_best.get(elem, 0)
            assert np.isclose(ferrox_val, pymatgen_val, atol=0.1), (
                f"{elem}: ferrox={ferrox_val}, pymatgen={pymatgen_val}"
            )

    def test_multiple_solutions_returned(self) -> None:
        """Some compositions have multiple valid oxidation state assignments."""
        guesses = ferrox.oxi_state_guesses("Fe3O4")  # magnetite: Fe2+ and Fe3+
        # Should find at least one solution
        assert len(guesses) > 0
        # All solutions should be charge-balanced
        for guess in guesses:
            total_charge = 0.0
            oxi_states = guess["oxidation_states"]
            # Fe3O4: 3 Fe and 4 O
            total_charge += 3 * oxi_states.get("Fe", 0)
            total_charge += 4 * oxi_states.get("O", 0)
            assert np.isclose(total_charge, 0.0, atol=0.1), (
                f"Non-zero charge: {total_charge}"
            )


class TestBvSums:
    """Test bond valence sum calculations."""

    @pytest.fixture
    def nacl_structure(self) -> dict:
        """Create NaCl structure."""
        struct = Structure.from_spacegroup(
            225,  # Fm-3m
            lattice=[[5.64, 0, 0], [0, 5.64, 0], [0, 0, 5.64]],
            species=["Na", "Cl"],
            coords=[[0, 0, 0], [0.5, 0.5, 0.5]],
        )
        return json.loads(struct.to_json())

    @pytest.fixture
    def fe2o3_structure(self) -> dict:
        """Create Fe2O3 corundum structure (simplified)."""
        struct = Structure.from_spacegroup(
            167,  # R-3c (corundum)
            lattice=[[5.038, 0, 0], [0, 5.038, 0], [0, 0, 13.772]],
            species=["Fe", "O"],
            coords=[[0, 0, 0.3553], [0.3064, 0, 0.25]],
        )
        return json.loads(struct.to_json())

    def test_bv_sums_positive_for_cation(self, nacl_structure: dict) -> None:
        """BV sum should be positive for cations like Na+."""
        bv_sums = ferrox.compute_bv_sums(nacl_structure)
        # NaCl structure from_spacegroup generates full conventional cell
        struct = Structure.from_dict(nacl_structure)
        assert len(bv_sums) == len(struct)
        # One should be positive (Na), one negative (Cl)
        has_positive = any(bvs > 0 for bvs in bv_sums)
        has_negative = any(bvs < 0 for bvs in bv_sums)
        assert has_positive, f"Expected positive BVS for cation: {bv_sums}"
        assert has_negative, f"Expected negative BVS for anion: {bv_sums}"

    def test_bv_sums_reasonable_magnitude(self, nacl_structure: dict) -> None:
        """BV sums should be close to expected oxidation states."""
        bv_sums = ferrox.compute_bv_sums(nacl_structure)
        # Na+ should have BVS ~1, Cl- should have BVS ~-1
        for bvs in bv_sums:
            assert abs(bvs) < 2.0, f"BVS magnitude too large: {bvs}"
            assert abs(bvs) > 0.5, f"BVS magnitude too small: {bvs}"

    def test_bv_sums_scale_factor(self, nacl_structure: dict) -> None:
        """Scale factor should affect BV sums."""
        bv_sums_1 = ferrox.compute_bv_sums(nacl_structure, scale_factor=1.0)
        bv_sums_2 = ferrox.compute_bv_sums(nacl_structure, scale_factor=1.015)
        # Different scale factors should give different results
        assert not all(
            np.isclose(a, b, atol=0.001) for a, b in zip(bv_sums_1, bv_sums_2)
        ), "Scale factor should affect BV sums"


class TestGuessOxidationStatesBvs:
    """Test BVS-based oxidation state guessing."""

    @pytest.fixture
    def nacl_structure(self) -> dict:
        """Create NaCl structure."""
        struct = Structure.from_spacegroup(
            225,
            lattice=[[5.64, 0, 0], [0, 5.64, 0], [0, 0, 5.64]],
            species=["Na", "Cl"],
            coords=[[0, 0, 0], [0.5, 0.5, 0.5]],
        )
        return json.loads(struct.to_json())

    def test_guess_oxi_states_returns_list(self, nacl_structure: dict) -> None:
        """Should return oxidation states for each site."""
        oxi_states = ferrox.guess_oxidation_states_bvs(nacl_structure)
        struct = Structure.from_dict(nacl_structure)
        assert len(oxi_states) == len(struct)

    def test_guess_oxi_states_charge_balanced(self, nacl_structure: dict) -> None:
        """Result should be charge balanced."""
        oxi_states = ferrox.guess_oxidation_states_bvs(nacl_structure)
        total = sum(oxi_states)
        assert total == 0, f"Not charge balanced: sum={total}, states={oxi_states}"


class TestAddOxidationStates:
    """Test adding/removing oxidation states."""

    @pytest.fixture
    def nacl_structure(self) -> dict:
        """Create NaCl structure."""
        struct = Structure.from_spacegroup(
            225,
            lattice=[[5.64, 0, 0], [0, 5.64, 0], [0, 0, 5.64]],
            species=["Na", "Cl"],
            coords=[[0, 0, 0], [0.5, 0.5, 0.5]],
        )
        return json.loads(struct.to_json())

    def test_add_oxidation_state_by_element(self, nacl_structure: dict) -> None:
        """Test adding oxidation states by element."""
        result = ferrox.add_oxidation_state_by_element(
            nacl_structure, {"Na": 1, "Cl": -1}
        )
        struct = Structure.from_dict(result)
        # Check species have oxidation states
        for site in struct:
            sp = site.specie
            assert sp.oxi_state is not None
            if sp.symbol == "Na":
                assert sp.oxi_state == 1
            elif sp.symbol == "Cl":
                assert sp.oxi_state == -1

    def test_add_oxidation_state_by_site(self, nacl_structure: dict) -> None:
        """Test adding oxidation states by site."""
        struct = Structure.from_dict(nacl_structure)
        oxi_states = [1 if str(site.specie) == "Na" else -1 for site in struct]
        result = ferrox.add_oxidation_state_by_site(nacl_structure, oxi_states)
        struct_with_oxi = Structure.from_dict(result)

        for site in struct_with_oxi:
            assert site.specie.oxi_state is not None

    def test_remove_oxidation_states(self, nacl_structure: dict) -> None:
        """Test removing oxidation states."""
        # First add them
        with_oxi = ferrox.add_oxidation_state_by_element(
            nacl_structure, {"Na": 1, "Cl": -1}
        )
        # Then remove them
        without_oxi = ferrox.remove_oxidation_states(with_oxi)
        struct = Structure.from_dict(without_oxi)

        for site in struct:
            sp = site.specie
            # After removal, species should not have oxidation states
            # (pymatgen may return Element instead of Species with oxi_state)
            assert getattr(sp, "oxi_state", None) is None

    def test_add_charges_from_guesses(self, nacl_structure: dict) -> None:
        """Test adding oxidation states based on composition guessing."""
        result = ferrox.add_charges_from_oxi_state_guesses(nacl_structure)
        struct = Structure.from_dict(result)

        # Should have oxidation states assigned
        for site in struct:
            assert site.specie.oxi_state is not None


class TestComparisonWithPymatgen:
    """Compare ferrox results with pymatgen for verification."""

    @pytest.fixture
    def fe2o3_structure(self) -> Structure:
        """Create Fe2O3 structure."""
        return Structure.from_spacegroup(
            167,  # R-3c (corundum)
            lattice=[[5.038, 0, 0], [0, 5.038, 0], [0, 0, 13.772]],
            species=["Fe", "O"],
            coords=[[0, 0, 0.3553], [0.3064, 0, 0.25]],
        )

    def test_composition_guesses_match_pymatgen(self) -> None:
        """Verify composition guesses match pymatgen for common compounds."""
        test_cases = [
            "NaCl",
            "Fe2O3",
            "TiO2",
            "Al2O3",
            "CaO",
        ]

        for formula in test_cases:
            ferrox_guesses = ferrox.oxi_state_guesses(formula)
            comp = Composition(formula)
            pymatgen_guesses = comp.oxi_state_guesses()

            assert len(ferrox_guesses) > 0, f"No ferrox guesses for {formula}"
            assert len(pymatgen_guesses) > 0, f"No pymatgen guesses for {formula}"

            ferrox_best = ferrox_guesses[0]["oxidation_states"]
            pymatgen_best = pymatgen_guesses[0]

            # Convert pymatgen format
            for elem_str in ferrox_best:
                elem = Element(elem_str)
                pymatgen_val = pymatgen_best.get(elem, 0)
                ferrox_val = ferrox_best[elem_str]
                assert np.isclose(ferrox_val, pymatgen_val, atol=0.5), (
                    f"{formula}: {elem_str} ferrox={ferrox_val}, pymatgen={pymatgen_val}"
                )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
