"""Tests for oxidation state guessing functionality comparing ferrox with pymatgen."""

import json

import ferrox
import numpy as np
import pytest
from pymatgen.core import Composition, Structure


# Shared fixtures
@pytest.fixture
def nacl_structure() -> dict:
    """Create NaCl structure (Fm-3m, rocksalt)."""
    struct = Structure.from_spacegroup(
        225,
        lattice=[[5.64, 0, 0], [0, 5.64, 0], [0, 0, 5.64]],
        species=["Na", "Cl"],
        coords=[[0, 0, 0], [0.5, 0.5, 0.5]],
    )
    return json.loads(struct.to_json())


class TestOxiStateGuesses:
    """Test composition-based oxidation state guessing."""

    @pytest.mark.parametrize(
        ("formula", "expected"),
        [
            ("NaCl", {"Na": 1.0, "Cl": -1.0}),
            ("Fe2O3", {"Fe": 3.0, "O": -2.0}),
            ("MgO", {"Mg": 2.0, "O": -2.0}),
        ],
    )
    def test_common_compounds(self, formula: str, expected: dict) -> None:
        """Common compounds should give expected oxidation states."""
        guesses = ferrox.oxi_state_guesses(formula)
        assert len(guesses) > 0
        best = guesses[0]["oxidation_states"]
        for elem, oxi in expected.items():
            assert np.isclose(best[elem], oxi, atol=0.01), f"{formula}: {elem}"

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

        # Pymatgen returns list of dicts with Element keys, convert to string keys
        pymatgen_best = {str(k): v for k, v in pymatgen_guesses[0].items()}

        for elem in ["Li", "Fe", "P", "O"]:
            pymatgen_val = pymatgen_best.get(elem, 0)
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
            np.isclose(a, b, atol=0.001)
            for a, b in zip(bv_sums_1, bv_sums_2, strict=True)
        ), "Scale factor should affect BV sums"


class TestGuessOxidationStatesBvs:
    """Test BVS-based oxidation state guessing."""

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

    @pytest.mark.parametrize("formula", ["NaCl", "Fe2O3", "TiO2", "Al2O3", "CaO"])
    def test_composition_guesses_match_pymatgen(self, formula: str) -> None:
        """Verify composition guesses match pymatgen for common compounds."""
        ferrox_guesses = ferrox.oxi_state_guesses(formula)
        pymatgen_guesses = Composition(formula).oxi_state_guesses()

        assert len(ferrox_guesses) > 0, f"No ferrox guesses for {formula}"
        assert len(pymatgen_guesses) > 0, f"No pymatgen guesses for {formula}"

        ferrox_best = ferrox_guesses[0]["oxidation_states"]
        pymatgen_best = {str(k): v for k, v in pymatgen_guesses[0].items()}

        for elem_str, ferrox_val in ferrox_best.items():
            pymatgen_val = pymatgen_best.get(elem_str, 0)
            assert np.isclose(ferrox_val, pymatgen_val, atol=0.5), (
                f"{formula}: {elem_str} ferrox={ferrox_val}, pymatgen={pymatgen_val}"
            )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
