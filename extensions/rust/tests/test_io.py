"""Tests for TorchSim state conversion functions."""

from __future__ import annotations

import json

import numpy as np
import pytest
from conftest import make_cubic_structure, make_site, make_structure

try:
    from ferrox import io as ferrox_io
except ImportError:
    pytest.skip("ferrox not installed", allow_module_level=True)


# === Fixtures ===


@pytest.fixture
def si_structure() -> dict:
    """Si diamond structure (8 atoms)."""
    return make_cubic_structure(
        5.43,
        [
            make_site("Si", [i / 4, j / 4, k / 4])
            for i, j, k in [
                (0, 0, 0),
                (1, 1, 1),
                (2, 2, 0),
                (3, 3, 1),
                (2, 0, 2),
                (3, 1, 3),
                (0, 2, 2),
                (1, 3, 3),
            ]
        ],
    )


@pytest.fixture
def ar_structure() -> dict:
    """Ar FCC structure (4 atoms)."""
    return make_cubic_structure(
        5.26,
        [
            make_site("Ar", pos)
            for pos in [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]
        ],
    )


@pytest.fixture
def fe_structure() -> dict:
    """BCC Fe structure (2 atoms)."""
    return make_cubic_structure(
        2.87,
        [make_site("Fe", [0, 0, 0]), make_site("Fe", [0.5, 0.5, 0.5])],
    )


# === Single Structure Conversion Tests ===


class TestSingleStructureToState:
    """Tests for single structure to TorchSim state conversion."""

    def test_basic_conversion(self, si_structure: dict) -> None:
        """Convert Si structure to state and verify all fields."""
        state = ferrox_io.to_torch_sim_state(si_structure)

        # Array fields have 8 atoms
        for key in ("positions", "masses", "atomic_numbers", "system_idx"):
            assert len(state[key]) == 8

        # System fields have 1 system
        for key in ("cell", "charge", "spin"):
            assert len(state[key]) == 1

        # Verify values
        assert all(z == 14 for z in state["atomic_numbers"])  # Si atomic number
        assert all(m == pytest.approx(28.0855, rel=1e-3) for m in state["masses"])
        assert all(idx == 0 for idx in state["system_idx"])
        assert state["pbc"] == [True, True, True]

    def test_cell_values_cubic(self, si_structure: dict) -> None:
        """Verify cell matrix values for cubic lattice."""
        state = ferrox_io.to_torch_sim_state(si_structure)
        cell = state["cell"][0]

        # Cell is 3x3
        assert len(cell) == 3
        assert all(len(row) == 3 for row in cell)

        # TorchSim uses column-major, diagonal should be lattice param
        for idx in range(3):
            assert cell[idx][idx] == pytest.approx(5.43, rel=1e-3)


class TestMultipleStructuresToState:
    """Tests for multiple structures to batched TorchSim state."""

    def test_batched_conversion(self, si_structure: dict, fe_structure: dict) -> None:
        """Convert multiple structures to batched state."""
        state = ferrox_io.structures_to_torch_sim_state([si_structure, fe_structure])

        # Si (8 atoms) + Fe (2 atoms) = 10 total atoms, 2 systems
        assert len(state["positions"]) == 10
        assert len(state["cell"]) == 2

        # Verify system_idx and atomic_numbers
        assert state["system_idx"][:8] == [0] * 8
        assert state["system_idx"][8:] == [1] * 2
        assert all(z == 14 for z in state["atomic_numbers"][:8])  # Si
        assert all(z == 26 for z in state["atomic_numbers"][8:])  # Fe

    def test_empty_list(self) -> None:
        """Empty structure list returns empty state."""
        state = ferrox_io.structures_to_torch_sim_state([])
        for key in ("positions", "masses", "cell", "atomic_numbers", "system_idx"):
            assert state[key] == []

    def test_inconsistent_pbc_error(self) -> None:
        """Structures with different PBC settings raise error."""
        pbc_true = make_cubic_structure(4.0, [make_site("Fe", [0, 0, 0])])
        pbc_false = make_cubic_structure(4.0, [make_site("Cu", [0, 0, 0])])
        pbc_false["lattice"]["pbc"] = [False, False, False]

        with pytest.raises(ValueError, match="periodic boundary conditions"):
            ferrox_io.structures_to_torch_sim_state(
                [json.dumps(pbc_true), json.dumps(pbc_false)]
            )


# === State to Structure Conversion Tests ===


class TestStateToStructures:
    """Tests for TorchSim state to structures conversion."""

    def test_single_system_round_trip(self, si_structure: dict) -> None:
        """Round-trip: structure -> state -> structure."""
        state = ferrox_io.to_torch_sim_state(si_structure)
        structures = ferrox_io.from_torch_sim_state(state)

        assert len(structures) == 1
        assert structures[0]["@class"] == "Structure"
        assert len(structures[0]["sites"]) == 8

    def test_multiple_systems_round_trip(
        self, si_structure: dict, ar_structure: dict
    ) -> None:
        """Round-trip for multiple structures."""
        state = ferrox_io.structures_to_torch_sim_state([si_structure, ar_structure])
        structures = ferrox_io.from_torch_sim_state(state)

        assert len(structures) == 2
        assert len(structures[0]["sites"]) == 8  # Si
        assert len(structures[1]["sites"]) == 4  # Ar

    def test_positions_preserved(self, si_structure: dict) -> None:
        """Verify positions are preserved in round-trip."""
        original_matrix = np.array(si_structure["lattice"]["matrix"])
        original_frac = np.array([site["abc"] for site in si_structure["sites"]])
        original_cart = original_frac @ original_matrix

        state = ferrox_io.to_torch_sim_state(si_structure)
        result = ferrox_io.from_torch_sim_state(state)[0]

        result_matrix = np.array(result["lattice"]["matrix"])
        result_frac = np.array([site["abc"] for site in result["sites"]])
        result_cart = result_frac @ result_matrix

        np.testing.assert_allclose(original_cart, result_cart, rtol=1e-10)

    def test_species_preserved(self, fe_structure: dict) -> None:
        """Verify species are preserved in round-trip."""
        state = ferrox_io.to_torch_sim_state(fe_structure)
        result = ferrox_io.from_torch_sim_state(state)[0]

        assert all(site["species"][0]["element"] == "Fe" for site in result["sites"])


class TestParseTorchSimStateJson:
    """Tests for parsing TorchSim state from JSON string."""

    def test_parse_json_string(self, si_structure: dict) -> None:
        """Parse state from JSON string."""
        state_dict = ferrox_io.to_torch_sim_state(si_structure)
        structures = ferrox_io.parse_torch_sim_state_json(json.dumps(state_dict))

        assert len(structures) == 1
        assert len(structures[0]["sites"]) == 8

    @pytest.mark.parametrize(
        "invalid_json",
        [
            "not valid json",
            '{"positions": [[0, 0, 0]]}',  # missing required fields
        ],
    )
    def test_invalid_json(self, invalid_json: str) -> None:
        """Invalid JSON raises error."""
        with pytest.raises(ValueError, match="Invalid TorchSim state JSON"):
            ferrox_io.parse_torch_sim_state_json(invalid_json)


# === Cell Matrix Convention Tests ===


class TestCellMatrixConvention:
    """Tests for cell matrix convention (row-major vs column-major)."""

    def test_triclinic_cell_round_trip(self) -> None:
        """Test triclinic cell preserves correct orientation."""
        triclinic = make_structure(
            {"matrix": [[4.0, 0.5, 0.2], [0.3, 5.0, 0.4], [0.1, 0.2, 6.0]]},
            [make_site("Fe", [0.25, 0.25, 0.25])],
        )

        state = ferrox_io.to_torch_sim_state(triclinic)
        result = ferrox_io.from_torch_sim_state(state)[0]

        np.testing.assert_allclose(
            triclinic["lattice"]["matrix"],
            result["lattice"]["matrix"],
            rtol=1e-10,
        )

    def test_cell_diagonal_values(self) -> None:
        """Verify diagonal cell values are correct after conversion."""
        ortho = make_structure(
            {"matrix": [[3.0, 0, 0], [0, 4.0, 0], [0, 0, 5.0]]},
            [make_site("H", [0, 0, 0])],
        )

        cell = ferrox_io.to_torch_sim_state(ortho)["cell"][0]
        # TorchSim cell is column-major
        assert cell[0][0] == pytest.approx(3.0)
        assert cell[1][1] == pytest.approx(4.0)
        assert cell[2][2] == pytest.approx(5.0)


# === Edge Cases ===


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_single_atom_structure(self) -> None:
        """Single atom structure works correctly."""
        single = make_cubic_structure(4.0, [make_site("Fe", [0, 0, 0])])
        state = ferrox_io.to_torch_sim_state(single)

        assert len(state["positions"]) == 1
        assert state["atomic_numbers"] == [26]
        assert state["system_idx"] == [0]

    def test_large_structure(self) -> None:
        """Large structure (3x3x3 BCC supercell = 54 atoms) converts correctly."""
        sites = [
            make_site(
                "Fe", [(idx_a + offset) / 3, (idx_b + offset) / 3, (idx_c + offset) / 3]
            )
            for idx_a in range(3)
            for idx_b in range(3)
            for idx_c in range(3)
            for offset in (0, 0.5)
        ]
        state = ferrox_io.to_torch_sim_state(make_cubic_structure(2.87 * 3, sites))

        assert len(state["positions"]) == 54
        assert len(state["atomic_numbers"]) == 54

    def test_different_elements_batched(self) -> None:
        """Batched state with different elements per system."""
        structures = [
            make_cubic_structure(a, [make_site(el, [0, 0, 0])])
            for el, a in [("Si", 5.43), ("Fe", 2.87), ("Cu", 3.6)]
        ]
        state = ferrox_io.structures_to_torch_sim_state(structures)

        assert state["atomic_numbers"] == [14, 26, 29]
        assert state["system_idx"] == [0, 1, 2]
        assert len(state["cell"]) == 3

    def test_charge_preserved(self) -> None:
        """Verify structure charge is preserved."""
        charged = make_cubic_structure(4.0, [make_site("Fe", [0, 0, 0])])
        charged["charge"] = 2.0

        state = ferrox_io.to_torch_sim_state(json.dumps(charged))
        assert state["charge"] == [2.0]

    def test_spin_preserved(self) -> None:
        """Spin is preserved via structure properties (like ASE atoms.info['spin'])."""
        structure = make_cubic_structure(4.0, [make_site("Fe", [0, 0, 0])])
        structure["properties"] = {"spin": 2.0}

        state = ferrox_io.to_torch_sim_state(json.dumps(structure))
        assert state["spin"] == [2.0]

        # Round-trip preserves spin
        result = ferrox_io.from_torch_sim_state(state)[0]
        assert result["properties"]["spin"] == 2.0

    def test_spin_defaults_to_zero(self) -> None:
        """Spin defaults to 0.0 when not specified."""
        structure = make_cubic_structure(4.0, [make_site("Fe", [0, 0, 0])])

        state = ferrox_io.to_torch_sim_state(structure)
        assert state["spin"] == [0.0]

    def test_charge_and_spin_round_trip(self) -> None:
        """Charge and spin are preserved in round-trip conversion."""
        structure = make_cubic_structure(4.0, [make_site("Fe", [0, 0, 0])])
        structure["charge"] = 1.0
        structure["properties"] = {"spin": 1.0}

        state = ferrox_io.to_torch_sim_state(json.dumps(structure))
        assert state["charge"] == [1.0]
        assert state["spin"] == [1.0]

        result = ferrox_io.from_torch_sim_state(state)[0]
        assert result.get("charge", 0) == pytest.approx(1.0)
        assert result["properties"]["spin"] == 1.0

    def test_multiple_systems_charge_spin(self) -> None:
        """Batched state preserves per-system charge and spin."""
        struct1 = make_cubic_structure(4.0, [make_site("Fe", [0, 0, 0])])
        struct1["charge"] = 1.0
        struct1["properties"] = {"spin": 1.0}

        struct2 = make_cubic_structure(4.0, [make_site("Cu", [0, 0, 0])])
        struct2["charge"] = -1.0
        struct2["properties"] = {"spin": 0.0}

        struct3 = make_cubic_structure(4.0, [make_site("Ni", [0, 0, 0])])
        struct3["charge"] = 0.0
        struct3["properties"] = {"spin": 2.0}

        state = ferrox_io.structures_to_torch_sim_state(
            [json.dumps(struct1), json.dumps(struct2), json.dumps(struct3)]
        )

        assert state["charge"] == [1.0, -1.0, 0.0]
        assert state["spin"] == [1.0, 0.0, 2.0]

    def test_site_properties_not_preserved(self) -> None:
        """Site-level properties (magmom, selective_dynamics) are not preserved."""
        site_with_props = {
            "species": [{"element": "Fe", "occu": 1.0}],
            "abc": [0, 0, 0],
            "properties": {"magmom": 5.0, "selective_dynamics": [True, True, False]},
        }
        structure = make_structure(
            {"matrix": [[4.0, 0, 0], [0, 4.0, 0], [0, 0, 4.0]]},
            [site_with_props],
        )

        state = ferrox_io.to_torch_sim_state(structure)
        result = ferrox_io.from_torch_sim_state(state)[0]

        # TorchSim format doesn't preserve site-level properties
        result_props = result["sites"][0].get("properties", {})
        assert "magmom" not in result_props
        assert "selective_dynamics" not in result_props

    def test_structure_properties_partially_preserved(self) -> None:
        """Only spin is preserved from structure properties, not energy/forces."""
        structure = make_cubic_structure(4.0, [make_site("Fe", [0, 0, 0])])
        structure["properties"] = {
            "energy": -5.123,
            "spin": 1.0,
            "forces": [[0.1, 0.2, 0.3]],
        }

        state = ferrox_io.to_torch_sim_state(json.dumps(structure))
        result = ferrox_io.from_torch_sim_state(state)[0]

        result_props = result.get("properties", {})
        # Spin IS preserved
        assert result_props.get("spin") == 1.0
        # Other properties are NOT preserved
        assert "energy" not in result_props
        assert "forces" not in result_props
