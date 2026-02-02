//! Python bindings for ferrox.
//!
//! This module provides PyO3 bindings to expose the Rust StructureMatcher
//! to Python code.

// PyO3 proc macros generate code that triggers false positive clippy warnings
#![allow(clippy::useless_conversion)]

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList, PyString};
use std::collections::HashMap;
use std::path::Path;

use crate::composition::Composition;
use crate::coordination;
use crate::element::Element;
use crate::integrators;
use crate::io::{
    parse_extxyz_trajectory, parse_structure, parse_structure_json, structure_to_extxyz,
    structure_to_poscar, structure_to_pymatgen_json, write_structure,
};
use crate::potentials;
use crate::rdf;
use crate::species::Species;
use crate::structure::{
    Structure, SymmOp, SymmetryOperation, moyo_ops_to_arrays, spacegroup_to_crystal_system,
};
use crate::structure_matcher::{ComparatorType, StructureMatcher};
use nalgebra::{Matrix3, Vector3};

/// A structure input that can be either a JSON string, dict, or pymatgen object.
///
/// Accepts:
/// - `ferrox.func(struct)` (pymatgen Structure object directly)
/// - `ferrox.func(struct.as_dict())` (dict from as_dict())
/// - `ferrox.func(json.dumps(struct.as_dict()))` (JSON string)
///
/// Note: Functions using `parse_struct` internally expect periodic Structure data.
/// For molecules, use the dedicated molecule functions (e.g., `parse_molecule_json`).
pub struct StructureJson(String);

impl<'a, 'py> FromPyObject<'a, 'py> for StructureJson {
    type Error = PyErr;

    fn extract(ob: pyo3::Borrowed<'a, 'py, PyAny>) -> PyResult<Self> {
        let py = ob.py();
        let json_module = py.import("json")?;

        // Case 1: JSON string
        if let Ok(s) = ob.cast::<PyString>() {
            return Ok(StructureJson(s.to_string()));
        }

        // Case 2: Dict (e.g. from struct.as_dict())
        if let Ok(dict) = ob.cast::<PyDict>() {
            let json_str: String = json_module.call_method1("dumps", (dict,))?.extract()?;
            return Ok(StructureJson(json_str));
        }

        // Case 3: Object with as_dict() method (e.g. pymatgen Structure/Molecule)
        if ob.hasattr("as_dict")? {
            let dict = ob.call_method0("as_dict")?;
            let json_str: String = json_module.call_method1("dumps", (dict,))?.extract()?;
            return Ok(StructureJson(json_str));
        }

        Err(PyValueError::new_err(
            "Expected a JSON string, dict, or object with as_dict() method (e.g. pymatgen Structure/Molecule)",
        ))
    }
}

/// Parse a composition formula string, returning a PyResult.
fn parse_comp(formula: &str) -> PyResult<Composition> {
    Composition::from_formula(formula)
        .map_err(|e| PyValueError::new_err(format!("Error parsing formula: {e}")))
}

/// Parse a structure from StructureJson (string or dict), returning a PyResult.
fn parse_struct(input: &StructureJson) -> PyResult<Structure> {
    parse_structure_json(&input.0)
        .map_err(|e| PyValueError::new_err(format!("Error parsing structure: {e}")))
}

/// Convert a JSON string to a Python dict.
fn json_to_pydict(py: Python<'_>, json: &str) -> PyResult<Py<PyDict>> {
    let result = py.import("json")?.call_method1("loads", (json,))?;
    result
        .cast::<PyDict>()
        .map(|d| d.clone().unbind())
        .map_err(|e| PyValueError::new_err(format!("Expected dict from JSON: {e}")))
}

/// Parse a pair of structure inputs, returning a PyResult.
fn parse_structure_pair(
    struct1: &StructureJson,
    struct2: &StructureJson,
) -> PyResult<(Structure, Structure)> {
    Ok((parse_struct(struct1)?, parse_struct(struct2)?))
}

/// Convert Vec<String> to Vec<&str> for batch operations.
fn to_str_refs(strings: &[String]) -> Vec<&str> {
    strings.iter().map(|s| s.as_str()).collect()
}

/// Check if site indices are within bounds, returning PyIndexError if not.
fn check_site_bounds(num_sites: usize, indices: &[usize]) -> PyResult<()> {
    for &idx in indices {
        if idx >= num_sites {
            return Err(pyo3::exceptions::PyIndexError::new_err(format!(
                "Site index {idx} out of bounds (num_sites={num_sites})"
            )));
        }
    }
    Ok(())
}

/// Python wrapper for StructureMatcher.
///
/// Provides structure matching functionality from Python, accepting
/// structures as JSON strings (from pymatgen's Structure.as_dict()).
#[pyclass(name = "StructureMatcher")]
pub struct PyStructureMatcher {
    inner: StructureMatcher,
}

#[pymethods]
impl PyStructureMatcher {
    /// Create a new StructureMatcher.
    ///
    /// Args:
    ///     latt_len_tol: Fractional length tolerance for lattice vectors (default: 0.2).
    ///     site_pos_tol: Site position tolerance, normalized (default: 0.3).
    ///     angle_tol: Angle tolerance in degrees (default: 5.0)
    ///     primitive_cell: Whether to reduce to primitive cell (default: True)
    ///     scale: Whether to scale volumes to match (default: True)
    ///     attempt_supercell: Whether to try supercell matching (default: False)
    ///     comparator: "species" or "element" (default: "species")
    #[new]
    #[pyo3(signature = (
        latt_len_tol = 0.2,
        site_pos_tol = 0.3,
        angle_tol = 5.0,
        primitive_cell = true,
        scale = true,
        attempt_supercell = false,
        comparator = "species"
    ))]
    fn new(
        latt_len_tol: f64,
        site_pos_tol: f64,
        angle_tol: f64,
        primitive_cell: bool,
        scale: bool,
        attempt_supercell: bool,
        comparator: &str,
    ) -> PyResult<Self> {
        let comparator_type = match comparator {
            "species" => ComparatorType::Species,
            "element" => ComparatorType::Element,
            _ => {
                return Err(PyValueError::new_err(format!(
                    "Invalid comparator: {comparator}. Use 'species' or 'element'"
                )));
            }
        };

        let inner = StructureMatcher::new()
            .with_latt_len_tol(latt_len_tol)
            .with_site_pos_tol(site_pos_tol)
            .with_angle_tol(angle_tol)
            .with_primitive_cell(primitive_cell)
            .with_scale(scale)
            .with_attempt_supercell(attempt_supercell)
            .with_comparator(comparator_type);

        Ok(Self { inner })
    }

    /// Check if two structures match.
    ///
    /// Args:
    ///     struct1: First structure as JSON string (from Structure.as_dict())
    ///     struct2: Second structure as JSON string
    ///     skip_structure_reduction: If True, skip Niggli and primitive cell reduction.
    ///         Only use this with structures from `reduce_structure()`. (default: False)
    ///
    /// Returns:
    ///     True if structures match within tolerances.
    ///
    /// Example:
    ///     >>> import json
    ///     >>> from ferrox import StructureMatcher
    ///     >>> matcher = StructureMatcher()
    ///     >>> s1 = Structure(...)
    ///     >>> s2 = Structure(...)
    ///     >>> # Normal usage
    ///     >>> matcher.fit(json.dumps(s1.as_dict()), json.dumps(s2.as_dict()))
    ///     >>> # With pre-reduced structures (for batch comparisons)
    ///     >>> r1 = matcher.reduce_structure(json.dumps(s1.as_dict()))
    ///     >>> r2 = matcher.reduce_structure(json.dumps(s2.as_dict()))
    ///     >>> matcher.fit(r1, r2, skip_structure_reduction=True)
    #[pyo3(signature = (struct1, struct2, skip_structure_reduction = false))]
    fn fit(
        &self,
        struct1: StructureJson,
        struct2: StructureJson,
        skip_structure_reduction: bool,
    ) -> PyResult<bool> {
        let (s1, s2) = parse_structure_pair(&struct1, &struct2)?;
        Ok(if skip_structure_reduction {
            self.inner.fit_preprocessed(&s1, &s2)
        } else {
            self.inner.fit(&s1, &s2)
        })
    }

    /// Get RMS distance between two structures.
    ///
    /// Args:
    ///     struct1: First structure as JSON string
    ///     struct2: Second structure as JSON string
    ///
    /// Returns:
    ///     Tuple of (rms, max_dist) if structures match, None otherwise.
    fn get_rms_dist(
        &self,
        struct1: StructureJson,
        struct2: StructureJson,
    ) -> PyResult<Option<(f64, f64)>> {
        let (s1, s2) = parse_structure_pair(&struct1, &struct2)?;
        Ok(self.inner.get_rms_dist(&s1, &s2))
    }

    /// Compute universal distance between any two structures.
    ///
    /// Unlike `get_rms_dist` which returns None for incompatible structures,
    /// this method always returns a finite distance value, making it suitable
    /// for consistent ranking of structures by similarity.
    ///
    /// Args:
    ///     struct1: First structure as JSON string or dict.
    ///     struct2: Second structure as JSON string or dict.
    ///
    /// Returns:
    ///     Finite distance in [0, 1e9]. Identical structures return 0.0.
    ///     Empty vs non-empty structures return 1e9.
    fn get_structure_distance(
        &self,
        struct1: StructureJson,
        struct2: StructureJson,
    ) -> PyResult<f64> {
        let (s1, s2) = parse_structure_pair(&struct1, &struct2)?;
        Ok(self.inner.get_structure_distance(&s1, &s2))
    }

    /// Check if two structures match under any species permutation.
    ///
    /// This is useful for comparing structures where the identity of species
    /// is not important, only the arrangement. For example, NaCl and MgO both
    /// have the rocksalt structure, so `fit_anonymous` would return true.
    ///
    /// Args:
    ///     struct1: First structure as JSON string (from Structure.as_dict())
    ///     struct2: Second structure as JSON string
    ///
    /// Returns:
    ///     True if structures match under some species permutation.
    ///
    /// Example:
    ///     >>> import json
    ///     >>> from ferrox import StructureMatcher
    ///     >>> matcher = StructureMatcher()
    ///     >>> nacl = Structure(Lattice.cubic(5.64), ["Na", "Cl"], [[0, 0, 0], [0.5, 0.5, 0.5]])
    ///     >>> mgo = Structure(Lattice.cubic(4.21), ["Mg", "O"], [[0, 0, 0], [0.5, 0.5, 0.5]])
    ///     >>> matcher.fit_anonymous(json.dumps(nacl.as_dict()), json.dumps(mgo.as_dict()))
    ///     True
    fn fit_anonymous(&self, struct1: StructureJson, struct2: StructureJson) -> PyResult<bool> {
        let (s1, s2) = parse_structure_pair(&struct1, &struct2)?;
        Ok(self.inner.fit_anonymous(&s1, &s2))
    }

    /// Deduplicate a list of structures.
    ///
    /// Args:
    ///     structures: List of structure JSON strings
    ///
    /// Returns:
    ///     List where result[i] is the index of the first structure matching structure i.
    ///
    /// Example:
    ///     >>> structures = [s.as_dict() for s in my_structures]
    ///     >>> json_strs = [json.dumps(s) for s in structures]
    ///     >>> indices = matcher.deduplicate(json_strs)
    fn deduplicate(&self, py: Python<'_>, structures: Vec<String>) -> PyResult<Vec<usize>> {
        // Release GIL during heavy computation
        py.detach(|| {
            self.inner
                .deduplicate_json(&to_str_refs(&structures))
                .map_err(|e| PyValueError::new_err(e.to_string()))
        })
    }

    /// Group structures into equivalence classes.
    ///
    /// Args:
    ///     structures: List of structure JSON strings
    ///
    /// Returns:
    ///     Dict mapping canonical index to list of equivalent structure indices.
    ///
    /// Example:
    ///     >>> groups = matcher.group(json_strs)
    ///     >>> for canonical, members in groups.items():
    ///     ...     print(f"Group {canonical}: {members}")
    fn group(
        &self,
        py: Python<'_>,
        structures: Vec<String>,
    ) -> PyResult<HashMap<usize, Vec<usize>>> {
        // Release GIL during heavy computation
        py.detach(|| {
            self.inner
                .group_json(&to_str_refs(&structures))
                .map(|m| m.into_iter().collect())
                .map_err(|e| PyValueError::new_err(e.to_string()))
        })
    }

    /// Get unique structures from a list.
    ///
    /// Args:
    ///     structures: List of structure JSON strings
    ///
    /// Returns:
    ///     List of indices of unique (first occurrence) structures.
    fn get_unique_indices(&self, structures: Vec<String>) -> PyResult<Vec<usize>> {
        let dedup = self
            .inner
            .deduplicate_json(&to_str_refs(&structures))
            .map_err(|e| PyValueError::new_err(e.to_string()))?;

        // Get indices where result[i] == i (first occurrences)
        let unique: Vec<usize> = dedup
            .iter()
            .enumerate()
            .filter(|&(idx, &canonical)| idx == canonical)
            .map(|(idx, _)| idx)
            .collect();

        Ok(unique)
    }

    /// Find matches for new structures against existing (already-deduplicated) structures.
    ///
    /// This is optimized for the common deduplication scenario where you have a small
    /// batch of new structures (~100) and a large set of existing structures (~28,000)
    /// that are already deduplicated.
    ///
    /// Args:
    ///     new_structures: List of new structure JSON strings to check
    ///     existing_structures: List of existing (already-deduplicated) structure JSON strings
    ///
    /// Returns:
    ///     List where result[i] is the index of the matching existing structure,
    ///     or None if new structure i has no match.
    ///
    /// Example:
    ///     >>> # 100 new structures, 28000 existing
    ///     >>> matches = matcher.find_matches(new_json_strs, existing_json_strs)
    ///     >>> for i, match_idx in enumerate(matches):
    ///     ...     if match_idx is not None:
    ///     ...         print(f"New {i} matches existing {match_idx}")
    ///     ...     else:
    ///     ...         print(f"New {i} is unique")
    ///
    /// Performance:
    ///     - Skips comparing existing structures against each other (already deduplicated)
    ///     - Uses composition hashing to filter candidates
    ///     - Early termination on first match
    ///     - Parallelized across new structures
    fn find_matches(
        &self,
        py: Python<'_>,
        new_structures: Vec<String>,
        existing_structures: Vec<String>,
    ) -> PyResult<Vec<Option<usize>>> {
        // Release GIL during heavy computation to allow other Python threads to run
        py.detach(|| {
            self.inner
                .find_matches_json(
                    &to_str_refs(&new_structures),
                    &to_str_refs(&existing_structures),
                )
                .map_err(|e| PyValueError::new_err(e.to_string()))
        })
    }

    /// Apply Niggli reduction and optionally primitive cell reduction to a structure.
    ///
    /// Use this to pre-reduce structures before calling `fit(..., skip_structure_reduction=True)`.
    /// This is an optimization for comparing many structures - reduce once, compare many times.
    ///
    /// Args:
    ///     structure: Structure as JSON string (from Structure.as_dict())
    ///
    /// Returns:
    ///     Reduced structure as JSON string (pymatgen-compatible format).
    ///
    /// Example:
    ///     >>> # Pre-reduce structures for batch comparison
    ///     >>> reduced_structs = [matcher.reduce_structure(s) for s in json_strs]
    ///     >>> # Now compare without redundant reduction
    ///     >>> for i, s1 in enumerate(reduced_structs):
    ///     ...     for s2 in reduced_structs[i+1:]:
    ///     ...         matcher.fit(s1, s2, skip_structure_reduction=True)
    fn reduce_structure(&self, py: Python<'_>, structure: StructureJson) -> PyResult<String> {
        let s = parse_struct(&structure)?;
        // Release GIL during reduction (supports batch usage in loops)
        let reduced = py.detach(|| self.inner.reduce_structure(&s));
        Ok(structure_to_pymatgen_json(&reduced))
    }

    fn __repr__(&self) -> String {
        let sm = &self.inner;
        // Use Python-style True/False for booleans
        let py_bool = |b: bool| if b { "True" } else { "False" };
        format!(
            "StructureMatcher(latt_len_tol={}, site_pos_tol={}, angle_tol={}, \
             primitive_cell={}, scale={}, attempt_supercell={})",
            sm.latt_len_tol,
            sm.site_pos_tol,
            sm.angle_tol,
            py_bool(sm.primitive_cell),
            py_bool(sm.scale),
            py_bool(sm.attempt_supercell)
        )
    }

    /// Get the lattice length tolerance.
    #[getter]
    fn latt_len_tol(&self) -> f64 {
        self.inner.latt_len_tol
    }

    /// Get the site position tolerance.
    #[getter]
    fn site_pos_tol(&self) -> f64 {
        self.inner.site_pos_tol
    }

    /// Get the angle tolerance.
    #[getter]
    fn angle_tol(&self) -> f64 {
        self.inner.angle_tol
    }

    /// Get whether primitive cell reduction is enabled.
    #[getter]
    fn primitive_cell(&self) -> bool {
        self.inner.primitive_cell
    }

    /// Get whether volume scaling is enabled.
    #[getter]
    fn scale(&self) -> bool {
        self.inner.scale
    }

    /// Get whether supercell matching is enabled.
    #[getter]
    fn attempt_supercell(&self) -> bool {
        self.inner.attempt_supercell
    }
}

// === Element Class ===

/// Python wrapper for Element.
///
/// Provides access to element properties like atomic number, mass, electronegativity,
/// oxidation states, radii, and physical properties.
#[pyclass(name = "Element")]
pub struct PyElement {
    inner: Element,
}

#[pymethods]
impl PyElement {
    /// Create an Element from symbol or atomic number.
    ///
    /// Args:
    ///     symbol_or_z: Element symbol (str like "Fe") or atomic number (int like 26)
    ///
    /// Returns:
    ///     Element object
    ///
    /// Raises:
    ///     ValueError: If the symbol or atomic number is invalid
    #[new]
    fn new(symbol_or_z: &Bound<'_, PyAny>) -> PyResult<Self> {
        if let Ok(symbol) = symbol_or_z.extract::<&str>() {
            Element::from_symbol(symbol)
                .map(|e| Self { inner: e })
                .ok_or_else(|| PyValueError::new_err(format!("Unknown element symbol: {symbol}")))
        } else if let Ok(z) = symbol_or_z.extract::<u8>() {
            Element::from_atomic_number(z)
                .map(|e| Self { inner: e })
                .ok_or_else(|| PyValueError::new_err(format!("Invalid atomic number: {z}")))
        } else {
            Err(PyValueError::new_err(
                "Expected element symbol (str) or atomic number (int)",
            ))
        }
    }

    /// Element symbol (e.g., "Fe", "O").
    #[getter]
    fn symbol(&self) -> &'static str {
        self.inner.symbol()
    }

    /// Atomic number (1-118 for real elements, 119+ for pseudo-elements).
    #[getter]
    fn atomic_number(&self) -> u8 {
        self.inner.atomic_number()
    }

    /// Atomic mass in atomic mass units (u).
    #[getter]
    fn atomic_mass(&self) -> f64 {
        self.inner.atomic_mass()
    }

    /// Full element name (e.g., "Iron", "Oxygen").
    #[getter]
    fn name(&self) -> &'static str {
        self.inner.name()
    }

    /// Pauling electronegativity (None for noble gases, transactinides).
    #[getter]
    fn electronegativity(&self) -> Option<f64> {
        self.inner.electronegativity()
    }

    /// Periodic table row (1-7).
    #[getter]
    fn row(&self) -> u8 {
        self.inner.row()
    }

    /// Periodic table group (1-18).
    #[getter]
    fn group(&self) -> u8 {
        self.inner.group()
    }

    /// Periodic table block ("S", "P", "D", or "F").
    #[getter]
    fn block(&self) -> &'static str {
        self.inner.block().as_str()
    }

    /// Atomic radius in Angstroms.
    #[getter]
    fn atomic_radius(&self) -> Option<f64> {
        self.inner.atomic_radius()
    }

    /// Covalent radius in Angstroms.
    #[getter]
    fn covalent_radius(&self) -> Option<f64> {
        self.inner.covalent_radius()
    }

    /// All known oxidation states.
    #[getter]
    fn oxidation_states(&self) -> Vec<i8> {
        self.inner.oxidation_states().to_vec()
    }

    /// Common oxidation states.
    #[getter]
    fn common_oxidation_states(&self) -> Vec<i8> {
        self.inner.common_oxidation_states().to_vec()
    }

    /// ICSD oxidation states (with >= 10 instances in ICSD).
    #[getter]
    fn icsd_oxidation_states(&self) -> Vec<i8> {
        self.inner.icsd_oxidation_states().to_vec()
    }

    /// Maximum oxidation state.
    #[getter]
    fn max_oxidation_state(&self) -> Option<i8> {
        self.inner.max_oxidation_state()
    }

    /// Minimum oxidation state.
    #[getter]
    fn min_oxidation_state(&self) -> Option<i8> {
        self.inner.min_oxidation_state()
    }

    /// Ionic radius for a specific oxidation state (Angstroms).
    #[pyo3(signature = (oxidation_state))]
    fn ionic_radius(&self, oxidation_state: i8) -> Option<f64> {
        self.inner.ionic_radius(oxidation_state)
    }

    /// All ionic radii as dict mapping oxidation state (str) to radius (float).
    ///
    /// Returns:
    ///     dict[str, float]: Oxidation state -> ionic radius in Angstroms
    #[getter]
    fn ionic_radii(&self, py: Python<'_>) -> PyResult<Option<Py<PyDict>>> {
        match self.inner.ionic_radii() {
            Some(radii) => {
                let dict = PyDict::new(py);
                for (oxi, radius) in radii {
                    dict.set_item(oxi.to_string(), radius)?;
                }
                Ok(Some(dict.unbind()))
            }
            None => Ok(None),
        }
    }

    /// Full Shannon radii data structure.
    ///
    /// Returns nested dict: oxidation_state -> coordination -> spin -> {crystal_radius, ionic_radius}
    ///
    /// Returns:
    ///     dict[str, dict[str, dict[str, dict[str, float]]]]: Shannon radii data
    #[getter]
    fn shannon_radii(&self, py: Python<'_>) -> PyResult<Option<Py<PyDict>>> {
        match self.inner.shannon_radii() {
            Some(shannon) => {
                let outer_dict = PyDict::new(py);
                for (oxi_state, coord_map) in shannon {
                    let coord_dict = PyDict::new(py);
                    for (coordination, spin_map) in coord_map {
                        let spin_dict = PyDict::new(py);
                        for (spin, radii_pair) in spin_map {
                            let radii_dict = PyDict::new(py);
                            radii_dict.set_item("crystal_radius", radii_pair.crystal_radius)?;
                            radii_dict.set_item("ionic_radius", radii_pair.ionic_radius)?;
                            spin_dict.set_item(spin, radii_dict)?;
                        }
                        coord_dict.set_item(coordination, spin_dict)?;
                    }
                    outer_dict.set_item(oxi_state.to_string(), coord_dict)?;
                }
                Ok(Some(outer_dict.unbind()))
            }
            None => Ok(None),
        }
    }

    /// Shannon ionic radius for specific oxidation state, coordination, and spin.
    ///
    /// Args:
    ///     oxidation_state: Oxidation state (e.g., 2 for Fe2+)
    ///     coordination: Coordination number as Roman numeral (e.g., "VI" for octahedral)
    ///     spin: Spin state ("High Spin", "Low Spin", or "" for none)
    #[pyo3(signature = (oxidation_state, coordination, spin = ""))]
    fn shannon_ionic_radius(
        &self,
        oxidation_state: i8,
        coordination: &str,
        spin: &str,
    ) -> Option<f64> {
        self.inner
            .shannon_ionic_radius(oxidation_state, coordination, spin)
    }

    // Physical properties

    /// Melting point in Kelvin.
    #[getter]
    fn melting_point(&self) -> Option<f64> {
        self.inner.melting_point()
    }

    /// Boiling point in Kelvin.
    #[getter]
    fn boiling_point(&self) -> Option<f64> {
        self.inner.boiling_point()
    }

    /// Density in g/cm³ (or g/L for gases at STP).
    #[getter]
    fn density(&self) -> Option<f64> {
        self.inner.density()
    }

    /// Electron affinity in kJ/mol.
    #[getter]
    fn electron_affinity(&self) -> Option<f64> {
        self.inner.electron_affinity()
    }

    /// First ionization energy in kJ/mol.
    #[getter]
    fn first_ionization_energy(&self) -> Option<f64> {
        self.inner.first_ionization_energy()
    }

    /// All ionization energies in kJ/mol (index 0 = first ionization).
    #[getter]
    fn ionization_energies(&self) -> Vec<f64> {
        self.inner.ionization_energies().to_vec()
    }

    /// Molar heat capacity (Cp) in J/(mol·K).
    #[getter]
    fn molar_heat(&self) -> Option<f64> {
        self.inner.molar_heat()
    }

    /// Specific heat capacity in J/(g·K).
    #[getter]
    fn specific_heat(&self) -> Option<f64> {
        self.inner.specific_heat()
    }

    /// Number of valence electrons.
    #[getter]
    fn n_valence(&self) -> Option<u8> {
        self.inner.n_valence()
    }

    /// Electron configuration (e.g., "1s2 2s2 2p6 3s2 3p6 4s2 3d6").
    #[getter]
    fn electron_configuration(&self) -> Option<&'static str> {
        self.inner.electron_configuration()
    }

    /// Semantic electron configuration with noble gas core (e.g., "[Ar] 4s2 3d6").
    #[getter]
    fn electron_configuration_semantic(&self) -> Option<&'static str> {
        self.inner.electron_configuration_semantic()
    }

    // Classification methods

    /// True if element is a noble gas (He, Ne, Ar, Kr, Xe, Rn, Og).
    fn is_noble_gas(&self) -> bool {
        self.inner.is_noble_gas()
    }

    /// True if element is an alkali metal (Li, Na, K, Rb, Cs, Fr).
    fn is_alkali(&self) -> bool {
        self.inner.is_alkali()
    }

    /// True if element is an alkaline earth metal (Be, Mg, Ca, Sr, Ba, Ra).
    fn is_alkaline(&self) -> bool {
        self.inner.is_alkaline()
    }

    /// True if element is a halogen (F, Cl, Br, I, At).
    fn is_halogen(&self) -> bool {
        self.inner.is_halogen()
    }

    /// True if element is a chalcogen (O, S, Se, Te, Po).
    fn is_chalcogen(&self) -> bool {
        self.inner.is_chalcogen()
    }

    /// True if element is a lanthanoid (La-Lu).
    fn is_lanthanoid(&self) -> bool {
        self.inner.is_lanthanoid()
    }

    /// True if element is an actinoid (Ac-Lr).
    fn is_actinoid(&self) -> bool {
        self.inner.is_actinoid()
    }

    /// True if element is a transition metal.
    fn is_transition_metal(&self) -> bool {
        self.inner.is_transition_metal()
    }

    /// True if element is a post-transition metal (Al, Ga, In, Tl, Sn, Pb, Bi).
    fn is_post_transition_metal(&self) -> bool {
        self.inner.is_post_transition_metal()
    }

    /// True if element is a metalloid (B, Si, Ge, As, Sb, Te, Po).
    fn is_metalloid(&self) -> bool {
        self.inner.is_metalloid()
    }

    /// True if element is a metal.
    fn is_metal(&self) -> bool {
        self.inner.is_metal()
    }

    /// True if element is radioactive.
    fn is_radioactive(&self) -> bool {
        self.inner.is_radioactive()
    }

    /// True if element is a rare earth (lanthanoid, actinoid, Sc, or Y).
    fn is_rare_earth(&self) -> bool {
        self.inner.is_rare_earth()
    }

    /// True if element is a pseudo-element (Dummy, D, or T).
    fn is_pseudo(&self) -> bool {
        self.inner.is_pseudo()
    }

    fn __repr__(&self) -> String {
        format!("Element(\"{}\")", self.inner.symbol())
    }

    fn __str__(&self) -> &'static str {
        self.inner.symbol()
    }

    fn __eq__(&self, other: &Self) -> bool {
        self.inner == other.inner
    }

    fn __hash__(&self) -> isize {
        self.inner.atomic_number() as isize
    }
}

// === Structure I/O Functions ===

/// Convert a Structure to a Python dict in pymatgen format.
fn structure_to_pydict<'py>(
    py: Python<'py>,
    structure: &Structure,
) -> PyResult<Bound<'py, PyDict>> {
    let dict = PyDict::new(py);

    // Pymatgen markers
    dict.set_item("@module", "pymatgen.core.structure")?;
    dict.set_item("@class", "Structure")?;

    // Lattice
    let lattice_dict = PyDict::new(py);
    let mat = structure.lattice.matrix();
    let matrix = PyList::new(
        py,
        [
            PyList::new(py, [mat[(0, 0)], mat[(0, 1)], mat[(0, 2)]])?,
            PyList::new(py, [mat[(1, 0)], mat[(1, 1)], mat[(1, 2)]])?,
            PyList::new(py, [mat[(2, 0)], mat[(2, 1)], mat[(2, 2)]])?,
        ],
    )?;
    lattice_dict.set_item("matrix", matrix)?;
    lattice_dict.set_item(
        "pbc",
        PyList::new(
            py,
            [
                structure.lattice.pbc[0],
                structure.lattice.pbc[1],
                structure.lattice.pbc[2],
            ],
        )?,
    )?;
    dict.set_item("lattice", lattice_dict)?;

    // Sites with all species and their occupancies
    let sites = PyList::empty(py);
    for (site_occ, coord) in structure
        .site_occupancies
        .iter()
        .zip(structure.frac_coords.iter())
    {
        let site = PyDict::new(py);

        // Species list with occupancies
        let species_list = PyList::empty(py);
        for (sp, occ) in &site_occ.species {
            let species_entry = PyDict::new(py);
            species_entry.set_item("element", sp.element.symbol())?;
            species_entry.set_item("occu", occ)?;
            if let Some(oxi) = sp.oxidation_state {
                species_entry.set_item("oxidation_state", oxi)?;
            }
            species_list.append(species_entry)?;
        }
        site.set_item("species", species_list)?;

        // Coordinates
        site.set_item("abc", PyList::new(py, [coord.x, coord.y, coord.z])?)?;

        // Site-level properties (label, magmom, orig_site_idx, etc.)
        let site_props = PyDict::new(py);
        for (key, value) in &site_occ.properties {
            site_props.set_item(key, json_to_py(py, value)?)?;
        }
        site.set_item("properties", site_props)?;

        sites.append(site)?;
    }
    dict.set_item("sites", sites)?;

    // Properties
    let props = PyDict::new(py);
    for (key, value) in &structure.properties {
        // Convert serde_json::Value to Python object
        let py_value = json_to_py(py, value)?;
        props.set_item(key, py_value)?;
    }
    dict.set_item("properties", props)?;

    Ok(dict)
}

/// Convert serde_json::Value to Python object.
fn json_to_py(py: Python<'_>, value: &serde_json::Value) -> PyResult<Py<PyAny>> {
    use pyo3::IntoPyObject;

    match value {
        serde_json::Value::Null => Ok(py.None()),
        serde_json::Value::Bool(b) => Ok(b.into_pyobject(py)?.to_owned().unbind().into_any()),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(i.into_pyobject(py)?.unbind().into_any())
            } else if let Some(u) = n.as_u64() {
                Ok(u.into_pyobject(py)?.unbind().into_any())
            } else if let Some(f) = n.as_f64() {
                Ok(f.into_pyobject(py)?.unbind().into_any())
            } else {
                Err(PyValueError::new_err("Invalid number in JSON"))
            }
        }
        serde_json::Value::String(s) => Ok(s.into_pyobject(py)?.unbind().into_any()),
        serde_json::Value::Array(arr) => {
            let list: Vec<Py<PyAny>> = arr
                .iter()
                .map(|v| json_to_py(py, v))
                .collect::<PyResult<_>>()?;
            Ok(PyList::new(py, list)?.into_any().unbind())
        }
        serde_json::Value::Object(obj) => {
            let dict = PyDict::new(py);
            for (key, val) in obj {
                dict.set_item(key, json_to_py(py, val)?)?;
            }
            Ok(dict.unbind().into_any())
        }
    }
}

/// Parse a structure file (auto-detects format from extension).
///
/// Supports:
/// - `.json` - Pymatgen JSON format
/// - `.cif` - Crystallographic Information File
/// - `.xyz`, `.extxyz` - Extended XYZ format
/// - `POSCAR*`, `CONTCAR*`, `.vasp` - VASP POSCAR format
///
/// Args:
///     path: Path to the structure file
///
/// Returns:
///     dict: Structure as a Python dict compatible with pymatgen's Structure.from_dict()
///
/// Example:
///     >>> from ferrox import parse_structure_file
///     >>> from pymatgen.core import Structure
///     >>> struct_dict = parse_structure_file("structure.cif")
///     >>> structure = Structure.from_dict(struct_dict)
#[pyfunction]
fn parse_structure_file(py: Python<'_>, path: &str) -> PyResult<Py<PyDict>> {
    let structure = parse_structure(Path::new(path))
        .map_err(|e| PyValueError::new_err(format!("Error parsing {path}: {e}")))?;

    Ok(structure_to_pydict(py, &structure)?.unbind())
}

/// Parse trajectory file (extXYZ format).
///
/// Loads all frames from a trajectory file into a list of structure dicts.
///
/// Args:
///     path: Path to the trajectory file (xyz/extxyz format)
///
/// Returns:
///     List of pymatgen-compatible structure dicts, one per frame
///
/// Example:
///     >>> from ferrox import parse_trajectory
///     >>> frames = parse_trajectory("trajectory.xyz")
///     >>> for frame_dict in frames:
///     ...     structure = Structure.from_dict(frame_dict)
///     ...     print(structure.composition)
#[pyfunction]
fn parse_trajectory(py: Python<'_>, path: &str) -> PyResult<Vec<Py<PyDict>>> {
    let frames = parse_extxyz_trajectory(Path::new(path))
        .map_err(|e| PyValueError::new_err(e.to_string()))?;

    let mut results = Vec::new();
    for frame_result in frames {
        let structure =
            frame_result.map_err(|e| PyValueError::new_err(format!("Frame parse error: {e}")))?;
        results.push(structure_to_pydict(py, &structure)?.unbind());
    }

    Ok(results)
}

// === Structure Writing Functions ===

/// Write a structure to a file with automatic format detection.
///
/// The format is determined by the file extension:
/// - `.json` - Pymatgen JSON format
/// - `.cif` - CIF format
/// - `.xyz`, `.extxyz` - extXYZ format
/// - `.vasp`, `POSCAR*`, `CONTCAR*` - POSCAR format
///
/// Args:
///     structure (str): Structure as JSON string (from Structure.as_dict())
///     path (str): Path to the output file
///
/// Example:
///     >>> from ferrox import write_structure_file
///     >>> import json
///     >>> write_structure_file(json.dumps(s.as_dict()), "output.cif")
#[pyfunction]
fn write_structure_file(structure: StructureJson, path: &str) -> PyResult<()> {
    let s = parse_struct(&structure)?;
    write_structure(&s, Path::new(path))
        .map_err(|e| PyValueError::new_err(format!("Error writing {path}: {e}")))
}

/// Convert a structure to POSCAR format string.
///
/// Args:
///     structure (str): Structure as JSON string (from Structure.as_dict())
///     comment (str, optional): Comment line for the POSCAR (defaults to formula)
///
/// Returns:
///     str: POSCAR format string
///
/// Example:
///     >>> from ferrox import to_poscar
///     >>> import json
///     >>> poscar_str = to_poscar(json.dumps(s.as_dict()))
///     >>> print(poscar_str)
#[pyfunction]
#[pyo3(signature = (structure, comment = None))]
fn to_poscar(structure: StructureJson, comment: Option<&str>) -> PyResult<String> {
    let s = parse_struct(&structure)?;
    Ok(structure_to_poscar(&s, comment))
}

/// Convert a structure to CIF format string.
///
/// Args:
///     structure (str): Structure as JSON string (from Structure.as_dict())
///     data_name (str, optional): Data block name (defaults to formula)
///
/// Returns:
///     str: CIF format string
///
/// Example:
///     >>> from ferrox import to_cif
///     >>> import json
///     >>> cif_str = to_cif(json.dumps(s.as_dict()))
///     >>> print(cif_str)
#[pyfunction]
#[pyo3(signature = (structure, data_name = None))]
fn to_cif(structure: StructureJson, data_name: Option<&str>) -> PyResult<String> {
    let s = parse_struct(&structure)?;
    Ok(crate::cif::structure_to_cif(&s, data_name))
}

/// Convert a structure to extXYZ format string.
///
/// Args:
///     structure (str): Structure as JSON string (from Structure.as_dict())
///
/// Returns:
///     str: extXYZ format string
///
/// Example:
///     >>> from ferrox import to_extxyz
///     >>> import json
///     >>> xyz_str = to_extxyz(json.dumps(s.as_dict()))
///     >>> print(xyz_str)
#[pyfunction]
fn to_extxyz(structure: StructureJson) -> PyResult<String> {
    let s = parse_struct(&structure)?;
    Ok(structure_to_extxyz(&s, None))
}

/// Convert a structure to pymatgen JSON format string.
///
/// Args:
///     structure (str): Structure as JSON string (from Structure.as_dict())
///
/// Returns:
///     str: JSON format string compatible with pymatgen's Structure.from_dict()
///
/// Example:
///     >>> from ferrox import to_pymatgen_json
///     >>> import json
///     >>> json_str = to_pymatgen_json(json.dumps(s.as_dict()))
#[pyfunction]
fn to_pymatgen_json(structure: StructureJson) -> PyResult<String> {
    let s = parse_struct(&structure)?;
    Ok(structure_to_pymatgen_json(&s))
}

// === Molecule I/O Functions ===

/// Parse a molecule from pymatgen Molecule JSON format.
///
/// Args:
///     json_str (str): JSON string in pymatgen Molecule.as_dict() format
///
/// Returns:
///     dict: Parsed molecule as dict (same format as input)
///
/// Example:
///     >>> from ferrox import parse_molecule_json
///     >>> import json
///     >>> mol_dict = parse_molecule_json(json.dumps(mol.as_dict()))
#[pyfunction]
#[pyo3(name = "parse_molecule_json")]
fn parse_molecule_json_py(py: Python<'_>, json_str: &str) -> PyResult<Py<PyDict>> {
    let mol = crate::io::parse_molecule_json(json_str)
        .map_err(|e| PyValueError::new_err(format!("Error parsing molecule: {e}")))?;
    let mol_json = crate::io::molecule_to_pymatgen_json(&mol);
    json_to_pydict(py, &mol_json)
}

/// Convert a molecule to pymatgen JSON format string.
///
/// Note: Input must be in pymatgen Molecule format (non-periodic, with "xyz" coords).
/// Passing a periodic Structure will raise an error.
///
/// Args:
///     molecule (str | dict): Molecule as JSON string or dict (pymatgen Molecule format)
///
/// Returns:
///     str: JSON format string compatible with pymatgen's Molecule.from_dict()
#[pyfunction]
fn molecule_to_json(molecule: StructureJson) -> PyResult<String> {
    let mol = crate::io::parse_molecule_json(&molecule.0)
        .map_err(|e| PyValueError::new_err(format!("Error parsing molecule: {e}")))?;
    Ok(crate::io::molecule_to_pymatgen_json(&mol))
}

/// Convert a molecule to XYZ format string.
///
/// Note: Input must be in pymatgen Molecule format (non-periodic, with "xyz" coords).
/// Passing a periodic Structure will raise an error.
///
/// Args:
///     molecule (str | dict): Molecule as JSON string or dict (pymatgen Molecule format)
///     comment (str, optional): Comment line (defaults to formula)
///
/// Returns:
///     str: XYZ format string
#[pyfunction]
#[pyo3(signature = (molecule, comment = None))]
fn molecule_to_xyz(molecule: StructureJson, comment: Option<&str>) -> PyResult<String> {
    let mol = crate::io::parse_molecule_json(&molecule.0)
        .map_err(|e| PyValueError::new_err(format!("Error parsing molecule: {e}")))?;
    Ok(crate::io::molecule_to_xyz(&mol, comment))
}

/// Parse a molecule from XYZ file content.
///
/// Args:
///     content (str): XYZ file content as string
///
/// Returns:
///     dict: Parsed molecule in pymatgen Molecule.as_dict() format
#[pyfunction]
#[pyo3(name = "parse_xyz_str")]
fn parse_xyz_str_py(py: Python<'_>, content: &str) -> PyResult<Py<PyDict>> {
    let mol = crate::io::parse_xyz_str(content)
        .map_err(|e| PyValueError::new_err(format!("Error parsing XYZ: {e}")))?;
    let mol_json = crate::io::molecule_to_pymatgen_json(&mol);
    json_to_pydict(py, &mol_json)
}

/// Parse a molecule from an XYZ file.
///
/// Args:
///     path (str): Path to the XYZ file
///
/// Returns:
///     dict: Parsed molecule in pymatgen Molecule.as_dict() format
#[pyfunction]
fn parse_xyz_file(py: Python<'_>, path: &str) -> PyResult<Py<PyDict>> {
    let mol = crate::io::parse_xyz(Path::new(path))
        .map_err(|e| PyValueError::new_err(format!("Error parsing XYZ file: {e}")))?;
    let mol_json = crate::io::molecule_to_pymatgen_json(&mol);
    json_to_pydict(py, &mol_json)
}

/// Parse ASE Atoms dict, returning either a Structure or Molecule dict.
///
/// This is useful when you don't know if the input is periodic or not.
///
/// Args:
///     ase_dict (dict): ASE Atoms dict
///
/// Returns:
///     tuple[str, dict]: Tuple of ("Structure" or "Molecule", dict in pymatgen format)
#[pyfunction]
fn parse_ase_dict(py: Python<'_>, ase_dict: &Bound<'_, PyDict>) -> PyResult<(String, Py<PyDict>)> {
    let json_module = py.import("json")?;
    let json_str: String = json_module.call_method1("dumps", (ase_dict,))?.extract()?;
    let result = crate::io::parse_ase_atoms_json(&json_str)
        .map_err(|e| PyValueError::new_err(format!("Error parsing ASE dict: {e}")))?;
    struct_or_mol_to_pydict(py, result)
}

/// Parse XYZ content flexibly, returning Structure if lattice present, Molecule otherwise.
///
/// Args:
///     path (str): Path to XYZ file
///
/// Returns:
///     tuple[str, dict]: Tuple of ("Structure" or "Molecule", dict in pymatgen format)
#[pyfunction]
#[pyo3(name = "parse_xyz_flexible")]
fn parse_xyz_flexible_py(py: Python<'_>, path: &str) -> PyResult<(String, Py<PyDict>)> {
    let result = crate::io::parse_xyz_flexible(Path::new(path))
        .map_err(|e| PyValueError::new_err(format!("Error parsing XYZ: {e}")))?;
    struct_or_mol_to_pydict(py, result)
}

// === Direct Object Conversion (pymatgen <-> ferrox <-> ASE) ===

/// Convert a pymatgen Structure directly to ferrox dict format.
///
/// This extracts lattice, species, and coordinates directly from the pymatgen
/// object without JSON serialization overhead.
///
/// Args:
///     structure: pymatgen Structure object
///
/// Returns:
///     dict: Structure in ferrox/pymatgen dict format
///
/// Example:
///     >>> from pymatgen.core import Structure
///     >>> from ferrox import from_pymatgen_structure
///     >>> struct = Structure.from_file("POSCAR")
///     >>> ferrox_dict = from_pymatgen_structure(struct)
fn validate_3x3(m: &[Vec<f64>], name: &str) -> PyResult<[f64; 9]> {
    if m.len() != 3 || m.iter().any(|r| r.len() != 3) {
        return Err(PyValueError::new_err(format!("{name} must be 3×3")));
    }
    let flat = [
        m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2],
    ];
    if let Some(idx) = flat.iter().position(|v| !v.is_finite()) {
        let row = idx / 3;
        let col = idx % 3;
        return Err(PyValueError::new_err(format!(
            "{name}[{row}][{col}] must be finite, got {}",
            flat[idx]
        )));
    }
    Ok(flat)
}

#[pyfunction]
fn from_pymatgen_structure(py: Python<'_>, structure: &Bound<'_, PyAny>) -> PyResult<Py<PyDict>> {
    // Extract lattice matrix directly
    let lattice = structure.getattr("lattice")?;
    let matrix: Vec<Vec<f64>> = lattice.getattr("matrix")?.extract()?;
    let matrix_flat = validate_3x3(&matrix, "lattice matrix")?;
    let pbc: [bool; 3] = lattice
        .getattr("pbc")
        .and_then(|p| p.extract())
        .unwrap_or([true, true, true]);

    // Extract charge if present
    let charge: f64 = structure
        .getattr("charge")
        .and_then(|c| c.extract())
        .unwrap_or(0.0);

    // Build the ferrox lattice
    let mut lattice_obj =
        crate::lattice::Lattice::new(nalgebra::Matrix3::from_row_slice(&matrix_flat));
    lattice_obj.pbc = pbc;

    // Extract sites with full species info (oxidation states, occupancies, disordered sites)
    let sites = structure.getattr("sites")?;
    let mut site_occupancies = Vec::new();
    let mut frac_coords = Vec::new();

    for site_result in sites.try_iter()? {
        let site = site_result?;

        // Get fractional coordinates
        let frac: [f64; 3] = site.getattr("frac_coords")?.extract()?;
        frac_coords.push(nalgebra::Vector3::new(frac[0], frac[1], frac[2]));

        // Get species with occupancies - site.species is a Composition-like object
        let species_comp = site.getattr("species")?;
        let mut species_vec: Vec<(crate::species::Species, f64)> = Vec::new();

        // Iterate over (Species, occupancy) pairs - handles disordered sites
        for item_result in species_comp.call_method0("items")?.try_iter()? {
            let item = item_result?;
            let (sp, occu): (pyo3::Bound<'_, PyAny>, f64) = item.extract()?;

            // Extract element symbol
            let symbol: String = sp.getattr("symbol")?.extract()?;
            let elem = crate::element::Element::from_symbol(&symbol)
                .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {symbol}")))?;

            // Extract oxidation state from sp.getattr("oxi_state"):
            // - pymatgen Species.oxi_state returns None for unspecified/neutral species
            // - When present, oxi_state is a float (e.g., 2.0 for Fe2+, -2.0 for O2-)
            // - We treat None (fails extract) or zero-like values as no oxidation state
            // - Only integer-valued oxidation states are accepted (non-integer -> None)
            let oxi_state: Option<i8> = sp
                .getattr("oxi_state")
                .and_then(|o| o.extract::<f64>())
                .ok()
                .and_then(|oxi| {
                    if oxi.abs() < 1e-10 {
                        None // Zero treated as neutral/unspecified
                    } else if oxi.fract().abs() < 1e-10 {
                        Some(oxi.round() as i8)
                    } else {
                        None // Non-integer oxidation states not supported
                    }
                });

            species_vec.push((crate::species::Species::new(elem, oxi_state), occu));
        }

        site_occupancies.push(crate::species::SiteOccupancy::new(species_vec));
    }

    let s = crate::structure::Structure::try_new_full(
        lattice_obj,
        site_occupancies,
        frac_coords,
        pbc,
        charge,
        std::collections::HashMap::new(),
    )
    .map_err(|e| PyValueError::new_err(format!("Error creating structure: {e}")))?;

    let json = structure_to_pymatgen_json(&s);
    json_to_pydict(py, &json)
}

/// Convert a ferrox dict to a pymatgen Structure object.
///
/// Args:
///     structure (str | dict): Structure in ferrox/pymatgen dict format
///
/// Returns:
///     pymatgen.core.Structure: pymatgen Structure object
///
/// Example:
///     >>> from ferrox import to_pymatgen_structure, from_pymatgen_structure
///     >>> struct = to_pymatgen_structure(ferrox_dict)
#[pyfunction]
fn to_pymatgen_structure(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyAny>> {
    let pymatgen = py.import("pymatgen.core.structure")?;
    let structure_cls = pymatgen.getattr("Structure")?;

    // Parse to get validated structure, then serialize
    let s = parse_struct(&structure)?;
    let json_str = structure_to_pymatgen_json(&s);
    let dict = json_to_pydict(py, &json_str)?;

    // Call Structure.from_dict()
    structure_cls
        .call_method1("from_dict", (dict,))
        .map(|o| o.unbind())
}

/// Convert a ferrox dict to a pymatgen Molecule object.
///
/// Args:
///     molecule (str | dict): Molecule in ferrox/pymatgen dict format
///
/// Returns:
///     pymatgen.core.Molecule: pymatgen Molecule object
///
/// Example:
///     >>> from ferrox import to_pymatgen_molecule
///     >>> mol = to_pymatgen_molecule(ferrox_mol_dict)
#[pyfunction]
fn to_pymatgen_molecule(py: Python<'_>, molecule: StructureJson) -> PyResult<Py<PyAny>> {
    let pymatgen = py.import("pymatgen.core.structure")?;
    let molecule_cls = pymatgen.getattr("Molecule")?;

    let mol = crate::io::parse_molecule_json(&molecule.0)
        .map_err(|e| PyValueError::new_err(format!("Error parsing molecule: {e}")))?;
    let json_str = crate::io::molecule_to_pymatgen_json(&mol);
    let dict = json_to_pydict(py, &json_str)?;

    molecule_cls
        .call_method1("from_dict", (dict,))
        .map(|o| o.unbind())
}

/// Convert an ASE Atoms object directly to ferrox dict format.
///
/// This extracts cell, symbols, and positions directly from the ASE Atoms
/// object without JSON serialization overhead.
///
/// Args:
///     atoms: ASE Atoms object
///
/// Returns:
///     dict: Structure or Molecule in ferrox/pymatgen dict format
///
/// Example:
///     >>> from ase.io import read
///     >>> from ferrox import from_ase_atoms
///     >>> atoms = read("POSCAR")
///     >>> ferrox_dict = from_ase_atoms(atoms)
#[pyfunction]
fn from_ase_atoms(py: Python<'_>, atoms: &Bound<'_, PyAny>) -> PyResult<Py<PyDict>> {
    // Extract symbols
    let symbols: Vec<String> = atoms.call_method0("get_chemical_symbols")?.extract()?;

    // Extract positions (Cartesian)
    let positions: Vec<[f64; 3]> = atoms.call_method0("get_positions")?.extract()?;

    // Extract cell - falls back to zero matrix if extraction fails (e.g., non-standard cell type)
    // This is intentional: has_cell check below correctly handles zero matrices as "no cell"
    let cell_obj = atoms.call_method0("get_cell")?;
    let cell: Vec<Vec<f64>> = cell_obj.extract().unwrap_or_else(|_| vec![vec![0.0; 3]; 3]);
    let cell_flat = validate_3x3(&cell, "ASE cell")?;
    let has_cell = cell_flat.iter().any(|&v| v.abs() > 1e-10);

    // Extract pbc
    let pbc: [bool; 3] = atoms
        .call_method0("get_pbc")
        .and_then(|p| p.extract())
        .unwrap_or([false, false, false]);
    let is_periodic = pbc.iter().any(|&p| p) && has_cell;

    // Extract charge from atoms.info["charge"] if present (ASE stores charge in info dict)
    let charge: f64 = (|| -> Option<f64> {
        let info = atoms.getattr("info").ok()?;
        let charge_val = info.get_item("charge").ok()?;
        charge_val.extract::<f64>().ok()
    })()
    .unwrap_or(0.0);

    // Convert symbols to species (shared by both branches)
    let species: Vec<crate::species::Species> = symbols
        .iter()
        .map(|s| {
            let elem = crate::element::Element::from_symbol(s)
                .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {s}")))?;
            Ok(crate::species::Species::neutral(elem))
        })
        .collect::<PyResult<_>>()?;

    // Convert positions to Vector3
    let cart_coords: Vec<nalgebra::Vector3<f64>> = positions
        .iter()
        .map(|p| nalgebra::Vector3::new(p[0], p[1], p[2]))
        .collect();

    if is_periodic {
        // Build periodic Structure
        let mut lattice =
            crate::lattice::Lattice::new(nalgebra::Matrix3::from_row_slice(&cell_flat));
        lattice.pbc = pbc;

        // Convert Cartesian to fractional (cache inverse to avoid repeated inversion)
        let inv = lattice.inv_matrix();
        let frac_coords: Vec<nalgebra::Vector3<f64>> =
            cart_coords.iter().map(|p| inv * p).collect();

        let s = crate::structure::Structure::try_new_full(
            lattice,
            species
                .into_iter()
                .map(crate::species::SiteOccupancy::ordered)
                .collect(),
            frac_coords,
            pbc,
            charge,
            std::collections::HashMap::new(),
        )
        .map_err(|e| PyValueError::new_err(format!("Error creating structure: {e}")))?;

        let json = structure_to_pymatgen_json(&s);
        json_to_pydict(py, &json)
    } else {
        // Build non-periodic Molecule
        let mol = crate::structure::Structure::try_new_molecule(
            species,
            cart_coords,
            charge,
            std::collections::HashMap::new(),
        )
        .map_err(|e| PyValueError::new_err(format!("Error creating molecule: {e}")))?;

        let json = crate::io::molecule_to_pymatgen_json(&mol);
        json_to_pydict(py, &json)
    }
}

/// Convert a ferrox dict to an ASE Atoms object.
///
/// Args:
///     structure (str | dict): Structure or Molecule in ferrox/pymatgen dict format
///
/// Returns:
///     ase.Atoms: ASE Atoms object
///
/// Example:
///     >>> from ferrox import to_ase_atoms
///     >>> atoms = to_ase_atoms(ferrox_dict)
#[pyfunction]
fn to_ase_atoms(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyAny>> {
    let ase = py.import("ase")?;
    let atoms_cls = ase.getattr("Atoms")?;

    // Try to parse as structure first, then as molecule
    let (symbols, positions, cell, pbc, charge) = if let Ok(s) = parse_structure_json(&structure.0)
    {
        let symbols: Vec<String> = s.species_strings();
        let positions: Vec<[f64; 3]> = s.cart_coords().iter().map(|c| [c.x, c.y, c.z]).collect();
        let mat = s.lattice.matrix();
        let cell = vec![
            vec![mat[(0, 0)], mat[(0, 1)], mat[(0, 2)]],
            vec![mat[(1, 0)], mat[(1, 1)], mat[(1, 2)]],
            vec![mat[(2, 0)], mat[(2, 1)], mat[(2, 2)]],
        ];
        (symbols, positions, Some(cell), s.pbc, s.charge)
    } else if let Ok(mol) = crate::io::parse_molecule_json(&structure.0) {
        let symbols: Vec<String> = mol.species_strings();
        let positions: Vec<[f64; 3]> = mol.cart_coords().iter().map(|c| [c.x, c.y, c.z]).collect();
        (symbols, positions, None, [false, false, false], mol.charge)
    } else {
        return Err(PyValueError::new_err(
            "Could not parse input as Structure or Molecule",
        ));
    };

    // Build kwargs
    let kwargs = PyDict::new(py);
    kwargs.set_item("symbols", symbols)?;
    kwargs.set_item("positions", positions)?;
    kwargs.set_item("pbc", pbc)?;
    if let Some(cell) = cell {
        kwargs.set_item("cell", cell)?;
    }

    let atoms = atoms_cls.call((), Some(&kwargs))?;

    // Set charge in info dict if non-zero (consistent with structure_to_ase_atoms_dict)
    if charge.abs() > 1e-10 {
        let info = atoms.getattr("info")?;
        info.set_item("charge", charge)?;
    }

    Ok(atoms.unbind())
}

// === Helper Functions ===

/// Convert StructureOrMolecule to a (type_name, pydict) tuple.
#[allow(deprecated)]
fn struct_or_mol_to_pydict(
    py: Python<'_>,
    result: crate::io::StructureOrMolecule,
) -> PyResult<(String, Py<PyDict>)> {
    match result {
        crate::io::StructureOrMolecule::Structure(s) => {
            let json = structure_to_pymatgen_json(&s);
            Ok(("Structure".to_string(), json_to_pydict(py, &json)?))
        }
        crate::io::StructureOrMolecule::Molecule(m) => {
            let json = crate::io::molecule_to_pymatgen_json(&m);
            Ok(("Molecule".to_string(), json_to_pydict(py, &json)?))
        }
    }
}

/// Parse reduction algorithm from string ("niggli" or "lll").
fn parse_reduction_algo(algo: &str) -> PyResult<crate::structure::ReductionAlgo> {
    match algo.to_lowercase().as_str() {
        "niggli" => Ok(crate::structure::ReductionAlgo::Niggli),
        "lll" => Ok(crate::structure::ReductionAlgo::LLL),
        _ => Err(PyValueError::new_err(format!(
            "Invalid algorithm: {algo}. Use 'niggli' or 'lll'"
        ))),
    }
}

// === Structure Manipulation Functions ===

/// Create a supercell from a structure.
///
/// Args:
///     structure (str): Structure as JSON string (from Structure.as_dict())
///     scaling_matrix (list[list[int]]): 3x3 integer scaling matrix [[a1,a2,a3],[b1,b2,b3],[c1,c2,c3]].
///         Negative values are allowed and create mirror transformations.
///
/// Returns:
///     dict: Supercell structure as a Python dict compatible with pymatgen
///
/// Example:
///     >>> from ferrox import make_supercell
///     >>> import json
///     >>> supercell_dict = make_supercell(json.dumps(s.as_dict()), [[2,0,0],[0,2,0],[0,0,2]])
///     >>> supercell = Structure.from_dict(supercell_dict)
#[pyfunction]
fn make_supercell(
    py: Python<'_>,
    structure: StructureJson,
    scaling_matrix: [[i32; 3]; 3],
) -> PyResult<Py<PyDict>> {
    let supercell = parse_struct(&structure)?
        .make_supercell(scaling_matrix)
        .map_err(|e| PyValueError::new_err(format!("Error creating supercell: {e}")))?;
    Ok(structure_to_pydict(py, &supercell)?.unbind())
}

/// Create a diagonal supercell (nx x ny x nz).
///
/// Args:
///     structure (str): Structure as JSON string (from Structure.as_dict())
///     nx (int): Scaling factor along a-axis
///     ny (int): Scaling factor along b-axis
///     nz (int): Scaling factor along c-axis
///
/// Returns:
///     dict: Supercell structure as a Python dict compatible with pymatgen
///
/// Example:
///     >>> from ferrox import make_supercell_diag
///     >>> import json
///     >>> supercell_dict = make_supercell_diag(json.dumps(s.as_dict()), 2, 2, 2)
///     >>> supercell = Structure.from_dict(supercell_dict)
#[pyfunction]
fn make_supercell_diag(
    py: Python<'_>,
    structure: StructureJson,
    nx: i32,
    ny: i32,
    nz: i32,
) -> PyResult<Py<PyDict>> {
    if nx <= 0 || ny <= 0 || nz <= 0 {
        return Err(PyValueError::new_err(format!(
            "make_supercell_diag: scaling factors must be positive, got [{nx}, {ny}, {nz}]"
        )));
    }
    let supercell = parse_struct(&structure)?.make_supercell_diag([nx, ny, nz]);
    Ok(structure_to_pydict(py, &supercell)?.unbind())
}

/// Get a structure with reduced lattice (Niggli or LLL).
///
/// Atomic positions are preserved in Cartesian space; only the lattice
/// basis changes. Fractional coordinates are wrapped to [0, 1).
///
/// Args:
///     structure (str): Structure as JSON string (from Structure.as_dict())
///     algo (str): Reduction algorithm - "niggli" or "lll"
///
/// Returns:
///     dict: Reduced structure as a Python dict compatible with pymatgen
///
/// Example:
///     >>> from ferrox import get_reduced_structure
///     >>> import json
///     >>> reduced_dict = get_reduced_structure(json.dumps(s.as_dict()), "niggli")
///     >>> reduced = Structure.from_dict(reduced_dict)
#[pyfunction]
fn get_reduced_structure(
    py: Python<'_>,
    structure: StructureJson,
    algo: &str,
) -> PyResult<Py<PyDict>> {
    let reduced = parse_struct(&structure)?
        .get_reduced_structure(parse_reduction_algo(algo)?)
        .map_err(|e| PyValueError::new_err(format!("Error reducing structure: {e}")))?;
    Ok(structure_to_pydict(py, &reduced)?.unbind())
}

/// Get a structure with reduced lattice using custom parameters.
///
/// Args:
///     structure (str): Structure as JSON string (from Structure.as_dict())
///     algo (str): Reduction algorithm - "niggli" or "lll"
///     niggli_tol (float): Tolerance for Niggli reduction (default: 1e-5, ignored for LLL)
///     lll_delta (float): Delta parameter for LLL reduction (default: 0.75, ignored for Niggli)
///
/// Returns:
///     dict: Reduced structure as a Python dict compatible with pymatgen
#[pyfunction]
#[pyo3(signature = (structure, algo, niggli_tol = 1e-5, lll_delta = 0.75))]
fn get_reduced_structure_with_params(
    py: Python<'_>,
    structure: StructureJson,
    algo: &str,
    niggli_tol: f64,
    lll_delta: f64,
) -> PyResult<Py<PyDict>> {
    let reduced = parse_struct(&structure)?
        .get_reduced_structure_with_params(parse_reduction_algo(algo)?, niggli_tol, lll_delta)
        .map_err(|e| PyValueError::new_err(format!("Error reducing structure: {e}")))?;
    Ok(structure_to_pydict(py, &reduced)?.unbind())
}

// === Lattice Property Functions ===

/// Get the metric tensor G = A * A^T of the lattice.
///
/// The metric tensor is fundamental for crystallographic calculations,
/// relating fractional and Cartesian coordinates.
///
/// Args:
///     structure (dict): Structure as a Python dict (from Structure.as_dict())
///
/// Returns:
///     list[list[float]]: 3x3 metric tensor matrix
#[pyfunction]
fn get_lattice_metric_tensor(structure: StructureJson) -> PyResult<[[f64; 3]; 3]> {
    let struc = parse_struct(&structure)?;
    let g = struc.lattice.metric_tensor();
    Ok([
        [g[(0, 0)], g[(0, 1)], g[(0, 2)]],
        [g[(1, 0)], g[(1, 1)], g[(1, 2)]],
        [g[(2, 0)], g[(2, 1)], g[(2, 2)]],
    ])
}

/// Get the inverse of the lattice matrix.
///
/// Useful for coordinate transformations between Cartesian and fractional.
///
/// Args:
///     structure (dict): Structure as a Python dict (from Structure.as_dict())
///
/// Returns:
///     list[list[float]]: 3x3 inverse lattice matrix
#[pyfunction]
fn get_lattice_inv_matrix(structure: StructureJson) -> PyResult<[[f64; 3]; 3]> {
    let struc = parse_struct(&structure)?;
    let inv = struc.lattice.inv_matrix();
    Ok([
        [inv[(0, 0)], inv[(0, 1)], inv[(0, 2)]],
        [inv[(1, 0)], inv[(1, 1)], inv[(1, 2)]],
        [inv[(2, 0)], inv[(2, 1)], inv[(2, 2)]],
    ])
}

/// Get the reciprocal lattice.
///
/// Returns the reciprocal lattice matrix (2π convention) as lattice vectors.
///
/// Args:
///     structure (dict): Structure as a Python dict (from Structure.as_dict())
///
/// Returns:
///     list[list[float]]: 3x3 reciprocal lattice matrix
#[pyfunction]
fn get_reciprocal_lattice(structure: StructureJson) -> PyResult<[[f64; 3]; 3]> {
    let struc = parse_struct(&structure)?;
    let recip = struc.lattice.reciprocal();
    let m = recip.matrix();
    Ok([
        [m[(0, 0)], m[(0, 1)], m[(0, 2)]],
        [m[(1, 0)], m[(1, 1)], m[(1, 2)]],
        [m[(2, 0)], m[(2, 1)], m[(2, 2)]],
    ])
}

/// Get the LLL-reduced lattice matrix.
///
/// The Lenstra-Lenstra-Lovász (LLL) algorithm produces a basis with
/// nearly orthogonal vectors, useful for PBC calculations.
///
/// Args:
///     structure (dict): Structure as a Python dict (from Structure.as_dict())
///
/// Returns:
///     list[list[float]]: 3x3 LLL-reduced lattice matrix
#[pyfunction]
fn get_lll_reduced_lattice(structure: StructureJson) -> PyResult<[[f64; 3]; 3]> {
    let struc = parse_struct(&structure)?;
    let lll = struc.lattice.lll_matrix();
    Ok([
        [lll[(0, 0)], lll[(0, 1)], lll[(0, 2)]],
        [lll[(1, 0)], lll[(1, 1)], lll[(1, 2)]],
        [lll[(2, 0)], lll[(2, 1)], lll[(2, 2)]],
    ])
}

/// Get the transformation matrix to LLL-reduced basis.
///
/// The mapping M transforms original fractional coords to LLL coords:
/// frac_lll = M^(-1) @ frac_orig
///
/// Args:
///     structure (dict): Structure as a Python dict (from Structure.as_dict())
///
/// Returns:
///     list[list[float]]: 3x3 LLL transformation matrix
#[pyfunction]
fn get_lll_mapping(structure: StructureJson) -> PyResult<[[f64; 3]; 3]> {
    let struc = parse_struct(&structure)?;
    let mapping = struc.lattice.lll_mapping();
    Ok([
        [mapping[(0, 0)], mapping[(0, 1)], mapping[(0, 2)]],
        [mapping[(1, 0)], mapping[(1, 1)], mapping[(1, 2)]],
        [mapping[(2, 0)], mapping[(2, 1)], mapping[(2, 2)]],
    ])
}

// === Neighbor Finding Functions ===

/// Get neighbor list for a structure.
///
/// Finds all atom pairs within cutoff radius using periodic boundary conditions.
///
/// Args:
///     structure (str): Structure as JSON string (from Structure.as_dict())
///     r (float): Cutoff radius in Angstroms
///     numerical_tol (float): Tolerance for distance comparisons (typically 1e-8)
///     exclude_self (bool): If True, exclude self-pairs (distance ~0)
///
/// Returns:
///     tuple[list[int], list[int], list[list[int]], list[float]]: (center_indices, neighbor_indices, image_offsets, distances)
#[pyfunction]
#[pyo3(signature = (structure, r, numerical_tol = 1e-8, exclude_self = true))]
fn get_neighbor_list(
    structure: StructureJson,
    r: f64,
    numerical_tol: f64,
    exclude_self: bool,
) -> PyResult<(Vec<usize>, Vec<usize>, Vec<[i32; 3]>, Vec<f64>)> {
    if r < 0.0 {
        return Err(PyValueError::new_err("Cutoff radius must be non-negative"));
    }
    Ok(parse_struct(&structure)?.get_neighbor_list(r, numerical_tol, exclude_self))
}

/// Get distance between two sites using minimum image convention.
///
/// Args:
///     structure (str): Structure as JSON string
///     i (int): First site index
///     j (int): Second site index
///
/// Returns:
///     float: Distance in Angstroms
#[pyfunction]
fn get_distance(structure: StructureJson, i: usize, j: usize) -> PyResult<f64> {
    let s = parse_struct(&structure)?;
    let n = s.num_sites();
    if i >= n || j >= n {
        return Err(pyo3::exceptions::PyIndexError::new_err(format!(
            "Site index out of bounds: i={i}, j={j}, num_sites={n}"
        )));
    }
    Ok(s.get_distance(i, j))
}

/// Get the full distance matrix between all sites.
///
/// Args:
///     structure (str): Structure as JSON string
///
/// Returns:
///     list[list[float]]: n x n distance matrix where n = num_sites
#[pyfunction]
fn distance_matrix(structure: StructureJson) -> PyResult<Vec<Vec<f64>>> {
    Ok(parse_struct(&structure)?.distance_matrix())
}

/// Get distance and periodic image between two sites.
///
/// Args:
///     structure (str): Structure as JSON string
///     i (int): First site index
///     j (int): Second site index
///
/// Returns:
///     tuple[float, list[int]]: (distance, [da, db, dc]) where the image tells
///     which periodic image of site j is closest to site i.
#[pyfunction]
fn get_distance_and_image(
    structure: StructureJson,
    i: usize,
    j: usize,
) -> PyResult<(f64, [i32; 3])> {
    let parsed = parse_struct(&structure)?;
    check_site_bounds(parsed.num_sites(), &[i, j])?;
    Ok(parsed.get_distance_and_image(i, j))
}

/// Get distance to a specific periodic image of site j.
///
/// Args:
///     structure (str): Structure as JSON string
///     i (int): First site index
///     j (int): Second site index
///     jimage (list[int]): Lattice translation [da, db, dc]
///
/// Returns:
///     float: Distance to the specified periodic image
#[pyfunction]
fn get_distance_with_image(
    structure: StructureJson,
    i: usize,
    j: usize,
    jimage: [i32; 3],
) -> PyResult<f64> {
    let parsed = parse_struct(&structure)?;
    check_site_bounds(parsed.num_sites(), &[i, j])?;
    Ok(parsed.get_distance_with_image(i, j, jimage))
}

/// Get Cartesian distance from a site to an arbitrary point.
///
/// This is a simple Euclidean distance, not using periodic boundary conditions.
///
/// Args:
///     structure (str): Structure as JSON string
///     idx (int): Site index
///     point (list[float]): Cartesian coordinates [x, y, z]
///
/// Returns:
///     float: Distance in Angstroms
#[pyfunction]
fn distance_from_point(structure: StructureJson, idx: usize, point: [f64; 3]) -> PyResult<f64> {
    let parsed = parse_struct(&structure)?;
    check_site_bounds(parsed.num_sites(), &[idx])?;
    Ok(parsed.distance_from_point(idx, point.into()))
}

/// Check if two sites are periodic images of each other.
///
/// Sites are periodic images if they have the same species and their fractional
/// coordinates differ by integers (within tolerance).
///
/// Args:
///     structure (str): Structure as JSON string
///     i (int): First site index
///     j (int): Second site index
///     tolerance (float): Tolerance for coordinate comparison (default: 1e-8)
///
/// Returns:
///     bool: True if sites are periodic images
#[pyfunction]
#[pyo3(signature = (structure, i, j, tolerance = 1e-8))]
fn is_periodic_image(
    structure: StructureJson,
    i: usize,
    j: usize,
    tolerance: f64,
) -> PyResult<bool> {
    if tolerance < 0.0 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "tolerance must be non-negative",
        ));
    }
    let parsed = parse_struct(&structure)?;
    check_site_bounds(parsed.num_sites(), &[i, j])?;
    Ok(parsed.is_periodic_image(i, j, tolerance))
}

/// Get label for a specific site.
///
/// Returns the explicit label if set, otherwise the species string.
///
/// Args:
///     structure (str): Structure as JSON string
///     idx (int): Site index
///
/// Returns:
///     str: Site label
#[pyfunction]
fn site_label(structure: StructureJson, idx: usize) -> PyResult<String> {
    let parsed = parse_struct(&structure)?;
    check_site_bounds(parsed.num_sites(), &[idx])?;
    Ok(parsed.site_label(idx))
}

/// Get labels for all sites.
///
/// Args:
///     structure (str): Structure as JSON string
///
/// Returns:
///     list[str]: Site labels
#[pyfunction]
fn site_labels(structure: StructureJson) -> PyResult<Vec<String>> {
    Ok(parse_struct(&structure)?.site_labels())
}

/// Get species strings for all sites.
///
/// For ordered sites: "Fe" or "Fe2+". For disordered: "Co:0.500, Fe:0.500".
///
/// Args:
///     structure (str): Structure as JSON string
///
/// Returns:
///     list[str]: Species strings
#[pyfunction]
fn species_strings(structure: StructureJson) -> PyResult<Vec<String>> {
    Ok(parse_struct(&structure)?.species_strings())
}

// === Structure Interpolation Functions ===

/// Interpolate between two structures for NEB calculations.
///
/// Generates n_images + 1 structures from start to end with linearly
/// interpolated coordinates.
///
/// Args:
///     struct1 (str): Start structure as JSON string
///     struct2 (str): End structure as JSON string
///     n_images (int): Number of intermediate images (total returned = n_images + 1)
///     interpolate_lattices (bool): If True, also interpolate lattice parameters
///     use_pbc (bool): If True, use minimum image convention for interpolation
///
/// Returns:
///     list[dict]: List of structure dicts from start to end
#[pyfunction]
#[pyo3(signature = (struct1, struct2, n_images, interpolate_lattices = false, use_pbc = true))]
fn interpolate(
    py: Python<'_>,
    struct1: StructureJson,
    struct2: StructureJson,
    n_images: usize,
    interpolate_lattices: bool,
    use_pbc: bool,
) -> PyResult<Vec<Py<PyDict>>> {
    let (s1, s2) = parse_structure_pair(&struct1, &struct2)?;
    let images = s1
        .interpolate(&s2, n_images, interpolate_lattices, use_pbc)
        .map_err(|e| PyValueError::new_err(format!("Interpolation error: {e}")))?;
    images
        .iter()
        .map(|s| Ok(structure_to_pydict(py, s)?.unbind()))
        .collect()
}

// === Structure Matching Convenience Functions ===

/// Check if two structures match using default matcher settings.
///
/// This is a convenience wrapper around StructureMatcher.fit() that uses
/// sensible defaults. For more control, create a StructureMatcher instance.
///
/// Args:
///     struct1 (str): First structure as JSON string
///     struct2 (str): Second structure as JSON string
///     anonymous (bool): If True, allows any species permutation (prototype matching)
///
/// Returns:
///     bool: True if structures match, False otherwise
///
/// Example:
///     >>> from ferrox import matches
///     >>> import json
///     >>> nacl = Structure(...)
///     >>> mgo = Structure(...)
///     >>> # Check if same structure
///     >>> matches(json.dumps(nacl.as_dict()), json.dumps(nacl.as_dict()), anonymous=False)
///     True
///     >>> # Check if same prototype (rocksalt)
///     >>> matches(json.dumps(nacl.as_dict()), json.dumps(mgo.as_dict()), anonymous=True)
///     True
#[pyfunction]
#[pyo3(signature = (struct1, struct2, anonymous = false))]
fn matches(struct1: StructureJson, struct2: StructureJson, anonymous: bool) -> PyResult<bool> {
    let (s1, s2) = parse_structure_pair(&struct1, &struct2)?;
    Ok(s1.matches(&s2, anonymous))
}

// === Structure Sorting Functions ===

/// Get a sorted copy of the structure by atomic number.
///
/// Args:
///     structure (str): Structure as JSON string
///     reverse (bool): If True, sort in descending order (default False)
///
/// Returns:
///     dict: Sorted structure as pymatgen-compatible dict
#[pyfunction]
#[pyo3(signature = (structure, reverse = false))]
fn get_sorted_structure(
    py: Python<'_>,
    structure: StructureJson,
    reverse: bool,
) -> PyResult<Py<PyDict>> {
    let sorted = parse_struct(&structure)?.get_sorted_structure(reverse);
    Ok(structure_to_pydict(py, &sorted)?.unbind())
}

/// Get a sorted copy of the structure by electronegativity.
///
/// Args:
///     structure (str): Structure as JSON string
///     reverse (bool): If True, sort in descending order (default False)
///
/// Returns:
///     dict: Sorted structure as pymatgen-compatible dict
#[pyfunction]
#[pyo3(signature = (structure, reverse = false))]
fn get_sorted_by_electronegativity(
    py: Python<'_>,
    structure: StructureJson,
    reverse: bool,
) -> PyResult<Py<PyDict>> {
    let sorted = parse_struct(&structure)?.get_sorted_by_electronegativity(reverse);
    Ok(structure_to_pydict(py, &sorted)?.unbind())
}

// === Structure Copy/Sanitization Functions ===

/// Create a copy of the structure, optionally sanitized.
///
/// Sanitization applies:
/// 1. LLL lattice reduction
/// 2. Sort sites by electronegativity
/// 3. Wrap fractional coords to [0, 1)
///
/// Args:
///     structure (str): Structure as JSON string
///     sanitize (bool): If True, apply sanitization steps (default False)
///
/// Returns:
///     dict: Copy of structure as pymatgen-compatible dict
#[pyfunction]
#[pyo3(signature = (structure, sanitize = false))]
fn copy_structure(
    py: Python<'_>,
    structure: StructureJson,
    sanitize: bool,
) -> PyResult<Py<PyDict>> {
    let copied = parse_struct(&structure)?.copy(sanitize);
    Ok(structure_to_pydict(py, &copied)?.unbind())
}

/// Wrap all fractional coordinates to [0, 1).
///
/// Args:
///     structure (str): Structure as JSON string
///
/// Returns:
///     dict: Structure with wrapped coordinates as pymatgen-compatible dict
#[pyfunction]
fn wrap_to_unit_cell(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyDict>> {
    let mut s = parse_struct(&structure)?;
    s.wrap_to_unit_cell();
    Ok(structure_to_pydict(py, &s)?.unbind())
}

// === Symmetry Operation Functions ===

/// Apply a symmetry operation to a structure.
///
/// A symmetry operation consists of a 3x3 rotation matrix and a translation vector.
/// The transformation is: new = rotation * old + translation
///
/// Args:
///     structure (str): Structure as JSON string
///     rotation (list[list[float]]): 3x3 rotation matrix as [[r11,r12,r13],[r21,r22,r23],[r31,r32,r33]]
///     translation (list[float]): Translation vector as [t1, t2, t3]
///     fractional (bool): If True, operation is in fractional coords; else Cartesian
///
/// Returns:
///     dict: Transformed structure as pymatgen-compatible dict
///
/// Example:
///     >>> from ferrox import apply_operation
///     >>> import json
///     >>> # Inversion operation: rotation = -I, translation = [0,0,0]
///     >>> inverted = apply_operation(json.dumps(s.as_dict()),
///     ...     [[-1,0,0],[0,-1,0],[0,0,-1]], [0,0,0], fractional=True)
#[pyfunction]
#[pyo3(signature = (structure, rotation, translation, fractional = true))]
fn apply_operation(
    py: Python<'_>,
    structure: StructureJson,
    rotation: [[f64; 3]; 3],
    translation: [f64; 3],
    fractional: bool,
) -> PyResult<Py<PyDict>> {
    let mut s = parse_struct(&structure)?;
    let rot = Matrix3::from_row_slice(&rotation.concat());
    let op = SymmOp::new(rot, Vector3::from(translation));
    s.apply_operation(&op, fractional);
    Ok(structure_to_pydict(py, &s)?.unbind())
}

/// Apply inversion through the origin.
///
/// Args:
///     structure (str): Structure as JSON string
///     fractional (bool): If True, operation is in fractional coords; else Cartesian
///
/// Returns:
///     dict: Inverted structure as pymatgen-compatible dict
#[pyfunction]
#[pyo3(signature = (structure, fractional = true))]
fn apply_inversion(
    py: Python<'_>,
    structure: StructureJson,
    fractional: bool,
) -> PyResult<Py<PyDict>> {
    let mut s = parse_struct(&structure)?;
    s.apply_operation(&SymmOp::inversion(), fractional);
    Ok(structure_to_pydict(py, &s)?.unbind())
}

/// Apply a translation to all sites.
///
/// Args:
///     structure (str): Structure as JSON string
///     translation (list[float]): Translation vector as [t1, t2, t3]
///     fractional (bool): If True, translation is in fractional coords; else Cartesian (Angstroms)
///
/// Returns:
///     dict: Translated structure as pymatgen-compatible dict
#[pyfunction]
#[pyo3(signature = (structure, translation, fractional = true))]
fn apply_translation(
    py: Python<'_>,
    structure: StructureJson,
    translation: [f64; 3],
    fractional: bool,
) -> PyResult<Py<PyDict>> {
    let mut s = parse_struct(&structure)?;
    s.apply_operation(&SymmOp::translation(Vector3::from(translation)), fractional);
    Ok(structure_to_pydict(py, &s)?.unbind())
}

// === Structure Properties Functions ===

/// Get all queryable metadata from a structure in a single call.
///
/// This is more efficient than calling individual functions when you need
/// multiple properties, as it only parses the structure once.
///
/// Args:
///     structure (str): Structure as JSON string
///     compute_spacegroup (bool): Whether to compute spacegroup (expensive). Default: False.
///     symprec (float): Symmetry precision for spacegroup detection. Default: 0.01.
///
/// Returns:
///     dict: Metadata dictionary with keys:
///         - formula: reduced formula (e.g., "Fe2O3")
///         - formula_anonymous: anonymous formula (e.g., "A2B3")
///         - formula_hill: Hill notation formula
///         - chemical_system: element system (e.g., "Fe-O")
///         - elements: sorted list of unique element symbols
///         - n_elements: number of unique elements
///         - n_sites: number of sites
///         - volume: unit cell volume in Angstrom^3
///         - density: density in g/cm^3 (or None if volume is zero)
///         - mass: total mass in atomic mass units
///         - is_ordered: whether all sites have single species
///         - spacegroup_number: (optional) spacegroup number if compute_spacegroup=True
#[pyfunction]
#[pyo3(signature = (structure, compute_spacegroup = false, symprec = 0.01))]
fn get_structure_metadata(
    py: Python<'_>,
    structure: StructureJson,
    compute_spacegroup: bool,
    symprec: f64,
) -> PyResult<Py<PyDict>> {
    let s = parse_struct(&structure)?;
    let comp = s.composition();
    let dict = PyDict::new(py);

    // Composition-derived properties
    dict.set_item("formula", comp.reduced_formula())?;
    dict.set_item("formula_anonymous", comp.anonymous_formula())?;
    dict.set_item("formula_hill", comp.hill_formula())?;
    dict.set_item("chemical_system", comp.chemical_system())?;

    // Element list (sorted)
    let mut elements: Vec<&str> = s.unique_elements().iter().map(|e| e.symbol()).collect();
    elements.sort();
    dict.set_item("elements", elements)?;
    dict.set_item("n_elements", comp.num_elements())?;

    // Structure properties
    dict.set_item("n_sites", s.num_sites())?;
    dict.set_item("volume", s.volume())?;
    dict.set_item("density", s.density())?;
    dict.set_item("mass", s.total_mass())?;
    dict.set_item("is_ordered", s.is_ordered())?;

    // Spacegroup (expensive, optional)
    if compute_spacegroup {
        match s.get_spacegroup_number(symprec) {
            Ok(sg) => dict.set_item("spacegroup_number", sg)?,
            Err(_) => dict.set_item("spacegroup_number", py.None())?,
        }
    }

    Ok(dict.unbind())
}

// === Symmetry Analysis Functions ===

/// Get the spacegroup number of a structure.
///
/// Args:
///     structure (str): Structure as JSON string
///     symprec (float): Symmetry precision (default: 0.01)
///
/// Returns:
///     int: Spacegroup number (1-230)
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_spacegroup_number(structure: StructureJson, symprec: f64) -> PyResult<i32> {
    parse_struct(&structure)?
        .get_spacegroup_number(symprec)
        .map_err(|e| PyValueError::new_err(format!("Symmetry analysis failed: {e}")))
}

/// Get the Hermann-Mauguin spacegroup symbol (e.g., "Fm-3m", "P2_1/c").
///
/// Args:
///     structure (str): Structure as JSON string
///     symprec (float): Symmetry precision (default: 0.01)
///
/// Returns:
///     str: Hermann-Mauguin symbol
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_spacegroup_symbol(structure: StructureJson, symprec: f64) -> PyResult<String> {
    parse_struct(&structure)?
        .get_spacegroup_symbol(symprec)
        .map_err(|e| PyValueError::new_err(format!("Symmetry analysis failed: {e}")))
}

/// Get the Hall number (1-530) identifying the specific spacegroup setting.
///
/// Args:
///     structure (str): Structure as JSON string
///     symprec (float): Symmetry precision (default: 0.01)
///
/// Returns:
///     int: Hall number
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_hall_number(structure: StructureJson, symprec: f64) -> PyResult<i32> {
    parse_struct(&structure)?
        .get_hall_number(symprec)
        .map_err(|e| PyValueError::new_err(format!("Symmetry analysis failed: {e}")))
}

/// Get the Pearson symbol (e.g., "cF8" for FCC Cu).
///
/// The Pearson symbol encodes the crystal system, centering type, and
/// number of atoms in the conventional cell.
///
/// Args:
///     structure (str): Structure as JSON string
///     symprec (float): Symmetry precision (default: 0.01)
///
/// Returns:
///     str: Pearson symbol
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_pearson_symbol(structure: StructureJson, symprec: f64) -> PyResult<String> {
    parse_struct(&structure)?
        .get_pearson_symbol(symprec)
        .map_err(|e| PyValueError::new_err(format!("Symmetry analysis failed: {e}")))
}

/// Get Wyckoff letters for each site in the structure.
///
/// Wyckoff positions describe the site symmetry and multiplicity of each
/// atomic position. Sites with the same letter have equivalent positions
/// under the space group symmetry.
///
/// Args:
///     structure (str): Structure as JSON string
///     symprec (float): Symmetry precision (default: 0.01)
///
/// Returns:
///     list[str]: Wyckoff letters for each site (single-character strings)
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_wyckoff_letters(structure: StructureJson, symprec: f64) -> PyResult<Vec<String>> {
    let letters = parse_struct(&structure)?
        .get_wyckoff_letters(symprec)
        .map_err(|e| PyValueError::new_err(format!("Symmetry analysis failed: {e}")))?;
    // Convert chars to strings for Python compatibility
    Ok(letters.into_iter().map(|c| c.to_string()).collect())
}

/// Get site symmetry symbols for each site (e.g., "m..", "-1", "4mm").
///
/// The site symmetry describes the point group symmetry at each atomic site,
/// oriented with respect to the standardized cell.
///
/// Args:
///     structure (str): Structure as JSON string
///     symprec (float): Symmetry precision (default: 0.01)
///
/// Returns:
///     list[str]: Site symmetry symbols for each site
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_site_symmetry_symbols(structure: StructureJson, symprec: f64) -> PyResult<Vec<String>> {
    parse_struct(&structure)?
        .get_site_symmetry_symbols(symprec)
        .map_err(|e| PyValueError::new_err(format!("Symmetry analysis failed: {e}")))
}

/// Get symmetry operations in the input cell.
///
/// Returns a list of symmetry operations, each consisting of a 3x3 rotation
/// matrix (integer, in fractional coordinates) and a translation vector
/// (float, in fractional coordinates).
///
/// A symmetry operation transforms a point r to: R @ r + t
///
/// Args:
///     structure (str): Structure as JSON string
///     symprec (float): Symmetry precision (default: 0.01)
///
/// Returns:
///     list[tuple[list[list[int]], list[float]]]: List of (rotation, translation) pairs
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_symmetry_operations(
    structure: StructureJson,
    symprec: f64,
) -> PyResult<Vec<SymmetryOperation>> {
    parse_struct(&structure)?
        .get_symmetry_operations(symprec)
        .map_err(|e| PyValueError::new_err(format!("Symmetry analysis failed: {e}")))
}

/// Get equivalent sites (crystallographic orbits).
///
/// Returns a list where orbits[i] is the index of the representative site
/// that site i is equivalent to. Sites with the same orbit index are
/// related by space group symmetry.
///
/// For example, orbits=[0, 0, 2, 2, 2, 2] means sites 0-1 are equivalent
/// to site 0, and sites 2-5 are equivalent to site 2.
///
/// Args:
///     structure (str): Structure as JSON string
///     symprec (float): Symmetry precision (default: 0.01)
///
/// Returns:
///     list[int]: Orbit indices for each site
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_equivalent_sites(structure: StructureJson, symprec: f64) -> PyResult<Vec<usize>> {
    parse_struct(&structure)?
        .get_equivalent_sites(symprec)
        .map_err(|e| PyValueError::new_err(format!("Symmetry analysis failed: {e}")))
}

/// Get the crystal system based on the spacegroup.
///
/// Returns one of: "triclinic", "monoclinic", "orthorhombic",
/// "tetragonal", "trigonal", "hexagonal", "cubic".
///
/// Args:
///     structure (str): Structure as JSON string
///     symprec (float): Symmetry precision (default: 0.01)
///
/// Returns:
///     str: Crystal system name
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_crystal_system(structure: StructureJson, symprec: f64) -> PyResult<String> {
    parse_struct(&structure)?
        .get_crystal_system(symprec)
        .map_err(|e| PyValueError::new_err(format!("Symmetry analysis failed: {e}")))
}

/// Get full symmetry dataset for a structure.
///
/// This is more efficient when you need multiple symmetry properties,
/// as it only runs the symmetry analysis once.
///
/// Args:
///     structure (str): Structure as JSON string
///     symprec (float): Symmetry precision (default: 0.01)
///
/// Returns:
///     dict: Dictionary with keys:
///         - spacegroup_number: int (1-230)
///         - spacegroup_symbol: str (Hermann-Mauguin symbol)
///         - hall_number: int (1-530)
///         - pearson_symbol: str
///         - crystal_system: str
///         - wyckoff_letters: list[str]
///         - site_symmetry_symbols: list[str]
///         - equivalent_sites: list[int]
///         - symmetry_operations: list[tuple[list[list[int]], list[float]]]
///         - num_operations: int
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_symmetry_dataset(
    py: Python<'_>,
    structure: StructureJson,
    symprec: f64,
) -> PyResult<Py<PyDict>> {
    let dataset = parse_struct(&structure)?
        .get_symmetry_dataset(symprec)
        .map_err(|e| PyValueError::new_err(format!("Symmetry analysis failed: {e}")))?;

    let dict = PyDict::new(py);
    dict.set_item("spacegroup_number", dataset.number)?;
    dict.set_item("spacegroup_symbol", &dataset.hm_symbol)?;
    dict.set_item("hall_number", dataset.hall_number)?;
    dict.set_item("pearson_symbol", &dataset.pearson_symbol)?;
    dict.set_item(
        "crystal_system",
        spacegroup_to_crystal_system(dataset.number),
    )?;

    let wyckoffs: Vec<String> = dataset.wyckoffs.iter().map(|c| c.to_string()).collect();
    dict.set_item("wyckoff_letters", wyckoffs)?;
    dict.set_item("site_symmetry_symbols", &dataset.site_symmetry_symbols)?;
    dict.set_item("equivalent_sites", &dataset.orbits)?;
    dict.set_item(
        "symmetry_operations",
        moyo_ops_to_arrays(&dataset.operations),
    )?;
    dict.set_item("num_operations", dataset.operations.len())?;

    Ok(dict.unbind())
}

// === Site Manipulation Functions ===

/// Translate specific sites by a vector.
///
/// Args:
///     structure (str): Structure as JSON string
///     indices (list[int]): Site indices to translate
///     vector (list[float]): Translation vector as [x, y, z]
///     fractional (bool): If True, vector is in fractional coords; else Cartesian (Angstroms)
///
/// Returns:
///     dict: Structure with translated sites as pymatgen-compatible dict
#[pyfunction]
#[pyo3(signature = (structure, indices, vector, fractional = true))]
fn translate_sites(
    py: Python<'_>,
    structure: StructureJson,
    indices: Vec<usize>,
    vector: [f64; 3],
    fractional: bool,
) -> PyResult<Py<PyDict>> {
    let mut s = parse_struct(&structure)?;
    let n = s.num_sites();
    if let Some(&idx) = indices.iter().find(|&&i| i >= n) {
        return Err(pyo3::exceptions::PyIndexError::new_err(format!(
            "Site index {idx} out of bounds (num_sites={n})"
        )));
    }
    s.translate_sites(&indices, Vector3::from(vector), fractional);
    Ok(structure_to_pydict(py, &s)?.unbind())
}

/// Perturb all sites by random vectors.
///
/// Each site is translated by a random vector with magnitude uniformly
/// distributed in [min_distance, distance].
///
/// Args:
///     structure (str): Structure as JSON string
///     distance (float): Maximum perturbation distance in Angstroms
///     min_distance (float | None): Minimum perturbation distance (default: 0)
///     seed (int | None): Random seed for reproducibility
///
/// Returns:
///     dict: Perturbed structure as pymatgen-compatible dict
#[pyfunction]
#[pyo3(signature = (structure, distance, min_distance = None, seed = None))]
fn perturb(
    py: Python<'_>,
    structure: StructureJson,
    distance: f64,
    min_distance: Option<f64>,
    seed: Option<u64>,
) -> PyResult<Py<PyDict>> {
    if distance < 0.0 {
        return Err(PyValueError::new_err("distance must be non-negative"));
    }
    if let Some(min_dist) = min_distance {
        if min_dist < 0.0 {
            return Err(PyValueError::new_err("min_distance must be non-negative"));
        }
        if min_dist > distance {
            return Err(PyValueError::new_err("min_distance must be <= distance"));
        }
    }
    let mut s = parse_struct(&structure)?;
    s.perturb(distance, min_distance, seed);
    Ok(structure_to_pydict(py, &s)?.unbind())
}

// === Normalization and Site Properties ===

/// Normalize an element symbol string.
///
/// Parses various element symbol formats and extracts:
/// - The base element
/// - Oxidation state (if present, e.g., "Fe2+")
/// - Metadata (POTCAR suffix, labels, etc.)
///
/// Args:
///     symbol: Element symbol string (e.g., "Fe", "Fe2+", "Ca_pv", "Fe1_oct")
///
/// Returns:
///     dict with keys: element (str), oxidation_state (int or None), metadata (dict)
#[pyfunction]
fn normalize_element_symbol(py: Python<'_>, symbol: &str) -> PyResult<Py<PyDict>> {
    use crate::element::normalize_symbol;

    let normalized = normalize_symbol(symbol)
        .map_err(|e| PyValueError::new_err(format!("Invalid symbol '{}': {}", symbol, e)))?;

    let dict = PyDict::new(py);
    dict.set_item("element", normalized.element.symbol())?;
    dict.set_item(
        "oxidation_state",
        normalized.oxidation_state.map(|o| o as i32),
    )?;

    // Convert metadata HashMap to Python dict
    let metadata = PyDict::new(py);
    for (key, val) in normalized.metadata {
        // Convert serde_json::Value to Python
        let py_val = json_to_py(py, &val)?;
        metadata.set_item(key, py_val)?;
    }
    dict.set_item("metadata", metadata)?;

    Ok(dict.unbind())
}

/// Convert a HashMap of JSON values to a Python dict.
fn props_to_pydict<'py>(
    py: Python<'py>,
    props: &HashMap<String, serde_json::Value>,
) -> PyResult<Bound<'py, PyDict>> {
    let dict = PyDict::new(py);
    for (key, val) in props {
        dict.set_item(key, json_to_py(py, val)?)?;
    }
    Ok(dict)
}

/// Get site properties for a specific site.
///
/// Args:
///     structure: Structure as JSON string
///     idx: Site index
///
/// Returns:
///     dict: Site properties as a Python dict
#[pyfunction]
fn get_site_properties(
    py: Python<'_>,
    structure: StructureJson,
    idx: usize,
) -> PyResult<Py<PyDict>> {
    let s = parse_struct(&structure)?;
    if idx >= s.num_sites() {
        return Err(pyo3::exceptions::PyIndexError::new_err(format!(
            "Site index {idx} out of bounds for structure with {} sites",
            s.num_sites()
        )));
    }
    Ok(props_to_pydict(py, s.site_properties(idx))?.unbind())
}

/// Get all site properties for a structure.
///
/// Args:
///     structure: Structure as JSON string
///
/// Returns:
///     list[dict]: List of site property dicts (parallel to sites)
#[pyfunction]
fn get_all_site_properties(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyList>> {
    let s = parse_struct(&structure)?;
    let result: Vec<_> = (0..s.num_sites())
        .map(|idx| props_to_pydict(py, s.site_properties(idx)))
        .collect::<PyResult<_>>()?;
    Ok(PyList::new(py, result)?.unbind())
}

/// Set a site property.
///
/// Args:
///     structure: Structure as JSON string
///     idx: Site index
///     key: Property key
///     value: Property value (must be JSON-serializable)
///
/// Returns:
///     dict: Updated structure as pymatgen-compatible dict
#[pyfunction]
fn set_site_property(
    py: Python<'_>,
    structure: StructureJson,
    idx: usize,
    key: &str,
    value: Bound<'_, pyo3::PyAny>,
) -> PyResult<Py<PyDict>> {
    let mut s = parse_struct(&structure)?;
    if idx >= s.num_sites() {
        return Err(pyo3::exceptions::PyIndexError::new_err(format!(
            "Site index {idx} out of bounds for structure with {} sites",
            s.num_sites()
        )));
    }

    // Convert Python value to serde_json::Value
    let json_val = py_to_json_value(&value)?;
    s.set_site_property(idx, key, json_val);
    Ok(structure_to_pydict(py, &s)?.unbind())
}

/// Convert Python object to serde_json::Value.
#[allow(deprecated)] // downcast is deprecated but still functional
fn py_to_json_value(obj: &Bound<'_, pyo3::PyAny>) -> PyResult<serde_json::Value> {
    if obj.is_none() {
        Ok(serde_json::Value::Null)
    } else if let Ok(b) = obj.extract::<bool>() {
        Ok(serde_json::Value::Bool(b))
    } else if let Ok(i) = obj.extract::<i64>() {
        Ok(serde_json::json!(i))
    } else if let Ok(u) = obj.extract::<u64>() {
        // Handle large positive integers in range (2^63, 2^64) that don't fit in i64
        Ok(serde_json::json!(u))
    } else if let Ok(f) = obj.extract::<f64>() {
        Ok(serde_json::json!(f))
    } else if let Ok(s) = obj.extract::<String>() {
        Ok(serde_json::Value::String(s))
    } else if let Ok(list) = obj.downcast::<PyList>() {
        let arr: Vec<serde_json::Value> = list
            .iter()
            .map(|item| py_to_json_value(&item))
            .collect::<PyResult<_>>()?;
        Ok(serde_json::Value::Array(arr))
    } else if let Ok(dict) = obj.downcast::<PyDict>() {
        let mut map = serde_json::Map::new();
        for (k, v) in dict {
            let key: String = k.extract()?;
            map.insert(key, py_to_json_value(&v)?);
        }
        Ok(serde_json::Value::Object(map))
    } else {
        Err(PyValueError::new_err(format!(
            "Cannot convert Python object to JSON: {:?}",
            obj.get_type().name()
        )))
    }
}

// === Composition Functions ===

/// Parse a chemical formula and return composition data.
///
/// Args:
///     formula: Chemical formula string (e.g., "LiFePO4", "Ca3(PO4)2")
///
/// Returns:
///     dict with keys:
///         - species: dict mapping element symbols to amounts
///         - formula: full formula string
///         - reduced_formula: reduced formula string
///         - chemical_system: element system (e.g., "Fe-Li-O-P")
///         - num_atoms: total number of atoms
///         - weight: molecular weight in atomic mass units
#[pyfunction]
fn parse_composition(py: Python<'_>, formula: &str) -> PyResult<Py<PyDict>> {
    let comp = parse_comp(formula)?;
    let dict = PyDict::new(py);

    // Species dict
    let species_dict = PyDict::new(py);
    for (sp, amt) in comp.iter() {
        species_dict.set_item(sp.to_string(), *amt)?;
    }
    dict.set_item("species", species_dict)?;

    // Other properties
    dict.set_item("formula", comp.formula())?;
    dict.set_item("reduced_formula", comp.reduced_formula())?;
    dict.set_item("formula_anonymous", comp.anonymous_formula())?;
    dict.set_item("formula_hill", comp.hill_formula())?;
    dict.set_item("alphabetical_formula", comp.alphabetical_formula())?;
    dict.set_item("chemical_system", comp.chemical_system())?;
    dict.set_item("num_atoms", comp.num_atoms())?;
    dict.set_item("num_elements", comp.num_elements())?;
    dict.set_item("weight", comp.weight())?;
    dict.set_item("is_element", comp.is_element())?;

    if let Some(avg_en) = comp.average_electroneg() {
        dict.set_item("average_electroneg", avg_en)?;
    } else {
        dict.set_item("average_electroneg", py.None())?;
    }
    dict.set_item("total_electrons", comp.total_electrons())?;

    Ok(dict.unbind())
}

/// Get atomic fraction of an element in a composition.
///
/// Args:
///     formula: Chemical formula string
///     element: Element symbol (e.g., "Fe")
///
/// Returns:
///     Atomic fraction (0.0 to 1.0) or 0.0 if element not present.
#[pyfunction]
fn get_atomic_fraction(formula: &str, element: &str) -> PyResult<f64> {
    let comp = parse_comp(formula)?;
    let elem = Element::from_symbol(element)
        .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {element}")))?;
    Ok(comp.get_atomic_fraction(elem))
}

/// Get weight fraction of an element in a composition.
///
/// Args:
///     formula: Chemical formula string
///     element: Element symbol (e.g., "Fe")
///
/// Returns:
///     Weight fraction (0.0 to 1.0) or 0.0 if element not present.
#[pyfunction]
fn get_wt_fraction(formula: &str, element: &str) -> PyResult<f64> {
    let comp = parse_comp(formula)?;
    let elem = Element::from_symbol(element)
        .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {element}")))?;
    Ok(comp.get_wt_fraction(elem))
}

/// Get reduced composition as a dict.
///
/// Args:
///     formula: Chemical formula string
///
/// Returns:
///     dict mapping element symbols to amounts in reduced form.
#[pyfunction]
fn reduced_composition(py: Python<'_>, formula: &str) -> PyResult<Py<PyDict>> {
    let comp = parse_comp(formula)?.reduced_composition();
    let dict = PyDict::new(py);
    for (sp, amt) in comp.iter() {
        dict.set_item(sp.element.symbol(), *amt)?;
    }
    Ok(dict.unbind())
}

/// Get fractional composition (atomic fractions) as a dict.
///
/// Args:
///     formula: Chemical formula string
///
/// Returns:
///     dict mapping element symbols to atomic fractions (sum to 1.0).
#[pyfunction]
fn fractional_composition(py: Python<'_>, formula: &str) -> PyResult<Py<PyDict>> {
    let comp = parse_comp(formula)?.fractional_composition();
    let dict = PyDict::new(py);
    for (sp, amt) in comp.iter() {
        dict.set_item(sp.element.symbol(), *amt)?;
    }
    Ok(dict.unbind())
}

/// Check if a composition is charge balanced.
///
/// Args:
///     formula: Chemical formula string with oxidation states (e.g., "Na+Cl-", "Fe3+2O2-3")
///
/// Returns:
///     True if charge balanced, False if not, None if species lack oxidation states.
#[pyfunction]
fn is_charge_balanced(formula: &str) -> PyResult<Option<bool>> {
    let comp = parse_comp(formula)?;
    Ok(comp.is_charge_balanced())
}

/// Get the total charge of a composition.
///
/// Args:
///     formula: Chemical formula string with oxidation states
///
/// Returns:
///     Total charge as integer, or None if species lack oxidation states.
#[pyfunction]
fn composition_charge(formula: &str) -> PyResult<Option<i32>> {
    let comp = parse_comp(formula)?;
    Ok(comp.charge())
}

/// Check if two compositions are approximately equal.
///
/// Args:
///     formula1: First chemical formula
///     formula2: Second chemical formula
///     rtol: Relative tolerance (default 0.01, i.e. 1%)
///     atol: Absolute tolerance (default 1e-8)
///
/// Returns:
///     True if compositions are approximately equal.
#[pyfunction]
#[pyo3(signature = (formula1, formula2, rtol = 0.01, atol = 1e-8))]
fn compositions_almost_equal(
    formula1: &str,
    formula2: &str,
    rtol: f64,
    atol: f64,
) -> PyResult<bool> {
    let comp1 = parse_comp(formula1)?;
    let comp2 = parse_comp(formula2)?;
    Ok(comp1.almost_equals(&comp2, rtol, atol))
}

/// Get a hash of the reduced formula (ignores oxidation states).
///
/// Useful for grouping compositions by formula regardless of oxidation states.
///
/// Args:
///     formula (str): Chemical formula
///
/// Returns:
///     int: Hash value for the reduced formula
#[pyfunction]
fn formula_hash(formula: &str) -> PyResult<u64> {
    Ok(parse_comp(formula)?.formula_hash())
}

/// Get a hash of the composition including oxidation states.
///
/// Useful for exact matching of compositions.
///
/// Args:
///     formula (str): Chemical formula
///
/// Returns:
///     int: Hash value for the species composition
#[pyfunction]
fn species_hash(formula: &str) -> PyResult<u64> {
    Ok(parse_comp(formula)?.species_hash())
}

/// Remap elements in a composition according to a mapping.
///
/// Args:
///     formula (str): Chemical formula
///     mapping (dict): Element symbol -> new element symbol mapping
///
/// Returns:
///     dict: New composition with remapped elements
#[pyfunction]
fn remap_elements(
    py: Python<'_>,
    formula: &str,
    mapping: &Bound<'_, PyDict>,
) -> PyResult<Py<PyDict>> {
    use std::collections::HashMap;

    // Convert Python dict to HashMap<Element, Element>
    let mut elem_mapping = HashMap::new();
    for (key, value) in mapping.iter() {
        let from_sym: &str = key.extract()?;
        let to_sym: &str = value.extract()?;
        let from_elem = Element::from_symbol(from_sym)
            .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {from_sym}")))?;
        let to_elem = Element::from_symbol(to_sym)
            .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {to_sym}")))?;
        elem_mapping.insert(from_elem, to_elem);
    }

    let comp = parse_comp(formula)?;
    let remapped = comp.remap_elements(&elem_mapping);

    let dict = PyDict::new(py);
    for (sp, amt) in remapped.iter() {
        dict.set_item(sp.element.symbol(), amt)?;
    }
    Ok(dict.unbind())
}

/// Get the GCD reduction factor used in reduced_composition.
///
/// Args:
///     formula (str): Chemical formula
///
/// Returns:
///     float: The factor by which amounts were divided to get the reduced formula
#[pyfunction]
fn get_reduced_factor(formula: &str) -> PyResult<f64> {
    Ok(parse_comp(formula)?.get_reduced_factor())
}

// === Transformation Functions ===

/// Get the primitive cell of a structure.
///
/// Uses symmetry analysis to find the smallest unit cell that generates
/// the original structure through translational symmetry.
///
/// Args:
///     structure (str): Structure as JSON string
///     symprec (float): Symmetry precision for spacegroup detection
///
/// Returns:
///     dict: Primitive structure as pymatgen-compatible dict
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn to_primitive(py: Python<'_>, structure: StructureJson, symprec: f64) -> PyResult<Py<PyDict>> {
    let primitive = parse_struct(&structure)?
        .get_primitive(symprec)
        .map_err(|e| PyValueError::new_err(format!("Error getting primitive: {e}")))?;
    Ok(structure_to_pydict(py, &primitive)?.unbind())
}

/// Get the conventional cell of a structure.
///
/// Uses symmetry analysis to find the conventional unit cell based on
/// the spacegroup's standard setting.
///
/// Args:
///     structure (str): Structure as JSON string
///     symprec (float): Symmetry precision for spacegroup detection
///
/// Returns:
///     dict: Conventional structure as pymatgen-compatible dict
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn to_conventional(py: Python<'_>, structure: StructureJson, symprec: f64) -> PyResult<Py<PyDict>> {
    let conventional = parse_struct(&structure)?
        .get_conventional_structure(symprec)
        .map_err(|e| PyValueError::new_err(format!("Error getting conventional: {e}")))?;
    Ok(structure_to_pydict(py, &conventional)?.unbind())
}

/// Substitute species throughout a structure.
///
/// Args:
///     structure (str): Structure as JSON string
///     from_species (str): Species to replace (e.g., "Fe", "Fe2+")
///     to_species (str): Replacement species
///
/// Returns:
///     dict: Structure with substituted species
#[pyfunction]
fn substitute_species(
    py: Python<'_>,
    structure: StructureJson,
    from_species: &str,
    to_species: &str,
) -> PyResult<Py<PyDict>> {
    use crate::species::Species;

    let from_sp = Species::from_string(from_species).ok_or_else(|| {
        PyValueError::new_err(format!(
            "Invalid species '{from_species}': expected format like 'Fe' or 'Fe2+'"
        ))
    })?;
    let to_sp = Species::from_string(to_species).ok_or_else(|| {
        PyValueError::new_err(format!(
            "Invalid species '{to_species}': expected format like 'Fe' or 'Fe2+'"
        ))
    })?;

    let s = parse_struct(&structure)?
        .substitute(from_sp, to_sp)
        .map_err(|e| PyValueError::new_err(format!("Error substituting: {e}")))?;
    Ok(structure_to_pydict(py, &s)?.unbind())
}

/// Remove all sites containing specified species.
///
/// Args:
///     structure (str): Structure as JSON string
///     species (list[str]): Species to remove (e.g., ["Li", "Na"])
///
/// Returns:
///     dict: Structure with species removed
#[pyfunction]
fn remove_species(
    py: Python<'_>,
    structure: StructureJson,
    species: Vec<String>,
) -> PyResult<Py<PyDict>> {
    use crate::species::Species;

    let species_vec: Vec<Species> = species
        .iter()
        .map(|s| {
            Species::from_string(s)
                .ok_or_else(|| PyValueError::new_err(format!("Invalid species: {s}")))
        })
        .collect::<Result<_, _>>()?;

    let s = parse_struct(&structure)?
        .remove_species(&species_vec)
        .map_err(|e| PyValueError::new_err(format!("Error removing species: {e}")))?;
    Ok(structure_to_pydict(py, &s)?.unbind())
}

/// Remove sites by index.
///
/// Args:
///     structure (str): Structure as JSON string
///     indices (list[int]): Site indices to remove
///
/// Returns:
///     dict: Structure with sites removed
#[pyfunction]
fn remove_sites(
    py: Python<'_>,
    structure: StructureJson,
    indices: Vec<usize>,
) -> PyResult<Py<PyDict>> {
    let s = parse_struct(&structure)?
        .remove_sites(&indices)
        .map_err(|e| PyValueError::new_err(format!("Error removing sites: {e}")))?;
    Ok(structure_to_pydict(py, &s)?.unbind())
}

/// Apply a deformation gradient to the lattice.
///
/// Args:
///     structure (str): Structure as JSON string
///     gradient (list[list[float]]): 3x3 deformation gradient matrix
///
/// Returns:
///     dict: Deformed structure
#[pyfunction]
fn deform(
    py: Python<'_>,
    structure: StructureJson,
    gradient: [[f64; 3]; 3],
) -> PyResult<Py<PyDict>> {
    let grad_matrix = Matrix3::from_row_slice(&gradient.concat());
    let s = parse_struct(&structure)?
        .deform(grad_matrix)
        .map_err(|e| PyValueError::new_err(format!("Error deforming: {e}")))?;
    Ok(structure_to_pydict(py, &s)?.unbind())
}

/// Compute Ewald energy of an ionic structure.
///
/// Args:
///     structure (str): Structure as JSON string (must have oxidation states)
///     accuracy (float): Accuracy parameter for Ewald summation
///     real_cutoff (float): Real-space cutoff in Angstroms
///
/// Returns:
///     float: Coulomb energy in eV
#[pyfunction]
#[pyo3(signature = (structure, accuracy = 1e-5, real_cutoff = 10.0))]
fn ewald_energy(structure: StructureJson, accuracy: f64, real_cutoff: f64) -> PyResult<f64> {
    use crate::algorithms::Ewald;

    if accuracy <= 0.0 || accuracy >= 1.0 {
        return Err(PyValueError::new_err(format!(
            "accuracy must be in (0, 1), got {accuracy}"
        )));
    }
    if real_cutoff <= 0.0 {
        return Err(PyValueError::new_err(format!(
            "real_cutoff must be positive, got {real_cutoff}"
        )));
    }

    let s = parse_struct(&structure)?;
    let ewald = Ewald::new()
        .with_accuracy(accuracy)
        .with_real_cutoff(real_cutoff);
    ewald
        .energy(&s)
        .map_err(|e| PyValueError::new_err(format!("Ewald error: {e}")))
}

/// Enumerate orderings of a disordered structure.
///
/// Takes a structure with disordered sites and returns all possible
/// ordered configurations, optionally ranked by Ewald energy.
///
/// Args:
///     structure (str): Structure as JSON string
///     max_structures (int, optional): Maximum number of structures to return
///     sort_by_energy (bool): Whether to sort by Ewald energy
///
/// Returns:
///     list[dict]: List of ordered structures as pymatgen-compatible dicts
#[pyfunction]
#[pyo3(signature = (structure, max_structures = None, sort_by_energy = true))]
fn order_disordered(
    py: Python<'_>,
    structure: StructureJson,
    max_structures: Option<usize>,
    sort_by_energy: bool,
) -> PyResult<Vec<Py<PyDict>>> {
    use crate::transformations::OrderDisorderedConfig;

    let s = parse_struct(&structure)?;
    let config = OrderDisorderedConfig {
        max_structures,
        sort_by_energy,
        compute_energy: sort_by_energy,
        ..Default::default()
    };

    // Release GIL during heavy computation
    let results = py.detach(|| s.order_disordered(config));

    results
        .map_err(|e| PyValueError::new_err(format!("Error ordering: {e}")))?
        .iter()
        .map(|s| Ok(structure_to_pydict(py, s)?.unbind()))
        .collect()
}

/// Enumerate derivative structures from a parent structure.
///
/// Generates all symmetrically unique supercells up to a given size.
///
/// Args:
///     structure (str): Parent structure as JSON string
///     min_size (int): Minimum supercell size (number of formula units)
///     max_size (int): Maximum supercell size
///
/// Returns:
///     list[dict]: List of derivative structures
#[pyfunction]
#[pyo3(signature = (structure, min_size = 1, max_size = 4))]
fn enumerate_derivatives(
    py: Python<'_>,
    structure: StructureJson,
    min_size: usize,
    max_size: usize,
) -> PyResult<Vec<Py<PyDict>>> {
    let s = parse_struct(&structure)?;

    // Release GIL during heavy computation
    let results = py.detach(|| s.enumerate_derivatives(min_size, max_size));

    results
        .map_err(|e| PyValueError::new_err(format!("Error enumerating: {e}")))?
        .iter()
        .map(|s| Ok(structure_to_pydict(py, s)?.unbind()))
        .collect()
}

// === Slab Generation ===

/// Generate all unique surface terminations for a given Miller index.
///
/// Args:
///     structure: Structure as JSON string or dict
///     miller_index: Surface orientation as [h, k, l]
///     min_slab_size: Minimum slab thickness in Angstroms (default: 10.0)
///     min_vacuum_size: Minimum vacuum thickness in Angstroms (default: 10.0)
///     center_slab: Center slab in vacuum (default: True)
///     in_unit_planes: If True, min_slab_size is number of unit planes (default: False)
///     symprec: Symmetry precision for unique terminations (default: 0.01)
///
/// Returns:
///     List of slab structures (one per unique termination)
#[pyfunction]
#[pyo3(signature = (structure, miller_index, min_slab_size = 10.0, min_vacuum_size = 10.0, center_slab = true, in_unit_planes = false, symprec = 0.01))]
fn generate_slabs(
    py: Python<'_>,
    structure: StructureJson,
    miller_index: [i32; 3],
    min_slab_size: f64,
    min_vacuum_size: f64,
    center_slab: bool,
    in_unit_planes: bool,
    symprec: f64,
) -> PyResult<Vec<Py<PyDict>>> {
    let s = parse_struct(&structure)?;
    let config = crate::structure::SlabConfig {
        miller_index,
        min_slab_size,
        min_vacuum_size,
        center_slab,
        in_unit_planes,
        primitive: false,
        symprec,
        termination_index: None,
    };
    // Release GIL during heavy computation
    let slabs = py
        .detach(|| s.generate_slabs(&config))
        .map_err(|e| PyValueError::new_err(format!("Error generating slabs: {e}")))?;
    slabs
        .iter()
        .map(|slab| Ok(structure_to_pydict(py, slab)?.unbind()))
        .collect()
}

/// Generate a single slab for a given Miller index and termination.
///
/// Args:
///     structure: Structure as JSON string or dict
///     miller_index: Surface orientation as [h, k, l]
///     min_slab_size: Minimum slab thickness in Angstroms (default: 10.0)
///     min_vacuum_size: Minimum vacuum thickness in Angstroms (default: 10.0)
///     center_slab: Center slab in vacuum (default: True)
///     in_unit_planes: If True, min_slab_size is number of unit planes (default: False)
///     symprec: Symmetry precision (default: 0.01)
///     termination_index: Which termination to use (default: 0)
///
/// Returns:
///     Slab structure dict
#[pyfunction]
#[pyo3(signature = (structure, miller_index, min_slab_size = 10.0, min_vacuum_size = 10.0, center_slab = true, in_unit_planes = false, symprec = 0.01, termination_index = 0))]
fn make_slab(
    py: Python<'_>,
    structure: StructureJson,
    miller_index: [i32; 3],
    min_slab_size: f64,
    min_vacuum_size: f64,
    center_slab: bool,
    in_unit_planes: bool,
    symprec: f64,
    termination_index: usize,
) -> PyResult<Py<PyDict>> {
    let s = parse_struct(&structure)?;
    let config = crate::structure::SlabConfig {
        miller_index,
        min_slab_size,
        min_vacuum_size,
        center_slab,
        in_unit_planes,
        primitive: false,
        symprec,
        termination_index: Some(termination_index),
    };
    // Release GIL during heavy computation
    let slab = py
        .detach(|| s.make_slab(&config))
        .map_err(|e| PyValueError::new_err(format!("Error making slab: {e}")))?;
    Ok(structure_to_pydict(py, &slab)?.unbind())
}

// === Coordination Analysis ===

/// Get coordination numbers for all sites using distance cutoff.
///
/// Args:
///     structure: Structure as JSON string or dict
///     cutoff: Distance cutoff in Angstrom
///
/// Returns:
///     List of coordination numbers (one per site)
#[pyfunction]
#[pyo3(name = "get_coordination_numbers")]
fn py_get_coordination_numbers(structure: StructureJson, cutoff: f64) -> PyResult<Vec<usize>> {
    if cutoff < 0.0 {
        return Err(PyValueError::new_err("Cutoff must be non-negative"));
    }
    let s = parse_struct(&structure)?;
    Ok(coordination::get_coordination_numbers(&s, cutoff))
}

/// Get coordination number for a single site using distance cutoff.
///
/// Args:
///     structure: Structure as JSON string or dict
///     site_idx: Index of the site
///     cutoff: Distance cutoff in Angstrom
///
/// Returns:
///     Coordination number for the site
#[pyfunction]
#[pyo3(name = "get_coordination_number")]
fn py_get_coordination_number(
    structure: StructureJson,
    site_idx: usize,
    cutoff: f64,
) -> PyResult<usize> {
    if cutoff < 0.0 {
        return Err(PyValueError::new_err("Cutoff must be non-negative"));
    }
    let s = parse_struct(&structure)?;
    check_site_bounds(s.num_sites(), &[site_idx])?;
    Ok(coordination::get_coordination_number(&s, site_idx, cutoff))
}

/// Get local environment (neighbor info) for a site.
///
/// Args:
///     structure: Structure as JSON string or dict
///     site_idx: Index of the site
///     cutoff: Distance cutoff in Angstrom
///
/// Returns:
///     List of dicts with keys: element, species, distance, image, site_idx
#[pyfunction]
#[pyo3(name = "get_local_environment")]
fn py_get_local_environment(
    py: Python<'_>,
    structure: StructureJson,
    site_idx: usize,
    cutoff: f64,
) -> PyResult<Py<PyList>> {
    if cutoff < 0.0 {
        return Err(PyValueError::new_err("Cutoff must be non-negative"));
    }
    let s = parse_struct(&structure)?;
    check_site_bounds(s.num_sites(), &[site_idx])?;
    let neighbors = coordination::get_local_environment(&s, site_idx, cutoff);
    let list = PyList::empty(py);
    for n in neighbors {
        let dict = PyDict::new(py);
        dict.set_item("element", n.element().symbol())?;
        dict.set_item("species", n.species.to_string())?;
        dict.set_item("distance", n.distance)?;
        dict.set_item("image", n.image)?;
        dict.set_item("site_idx", n.site_idx)?;
        list.append(dict)?;
    }
    Ok(list.unbind())
}

/// Get neighbors for a site (indices and distances).
///
/// Args:
///     structure: Structure as JSON string or dict
///     site_idx: Index of the site
///     cutoff: Distance cutoff in Angstrom
///
/// Returns:
///     List of tuples: (neighbor_idx, distance, image)
#[pyfunction]
#[pyo3(name = "get_neighbors")]
fn py_get_neighbors(
    structure: StructureJson,
    site_idx: usize,
    cutoff: f64,
) -> PyResult<Vec<(usize, f64, [i32; 3])>> {
    if cutoff < 0.0 {
        return Err(PyValueError::new_err("Cutoff must be non-negative"));
    }
    let s = parse_struct(&structure)?;
    check_site_bounds(s.num_sites(), &[site_idx])?;
    Ok(coordination::get_neighbors(&s, site_idx, cutoff))
}

/// Get Voronoi-based coordination number for a site.
///
/// Args:
///     structure: Structure as JSON string or dict
///     site_idx: Index of the site
///     min_solid_angle: Minimum solid angle fraction to count as neighbor (default: 0.01)
///
/// Returns:
///     Voronoi-weighted coordination number
#[pyfunction]
#[pyo3(name = "get_cn_voronoi", signature = (structure, site_idx, min_solid_angle = 0.01))]
fn py_get_cn_voronoi(
    structure: StructureJson,
    site_idx: usize,
    min_solid_angle: f64,
) -> PyResult<f64> {
    if !(0.0..=1.0).contains(&min_solid_angle) {
        return Err(PyValueError::new_err(
            "min_solid_angle must be between 0.0 and 1.0 inclusive",
        ));
    }
    let s = parse_struct(&structure)?;
    check_site_bounds(s.num_sites(), &[site_idx])?;
    let config = coordination::VoronoiConfig { min_solid_angle };
    Ok(coordination::get_cn_voronoi(&s, site_idx, Some(&config)))
}

/// Get Voronoi-based coordination numbers for all sites.
///
/// Args:
///     structure: Structure as JSON string or dict
///     min_solid_angle: Minimum solid angle fraction to count as neighbor (default: 0.01)
///
/// Returns:
///     List of Voronoi-weighted coordination numbers
#[pyfunction]
#[pyo3(name = "get_cn_voronoi_all", signature = (structure, min_solid_angle = 0.01))]
fn py_get_cn_voronoi_all(structure: StructureJson, min_solid_angle: f64) -> PyResult<Vec<f64>> {
    if !(0.0..=1.0).contains(&min_solid_angle) {
        return Err(PyValueError::new_err(
            "min_solid_angle must be between 0.0 and 1.0 inclusive",
        ));
    }
    let s = parse_struct(&structure)?;
    let config = coordination::VoronoiConfig { min_solid_angle };
    Ok(coordination::get_cn_voronoi_all(&s, Some(&config)))
}

/// Get Voronoi neighbors for a site.
///
/// Args:
///     structure: Structure as JSON string or dict
///     site_idx: Index of the site
///     min_solid_angle: Minimum solid angle fraction to count as neighbor (default: 0.01)
///
/// Returns:
///     List of tuples: (neighbor_idx, solid_angle_weight)
#[pyfunction]
#[pyo3(name = "get_voronoi_neighbors", signature = (structure, site_idx, min_solid_angle = 0.01))]
fn py_get_voronoi_neighbors(
    structure: StructureJson,
    site_idx: usize,
    min_solid_angle: f64,
) -> PyResult<Vec<(usize, f64)>> {
    if !(0.0..=1.0).contains(&min_solid_angle) {
        return Err(PyValueError::new_err(
            "min_solid_angle must be between 0.0 and 1.0 inclusive",
        ));
    }
    let s = parse_struct(&structure)?;
    check_site_bounds(s.num_sites(), &[site_idx])?;
    let config = coordination::VoronoiConfig { min_solid_angle };
    Ok(coordination::get_voronoi_neighbors(
        &s,
        site_idx,
        Some(&config),
    ))
}

/// Get Voronoi-based local environment for a site.
///
/// Args:
///     structure: Structure as JSON string or dict
///     site_idx: Index of the site
///     min_solid_angle: Minimum solid angle fraction to count as neighbor (default: 0.01)
///
/// Returns:
///     List of dicts with keys: element, species, distance, image, site_idx, solid_angle
#[pyfunction]
#[pyo3(name = "get_local_environment_voronoi", signature = (structure, site_idx, min_solid_angle = 0.01))]
fn py_get_local_environment_voronoi(
    py: Python<'_>,
    structure: StructureJson,
    site_idx: usize,
    min_solid_angle: f64,
) -> PyResult<Py<PyList>> {
    if !(0.0..=1.0).contains(&min_solid_angle) {
        return Err(PyValueError::new_err(
            "min_solid_angle must be between 0.0 and 1.0 inclusive",
        ));
    }
    let s = parse_struct(&structure)?;
    check_site_bounds(s.num_sites(), &[site_idx])?;
    let config = coordination::VoronoiConfig { min_solid_angle };
    let neighbors = coordination::get_local_environment_voronoi(&s, site_idx, Some(&config));
    let list = PyList::empty(py);
    for n in neighbors {
        let dict = PyDict::new(py);
        dict.set_item("element", n.element().symbol())?;
        dict.set_item("species", n.species.to_string())?;
        dict.set_item("distance", n.distance)?;
        dict.set_item("image", n.image)?;
        dict.set_item("site_idx", n.site_idx)?;
        dict.set_item("solid_angle", n.solid_angle)?;
        list.append(dict)?;
    }
    Ok(list.unbind())
}

// === XRD Functions ===

/// Compute powder X-ray diffraction pattern from a structure.
///
/// Args:
///     structure: Structure as JSON string or dict
///     wavelength: X-ray wavelength in Angstroms (default: 1.54184, Cu Kα)
///     two_theta_range: Tuple of (min, max) 2θ angles in degrees (default: (0, 180))
///     debye_waller_factors: Dict of element symbol to B factor (optional)
///     scaled: Whether to scale intensities to 0-100 (default: True)
///
/// Returns:
///     Dict with keys: two_theta, intensities, hkls, d_spacings
///
/// Example:
///     >>> import ferrox
///     >>> pattern = ferrox.compute_xrd(structure, wavelength=1.5406)
///     >>> two_theta = pattern["two_theta"]
///     >>> intensities = pattern["intensities"]
#[pyfunction]
#[pyo3(name = "compute_xrd", signature = (
    structure,
    wavelength = 1.54184,
    two_theta_range = None,
    debye_waller_factors = None,
    scaled = true
))]
fn py_compute_xrd(
    py: Python<'_>,
    structure: StructureJson,
    wavelength: f64,
    two_theta_range: Option<(f64, f64)>,
    debye_waller_factors: Option<HashMap<String, f64>>,
    scaled: bool,
) -> PyResult<Py<PyDict>> {
    use crate::xrd::{XrdConfig, compute_xrd};

    if wavelength <= 0.0 {
        return Err(PyValueError::new_err("wavelength must be positive"));
    }

    if let Some((t_min, t_max)) = two_theta_range
        && (t_min < 0.0 || t_max > 180.0 || t_min >= t_max)
    {
        return Err(PyValueError::new_err(
            "two_theta_range must be (min, max) with 0 <= min < max <= 180",
        ));
    }

    let s = parse_struct(&structure)?;

    let config = XrdConfig {
        wavelength,
        two_theta_range,
        debye_waller_factors: debye_waller_factors.unwrap_or_default(),
        scaled,
        ..Default::default()
    };

    let pattern = py.detach(|| compute_xrd(&s, &config));

    let dict = PyDict::new(py);
    dict.set_item("two_theta", pattern.two_theta)?;
    dict.set_item("intensities", pattern.intensities)?;

    // Convert hkls to list of list of dicts
    let hkls_list = PyList::empty(py);
    for families in &pattern.hkls {
        let family_list = PyList::empty(py);
        for info in families {
            let info_dict = PyDict::new(py);
            info_dict.set_item("hkl", info.hkl.to_vec())?;
            info_dict.set_item("multiplicity", info.multiplicity)?;
            family_list.append(info_dict)?;
        }
        hkls_list.append(family_list)?;
    }
    dict.set_item("hkls", hkls_list)?;
    dict.set_item("d_spacings", pattern.d_spacings)?;

    Ok(dict.unbind())
}

// === Oxidation State Functions ===

fn validate_bvs_params(max_radius: f64, scale_factor: f64) -> PyResult<()> {
    if max_radius <= 0.0 {
        return Err(PyValueError::new_err(format!(
            "max_radius must be positive, got {max_radius}"
        )));
    }
    if scale_factor <= 0.0 {
        return Err(PyValueError::new_err(format!(
            "scale_factor must be positive, got {scale_factor}"
        )));
    }
    Ok(())
}

/// Guess oxidation states for a composition, ranked by ICSD probability.
#[pyfunction]
#[pyo3(name = "oxi_state_guesses", signature = (formula, target_charge = 0, use_all_oxi_states = false, max_sites = None))]
fn py_oxi_state_guesses(
    py: Python<'_>,
    formula: &str,
    target_charge: i8,
    use_all_oxi_states: bool,
    max_sites: Option<usize>,
) -> PyResult<Py<PyList>> {
    let guesses =
        parse_comp(formula)?.oxi_state_guesses(target_charge, None, use_all_oxi_states, max_sites);
    let result = PyList::empty(py);
    for guess in guesses {
        let dict = PyDict::new(py);
        let oxi_dict = PyDict::new(py);
        for (elem, oxi) in &guess.oxidation_states {
            oxi_dict.set_item(elem, oxi)?;
        }
        dict.set_item("oxidation_states", oxi_dict)?;
        dict.set_item("probability", guess.probability)?;
        result.append(dict)?;
    }
    Ok(result.unbind())
}

/// Add oxidation states to a structure based on composition guessing.
/// Raises ValueError for mixed-valence (non-integer average oxi states like Fe3O4).
#[pyfunction]
#[pyo3(name = "add_charges_from_oxi_state_guesses", signature = (structure, target_charge = 0))]
fn py_add_charges_from_oxi_state_guesses(
    py: Python<'_>,
    structure: StructureJson,
    target_charge: i8,
) -> PyResult<Py<PyDict>> {
    let s = parse_struct(&structure)?;
    let guesses = s
        .composition()
        .oxi_state_guesses(target_charge, None, false, None);
    let best = guesses.first().ok_or_else(|| {
        PyValueError::new_err("Could not find charge-balanced oxidation state assignment")
    })?;

    // Check for mixed-valence
    for (elem, oxi) in &best.oxidation_states {
        if (*oxi - oxi.round()).abs() > crate::oxidation::OXI_INT_TOLERANCE {
            return Err(PyValueError::new_err(format!(
                "Mixed-valence: {elem} has average oxi state {oxi:.2} (non-integer)"
            )));
        }
    }

    let oxi_map: std::collections::HashMap<String, i8> = best
        .oxidation_states
        .iter()
        .map(|(e, o)| (e.clone(), o.round() as i8))
        .collect();
    json_to_pydict(
        py,
        &structure_to_pymatgen_json(&s.add_oxidation_state_by_element(&oxi_map)),
    )
}

/// Compute bond valence sums for all sites using O'Keeffe & Brese parameters.
#[pyfunction]
#[pyo3(name = "compute_bv_sums", signature = (structure, max_radius = 4.0, scale_factor = 1.015))]
fn py_compute_bv_sums(
    structure: StructureJson,
    max_radius: f64,
    scale_factor: f64,
) -> PyResult<Vec<f64>> {
    validate_bvs_params(max_radius, scale_factor)?;
    parse_struct(&structure)?
        .compute_all_bv_sums(max_radius, scale_factor)
        .map_err(|e| PyValueError::new_err(e.to_string()))
}

/// Guess oxidation states using BVS-based MAP estimation with symmetry.
#[pyfunction]
#[pyo3(name = "guess_oxidation_states_bvs", signature = (structure, symprec = 0.1, max_radius = 4.0, scale_factor = 1.015))]
fn py_guess_oxidation_states_bvs(
    structure: StructureJson,
    symprec: f64,
    max_radius: f64,
    scale_factor: f64,
) -> PyResult<Vec<i8>> {
    validate_bvs_params(max_radius, scale_factor)?;
    parse_struct(&structure)?
        .guess_oxidation_states_bvs(symprec, max_radius, scale_factor)
        .map_err(|e| PyValueError::new_err(e.to_string()))
}

/// Add oxidation states to a structure by element symbol mapping.
#[pyfunction]
#[pyo3(name = "add_oxidation_state_by_element")]
fn py_add_oxidation_state_by_element(
    py: Python<'_>,
    structure: StructureJson,
    oxi_states: std::collections::HashMap<String, i8>,
) -> PyResult<Py<PyDict>> {
    json_to_pydict(
        py,
        &structure_to_pymatgen_json(
            &parse_struct(&structure)?.add_oxidation_state_by_element(&oxi_states),
        ),
    )
}

/// Add oxidation states to a structure by site index.
#[pyfunction]
#[pyo3(name = "add_oxidation_state_by_site")]
fn py_add_oxidation_state_by_site(
    py: Python<'_>,
    structure: StructureJson,
    oxi_states: Vec<i8>,
) -> PyResult<Py<PyDict>> {
    let result = parse_struct(&structure)?
        .add_oxidation_state_by_site(&oxi_states)
        .map_err(|e| PyValueError::new_err(e.to_string()))?;
    json_to_pydict(py, &structure_to_pymatgen_json(&result))
}

/// Remove oxidation states from all sites in a structure.
#[pyfunction]
#[pyo3(name = "remove_oxidation_states")]
fn py_remove_oxidation_states(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyDict>> {
    json_to_pydict(
        py,
        &structure_to_pymatgen_json(&parse_struct(&structure)?.remove_oxidation_states()),
    )
}

// === XRD Functions (continued) ===

/// Returns:
///     Dict[str, List[List[float]]]: Element symbol -> [[a1, b1], [a2, b2], [a3, b3], [a4, b4]]
#[pyfunction]
#[pyo3(name = "get_atomic_scattering_params")]
fn py_get_atomic_scattering_params(py: Python<'_>) -> PyResult<Py<PyDict>> {
    let params = crate::xrd::get_scattering_params();

    let dict = PyDict::new(py);
    for (element, coeffs) in params {
        let py_coeffs: Vec<Vec<f64>> = coeffs.iter().map(|pair| pair.to_vec()).collect();
        dict.set_item(element, py_coeffs)?;
    }
    Ok(dict.unbind())
}

// === RDF Functions ===

// Helper: validate and construct RDF options
fn make_rdf_options(
    r_max: f64,
    n_bins: usize,
    normalize: bool,
    auto_expand: bool,
    expansion_factor: f64,
) -> PyResult<rdf::RdfOptions> {
    if r_max <= 0.0 {
        return Err(PyValueError::new_err("r_max must be positive"));
    }
    if n_bins == 0 {
        return Err(PyValueError::new_err("n_bins must be at least 1"));
    }
    Ok(rdf::RdfOptions {
        r_max,
        n_bins,
        normalize,
        auto_expand,
        expansion_factor,
    })
}

/// Compute total RDF for all atom pairs. Returns (r, g_r) tuple.
#[pyfunction]
#[pyo3(name = "compute_rdf", signature = (structure, r_max=15.0, n_bins=75, normalize=true, auto_expand=true, expansion_factor=2.0))]
fn py_compute_rdf(
    py: Python<'_>,
    structure: StructureJson,
    r_max: f64,
    n_bins: usize,
    normalize: bool,
    auto_expand: bool,
    expansion_factor: f64,
) -> PyResult<(Vec<f64>, Vec<f64>)> {
    let s = parse_struct(&structure)?;
    let opts = make_rdf_options(r_max, n_bins, normalize, auto_expand, expansion_factor)?;
    // Release GIL during heavy computation (especially with auto_expand creating supercells)
    let result = py.detach(|| rdf::compute_rdf(&s, &opts));
    Ok((result.radii, result.g_of_r))
}

/// Compute element-resolved RDF for a specific element pair. Returns (r, g_r) tuple.
#[pyfunction]
#[pyo3(name = "compute_element_rdf", signature = (structure, element_a, element_b, r_max=15.0, n_bins=75, normalize=true, auto_expand=true, expansion_factor=2.0))]
fn py_compute_element_rdf(
    py: Python<'_>,
    structure: StructureJson,
    element_a: &str,
    element_b: &str,
    r_max: f64,
    n_bins: usize,
    normalize: bool,
    auto_expand: bool,
    expansion_factor: f64,
) -> PyResult<(Vec<f64>, Vec<f64>)> {
    let elem_a = Element::from_symbol(element_a)
        .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {element_a}")))?;
    let elem_b = Element::from_symbol(element_b)
        .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {element_b}")))?;
    let s = parse_struct(&structure)?;
    let opts = make_rdf_options(r_max, n_bins, normalize, auto_expand, expansion_factor)?;
    // Release GIL during heavy computation
    let result = py.detach(|| rdf::compute_element_rdf(&s, elem_a, elem_b, &opts));
    Ok((result.radii, result.g_of_r))
}

/// Compute RDF for all unique element pairs. Returns list of {element_a, element_b, r, g_r} dicts.
#[pyfunction]
#[pyo3(name = "compute_all_element_rdfs", signature = (structure, r_max=15.0, n_bins=75, normalize=true, auto_expand=true, expansion_factor=2.0))]
fn py_compute_all_element_rdfs(
    py: Python<'_>,
    structure: StructureJson,
    r_max: f64,
    n_bins: usize,
    normalize: bool,
    auto_expand: bool,
    expansion_factor: f64,
) -> PyResult<Py<PyList>> {
    let s = parse_struct(&structure)?;
    let opts = make_rdf_options(r_max, n_bins, normalize, auto_expand, expansion_factor)?;
    // Release GIL during heavy computation
    let results = py.detach(|| rdf::compute_all_element_rdfs(&s, &opts));
    let list = PyList::empty(py);
    for (elem_a, elem_b, rdf_result) in results {
        let dict = PyDict::new(py);
        dict.set_item("element_a", elem_a.symbol())?;
        dict.set_item("element_b", elem_b.symbol())?;
        dict.set_item("r", rdf_result.radii)?;
        dict.set_item("g_r", rdf_result.g_of_r)?;
        list.append(dict)?;
    }
    Ok(list.unbind())
}

// === MD Integrators ===

use crate::elastic;
use crate::integrators::{LangevinIntegrator, MDState};
use crate::optimizers::{CellFireState, FireConfig, FireState};
use crate::order_params;
use crate::trajectory::{MsdCalculator, VacfCalculator};

/// Python wrapper for MD state.
#[pyclass(name = "MDState")]
pub struct PyMDState {
    inner: MDState,
}

#[pymethods]
impl PyMDState {
    /// Create a new MD state.
    ///
    /// Args:
    ///     positions: Nx3 array of atomic positions in Angstrom
    ///     masses: N-element array of atomic masses in amu
    ///     velocities: Optional Nx3 array of velocities (default: zeros)
    #[new]
    #[pyo3(signature = (positions, masses, velocities = None))]
    fn new(
        positions: Vec<[f64; 3]>,
        masses: Vec<f64>,
        velocities: Option<Vec<[f64; 3]>>,
    ) -> PyResult<Self> {
        if positions.len() != masses.len() {
            return Err(PyValueError::new_err(format!(
                "Masses length ({}) must match positions length ({})",
                masses.len(),
                positions.len()
            )));
        }

        let pos_vec: Vec<Vector3<f64>> = positions.iter().map(|p| Vector3::from(*p)).collect();
        let mut state = MDState::new(pos_vec, masses);

        if let Some(vels) = velocities {
            if vels.len() != state.num_atoms() {
                return Err(PyValueError::new_err(format!(
                    "Velocities length ({}) must match positions length ({})",
                    vels.len(),
                    state.num_atoms()
                )));
            }
            state.velocities = vels.iter().map(|v| Vector3::from(*v)).collect();
        }

        Ok(Self { inner: state })
    }

    /// Initialize velocities from Maxwell-Boltzmann distribution.
    ///
    /// Args:
    ///     temperature_k: Target temperature in Kelvin
    ///     seed: Optional random seed for reproducibility
    #[pyo3(signature = (temperature_k, seed = None))]
    fn init_velocities(&mut self, temperature_k: f64, seed: Option<u64>) {
        self.inner.init_velocities(temperature_k, seed);
    }

    /// Get kinetic energy in eV.
    fn kinetic_energy(&self) -> f64 {
        self.inner.kinetic_energy()
    }

    /// Get temperature in Kelvin.
    fn temperature(&self) -> f64 {
        self.inner.temperature()
    }

    /// Get number of atoms.
    fn num_atoms(&self) -> usize {
        self.inner.num_atoms()
    }

    /// Get positions as Nx3 array.
    #[getter]
    fn positions(&self) -> Vec<[f64; 3]> {
        self.inner
            .positions
            .iter()
            .map(|p| [p.x, p.y, p.z])
            .collect()
    }

    /// Set positions from Nx3 array.
    #[setter]
    fn set_positions(&mut self, positions: Vec<[f64; 3]>) -> PyResult<()> {
        if positions.len() != self.inner.num_atoms() {
            return Err(PyValueError::new_err(format!(
                "Positions length ({}) must match num_atoms ({})",
                positions.len(),
                self.inner.num_atoms()
            )));
        }
        self.inner.positions = positions.iter().map(|p| Vector3::from(*p)).collect();
        Ok(())
    }

    /// Get velocities as Nx3 array (in internal units: Angstrom/10.18fs).
    #[getter]
    fn velocities(&self) -> Vec<[f64; 3]> {
        self.inner
            .velocities
            .iter()
            .map(|v| [v.x, v.y, v.z])
            .collect()
    }

    /// Set velocities from Nx3 array.
    #[setter]
    fn set_velocities(&mut self, velocities: Vec<[f64; 3]>) -> PyResult<()> {
        if velocities.len() != self.inner.num_atoms() {
            return Err(PyValueError::new_err(format!(
                "Velocities length ({}) must match num_atoms ({})",
                velocities.len(),
                self.inner.num_atoms()
            )));
        }
        self.inner.velocities = velocities.iter().map(|v| Vector3::from(*v)).collect();
        Ok(())
    }

    /// Get forces as Nx3 array (in eV/Angstrom).
    #[getter]
    fn forces(&self) -> Vec<[f64; 3]> {
        self.inner.forces.iter().map(|f| [f.x, f.y, f.z]).collect()
    }

    /// Set forces from Nx3 array.
    #[setter]
    fn set_forces(&mut self, forces: Vec<[f64; 3]>) -> PyResult<()> {
        if forces.len() != self.inner.num_atoms() {
            return Err(PyValueError::new_err(format!(
                "Forces length ({}) must match num_atoms ({})",
                forces.len(),
                self.inner.num_atoms()
            )));
        }
        let force_vec: Vec<Vector3<f64>> = forces.iter().map(|f| Vector3::from(*f)).collect();
        self.inner.set_forces(&force_vec);
        Ok(())
    }
}

/// Python wrapper for Langevin integrator.
#[pyclass(name = "LangevinIntegrator")]
pub struct PyLangevinIntegrator {
    inner: LangevinIntegrator,
}

#[pymethods]
impl PyLangevinIntegrator {
    /// Create a new Langevin integrator.
    ///
    /// Args:
    ///     temperature_k: Target temperature in Kelvin
    ///     friction: Friction coefficient in 1/fs (typical: 0.001 to 0.01)
    ///     dt: Time step in fs
    ///     seed: Optional random seed for reproducibility
    #[new]
    #[pyo3(signature = (temperature_k, friction, dt, seed = None))]
    fn new(temperature_k: f64, friction: f64, dt: f64, seed: Option<u64>) -> Self {
        Self {
            inner: LangevinIntegrator::new(temperature_k, friction, dt, seed),
        }
    }

    /// Perform one Langevin dynamics step.
    ///
    /// Args:
    ///     state: MDState to update
    ///     compute_forces: Python callable that takes positions (Nx3 array)
    ///                     and returns forces (Nx3 array in eV/Angstrom)
    ///
    /// Raises:
    ///     RuntimeError: If force computation fails. State is restored to its
    ///         original value before the step when this happens.
    ///     ValueError: If force callback returns wrong number of forces.
    fn step(
        &mut self,
        state: &mut PyMDState,
        compute_forces: Py<PyAny>,
        py: Python<'_>,
    ) -> PyResult<()> {
        self.inner.try_step(&mut state.inner, |positions| {
            let n_atoms = positions.len();
            let pos_arr: Vec<[f64; 3]> = positions.iter().map(|p| [p.x, p.y, p.z]).collect();
            let result = compute_forces.call1(py, (pos_arr,))?;
            let forces: Vec<[f64; 3]> = result.extract(py)?;
            if forces.len() != n_atoms {
                return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>(format!(
                    "force callback returned {} forces, expected {} (one per atom)",
                    forces.len(),
                    n_atoms
                )));
            }
            Ok(forces.iter().map(|f| Vector3::from(*f)).collect())
        })
    }

    /// Set target temperature.
    fn set_temperature(&mut self, temperature_k: f64) {
        self.inner.set_temperature(temperature_k);
    }

    /// Set friction coefficient.
    fn set_friction(&mut self, friction: f64) {
        self.inner.set_friction(friction);
    }

    /// Set time step.
    fn set_dt(&mut self, dt: f64) {
        self.inner.set_dt(dt);
    }
}

/// Perform one velocity Verlet step (NVE ensemble).
///
/// Args:
///     state: MDState to update
///     dt: Time step in fs
///     compute_forces: Python callable that takes positions (Nx3 array)
///                     and returns forces (Nx3 array in eV/Angstrom)
///
/// Raises:
///     RuntimeError: If force computation fails. State is restored to its
///         original value before the step when this happens.
#[pyfunction]
fn md_velocity_verlet_step(
    state: &mut PyMDState,
    dt: f64,
    compute_forces: Py<PyAny>,
    py: Python<'_>,
) -> PyResult<()> {
    match integrators::try_velocity_verlet_step(std::mem::take(&mut state.inner), dt, |positions| {
        let n_atoms = positions.len();
        let pos_arr: Vec<[f64; 3]> = positions.iter().map(|p| [p.x, p.y, p.z]).collect();
        let result = compute_forces.call1(py, (pos_arr,))?;
        let forces: Vec<[f64; 3]> = result.extract(py)?;
        if forces.len() != n_atoms {
            return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>(format!(
                "force callback returned {} forces, expected {} (one per atom)",
                forces.len(),
                n_atoms
            )));
        }
        Ok(forces.iter().map(|f| Vector3::from(*f)).collect())
    }) {
        Ok(new_state) => {
            state.inner = new_state;
            Ok(())
        }
        Err((original_state, err)) => {
            state.inner = original_state;
            Err(err)
        }
    }
}

// === FIRE Optimizer ===

/// Python wrapper for FIRE configuration.
#[pyclass(name = "FireConfig")]
#[derive(Clone)]
pub struct PyFireConfig {
    inner: FireConfig,
}

#[pymethods]
impl PyFireConfig {
    /// Create a new FIRE configuration with default values.
    ///
    /// Args:
    ///     dt_start: Initial timestep (default: 0.1)
    ///     dt_max: Maximum timestep (default: 1.0)
    ///     n_min: Min steps before dt increase (default: 5)
    ///     f_inc: Factor to increase dt (default: 1.1)
    ///     f_dec: Factor to decrease dt (default: 0.5)
    ///     alpha_start: Initial mixing parameter (default: 0.1)
    ///     f_alpha: Factor to decrease alpha (default: 0.99)
    ///     max_step: Maximum step size in Angstrom (default: 0.2)
    #[new]
    #[pyo3(signature = (dt_start=None, dt_max=None, n_min=None, f_inc=None, f_dec=None, alpha_start=None, f_alpha=None, max_step=None))]
    fn new(
        dt_start: Option<f64>,
        dt_max: Option<f64>,
        n_min: Option<usize>,
        f_inc: Option<f64>,
        f_dec: Option<f64>,
        alpha_start: Option<f64>,
        f_alpha: Option<f64>,
        max_step: Option<f64>,
    ) -> Self {
        let mut config = FireConfig::default();
        if let Some(v) = dt_start {
            config.dt_start = v;
        }
        if let Some(v) = dt_max {
            config.dt_max = v;
        }
        if let Some(v) = n_min {
            config.n_min = v;
        }
        if let Some(v) = f_inc {
            config.f_inc = v;
        }
        if let Some(v) = f_dec {
            config.f_dec = v;
        }
        if let Some(v) = alpha_start {
            config.alpha_start = v;
        }
        if let Some(v) = f_alpha {
            config.f_alpha = v;
        }
        if let Some(v) = max_step {
            config.max_step = v;
        }
        Self { inner: config }
    }

    #[getter]
    fn dt_start(&self) -> f64 {
        self.inner.dt_start
    }

    #[getter]
    fn dt_max(&self) -> f64 {
        self.inner.dt_max
    }

    #[getter]
    fn max_step(&self) -> f64 {
        self.inner.max_step
    }
}

/// Python wrapper for FIRE optimizer state.
#[pyclass(name = "FireState")]
pub struct PyFireState {
    inner: FireState,
    config: FireConfig,
}

#[pymethods]
impl PyFireState {
    /// Create a new FIRE optimizer state.
    ///
    /// Args:
    ///     positions: Nx3 array of atomic positions in Angstrom
    ///     config: Optional FireConfig (uses defaults if not provided)
    #[new]
    #[pyo3(signature = (positions, config = None))]
    fn new(positions: Vec<[f64; 3]>, config: Option<PyFireConfig>) -> Self {
        let pos_vec: Vec<Vector3<f64>> = positions.iter().map(|p| Vector3::from(*p)).collect();
        let fire_config = config.map(|c| c.inner).unwrap_or_default();
        let state = FireState::new(pos_vec, &fire_config);
        Self {
            inner: state,
            config: fire_config,
        }
    }

    /// Perform one FIRE optimization step.
    ///
    /// Args:
    ///     compute_forces: Python callable that takes positions (Nx3 array)
    ///                     and returns forces (Nx3 array in eV/Angstrom)
    ///
    /// Raises:
    ///     RuntimeError: If force computation fails. State is restored to its
    ///         original value before the step when this happens.
    ///     ValueError: If force callback returns wrong number of forces.
    fn step(&mut self, compute_forces: Py<PyAny>, py: Python<'_>) -> PyResult<()> {
        self.inner.try_step(
            |positions| {
                let n_atoms = positions.len();
                let pos_arr: Vec<[f64; 3]> = positions.iter().map(|p| [p.x, p.y, p.z]).collect();
                let result = compute_forces.call1(py, (pos_arr,))?;
                let forces: Vec<[f64; 3]> = result.extract(py)?;
                if forces.len() != n_atoms {
                    return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>(format!(
                        "force callback returned {} forces, expected {} (one per atom)",
                        forces.len(),
                        n_atoms
                    )));
                }
                Ok(forces.iter().map(|f| Vector3::from(*f)).collect())
            },
            &self.config,
        )
    }

    /// Check if optimization has converged.
    ///
    /// Args:
    ///     fmax: Maximum force component threshold in eV/Angstrom
    fn is_converged(&self, fmax: f64) -> bool {
        self.inner.is_converged(fmax)
    }

    /// Get maximum force component magnitude.
    fn max_force(&self) -> f64 {
        self.inner.max_force()
    }

    /// Get number of atoms.
    fn num_atoms(&self) -> usize {
        self.inner.num_atoms()
    }

    /// Get positions as Nx3 array.
    #[getter]
    fn positions(&self) -> Vec<[f64; 3]> {
        self.inner
            .positions
            .iter()
            .map(|p| [p.x, p.y, p.z])
            .collect()
    }
}

/// Python wrapper for FIRE optimizer with cell optimization.
#[pyclass(name = "CellFireState")]
pub struct PyCellFireState {
    inner: CellFireState,
    config: FireConfig,
}

#[pymethods]
impl PyCellFireState {
    /// Create a new FIRE optimizer state with cell optimization.
    ///
    /// Args:
    ///     positions: Nx3 array of atomic positions in Angstrom
    ///     cell: 3x3 cell matrix (rows are lattice vectors)
    ///     config: Optional FireConfig
    ///     cell_factor: Scaling factor for cell DOF (default: 1.0)
    #[new]
    #[pyo3(signature = (positions, cell, config = None, cell_factor = 1.0))]
    fn new(
        positions: Vec<[f64; 3]>,
        cell: [[f64; 3]; 3],
        config: Option<PyFireConfig>,
        cell_factor: f64,
    ) -> Self {
        let pos_vec: Vec<Vector3<f64>> = positions.iter().map(|p| Vector3::from(*p)).collect();
        let cell_mat = Matrix3::from_row_slice(&[
            cell[0][0], cell[0][1], cell[0][2], cell[1][0], cell[1][1], cell[1][2], cell[2][0],
            cell[2][1], cell[2][2],
        ]);
        let fire_config = config.map(|c| c.inner).unwrap_or_default();
        let state = CellFireState::new(pos_vec, cell_mat, &fire_config, cell_factor);
        Self {
            inner: state,
            config: fire_config,
        }
    }

    /// Perform one FIRE optimization step with cell optimization.
    ///
    /// Args:
    ///     compute_forces_and_stress: Python callable that takes (positions, cell)
    ///         and returns (forces, stress) where stress is 3x3 in eV/Angstrom^3
    ///
    /// Raises:
    ///     RuntimeError: If force/stress computation fails. State is restored to its
    ///         original value before the step when this happens.
    ///     ValueError: If force callback returns wrong number of forces.
    fn step(&mut self, compute_forces_and_stress: Py<PyAny>, py: Python<'_>) -> PyResult<()> {
        self.inner.try_step(
            |positions, cell| {
                let n_atoms = positions.len();
                let pos_arr: Vec<[f64; 3]> = positions.iter().map(|p| [p.x, p.y, p.z]).collect();
                let cell_arr = [
                    [cell[(0, 0)], cell[(0, 1)], cell[(0, 2)]],
                    [cell[(1, 0)], cell[(1, 1)], cell[(1, 2)]],
                    [cell[(2, 0)], cell[(2, 1)], cell[(2, 2)]],
                ];

                let result = compute_forces_and_stress.call1(py, (pos_arr, cell_arr))?;
                let (forces, stress): (Vec<[f64; 3]>, [[f64; 3]; 3]) = result.extract(py)?;

                if forces.len() != n_atoms {
                    return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>(format!(
                        "force callback returned {} forces, expected {} (one per atom)",
                        forces.len(),
                        n_atoms
                    )));
                }

                let force_vec: Vec<Vector3<f64>> =
                    forces.iter().map(|f| Vector3::from(*f)).collect();
                let stress_mat = Matrix3::from_row_slice(&[
                    stress[0][0],
                    stress[0][1],
                    stress[0][2],
                    stress[1][0],
                    stress[1][1],
                    stress[1][2],
                    stress[2][0],
                    stress[2][1],
                    stress[2][2],
                ]);

                Ok((force_vec, stress_mat))
            },
            &self.config,
        )
    }

    /// Check if optimization has converged.
    fn is_converged(&self, fmax: f64, smax: f64) -> bool {
        self.inner.is_converged(fmax, smax)
    }

    /// Get maximum force component magnitude.
    fn max_force(&self) -> f64 {
        self.inner.max_force()
    }

    /// Get maximum stress component magnitude.
    fn max_stress(&self) -> f64 {
        self.inner.max_stress()
    }

    /// Get positions as Nx3 array.
    #[getter]
    fn positions(&self) -> Vec<[f64; 3]> {
        self.inner
            .positions
            .iter()
            .map(|p| [p.x, p.y, p.z])
            .collect()
    }

    /// Get cell as 3x3 array.
    #[getter]
    fn cell(&self) -> [[f64; 3]; 3] {
        let c = &self.inner.cell;
        [
            [c[(0, 0)], c[(0, 1)], c[(0, 2)]],
            [c[(1, 0)], c[(1, 1)], c[(1, 2)]],
            [c[(2, 0)], c[(2, 1)], c[(2, 2)]],
        ]
    }
}

// === Elastic Tensor Analysis ===

/// Generate strain matrices for elastic tensor calculation.
///
/// Args:
///     magnitude: Strain magnitude (typical: 0.005 to 0.01)
///     shear: Whether to include shear strains (default: True)
///
/// Returns:
///     List of 3x3 strain matrices
#[pyfunction]
#[pyo3(signature = (magnitude, shear = true))]
fn elastic_generate_strains(magnitude: f64, shear: bool) -> Vec<[[f64; 3]; 3]> {
    elastic::generate_strains(magnitude, shear)
        .into_iter()
        .map(|m| {
            [
                [m[(0, 0)], m[(0, 1)], m[(0, 2)]],
                [m[(1, 0)], m[(1, 1)], m[(1, 2)]],
                [m[(2, 0)], m[(2, 1)], m[(2, 2)]],
            ]
        })
        .collect()
}

/// Apply strain to a cell matrix.
///
/// Args:
///     cell: 3x3 cell matrix (rows are lattice vectors)
///     strain: 3x3 strain tensor
///
/// Returns:
///     Deformed cell matrix
#[pyfunction]
fn elastic_apply_strain(cell: [[f64; 3]; 3], strain: [[f64; 3]; 3]) -> [[f64; 3]; 3] {
    let cell_mat = Matrix3::from_row_slice(&[
        cell[0][0], cell[0][1], cell[0][2], cell[1][0], cell[1][1], cell[1][2], cell[2][0],
        cell[2][1], cell[2][2],
    ]);
    let strain_mat = Matrix3::from_row_slice(&[
        strain[0][0],
        strain[0][1],
        strain[0][2],
        strain[1][0],
        strain[1][1],
        strain[1][2],
        strain[2][0],
        strain[2][1],
        strain[2][2],
    ]);
    let result = elastic::apply_strain(&cell_mat, &strain_mat);
    [
        [result[(0, 0)], result[(0, 1)], result[(0, 2)]],
        [result[(1, 0)], result[(1, 1)], result[(1, 2)]],
        [result[(2, 0)], result[(2, 1)], result[(2, 2)]],
    ]
}

/// Convert stress tensor to Voigt notation.
///
/// Args:
///     stress: 3x3 stress tensor
///
/// Returns:
///     6-element Voigt vector [xx, yy, zz, yz, xz, xy]
#[pyfunction]
fn elastic_stress_to_voigt(stress: [[f64; 3]; 3]) -> [f64; 6] {
    let stress_mat = Matrix3::from_row_slice(&[
        stress[0][0],
        stress[0][1],
        stress[0][2],
        stress[1][0],
        stress[1][1],
        stress[1][2],
        stress[2][0],
        stress[2][1],
        stress[2][2],
    ]);
    elastic::stress_to_voigt(&stress_mat)
}

/// Convert strain tensor to Voigt notation.
///
/// Args:
///     strain: 3x3 strain tensor
///
/// Returns:
///     6-element Voigt vector [xx, yy, zz, 2*yz, 2*xz, 2*xy]
#[pyfunction]
fn elastic_strain_to_voigt(strain: [[f64; 3]; 3]) -> [f64; 6] {
    let strain_mat = Matrix3::from_row_slice(&[
        strain[0][0],
        strain[0][1],
        strain[0][2],
        strain[1][0],
        strain[1][1],
        strain[1][2],
        strain[2][0],
        strain[2][1],
        strain[2][2],
    ]);
    elastic::strain_to_voigt(&strain_mat)
}

/// Compute elastic tensor from stress-strain data.
///
/// Args:
///     strains: List of 3x3 strain matrices
///     stresses: List of 3x3 stress matrices (same length as strains)
///
/// Returns:
///     6x6 elastic tensor in Voigt notation
#[pyfunction]
fn elastic_tensor_from_stresses(
    strains: Vec<[[f64; 3]; 3]>,
    stresses: Vec<[[f64; 3]; 3]>,
) -> PyResult<[[f64; 6]; 6]> {
    if strains.len() != stresses.len() {
        return Err(PyValueError::new_err(
            "Strains and stresses must have same length",
        ));
    }

    let strain_mats: Vec<Matrix3<f64>> = strains
        .iter()
        .map(|s| {
            Matrix3::from_row_slice(&[
                s[0][0], s[0][1], s[0][2], s[1][0], s[1][1], s[1][2], s[2][0], s[2][1], s[2][2],
            ])
        })
        .collect();

    let stress_mats: Vec<Matrix3<f64>> = stresses
        .iter()
        .map(|s| {
            Matrix3::from_row_slice(&[
                s[0][0], s[0][1], s[0][2], s[1][0], s[1][1], s[1][2], s[2][0], s[2][1], s[2][2],
            ])
        })
        .collect();

    Ok(elastic::elastic_tensor_from_stresses(
        &strain_mats,
        &stress_mats,
    ))
}

/// Compute Voigt-Reuss-Hill bulk modulus from elastic tensor.
///
/// Args:
///     c: 6x6 elastic tensor in Voigt notation
///
/// Returns:
///     Bulk modulus (same units as input elastic tensor)
#[pyfunction]
fn elastic_bulk_modulus(c: [[f64; 6]; 6]) -> f64 {
    elastic::bulk_modulus(&c)
}

/// Compute Voigt-Reuss-Hill shear modulus from elastic tensor.
///
/// Args:
///     c: 6x6 elastic tensor in Voigt notation
///
/// Returns:
///     Shear modulus (same units as input elastic tensor)
#[pyfunction]
fn elastic_shear_modulus(c: [[f64; 6]; 6]) -> f64 {
    elastic::shear_modulus(&c)
}

/// Compute Young's modulus from bulk and shear moduli.
///
/// E = 9KG / (3K + G)
#[pyfunction]
fn elastic_youngs_modulus(k: f64, g: f64) -> f64 {
    elastic::youngs_modulus(k, g)
}

/// Compute Poisson's ratio from bulk and shear moduli.
///
/// nu = (3K - 2G) / (6K + 2G)
#[pyfunction]
fn elastic_poisson_ratio(k: f64, g: f64) -> f64 {
    elastic::poisson_ratio(k, g)
}

/// Check if elastic tensor satisfies mechanical stability.
///
/// Args:
///     c: 6x6 elastic tensor in Voigt notation
///
/// Returns:
///     True if all eigenvalues are positive (positive definite)
#[pyfunction]
fn elastic_is_stable(c: [[f64; 6]; 6]) -> bool {
    elastic::is_mechanically_stable(&c)
}

/// Compute Zener anisotropy ratio for cubic crystals.
///
/// A = 2 * C44 / (C11 - C12)
/// A = 1 for isotropic materials
#[pyfunction]
fn elastic_zener_ratio(c11: f64, c12: f64, c44: f64) -> f64 {
    elastic::zener_ratio(c11, c12, c44)
}

// === Bond Order Parameters ===

/// Compute Steinhardt q_l order parameter for each atom.
///
/// Args:
///     structure: pymatgen-style structure dict or JSON string
///     l: Degree of spherical harmonics (typical: 4 or 6)
///     cutoff: Neighbor cutoff distance in Angstrom
///
/// Returns:
///     List of q_l values for each atom
#[pyfunction]
fn compute_steinhardt_q(structure: StructureJson, l: i32, cutoff: f64) -> PyResult<Vec<f64>> {
    let rust_structure = parse_struct(&structure)?;
    Ok(order_params::compute_steinhardt_q(
        &rust_structure,
        l,
        cutoff,
    ))
}

/// Classify local structure based on q4 and q6 values.
///
/// Args:
///     q4: Local q4 value
///     q6: Local q6 value
///     tolerance: Classification tolerance (default: 0.1)
///
/// Returns:
///     Structure type string: "fcc", "bcc", "hcp", "icosahedral", "liquid", or "unknown"
#[pyfunction]
#[pyo3(signature = (q4, q6, tolerance = 0.1))]
fn classify_local_structure(q4: f64, q6: f64, tolerance: f64) -> &'static str {
    order_params::classify_local_structure(q4, q6, tolerance).as_str()
}

/// Classify all atoms in a structure based on their local order parameters.
///
/// Args:
///     structure: pymatgen-style structure dict or JSON string
///     cutoff: Neighbor cutoff distance in Angstrom
///     tolerance: Classification tolerance (default: 0.1)
///
/// Returns:
///     List of structure type strings for each atom
#[pyfunction]
#[pyo3(signature = (structure, cutoff, tolerance = 0.1))]
fn classify_all_atoms(
    structure: StructureJson,
    cutoff: f64,
    tolerance: f64,
) -> PyResult<Vec<&'static str>> {
    let rust_structure = parse_struct(&structure)?;
    Ok(
        order_params::classify_all_atoms(&rust_structure, cutoff, tolerance)
            .iter()
            .map(|s| s.as_str())
            .collect(),
    )
}

// === Trajectory Analysis ===

/// Streaming MSD calculator for large trajectories.
#[pyclass(name = "MsdCalculator")]
pub struct PyMsdCalculator {
    inner: MsdCalculator,
}

#[pymethods]
impl PyMsdCalculator {
    /// Create a new MSD calculator.
    ///
    /// Args:
    ///     n_atoms: Number of atoms
    ///     max_lag: Maximum lag time in frames
    ///     origin_interval: Frames between time origins (smaller = more samples)
    #[new]
    fn new(n_atoms: usize, max_lag: usize, origin_interval: usize) -> Self {
        Self {
            inner: MsdCalculator::new(n_atoms, max_lag, origin_interval),
        }
    }

    /// Add a frame to the MSD calculation.
    ///
    /// Args:
    ///     positions: Nx3 array of atomic positions
    fn add_frame(&mut self, positions: Vec<[f64; 3]>) -> PyResult<()> {
        if positions.len() != self.inner.n_atoms() {
            return Err(PyValueError::new_err(format!(
                "Positions length ({}) must match n_atoms ({})",
                positions.len(),
                self.inner.n_atoms()
            )));
        }
        let pos_vec: Vec<Vector3<f64>> = positions.iter().map(|p| Vector3::from(*p)).collect();
        self.inner.add_frame(&pos_vec);
        Ok(())
    }

    /// Compute final MSD values averaged over all atoms.
    ///
    /// Returns:
    ///     List of MSD values for each lag time
    fn compute_msd(&self) -> Vec<f64> {
        self.inner.compute_msd()
    }

    /// Compute MSD for each atom separately.
    ///
    /// Returns:
    ///     2D list: [lag][atom]
    fn compute_msd_per_atom(&self) -> Vec<Vec<f64>> {
        self.inner.compute_msd_per_atom()
    }
}

/// Streaming VACF calculator for large trajectories.
#[pyclass(name = "VacfCalculator")]
pub struct PyVacfCalculator {
    inner: VacfCalculator,
}

#[pymethods]
impl PyVacfCalculator {
    /// Create a new VACF calculator.
    ///
    /// Args:
    ///     n_atoms: Number of atoms
    ///     max_lag: Maximum lag time in frames
    ///     origin_interval: Frames between time origins
    #[new]
    fn new(n_atoms: usize, max_lag: usize, origin_interval: usize) -> Self {
        Self {
            inner: VacfCalculator::new(n_atoms, max_lag, origin_interval),
        }
    }

    /// Add a frame to the VACF calculation.
    ///
    /// Args:
    ///     velocities: Nx3 array of atomic velocities
    fn add_frame(&mut self, velocities: Vec<[f64; 3]>) -> PyResult<()> {
        if velocities.len() != self.inner.n_atoms() {
            return Err(PyValueError::new_err(format!(
                "Velocities length ({}) must match n_atoms ({})",
                velocities.len(),
                self.inner.n_atoms()
            )));
        }
        let vel_vec: Vec<Vector3<f64>> = velocities.iter().map(|v| Vector3::from(*v)).collect();
        self.inner.add_frame(&vel_vec);
        Ok(())
    }

    /// Compute final VACF values.
    ///
    /// Returns:
    ///     List of VACF values for each lag time
    fn compute_vacf(&self) -> Vec<f64> {
        self.inner.compute_vacf()
    }

    /// Compute normalized VACF (VACF(t) / VACF(0)).
    fn compute_normalized_vacf(&self) -> Vec<f64> {
        self.inner.compute_normalized_vacf()
    }
}

/// Compute diffusion coefficient from MSD using Einstein relation.
///
/// Args:
///     msd: MSD values for each lag time
///     times: Time values for each lag
///     dim: Dimensionality (default: 3)
///     start_fraction: Start of fitting region (default: 0.1)
///     end_fraction: End of fitting region (default: 0.9)
///
/// Returns:
///     (diffusion_coefficient, r_squared)
#[pyfunction]
#[pyo3(signature = (msd, times, dim = 3, start_fraction = 0.1, end_fraction = 0.9))]
fn diffusion_from_msd(
    msd: Vec<f64>,
    times: Vec<f64>,
    dim: usize,
    start_fraction: f64,
    end_fraction: f64,
) -> PyResult<(f64, f64)> {
    if msd.len() != times.len() {
        return Err(PyValueError::new_err("MSD and times must have same length"));
    }
    Ok(crate::trajectory::diffusion_coefficient_from_msd(
        &msd,
        &times,
        dim,
        start_fraction,
        end_fraction,
    ))
}

/// Compute diffusion coefficient from VACF using Green-Kubo relation.
///
/// Args:
///     vacf: VACF values for each lag time
///     dt: Time step between frames
///     dim: Dimensionality (default: 3)
///
/// Returns:
///     Diffusion coefficient
#[pyfunction]
#[pyo3(signature = (vacf, dt, dim = 3))]
fn diffusion_from_vacf(vacf: Vec<f64>, dt: f64, dim: usize) -> f64 {
    crate::trajectory::diffusion_coefficient_from_vacf(&vacf, dt, dim)
}

// === Point Defect Generation ===

use crate::defects;

/// Helper to build a Python dict from a DefectStructure result.
fn defect_result_to_pydict(
    py: Python<'_>,
    result: &defects::DefectStructure,
) -> PyResult<Py<PyDict>> {
    let dict = PyDict::new(py);
    let struct_json = structure_to_pymatgen_json(&result.structure);
    dict.set_item("structure", json_to_pydict(py, &struct_json)?)?;
    dict.set_item("defect_type", result.defect.defect_type.as_str())?;
    dict.set_item("site_idx", result.defect.site_idx)?;
    dict.set_item("position", result.defect.position.as_slice())?;
    if let Some(ref species) = result.defect.species {
        dict.set_item("species", species.to_string())?;
    }
    if let Some(ref original) = result.defect.original_species {
        dict.set_item("original_species", original.to_string())?;
    }
    Ok(dict.unbind())
}

/// Create a vacancy by removing an atom at the specified site index.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     site_idx: Index of the site to remove.
///
/// Returns:
///     Dict with 'structure' (defective structure as dict) and 'defect' (defect info).
#[pyfunction]
fn defect_create_vacancy(
    py: Python<'_>,
    structure: StructureJson,
    site_idx: usize,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let result = defects::create_vacancy(&struc, site_idx)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    defect_result_to_pydict(py, &result)
}

/// Create a substitutional defect by replacing the species at a site.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     site_idx: Index of the site to substitute.
///     new_species: Species string (e.g., "K", "Fe2+") to place at the site.
///
/// Returns:
///     Dict with 'structure' and 'defect' info.
#[pyfunction]
fn defect_create_substitution(
    py: Python<'_>,
    structure: StructureJson,
    site_idx: usize,
    new_species: &str,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let species = Species::from_string(new_species)
        .ok_or_else(|| PyValueError::new_err(format!("Invalid species: {new_species}")))?;
    let result = defects::create_substitution(&struc, site_idx, species)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    defect_result_to_pydict(py, &result)
}

/// Create an interstitial by adding an atom at a fractional position.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     position: Fractional coordinates [a, b, c] for the interstitial.
///     species: Species string (e.g., "Li", "O2-") to add.
///
/// Returns:
///     Dict with 'structure' and 'defect' info.
#[pyfunction]
fn defect_create_interstitial(
    py: Python<'_>,
    structure: StructureJson,
    position: [f64; 3],
    species: &str,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let new_species = Species::from_string(species)
        .ok_or_else(|| PyValueError::new_err(format!("Invalid species: {species}")))?;
    let frac_pos = Vector3::new(position[0], position[1], position[2]);
    let result = defects::create_interstitial(&struc, frac_pos, new_species)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    defect_result_to_pydict(py, &result)
}

/// Create an antisite pair by swapping species at two sites.
///
/// Note: Unlike other `defect_create_*` functions which return a dict with both
/// 'structure' and 'defect' info, this returns only the structure dict. This is
/// because antisites involve two sites being swapped rather than a single defect
/// site, making the defect info representation ambiguous.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     site_a_idx: Index of the first site.
///     site_b_idx: Index of the second site.
///
/// Returns:
///     Structure dict with swapped species (no defect metadata).
#[pyfunction]
fn defect_create_antisite(
    py: Python<'_>,
    structure: StructureJson,
    site_a_idx: usize,
    site_b_idx: usize,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let result = defects::create_antisite_pair(&struc, site_a_idx, site_b_idx)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    let struct_json = structure_to_pymatgen_json(&result);
    json_to_pydict(py, &struct_json)
}

/// Find potential interstitial sites using Voronoi tessellation.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     min_dist: Minimum distance to nearest atom for a valid site (Angstrom).
///     symprec: Symmetry precision for site deduplication (default: 0.01).
///
/// Returns:
///     List of dicts with 'frac_coords', 'cart_coords', 'min_distance', 'coordination',
///     and 'site_type'.
#[pyfunction]
#[pyo3(signature = (structure, min_dist, symprec = 0.01))]
fn defect_find_interstitial_sites(
    py: Python<'_>,
    structure: StructureJson,
    min_dist: f64,
    symprec: f64,
) -> PyResult<Vec<Py<PyDict>>> {
    if !min_dist.is_finite() || min_dist <= 0.0 {
        return Err(PyValueError::new_err(
            "min_dist must be positive and finite",
        ));
    }
    let struc = parse_struct(&structure)?;
    let sites = defects::find_voronoi_interstitials(&struc, Some(min_dist), symprec);

    let results: PyResult<Vec<Py<PyDict>>> = sites
        .into_iter()
        .map(|site| {
            let dict = PyDict::new(py);
            dict.set_item("frac_coords", site.frac_coords.as_slice())?;
            dict.set_item("cart_coords", site.cart_coords.as_slice())?;
            dict.set_item("min_distance", site.min_distance)?;
            dict.set_item("coordination", site.coordination)?;
            dict.set_item("site_type", site.site_type.as_str())?;
            Ok(dict.unbind())
        })
        .collect();

    results
}

/// Find an optimal supercell matrix for dilute defect calculations.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     min_image_dist: Minimum distance between periodic images (Angstrom, default: 10.0).
///     max_atoms: Maximum number of atoms in supercell (default: 200).
///     cubic: Preference for cubic supercells (default: False).
///
/// Returns:
///     3x3 integer transformation matrix [[a1,a2,a3], [b1,b2,b3], [c1,c2,c3]].
#[pyfunction]
#[pyo3(signature = (structure, min_image_dist = 10.0, max_atoms = 200, cubic = false))]
fn defect_find_supercell(
    structure: StructureJson,
    min_image_dist: f64,
    max_atoms: usize,
    cubic: bool,
) -> PyResult<[[i32; 3]; 3]> {
    let struc = parse_struct(&structure)?;

    // Validate min_image_dist: must be finite and positive
    if !min_image_dist.is_finite() || min_image_dist <= 0.0 {
        return Err(PyValueError::new_err(
            "min_image_dist must be positive and finite",
        ));
    }
    // Validate max_atoms: must be positive
    if max_atoms == 0 {
        return Err(PyValueError::new_err("max_atoms must be greater than 0"));
    }

    let config = defects::DefectSupercellConfig {
        min_distance: min_image_dist,
        max_atoms,
        cubic_preference: if cubic { 1.0 } else { 0.0 },
    };

    defects::find_defect_supercell(&struc, &config)
        .map_err(|err| PyValueError::new_err(err.to_string()))
}

/// Classify an interstitial site based on its coordination number.
///
/// Args:
///     coordination: The coordination number of the site.
///
/// Returns:
///     Site type string: "tetrahedral", "octahedral", "trigonal", or "other".
#[pyfunction]
fn defect_classify_site(coordination: usize) -> String {
    defects::classify_interstitial_site(coordination)
        .as_str()
        .to_string()
}

// =============================================================================
// Distortion Functions (ShakeNBreak-style)
// =============================================================================

use crate::distortions;

/// Distort bonds around a defect site by specified factors.
///
/// For each distortion factor, creates a new structure where neighbor atoms are
/// moved along their bond direction by `factor * original_distance`.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     center_site_idx: Index of the defect/center site.
///     distortion_factors: List of factors to apply (e.g., [-0.4, -0.2, 0.2, 0.4]).
///     num_neighbors: Maximum neighbors to distort (None = all within cutoff).
///     cutoff: Neighbor cutoff distance in Angstrom (default: 5.0).
///
/// Returns:
///     List of dicts with 'structure', 'distortion_type', 'distortion_factor', 'center_site_idx'.
#[pyfunction]
#[pyo3(signature = (structure, center_site_idx, distortion_factors, num_neighbors = None, cutoff = 5.0))]
fn defect_distort_bonds(
    py: Python<'_>,
    structure: StructureJson,
    center_site_idx: usize,
    distortion_factors: Vec<f64>,
    num_neighbors: Option<usize>,
    cutoff: f64,
) -> PyResult<Py<PyList>> {
    let struc = parse_struct(&structure)?;
    let results = distortions::distort_bonds(
        &struc,
        center_site_idx,
        &distortion_factors,
        num_neighbors,
        cutoff,
    )
    .map_err(|err| PyValueError::new_err(err.to_string()))?;

    let list = PyList::empty(py);
    for result in results {
        let dict = PyDict::new(py);
        let struct_json = structure_to_pymatgen_json(&result.structure);
        dict.set_item("structure", json_to_pydict(py, &struct_json)?)?;
        dict.set_item("distortion_type", result.distortion_type)?;
        dict.set_item("distortion_factor", result.distortion_factor)?;
        dict.set_item("center_site_idx", result.center_site_idx)?;
        list.append(dict)?;
    }
    Ok(list.unbind())
}

/// Create a dimer by moving two atoms closer together.
///
/// Both atoms are moved equally toward their midpoint until the target distance
/// is reached. Handles periodic boundary conditions correctly.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     site_a_idx: Index of the first atom.
///     site_b_idx: Index of the second atom.
///     target_distance: Desired distance between atoms in Angstrom.
///
/// Returns:
///     Dict with 'structure', 'distortion_type', 'distortion_factor', 'center_site_idx'.
#[pyfunction]
fn defect_create_dimer(
    py: Python<'_>,
    structure: StructureJson,
    site_a_idx: usize,
    site_b_idx: usize,
    target_distance: f64,
) -> PyResult<Py<PyDict>> {
    // Validate target_distance: must be finite and positive
    if !target_distance.is_finite() || target_distance <= 0.0 {
        return Err(PyValueError::new_err(
            "target_distance must be positive and finite",
        ));
    }

    let struc = parse_struct(&structure)?;
    let result = distortions::create_dimer(&struc, site_a_idx, site_b_idx, target_distance)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    let dict = PyDict::new(py);
    let struct_json = structure_to_pymatgen_json(&result.structure);
    dict.set_item("structure", json_to_pydict(py, &struct_json)?)?;
    dict.set_item("distortion_type", result.distortion_type)?;
    dict.set_item("distortion_factor", result.distortion_factor)?;
    dict.set_item("center_site_idx", result.center_site_idx)?;
    Ok(dict.unbind())
}

/// Apply Monte Carlo rattling to all atoms in a structure.
///
/// Each atom receives a random displacement drawn from a Gaussian distribution
/// with direction uniformly random on the unit sphere.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     stdev: Standard deviation of Gaussian displacement (Angstrom).
///     seed: Random seed for reproducibility.
///     min_distance: Minimum allowed distance between atoms (default: 0.5).
///     max_attempts: Maximum attempts per atom to avoid collisions (default: 100).
///
/// Returns:
///     Dict with 'structure', 'distortion_type', 'distortion_factor', 'center_site_idx'.
#[pyfunction]
#[pyo3(signature = (structure, stdev, seed, min_distance = 0.5, max_attempts = 100))]
fn defect_rattle(
    py: Python<'_>,
    structure: StructureJson,
    stdev: f64,
    seed: u64,
    min_distance: f64,
    max_attempts: usize,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;

    // Validate stdev: must be finite and non-negative
    if !stdev.is_finite() || stdev < 0.0 {
        return Err(PyValueError::new_err(
            "stdev must be non-negative and finite",
        ));
    }
    // Validate min_distance: must be finite and non-negative
    if !min_distance.is_finite() || min_distance < 0.0 {
        return Err(PyValueError::new_err(
            "min_distance must be non-negative and finite",
        ));
    }
    // Validate max_attempts: must be positive
    if max_attempts == 0 {
        return Err(PyValueError::new_err("max_attempts must be greater than 0"));
    }

    let result = distortions::rattle_structure(&struc, stdev, seed, min_distance, max_attempts)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    let dict = PyDict::new(py);
    let struct_json = structure_to_pymatgen_json(&result.structure);
    dict.set_item("structure", json_to_pydict(py, &struct_json)?)?;
    dict.set_item("distortion_type", result.distortion_type)?;
    dict.set_item("distortion_factor", result.distortion_factor)?;
    dict.set_item("center_site_idx", result.center_site_idx)?;
    Ok(dict.unbind())
}

/// Apply local rattling with distance-dependent amplitude decay.
///
/// Displacement amplitude decays exponentially with distance from the center site:
/// amplitude = max_amplitude * exp(-distance / decay_radius)
///
/// Args:
///     structure: Structure as JSON string or dict.
///     center_site_idx: Index of the center site (e.g., defect site).
///     max_amplitude: Maximum displacement amplitude at center (Angstrom).
///     decay_radius: Decay length scale (Angstrom).
///     seed: Random seed for reproducibility.
///
/// Returns:
///     Dict with 'structure', 'distortion_type', 'distortion_factor', 'center_site_idx'.
#[pyfunction]
fn defect_local_rattle(
    py: Python<'_>,
    structure: StructureJson,
    center_site_idx: usize,
    max_amplitude: f64,
    decay_radius: f64,
    seed: u64,
) -> PyResult<Py<PyDict>> {
    // Validate max_amplitude: must be finite and non-negative
    if !max_amplitude.is_finite() || max_amplitude < 0.0 {
        return Err(PyValueError::new_err(
            "max_amplitude must be non-negative and finite",
        ));
    }
    // Validate decay_radius: must be finite and positive
    if !decay_radius.is_finite() || decay_radius <= 0.0 {
        return Err(PyValueError::new_err(
            "decay_radius must be positive and finite",
        ));
    }

    let struc = parse_struct(&structure)?;
    let result =
        distortions::local_rattle(&struc, center_site_idx, max_amplitude, decay_radius, seed)
            .map_err(|err| PyValueError::new_err(err.to_string()))?;

    let dict = PyDict::new(py);
    let struct_json = structure_to_pymatgen_json(&result.structure);
    dict.set_item("structure", json_to_pydict(py, &struct_json)?)?;
    dict.set_item("distortion_type", result.distortion_type)?;
    dict.set_item("distortion_factor", result.distortion_factor)?;
    dict.set_item("center_site_idx", result.center_site_idx)?;
    Ok(dict.unbind())
}

// =============================================================================
// Voronoi Interstitials
// =============================================================================

/// Find interstitial sites using Voronoi tessellation.
///
/// Identifies potential interstitial positions as vertices of the Voronoi
/// tessellation of the atomic positions. Sites are filtered by minimum distance
/// and optionally reduced by symmetry.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     min_dist: Minimum distance to nearest atom (default: 0.5 Å if None).
///     symprec: Symmetry precision for equivalent site detection (default: 0.01).
///
/// Returns:
///     List of dicts with 'frac_coords', 'cart_coords', 'min_dist', 'coordination',
///     'site_type', 'wyckoff', 'multiplicity'.
#[pyfunction]
#[pyo3(signature = (structure, min_dist = None, symprec = 0.01))]
fn defect_find_voronoi_interstitials(
    py: Python<'_>,
    structure: StructureJson,
    min_dist: Option<f64>,
    symprec: f64,
) -> PyResult<Py<PyList>> {
    // Validate min_dist if provided: must be finite and non-negative
    if let Some(dist) = min_dist {
        if !dist.is_finite() || dist < 0.0 {
            return Err(PyValueError::new_err(
                "min_dist must be non-negative and finite",
            ));
        }
    }

    let struc = parse_struct(&structure)?;
    let sites = defects::find_voronoi_interstitials(&struc, min_dist, symprec);

    let list = PyList::empty(py);
    for site in sites {
        let dict = PyDict::new(py);
        dict.set_item("frac_coords", site.frac_coords.as_slice())?;
        dict.set_item("cart_coords", site.cart_coords.as_slice())?;
        dict.set_item("min_dist", site.min_distance)?;
        dict.set_item("coordination", site.coordination)?;
        dict.set_item("site_type", site.site_type.as_str())?;
        dict.set_item("wyckoff", site.wyckoff_label)?;
        dict.set_item("multiplicity", site.multiplicity)?;
        list.append(dict)?;
    }
    Ok(list.unbind())
}

// =============================================================================
// Defect Naming
// =============================================================================

/// Generate a doped-compatible name for a point defect.
///
/// Naming conventions:
/// - Vacancy: `v_{element}` or `v_{element}_{wyckoff}` (e.g., "v_O", "v_O_4a")
/// - Substitution: `{new}_on_{original}` (e.g., "Fe_on_Ni")
/// - Interstitial: `{element}_i` or `{element}_i_{site_type}` (e.g., "Li_i", "Li_i_oct")
/// - Antisite: `{A}_{B}` swap notation (e.g., "Fe_Ni" for Fe on Ni site)
///
/// Args:
///     defect_type: One of "vacancy", "interstitial", "substitution", "antisite".
///     species: Species at the defect site (e.g., "Li" for interstitial).
///     original_species: Original species before defect (e.g., "O" for vacancy).
///     wyckoff: Optional Wyckoff label (e.g., "4a", "8c").
///     site_type: Optional site type for interstitials (e.g., "oct", "tet").
///
/// Returns:
///     String name following doped naming conventions.
#[pyfunction]
#[pyo3(signature = (defect_type, species = None, original_species = None, wyckoff = None, site_type = None))]
fn defect_generate_name(
    defect_type: &str,
    species: Option<&str>,
    original_species: Option<&str>,
    wyckoff: Option<&str>,
    site_type: Option<&str>,
) -> PyResult<String> {
    // Build a PointDefect for naming
    let dtype = match defect_type.to_lowercase().as_str() {
        "vacancy" => defects::DefectType::Vacancy,
        "interstitial" => defects::DefectType::Interstitial,
        "substitution" => defects::DefectType::Substitution,
        "antisite" => defects::DefectType::Antisite,
        _ => {
            return Err(PyValueError::new_err(format!(
                "Unknown defect type: {defect_type}"
            )));
        }
    };

    let sp = match species {
        Some(s) => match Species::from_string(s) {
            Some(parsed) => Some(parsed),
            None => {
                return Err(PyValueError::new_err(format!(
                    "Invalid species string: '{s}'"
                )));
            }
        },
        None => None,
    };
    let orig_sp = match original_species {
        Some(s) => match Species::from_string(s) {
            Some(parsed) => Some(parsed),
            None => {
                return Err(PyValueError::new_err(format!(
                    "Invalid original_species string: '{s}'"
                )));
            }
        },
        None => None,
    };

    let defect = defects::PointDefect {
        defect_type: dtype,
        site_idx: None,
        position: Vector3::zeros(),
        species: sp,
        original_species: orig_sp,
        charge: 0,
    };

    Ok(defects::generate_defect_name(&defect, wyckoff, site_type))
}

// =============================================================================
// Charge State Guessing
// =============================================================================

use crate::oxidation;

/// Guess likely charge states for a point defect.
///
/// Uses ICSD oxidation state probabilities to predict which charge states
/// are most likely for a given defect based on the species involved.
///
/// Args:
///     defect_type: One of "vacancy", "interstitial", "substitution", "antisite".
///     removed_species: Element symbol removed (for vacancy, antisite).
///     added_species: Element symbol added (for interstitial, substitution, antisite).
///     original_species: Original element (for substitution).
///     max_charge: Maximum absolute charge to consider (default: 4).
///
/// Returns:
///     List of dicts with 'charge', 'probability', 'reasoning'.
#[pyfunction]
#[pyo3(signature = (defect_type, removed_species = None, added_species = None, original_species = None, max_charge = 4))]
fn defect_guess_charge_states(
    py: Python<'_>,
    defect_type: &str,
    removed_species: Option<&str>,
    added_species: Option<&str>,
    original_species: Option<&str>,
    max_charge: i32,
) -> PyResult<Py<PyList>> {
    let dtype = match defect_type.to_lowercase().as_str() {
        "vacancy" => defects::DefectType::Vacancy,
        "interstitial" => defects::DefectType::Interstitial,
        "substitution" => defects::DefectType::Substitution,
        "antisite" => defects::DefectType::Antisite,
        _ => {
            return Err(PyValueError::new_err(format!(
                "Unknown defect type: {defect_type}"
            )));
        }
    };

    let guesses = oxidation::guess_defect_charge_states(
        dtype,
        removed_species,
        added_species,
        original_species,
        max_charge,
    );

    let list = PyList::empty(py);
    for guess in guesses {
        let dict = PyDict::new(py);
        dict.set_item("charge", guess.charge)?;
        dict.set_item("probability", guess.probability)?;
        dict.set_item("reasoning", guess.reasoning)?;
        list.append(dict)?;
    }
    Ok(list.unbind())
}

// =============================================================================
// Defect Generator
// =============================================================================

/// Generate all point defects for a structure.
///
/// Main workflow function that analyzes symmetry, finds unique sites, and
/// generates all requested defect types with charge state predictions.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     extrinsic: List of element symbols to use as substitutional dopants.
///     include_vacancies: Whether to generate vacancies (default: True).
///     include_substitutions: Whether to generate substitutions (default: True).
///     include_interstitials: Whether to generate interstitials (default: True).
///     include_antisites: Whether to generate antisites (default: True).
///     supercell_min_dist: Minimum image distance for supercell in Å (default: 10.0).
///     supercell_max_atoms: Maximum atoms in supercell (default: 400).
///     interstitial_min_dist: Minimum distance for interstitial sites in Å (default: None).
///     symprec: Symmetry precision (default: 0.01).
///     max_charge: Maximum absolute charge state magnitude (default: 4).
///
/// Returns:
///     Dict with 'supercell_matrix', 'vacancies', 'substitutions', 'interstitials',
///     'antisites', 'spacegroup', 'n_defects'. Each defect list contains dicts with
///     'name', 'defect_type', 'site_idx', 'frac_coords', 'species', 'original_species',
///     'wyckoff', 'site_symmetry', 'charge_states', 'equivalent_sites'.
#[pyfunction]
#[pyo3(signature = (
    structure,
    extrinsic = vec![],
    include_vacancies = true,
    include_substitutions = true,
    include_interstitials = true,
    include_antisites = true,
    supercell_min_dist = 10.0,
    supercell_max_atoms = 400,
    interstitial_min_dist = None,
    symprec = 0.01,
    max_charge = 4
))]
#[allow(clippy::too_many_arguments)]
fn defect_generate_all(
    py: Python<'_>,
    structure: StructureJson,
    extrinsic: Vec<String>,
    include_vacancies: bool,
    include_substitutions: bool,
    include_interstitials: bool,
    include_antisites: bool,
    supercell_min_dist: f64,
    supercell_max_atoms: usize,
    interstitial_min_dist: Option<f64>,
    symprec: f64,
    max_charge: i32,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;

    let config = defects::DefectsGeneratorConfig {
        extrinsic,
        include_vacancies,
        include_substitutions,
        include_interstitials,
        include_antisites,
        supercell_min_dist,
        supercell_max_atoms,
        interstitial_min_dist,
        symprec,
        max_charge,
    };

    let result = defects::generate_all_defects(&struc, &config)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    // Helper to convert DefectEntry to PyDict
    fn entry_to_dict(py: Python<'_>, entry: &defects::DefectEntry) -> PyResult<pyo3::Py<PyDict>> {
        let dict = PyDict::new(py);
        dict.set_item("name", &entry.name)?;
        dict.set_item("defect_type", entry.defect_type.as_str())?;
        dict.set_item("site_idx", entry.site_idx)?;
        dict.set_item("frac_coords", entry.frac_coords.as_slice())?;
        dict.set_item("species", &entry.species)?;
        dict.set_item("original_species", &entry.original_species)?;
        dict.set_item("wyckoff", &entry.wyckoff)?;
        dict.set_item("site_symmetry", &entry.site_symmetry)?;
        dict.set_item("equivalent_sites", entry.equivalent_sites)?;

        // Convert charge states
        let charges = PyList::empty(py);
        for cs in &entry.charge_states {
            let cs_dict = PyDict::new(py);
            cs_dict.set_item("charge", cs.charge)?;
            cs_dict.set_item("probability", cs.probability)?;
            cs_dict.set_item("reasoning", &cs.reasoning)?;
            charges.append(cs_dict)?;
        }
        dict.set_item("charge_states", charges)?;
        Ok(dict.unbind())
    }

    // Helper to convert defect list to PyList
    let entries_to_list = |entries: &[defects::DefectEntry]| -> PyResult<pyo3::Py<PyList>> {
        let list = PyList::empty(py);
        for entry in entries {
            list.append(entry_to_dict(py, entry)?)?;
        }
        Ok(list.unbind())
    };

    let main_dict = PyDict::new(py);
    let matrix: Vec<Vec<i32>> = result
        .supercell_matrix
        .iter()
        .map(|row| row.to_vec())
        .collect();
    main_dict.set_item("supercell_matrix", matrix)?;
    main_dict.set_item("vacancies", entries_to_list(&result.vacancies)?)?;
    main_dict.set_item("substitutions", entries_to_list(&result.substitutions)?)?;
    main_dict.set_item("interstitials", entries_to_list(&result.interstitials)?)?;
    main_dict.set_item("antisites", entries_to_list(&result.antisites)?)?;
    main_dict.set_item("spacegroup", result.spacegroup)?;
    main_dict.set_item("n_defects", result.n_defects)?;

    Ok(main_dict.unbind())
}

// =============================================================================
// Wyckoff Labels
// =============================================================================

/// Get Wyckoff labels for all sites in a structure.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     symprec: Symmetry precision for spglib (default: 0.01).
///
/// Returns:
///     List of dicts with 'label', 'multiplicity', 'site_symmetry', 'representative_coords',
///     or None if symmetry analysis fails.
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_wyckoff_labels(
    py: Python<'_>,
    structure: StructureJson,
    symprec: f64,
) -> PyResult<Option<Py<PyList>>> {
    let struc = parse_struct(&structure)?;
    let sites = match struc.get_wyckoff_sites(symprec) {
        Ok(s) => s,
        Err(_) => return Ok(None),
    };

    let list = PyList::empty(py);
    for site in sites {
        let dict = PyDict::new(py);
        dict.set_item("label", site.label)?;
        dict.set_item("multiplicity", site.multiplicity)?;
        dict.set_item("site_symmetry", site.site_symmetry)?;
        dict.set_item(
            "representative_coords",
            site.representative_coords.as_slice(),
        )?;
        list.append(dict)?;
    }
    Ok(Some(list.unbind()))
}

// =============================================================================
// Surface Analysis Functions
// =============================================================================

use crate::surfaces;

/// Enumerate all unique Miller indices up to a maximum index value.
///
/// Args:
///     max_index: Maximum absolute value for any h, k, or l component.
///
/// Returns:
///     List of Miller indices as [h, k, l] arrays.
#[pyfunction]
fn surface_enumerate_miller(max_index: i32) -> Vec<[i32; 3]> {
    surfaces::enumerate_miller_indices(max_index)
        .into_iter()
        .map(|miller| miller.to_array())
        .collect()
}

/// Enumerate all unique terminations for a given Miller index.
///
/// Args:
///     structure: Bulk structure as JSON string or dict.
///     h, k, l: Miller index components.
///     min_slab: Minimum slab thickness in Angstroms (default: 10.0).
///     min_vacuum: Minimum vacuum thickness in Angstroms (default: 10.0).
///     symprec: Symmetry precision for finding unique terminations (default: 0.01).
///
/// Returns:
///     List of dicts with termination info including slab structure.
#[pyfunction]
#[pyo3(signature = (structure, h, k, l, min_slab = 10.0, min_vacuum = 10.0, symprec = 0.01))]
fn surface_enumerate_terminations(
    py: Python<'_>,
    structure: StructureJson,
    h: i32,
    k: i32,
    l: i32,
    min_slab: f64,
    min_vacuum: f64,
    symprec: f64,
) -> PyResult<Vec<Py<PyDict>>> {
    // Validate min_slab: must be finite and positive
    if !min_slab.is_finite() || min_slab <= 0.0 {
        return Err(PyValueError::new_err(
            "min_slab must be positive and finite",
        ));
    }
    // Validate min_vacuum: must be finite and positive
    if !min_vacuum.is_finite() || min_vacuum <= 0.0 {
        return Err(PyValueError::new_err(
            "min_vacuum must be positive and finite",
        ));
    }

    let struc = parse_struct(&structure)?;
    let miller = surfaces::MillerIndex::new(h, k, l);
    let config = surfaces::SlabConfigExt::new(miller)
        .with_min_slab_size(min_slab)
        .with_min_vacuum(min_vacuum);

    let terminations = surfaces::enumerate_terminations(&struc, miller, &config, symprec)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    let results: PyResult<Vec<Py<PyDict>>> = terminations
        .into_iter()
        .map(|term| {
            let dict = PyDict::new(py);
            dict.set_item("miller_index", term.miller_index.to_array())?;
            dict.set_item("shift", term.shift)?;
            let species_strs: Vec<String> = term
                .surface_species
                .iter()
                .map(|sp| sp.to_string())
                .collect();
            dict.set_item("surface_species", species_strs)?;
            dict.set_item("surface_density", term.surface_density)?;
            dict.set_item("is_polar", term.is_polar)?;
            let slab_json = structure_to_pymatgen_json(&term.slab);
            dict.set_item("slab", json_to_pydict(py, &slab_json)?)?;
            Ok(dict.unbind())
        })
        .collect();

    results
}

/// Find adsorption sites on a slab surface.
///
/// Args:
///     slab: Slab structure as JSON string or dict.
///     height: Height above surface for placing adsorbates (Angstroms, default: 2.0).
///     site_types: Optional list of site types to find ("atop", "bridge", "hollow3", "hollow4").
///     neighbor_cutoff: Optional cutoff for neighbor analysis (default: 4.0 Angstroms).
///         May need adjustment for structures with longer bonds (e.g., some oxides)
///         or shorter bonds in close-packed structures.
///     surface_tolerance: Optional tolerance for identifying surface atoms (default: 0.1 Angstroms).
///
/// Returns:
///     List of dicts with site info (type, position, coordinating atoms).
#[pyfunction]
#[pyo3(signature = (slab, height = 2.0, site_types = None, neighbor_cutoff = None, surface_tolerance = None))]
fn surface_find_adsorption_sites(
    py: Python<'_>,
    slab: StructureJson,
    height: f64,
    site_types: Option<Vec<String>>,
    neighbor_cutoff: Option<f64>,
    surface_tolerance: Option<f64>,
) -> PyResult<Vec<Py<PyDict>>> {
    // Validate height: must be finite and non-negative (zero = on surface plane)
    if !height.is_finite() || height < 0.0 {
        return Err(PyValueError::new_err(
            "height must be non-negative and finite",
        ));
    }
    // Validate neighbor_cutoff if provided: must be finite and positive
    if let Some(cutoff) = neighbor_cutoff {
        if !cutoff.is_finite() || cutoff <= 0.0 {
            return Err(PyValueError::new_err(
                "neighbor_cutoff must be positive and finite",
            ));
        }
    }

    let struc = parse_struct(&slab)?;

    let types_filter: Option<Vec<surfaces::AdsorptionSiteType>> = match site_types {
        Some(types) => {
            let mut parsed = Vec::with_capacity(types.len());
            for type_str in &types {
                match surfaces::AdsorptionSiteType::parse(type_str) {
                    Some(t) => parsed.push(t),
                    None => {
                        return Err(PyValueError::new_err(format!(
                            "Invalid adsorption site type: '{}'. Valid types: atop, bridge, hollow3, hollow4",
                            type_str
                        )));
                    }
                }
            }
            Some(parsed)
        }
        None => None,
    };

    let sites = surfaces::find_adsorption_sites(
        &struc,
        height,
        types_filter.as_deref(),
        neighbor_cutoff,
        surface_tolerance,
    )
    .map_err(|err| PyValueError::new_err(err.to_string()))?;

    let results: PyResult<Vec<Py<PyDict>>> = sites
        .into_iter()
        .map(|site| {
            let dict = PyDict::new(py);
            dict.set_item("site_type", site.site_type.as_str())?;
            dict.set_item(
                "position",
                [site.position.x, site.position.y, site.position.z],
            )?;
            dict.set_item(
                "cart_position",
                [
                    site.cart_position.x,
                    site.cart_position.y,
                    site.cart_position.z,
                ],
            )?;
            dict.set_item("height", site.height)?;
            dict.set_item("coordinating_atoms", site.coordinating_atoms.clone())?;
            dict.set_item("symmetry_multiplicity", site.symmetry_multiplicity)?;
            Ok(dict.unbind())
        })
        .collect();

    results
}

/// Get indices of surface atoms in a slab.
///
/// Args:
///     slab: Slab structure as JSON string or dict.
///     tolerance: Tolerance for identifying surface layer (fractional, default: 0.1).
///
/// Returns:
///     List of site indices for atoms at the top surface.
#[pyfunction]
#[pyo3(signature = (slab, tolerance = 0.1))]
fn surface_get_surface_atoms(slab: StructureJson, tolerance: f64) -> PyResult<Vec<usize>> {
    // Validate tolerance: must be finite and positive
    if !tolerance.is_finite() || tolerance <= 0.0 {
        return Err(PyValueError::new_err(
            "tolerance must be positive and finite",
        ));
    }
    let struc = parse_struct(&slab)?;
    Ok(surfaces::get_surface_atoms(&struc, tolerance))
}

/// Calculate the surface area of a slab.
///
/// Args:
///     slab: Slab structure as JSON string or dict.
///
/// Returns:
///     Surface area in Angstrom².
#[pyfunction]
fn surface_area(slab: StructureJson) -> PyResult<f64> {
    let struc = parse_struct(&slab)?;
    Ok(surfaces::surface_area(&struc))
}

/// Calculate surface energy from DFT energies.
///
/// Args:
///     slab_energy: Total energy of the slab (eV).
///     bulk_energy_per_atom: Energy per atom in the bulk (eV).
///     n_atoms: Number of atoms in the slab.
///     surface_area: Surface area (Angstrom²).
///
/// Returns:
///     Surface energy in eV/Angstrom².
///
/// Raises:
///     ValueError: If surface_area <= 0 or n_atoms == 0.
#[pyfunction]
fn surface_calculate_energy(
    slab_energy: f64,
    bulk_energy_per_atom: f64,
    n_atoms: usize,
    surface_area: f64,
) -> PyResult<f64> {
    if surface_area <= 0.0 {
        return Err(PyValueError::new_err("surface_area must be positive"));
    }
    if n_atoms == 0 {
        return Err(PyValueError::new_err("n_atoms must be greater than 0"));
    }
    if !slab_energy.is_finite() || !bulk_energy_per_atom.is_finite() {
        return Err(PyValueError::new_err(
            "slab_energy and bulk_energy_per_atom must be finite",
        ));
    }
    Ok(surfaces::calculate_surface_energy(
        slab_energy,
        bulk_energy_per_atom,
        n_atoms,
        surface_area,
    ))
}

/// Calculate the d-spacing for a Miller plane.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     h, k, l: Miller index components.
///
/// Returns:
///     d-spacing in Angstroms.
#[pyfunction]
fn surface_d_spacing(structure: StructureJson, h: i32, k: i32, l: i32) -> PyResult<f64> {
    let struc = parse_struct(&structure)?;
    surfaces::d_spacing(&struc.lattice, [h, k, l])
        .map_err(|err| PyValueError::new_err(err.to_string()))
}

/// Compute the Wulff shape (equilibrium crystal shape) from surface energies.
///
/// Args:
///     structure: Structure as JSON string or dict (for lattice info).
///     surface_energies: List of ([h, k, l], energy) tuples.
///
/// Returns:
///     Dict with Wulff shape info (facets, total_area, volume, sphericity).
#[pyfunction]
fn surface_compute_wulff(
    py: Python<'_>,
    structure: StructureJson,
    surface_energies: Vec<([i32; 3], f64)>,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;

    let energies: Vec<(surfaces::MillerIndex, f64)> = surface_energies
        .into_iter()
        .map(|(hkl, energy)| (surfaces::MillerIndex::from_array(hkl), energy))
        .collect();

    let wulff = surfaces::compute_wulff_shape(&struc.lattice, &energies)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    let result = PyDict::new(py);
    result.set_item("total_surface_area", wulff.total_surface_area)?;
    result.set_item("volume", wulff.volume)?;
    result.set_item("sphericity", wulff.sphericity)?;

    let facets_list = PyList::empty(py);
    for facet in &wulff.facets {
        let facet_dict = PyDict::new(py);
        facet_dict.set_item("miller_index", facet.miller_index.to_array())?;
        facet_dict.set_item("surface_energy", facet.surface_energy)?;
        facet_dict.set_item("normal", [facet.normal.x, facet.normal.y, facet.normal.z])?;
        facet_dict.set_item("distance_from_center", facet.distance_from_center)?;
        facet_dict.set_item("area_fraction", facet.area_fraction)?;
        facets_list.append(facet_dict)?;
    }
    result.set_item("facets", facets_list)?;

    Ok(result.unbind())
}

/// Convert a Miller index to a surface normal vector.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     h, k, l: Miller index components.
///
/// Returns:
///     Unit normal vector [x, y, z] in Cartesian coordinates.
#[pyfunction]
fn surface_miller_to_normal(
    structure: StructureJson,
    h: i32,
    k: i32,
    l: i32,
) -> PyResult<[f64; 3]> {
    let struc = parse_struct(&structure)?;
    let normal = surfaces::miller_to_normal(&struc.lattice, [h, k, l]);
    Ok([normal.x, normal.y, normal.z])
}

// =============================================================================
// Cell Operations (PBC, Reductions, Supercells)
// =============================================================================

use crate::cell_ops;

/// Compute minimum image distance between two positions under PBC.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     pos1: First position in fractional coordinates [a, b, c].
///     pos2: Second position in fractional coordinates [a, b, c].
///     pbc: Periodic boundary conditions [pbc_a, pbc_b, pbc_c].
///
/// Returns:
///     Minimum image distance in Angstroms.
#[pyfunction]
fn cell_minimum_image_distance(
    structure: StructureJson,
    pos1: [f64; 3],
    pos2: [f64; 3],
    pbc: [bool; 3],
) -> PyResult<f64> {
    let struc = parse_struct(&structure)?;
    let vec1 = Vector3::new(pos1[0], pos1[1], pos1[2]);
    let vec2 = Vector3::new(pos2[0], pos2[1], pos2[2]);
    Ok(cell_ops::minimum_image_distance(
        &struc.lattice,
        &vec1,
        &vec2,
        pbc,
    ))
}

/// Compute minimum image displacement vector under PBC.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     delta: Displacement in fractional coordinates [da, db, dc].
///     pbc: Periodic boundary conditions [pbc_a, pbc_b, pbc_c].
///
/// Returns:
///     Minimum image vector in Cartesian coordinates [x, y, z].
#[pyfunction]
fn cell_minimum_image_vector(
    structure: StructureJson,
    delta: [f64; 3],
    pbc: [bool; 3],
) -> PyResult<[f64; 3]> {
    let struc = parse_struct(&structure)?;
    let delta_vec = Vector3::new(delta[0], delta[1], delta[2]);
    let result = cell_ops::minimum_image_vector(&struc.lattice, &delta_vec, pbc);
    Ok([result[0], result[1], result[2]])
}

/// Wrap all site positions to the unit cell [0, 1)^3.
///
/// Args:
///     structure: Structure as JSON string or dict.
///
/// Returns:
///     Structure dict with wrapped positions.
#[pyfunction]
fn cell_wrap_to_unit_cell(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyDict>> {
    let mut struc = parse_struct(&structure)?;
    struc.wrap_to_unit_cell();
    let json = structure_to_pymatgen_json(&struc);
    json_to_pydict(py, &json)
}

/// Compute the Niggli-reduced cell of a structure.
///
/// The Niggli reduction produces a unique reduced cell with a ≤ b ≤ c and
/// specific conditions on angles.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     tolerance: Numerical tolerance for reduction (default: 1e-5).
///
/// Returns:
///     Dict with 'matrix' (3x3 Niggli lattice), 'transformation' (3x3 transform),
///     and 'form' ('TypeI' or 'TypeII').
#[pyfunction]
#[pyo3(signature = (structure, tolerance = 1e-5))]
fn cell_niggli_reduce(
    py: Python<'_>,
    structure: StructureJson,
    tolerance: f64,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let niggli = cell_ops::niggli_reduce(&struc.lattice, tolerance)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    let form_str = match niggli.form {
        cell_ops::NiggliForm::TypeI => "TypeI",
        cell_ops::NiggliForm::TypeII => "TypeII",
    };

    let dict = PyDict::new(py);
    dict.set_item("matrix", matrix3_to_array(&niggli.matrix))?;
    dict.set_item("transformation", matrix3_to_array(&niggli.transformation))?;
    dict.set_item("form", form_str)?;
    Ok(dict.unbind())
}

/// Check if a lattice is already Niggli-reduced.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     tolerance: Numerical tolerance for comparisons (default: 1e-5).
///
/// Returns:
///     True if the lattice satisfies Niggli conditions.
#[pyfunction]
#[pyo3(signature = (structure, tolerance = 1e-5))]
fn cell_is_niggli_reduced(structure: StructureJson, tolerance: f64) -> PyResult<bool> {
    let struc = parse_struct(&structure)?;
    Ok(cell_ops::is_niggli_reduced(&struc.lattice, tolerance))
}

/// Compute the Delaunay-reduced cell of a structure.
///
/// The Delaunay reduction produces a cell where all pairwise scalar products
/// of lattice vectors are non-positive (all angles ≥ 90°).
///
/// Args:
///     structure: Structure as JSON string or dict.
///     tolerance: Numerical tolerance for reduction (default: 1e-5).
///
/// Returns:
///     Dict with 'matrix' (3x3 Delaunay lattice) and 'transformation' (3x3 transform).
#[pyfunction]
#[pyo3(signature = (structure, tolerance = 1e-5))]
fn cell_delaunay_reduce(
    py: Python<'_>,
    structure: StructureJson,
    tolerance: f64,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let delaunay = cell_ops::delaunay_reduce(&struc.lattice, tolerance)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    let dict = PyDict::new(py);
    dict.set_item("matrix", matrix3_to_array(&delaunay.matrix))?;
    dict.set_item("transformation", matrix3_to_array(&delaunay.transformation))?;
    Ok(dict.unbind())
}

/// Find an optimal supercell matrix for a given strategy.
///
/// Args:
///     structure: Structure as JSON string or dict.
///     strategy: Supercell strategy - one of "target_atoms", "min_length", "min_image_dist".
///     target_value: Target value for the strategy (atoms, length in Å, or distance in Å).
///
/// Returns:
///     3x3 integer transformation matrix [[a1, a2, a3], [b1, b2, b3], [c1, c2, c3]].
#[pyfunction]
fn cell_find_supercell_matrix(
    structure: StructureJson,
    strategy: &str,
    target_value: Option<f64>,
) -> PyResult<[[i32; 3]; 3]> {
    let struc = parse_struct(&structure)?;
    let n_atoms = struc.num_sites();

    let cell_strategy = match strategy {
        "target_atoms" => {
            let target = target_value.unwrap_or(100.0);
            if target <= 0.0 || !target.is_finite() || target.fract() != 0.0 {
                return Err(PyValueError::new_err(
                    "target_atoms must be a positive finite integer",
                ));
            }
            cell_ops::SupercellStrategy::TargetAtoms(target as usize)
        }
        "min_length" => {
            let min_len = target_value.unwrap_or(10.0);
            if min_len <= 0.0 || !min_len.is_finite() {
                return Err(PyValueError::new_err(
                    "min_length must be a positive finite number",
                ));
            }
            cell_ops::SupercellStrategy::MinLength(min_len)
        }
        "min_image_dist" | "min_image_distance" => {
            let min_dist = target_value.unwrap_or(10.0);
            if min_dist <= 0.0 || !min_dist.is_finite() {
                return Err(PyValueError::new_err(
                    "min_image_dist must be a positive finite number",
                ));
            }
            cell_ops::SupercellStrategy::MinImageDistance(min_dist)
        }
        other => {
            return Err(PyValueError::new_err(format!(
                "Unknown strategy: {other}. Use 'target_atoms', 'min_length', or 'min_image_dist'"
            )));
        }
    };

    Ok(cell_ops::find_supercell_matrix(
        &struc.lattice,
        n_atoms,
        cell_strategy,
    ))
}

/// Check if two lattices are equivalent within tolerances.
///
/// Two lattices are equivalent if one can be transformed to the other by
/// an integer transformation matrix with determinant ±1.
///
/// Args:
///     structure1: First structure as JSON string or dict.
///     structure2: Second structure as JSON string or dict.
///     length_tol: Fractional tolerance for lattice vector lengths (default: 0.2).
///     angle_tol: Tolerance for angles in degrees (default: 5.0).
///
/// Returns:
///     True if the lattices are equivalent.
#[pyfunction]
#[pyo3(signature = (structure1, structure2, length_tol = 0.2, angle_tol = 5.0))]
fn cell_lattices_equivalent(
    structure1: StructureJson,
    structure2: StructureJson,
    length_tol: f64,
    angle_tol: f64,
) -> PyResult<bool> {
    let s1 = parse_struct(&structure1)?;
    let s2 = parse_struct(&structure2)?;
    Ok(cell_ops::lattices_equivalent(
        &s1.lattice,
        &s2.lattice,
        length_tol,
        angle_tol,
    ))
}

/// Check if one lattice is a supercell of another.
///
/// Args:
///     primitive: Primitive cell structure as JSON string or dict.
///     supercell: Potential supercell structure as JSON string or dict.
///     tolerance: Numerical tolerance for comparisons (default: 1e-5).
///
/// Returns:
///     3x3 integer transformation matrix if supercell, None otherwise.
#[pyfunction]
#[pyo3(signature = (primitive, supercell, tolerance = 1e-5))]
fn cell_is_supercell(
    primitive: StructureJson,
    supercell: StructureJson,
    tolerance: f64,
) -> PyResult<Option<[[i32; 3]; 3]>> {
    let prim = parse_struct(&primitive)?;
    let sup = parse_struct(&supercell)?;
    Ok(cell_ops::is_supercell(
        &prim.lattice,
        &sup.lattice,
        tolerance,
    ))
}

/// Compute the perpendicular distances (heights) of the lattice parallelepiped.
///
/// These are the minimum distances between parallel planes of the lattice,
/// which determine the minimum image distance for PBC calculations.
///
/// Args:
///     structure: Structure as JSON string or dict.
///
/// Returns:
///     Perpendicular distances [d_a, d_b, d_c] in Angstroms.
#[pyfunction]
fn cell_perpendicular_distances(structure: StructureJson) -> PyResult<[f64; 3]> {
    let struc = parse_struct(&structure)?;
    let perp = cell_ops::perpendicular_distances(&struc.lattice);
    Ok([perp[0], perp[1], perp[2]])
}

// === Type Conversion Helpers ===

/// Convert Matrix3 to [[f64; 3]; 3] array.
#[inline]
fn matrix3_to_array(m: &Matrix3<f64>) -> [[f64; 3]; 3] {
    [
        [m[(0, 0)], m[(0, 1)], m[(0, 2)]],
        [m[(1, 0)], m[(1, 1)], m[(1, 2)]],
        [m[(2, 0)], m[(2, 1)], m[(2, 2)]],
    ]
}

/// Convert [[f64; 3]; 3] array to Matrix3.
#[inline]
fn array_to_matrix3(arr: &[[f64; 3]; 3]) -> Matrix3<f64> {
    Matrix3::from_row_slice(&[
        arr[0][0], arr[0][1], arr[0][2], arr[1][0], arr[1][1], arr[1][2], arr[2][0], arr[2][1],
        arr[2][2],
    ])
}

/// Convert Vec<[f64; 3]> to Vec<Vector3<f64>>.
#[inline]
fn positions_to_vec3(positions: &[[f64; 3]]) -> Vec<Vector3<f64>> {
    positions.iter().map(|p| Vector3::from(*p)).collect()
}

/// Convert Vec<Vector3<f64>> to Vec<[f64; 3]>.
#[inline]
fn vec3_to_positions(vecs: &[Vector3<f64>]) -> Vec<[f64; 3]> {
    vecs.iter().map(|v| [v.x, v.y, v.z]).collect()
}

/// Convert Optional cell array to Optional Matrix3.
#[inline]
fn cell_to_matrix3(cell: Option<[[f64; 3]; 3]>) -> Option<Matrix3<f64>> {
    cell.map(|c| array_to_matrix3(&c))
}

// === Lennard-Jones Potential ===

/// Compute Lennard-Jones energy and forces.
///
/// Args:
///     positions: Nx3 array of atomic positions in Angstrom
///     cell: Optional 3x3 cell matrix (rows are lattice vectors)
///     pbc: Periodic boundary conditions [x, y, z] (default: [True]*3 if cell provided, else [False]*3)
///     sigma: LJ sigma parameter in Angstrom (default: 3.4 for Ar)
///     epsilon: LJ epsilon parameter in eV (default: 0.0103 for Ar)
///     cutoff: Optional cutoff distance in Angstrom
///
/// Returns:
///     Tuple of (energy, forces) where forces is Nx3 array
#[pyfunction]
#[pyo3(signature = (positions, cell=None, pbc=None, sigma=3.4, epsilon=0.0103, cutoff=None))]
fn compute_lennard_jones(
    positions: Vec<[f64; 3]>,
    cell: Option<[[f64; 3]; 3]>,
    pbc: Option<[bool; 3]>,
    sigma: f64,
    epsilon: f64,
    cutoff: Option<f64>,
) -> PyResult<(f64, Vec<[f64; 3]>)> {
    let pos_vec = positions_to_vec3(&positions);
    let cell_mat = cell_to_matrix3(cell);
    // Default to PBC only if cell is provided
    let pbc_arr = pbc.unwrap_or(if cell.is_some() {
        [true, true, true]
    } else {
        [false, false, false]
    });

    let params = potentials::LennardJonesParams::new(sigma, epsilon, cutoff);
    let result = potentials::compute_lennard_jones(&pos_vec, cell_mat.as_ref(), pbc_arr, &params)
        .map_err(|e| pyo3::exceptions::PyValueError::new_err(e.to_string()))?;

    Ok((result.energy, vec3_to_positions(&result.forces)))
}

/// Convenience wrapper returning only forces (energy is still computed internally).
///
/// Args:
///     positions: Nx3 array of atomic positions in Angstrom
///     cell: Optional 3x3 cell matrix (rows are lattice vectors)
///     pbc: Periodic boundary conditions [x, y, z] (default: [True]*3 if cell provided, else [False]*3)
///     sigma: LJ sigma parameter in Angstrom (default: 3.4 for Ar)
///     epsilon: LJ epsilon parameter in eV (default: 0.0103 for Ar)
///     cutoff: Optional cutoff distance in Angstrom
///
/// Returns:
///     Nx3 array of forces in eV/Angstrom
#[pyfunction]
#[pyo3(signature = (positions, cell=None, pbc=None, sigma=3.4, epsilon=0.0103, cutoff=None))]
fn compute_lennard_jones_forces(
    positions: Vec<[f64; 3]>,
    cell: Option<[[f64; 3]; 3]>,
    pbc: Option<[bool; 3]>,
    sigma: f64,
    epsilon: f64,
    cutoff: Option<f64>,
) -> PyResult<Vec<[f64; 3]>> {
    let pos_vec = positions_to_vec3(&positions);
    let cell_mat = cell_to_matrix3(cell);
    let pbc_arr = pbc.unwrap_or(if cell.is_some() {
        [true, true, true]
    } else {
        [false, false, false]
    });
    let params = potentials::LennardJonesParams::new(sigma, epsilon, cutoff);
    let result = potentials::compute_lennard_jones(&pos_vec, cell_mat.as_ref(), pbc_arr, &params)
        .map_err(|e| pyo3::exceptions::PyValueError::new_err(e.to_string()))?;
    Ok(vec3_to_positions(&result.forces))
}

// === Morse Potential ===

/// Compute Morse potential energy and forces.
///
/// V(r) = D * (1 - exp(-alpha*(r - r0)))^2 - D
///
/// Args:
///     positions: Nx3 array of atomic positions in Angstrom
///     cell: Optional 3x3 cell matrix (rows are lattice vectors)
///     pbc: Periodic boundary conditions [x, y, z] (default: [True]*3 if cell provided, else [False]*3)
///     d: Well depth in eV (default: 1.0)
///     alpha: Width parameter in 1/Angstrom (default: 1.0)
///     r0: Equilibrium distance in Angstrom (default: 1.0)
///     cutoff: Cutoff distance in Angstrom (default: 10.0)
///     compute_stress: Whether to compute stress tensor (default: False)
///
/// Returns:
///     Tuple of (energy, forces, stress) where stress is None if not requested
#[pyfunction]
#[pyo3(signature = (positions, cell=None, pbc=None, d=1.0, alpha=1.0, r0=1.0, cutoff=10.0, compute_stress=false))]
fn compute_morse(
    positions: Vec<[f64; 3]>,
    cell: Option<[[f64; 3]; 3]>,
    pbc: Option<[bool; 3]>,
    d: f64,
    alpha: f64,
    r0: f64,
    cutoff: f64,
    compute_stress: bool,
) -> PyResult<(f64, Vec<[f64; 3]>, Option<[[f64; 3]; 3]>)> {
    let pos_vec = positions_to_vec3(&positions);
    let cell_mat = cell_to_matrix3(cell);
    let pbc_arr = pbc.unwrap_or(if cell.is_some() {
        [true, true, true]
    } else {
        [false, false, false]
    });

    let result = potentials::compute_morse_simple(
        &pos_vec,
        cell_mat.as_ref(),
        pbc_arr,
        d,
        alpha,
        r0,
        cutoff,
        compute_stress,
    )
    .map_err(|e| pyo3::exceptions::PyValueError::new_err(e.to_string()))?;

    Ok((
        result.energy,
        vec3_to_positions(&result.forces),
        result.stress.as_ref().map(matrix3_to_array),
    ))
}

// === Soft Sphere Potential ===

/// Compute Soft Sphere potential energy and forces.
///
/// V(r) = epsilon * (sigma/r)^alpha
///
/// Args:
///     positions: Nx3 array of atomic positions in Angstrom
///     cell: Optional 3x3 cell matrix (rows are lattice vectors)
///     pbc: Periodic boundary conditions [x, y, z] (default: [True]*3 if cell provided, else [False]*3)
///     sigma: Length scale in Angstrom (default: 1.0)
///     epsilon: Energy scale in eV (default: 1.0)
///     alpha: Exponent (default: 12.0, use 2 for soft spheres)
///     cutoff: Cutoff distance in Angstrom (default: 10.0)
///     compute_stress: Whether to compute stress tensor (default: False)
///
/// Returns:
///     Tuple of (energy, forces, stress) where stress is None if not requested
#[pyfunction]
#[pyo3(signature = (positions, cell=None, pbc=None, sigma=1.0, epsilon=1.0, alpha=12.0, cutoff=10.0, compute_stress=false))]
fn compute_soft_sphere(
    positions: Vec<[f64; 3]>,
    cell: Option<[[f64; 3]; 3]>,
    pbc: Option<[bool; 3]>,
    sigma: f64,
    epsilon: f64,
    alpha: f64,
    cutoff: f64,
    compute_stress: bool,
) -> PyResult<(f64, Vec<[f64; 3]>, Option<[[f64; 3]; 3]>)> {
    let pos_vec = positions_to_vec3(&positions);
    let cell_mat = cell_to_matrix3(cell);
    let pbc_arr = pbc.unwrap_or(if cell.is_some() {
        [true, true, true]
    } else {
        [false, false, false]
    });

    let result = potentials::compute_soft_sphere_simple(
        &pos_vec,
        cell_mat.as_ref(),
        pbc_arr,
        sigma,
        epsilon,
        alpha,
        cutoff,
        compute_stress,
    )
    .map_err(|e| pyo3::exceptions::PyValueError::new_err(e.to_string()))?;

    Ok((
        result.energy,
        vec3_to_positions(&result.forces),
        result.stress.as_ref().map(matrix3_to_array),
    ))
}

// === Harmonic Bonds ===

/// Compute harmonic bond energy and forces.
///
/// V = 0.5 * k * (r - r0)^2
///
/// Args:
///     positions: Nx3 array of atomic positions in Angstrom
///     bonds: List of bonds, each as [i, j, k, r0] where i,j are atom indices,
///            k is spring constant (eV/Å²), r0 is equilibrium distance (Å)
///     cell: Optional 3x3 cell matrix (rows are lattice vectors)
///     pbc: Periodic boundary conditions [x, y, z] (default: [True]*3 if cell provided, else [False]*3)
///     compute_stress: Whether to compute stress tensor (default: False)
///
/// Returns:
///     Tuple of (energy, forces, stress) where stress is None if not requested
#[pyfunction]
#[pyo3(signature = (positions, bonds, cell=None, pbc=None, compute_stress=false))]
fn compute_harmonic_bonds(
    positions: Vec<[f64; 3]>,
    bonds: Vec<[f64; 4]>,
    cell: Option<[[f64; 3]; 3]>,
    pbc: Option<[bool; 3]>,
    compute_stress: bool,
) -> PyResult<(f64, Vec<[f64; 3]>, Option<[[f64; 3]; 3]>)> {
    let pos_vec = positions_to_vec3(&positions);
    let cell_mat = cell_to_matrix3(cell);
    let pbc_arr = pbc.unwrap_or(if cell.is_some() {
        [true, true, true]
    } else {
        [false, false, false]
    });
    let n_atoms = pos_vec.len();

    // Convert bonds with validation for indices
    let mut bond_vec: Vec<potentials::HarmonicBond> = Vec::with_capacity(bonds.len());
    for (bond_idx, bond) in bonds.iter().enumerate() {
        let idx_i = bond[0];
        let idx_j = bond[1];

        // Check for valid integer indices: finite, non-negative, integer value
        if !idx_i.is_finite() || idx_i < 0.0 || idx_i.fract() != 0.0 {
            return Err(PyValueError::new_err(format!(
                "bond {bond_idx}: atom index i={idx_i} is invalid (must be finite non-negative integer)"
            )));
        }
        if !idx_j.is_finite() || idx_j < 0.0 || idx_j.fract() != 0.0 {
            return Err(PyValueError::new_err(format!(
                "bond {bond_idx}: atom index j={idx_j} is invalid (must be finite non-negative integer)"
            )));
        }

        let idx_i_usize = idx_i as usize;
        let idx_j_usize = idx_j as usize;

        // Check bounds against positions array
        if idx_i_usize >= n_atoms {
            return Err(pyo3::exceptions::PyIndexError::new_err(format!(
                "bond {bond_idx}: atom index i={idx_i_usize} out of bounds (n_atoms={n_atoms})"
            )));
        }
        if idx_j_usize >= n_atoms {
            return Err(pyo3::exceptions::PyIndexError::new_err(format!(
                "bond {bond_idx}: atom index j={idx_j_usize} out of bounds (n_atoms={n_atoms})"
            )));
        }

        bond_vec.push(potentials::HarmonicBond::new(
            idx_i_usize,
            idx_j_usize,
            bond[2],
            bond[3],
        ));
    }

    let result = potentials::compute_harmonic_bonds(
        &pos_vec,
        &bond_vec,
        cell_mat.as_ref(),
        pbc_arr,
        compute_stress,
    )
    .map_err(|e| PyValueError::new_err(e.to_string()))?;

    Ok((
        result.energy,
        vec3_to_positions(&result.forces),
        result.stress.as_ref().map(matrix3_to_array),
    ))
}

// === Nosé-Hoover Thermostat ===

/// Nosé-Hoover chain thermostat for NVT molecular dynamics.
#[pyclass(name = "NoseHooverChain")]
pub struct PyNoseHooverChain {
    inner: integrators::NoseHooverChain,
}

#[pymethods]
impl PyNoseHooverChain {
    /// Create a new Nosé-Hoover chain thermostat.
    ///
    /// Args:
    ///     target_temp: Target temperature in K
    ///     tau: Coupling time constant in fs (larger = weaker coupling)
    ///     dt: Time step in fs
    ///     n_dof: Number of degrees of freedom (typically 3*N - 3)
    #[new]
    fn new(target_temp: f64, tau: f64, dt: f64, n_dof: usize) -> Self {
        Self {
            inner: integrators::NoseHooverChain::new(target_temp, tau, dt, n_dof),
        }
    }

    /// Perform one NVT step.
    ///
    /// Args:
    ///     state: MDState to update
    ///     compute_forces: Function that takes positions and returns forces
    ///
    /// Raises:
    ///     RuntimeError: If force computation fails. State is restored to its
    ///         original value before the step when this happens.
    ///     ValueError: If force callback returns wrong number of forces.
    fn step(&mut self, state: &mut PyMDState, compute_forces: &Bound<'_, PyAny>) -> PyResult<()> {
        self.inner.try_step(&mut state.inner, |positions| {
            let n_atoms = positions.len();
            let result = compute_forces.call1((vec3_to_positions(positions),))?;
            let forces: Vec<[f64; 3]> = result.extract()?;
            if forces.len() != n_atoms {
                return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>(format!(
                    "force callback returned {} forces, expected {} (one per atom)",
                    forces.len(),
                    n_atoms
                )));
            }
            Ok(positions_to_vec3(&forces))
        })
    }

    /// Set target temperature.
    fn set_temperature(&mut self, target_temp: f64) {
        self.inner.set_temperature(target_temp);
    }
}

// === Velocity Rescaling Thermostat ===

/// Velocity rescaling (Bussi) thermostat for NVT molecular dynamics.
#[pyclass(name = "VelocityRescale")]
pub struct PyVelocityRescale {
    inner: integrators::VelocityRescale,
}

#[pymethods]
impl PyVelocityRescale {
    /// Create a new velocity rescaling thermostat.
    ///
    /// Args:
    ///     target_temp: Target temperature in K
    ///     tau: Coupling time constant in fs
    ///     dt: Time step in fs
    ///     n_dof: Number of degrees of freedom
    ///     seed: Optional random seed
    #[new]
    #[pyo3(signature = (target_temp, tau, dt, n_dof, seed=None))]
    fn new(target_temp: f64, tau: f64, dt: f64, n_dof: usize, seed: Option<u64>) -> Self {
        Self {
            inner: integrators::VelocityRescale::new(target_temp, tau, dt, n_dof, seed),
        }
    }

    /// Perform one NVT step.
    ///
    /// Raises:
    ///     RuntimeError: If force computation fails. State is restored to its
    ///         original value before the step when this happens.
    ///     ValueError: If force callback returns wrong number of forces.
    fn step(&mut self, state: &mut PyMDState, compute_forces: &Bound<'_, PyAny>) -> PyResult<()> {
        self.inner.try_step(&mut state.inner, |positions| {
            let n_atoms = positions.len();
            let result = compute_forces.call1((vec3_to_positions(positions),))?;
            let forces: Vec<[f64; 3]> = result.extract()?;
            if forces.len() != n_atoms {
                return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>(format!(
                    "force callback returned {} forces, expected {} (one per atom)",
                    forces.len(),
                    n_atoms
                )));
            }
            Ok(positions_to_vec3(&forces))
        })
    }

    /// Set target temperature.
    fn set_temperature(&mut self, target_temp: f64) {
        self.inner.set_temperature(target_temp);
    }
}

// === NPT Ensemble ===

/// State for NPT molecular dynamics.
#[pyclass(name = "NPTState")]
pub struct PyNPTState {
    inner: integrators::NPTState,
}

#[pymethods]
impl PyNPTState {
    /// Create a new NPT state.
    ///
    /// Args:
    ///     positions: Nx3 array of atomic positions
    ///     masses: Array of atomic masses (must have same length as positions)
    ///     cell: 3x3 cell matrix (rows are lattice vectors)
    ///     pbc: Periodic boundary conditions [x, y, z] (default: [True, True, True])
    ///
    /// Raises:
    ///     ValueError: If masses length doesn't match positions length
    #[new]
    #[pyo3(signature = (positions, masses, cell, pbc=None))]
    fn new(
        positions: Vec<[f64; 3]>,
        masses: Vec<f64>,
        cell: [[f64; 3]; 3],
        pbc: Option<[bool; 3]>,
    ) -> PyResult<Self> {
        if positions.len() != masses.len() {
            return Err(PyValueError::new_err(format!(
                "Masses length ({}) must match positions length ({})",
                masses.len(),
                positions.len()
            )));
        }

        let pos_vec: Vec<Vector3<f64>> = positions.iter().map(|p| Vector3::from(*p)).collect();
        let cell_mat = Matrix3::from_row_slice(&[
            cell[0][0], cell[0][1], cell[0][2], cell[1][0], cell[1][1], cell[1][2], cell[2][0],
            cell[2][1], cell[2][2],
        ]);
        let pbc_arr = pbc.unwrap_or([true, true, true]);

        Ok(Self {
            inner: integrators::NPTState::new(pos_vec, masses, cell_mat, pbc_arr),
        })
    }

    /// Number of atoms.
    fn num_atoms(&self) -> usize {
        self.inner.num_atoms()
    }

    /// Current volume in Å³.
    fn volume(&self) -> f64 {
        self.inner.volume()
    }

    /// Kinetic energy in eV.
    fn kinetic_energy(&self) -> f64 {
        self.inner.kinetic_energy()
    }

    /// Instantaneous temperature in K.
    fn temperature(&self) -> f64 {
        self.inner.temperature()
    }

    /// Get positions as Nx3 array.
    #[getter]
    fn positions(&self) -> Vec<[f64; 3]> {
        self.inner
            .positions
            .iter()
            .map(|p| [p.x, p.y, p.z])
            .collect()
    }

    /// Get velocities as Nx3 array.
    #[getter]
    fn velocities(&self) -> Vec<[f64; 3]> {
        self.inner
            .velocities
            .iter()
            .map(|v| [v.x, v.y, v.z])
            .collect()
    }

    /// Get cell as 3x3 array.
    #[getter]
    fn cell(&self) -> [[f64; 3]; 3] {
        let c = &self.inner.cell;
        [
            [c[(0, 0)], c[(0, 1)], c[(0, 2)]],
            [c[(1, 0)], c[(1, 1)], c[(1, 2)]],
            [c[(2, 0)], c[(2, 1)], c[(2, 2)]],
        ]
    }
}

/// NPT integrator using Parrinello-Rahman barostat.
#[pyclass(name = "NPTIntegrator")]
pub struct PyNPTIntegrator {
    inner: integrators::NPTIntegrator,
}

#[pymethods]
impl PyNPTIntegrator {
    /// Create a new NPT integrator.
    ///
    /// Args:
    ///     temperature: Target temperature in K
    ///     pressure: Target pressure in GPa
    ///     tau_t: Temperature coupling time in fs
    ///     tau_p: Pressure coupling time in fs
    ///     dt: Time step in fs
    ///     n_atoms: Number of atoms
    ///     total_mass: Total system mass in amu
    #[new]
    fn new(
        temperature: f64,
        pressure: f64,
        tau_t: f64,
        tau_p: f64,
        dt: f64,
        n_atoms: usize,
        total_mass: f64,
    ) -> Self {
        let config = integrators::NPTConfig::new(temperature, pressure, tau_t, tau_p, dt);
        Self {
            inner: integrators::NPTIntegrator::new(config, n_atoms, total_mass),
        }
    }

    /// Perform one NPT step.
    ///
    /// Args:
    ///     state: NPTState to update
    ///     compute_forces_stress: Function (positions, cell) -> (forces, stress)
    ///
    /// Raises:
    ///     RuntimeError: If force/stress computation fails. State is restored to
    ///         its original value before the step when this happens.
    ///     ValueError: If force callback returns wrong number of forces.
    fn step(
        &mut self,
        state: &mut PyNPTState,
        compute_forces_stress: &Bound<'_, PyAny>,
    ) -> PyResult<()> {
        self.inner.try_step(&mut state.inner, |positions, cell| {
            let n_atoms = positions.len();
            let pos_list: Vec<[f64; 3]> = positions.iter().map(|p| [p.x, p.y, p.z]).collect();
            let cell_arr: [[f64; 3]; 3] = [
                [cell[(0, 0)], cell[(0, 1)], cell[(0, 2)]],
                [cell[(1, 0)], cell[(1, 1)], cell[(1, 2)]],
                [cell[(2, 0)], cell[(2, 1)], cell[(2, 2)]],
            ];

            let result = compute_forces_stress.call1((pos_list, cell_arr))?;
            let (forces, stress): (Vec<[f64; 3]>, [[f64; 3]; 3]) = result.extract()?;
            if forces.len() != n_atoms {
                return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>(format!(
                    "force callback returned {} forces, expected {} (one per atom)",
                    forces.len(),
                    n_atoms
                )));
            }
            let force_vec: Vec<Vector3<f64>> = forces.iter().map(|f| Vector3::from(*f)).collect();
            Ok((force_vec, array_to_matrix3(&stress)))
        })
    }
}

/// Register Python module contents.
pub fn register(py_mod: &Bound<'_, PyModule>) -> PyResult<()> {
    py_mod.add_class::<PyStructureMatcher>()?;
    py_mod.add_class::<PyElement>()?;
    // MD integrators
    py_mod.add_class::<PyMDState>()?;
    py_mod.add_class::<PyLangevinIntegrator>()?;
    py_mod.add_function(wrap_pyfunction!(md_velocity_verlet_step, py_mod)?)?;
    // FIRE optimizer
    py_mod.add_class::<PyFireConfig>()?;
    py_mod.add_class::<PyFireState>()?;
    py_mod.add_class::<PyCellFireState>()?;
    // Elastic tensor analysis
    py_mod.add_function(wrap_pyfunction!(elastic_generate_strains, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(elastic_apply_strain, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(elastic_stress_to_voigt, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(elastic_strain_to_voigt, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(elastic_tensor_from_stresses, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(elastic_bulk_modulus, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(elastic_shear_modulus, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(elastic_youngs_modulus, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(elastic_poisson_ratio, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(elastic_is_stable, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(elastic_zener_ratio, py_mod)?)?;
    // Order parameters
    py_mod.add_function(wrap_pyfunction!(compute_steinhardt_q, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(classify_local_structure, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(classify_all_atoms, py_mod)?)?;
    // Trajectory analysis
    py_mod.add_class::<PyMsdCalculator>()?;
    py_mod.add_class::<PyVacfCalculator>()?;
    py_mod.add_function(wrap_pyfunction!(diffusion_from_msd, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(diffusion_from_vacf, py_mod)?)?;
    // Lennard-Jones potential
    py_mod.add_function(wrap_pyfunction!(compute_lennard_jones, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(compute_lennard_jones_forces, py_mod)?)?;
    // Morse potential
    py_mod.add_function(wrap_pyfunction!(compute_morse, py_mod)?)?;
    // Soft Sphere potential
    py_mod.add_function(wrap_pyfunction!(compute_soft_sphere, py_mod)?)?;
    // Harmonic bonds
    py_mod.add_function(wrap_pyfunction!(compute_harmonic_bonds, py_mod)?)?;
    // Thermostats
    py_mod.add_class::<PyNoseHooverChain>()?;
    py_mod.add_class::<PyVelocityRescale>()?;
    // NPT ensemble
    py_mod.add_class::<PyNPTState>()?;
    py_mod.add_class::<PyNPTIntegrator>()?;
    // I/O functions (reading)
    py_mod.add_function(wrap_pyfunction!(parse_structure_file, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(parse_trajectory, py_mod)?)?;
    // I/O functions (writing)
    py_mod.add_function(wrap_pyfunction!(write_structure_file, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(to_poscar, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(to_cif, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(to_extxyz, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(to_pymatgen_json, py_mod)?)?;
    // Molecule I/O functions
    py_mod.add_function(wrap_pyfunction!(parse_molecule_json_py, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(molecule_to_json, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(molecule_to_xyz, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(parse_xyz_str_py, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(parse_xyz_file, py_mod)?)?;
    // ASE Atoms conversion functions
    py_mod.add_function(wrap_pyfunction!(parse_ase_dict, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(parse_xyz_flexible_py, py_mod)?)?;
    // Direct object conversion (pymatgen <-> ferrox <-> ASE)
    py_mod.add_function(wrap_pyfunction!(from_pymatgen_structure, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(to_pymatgen_structure, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(to_pymatgen_molecule, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(from_ase_atoms, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(to_ase_atoms, py_mod)?)?;
    // Supercell functions
    py_mod.add_function(wrap_pyfunction!(make_supercell, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(make_supercell_diag, py_mod)?)?;
    // Slab generation functions
    py_mod.add_function(wrap_pyfunction!(generate_slabs, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(make_slab, py_mod)?)?;
    // Reduction functions
    py_mod.add_function(wrap_pyfunction!(get_reduced_structure, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_reduced_structure_with_params, py_mod)?)?;
    // Lattice property functions
    py_mod.add_function(wrap_pyfunction!(get_lattice_metric_tensor, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_lattice_inv_matrix, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_reciprocal_lattice, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_lll_reduced_lattice, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_lll_mapping, py_mod)?)?;
    // Neighbor finding and distance functions
    py_mod.add_function(wrap_pyfunction!(get_neighbor_list, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_distance, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_distance_and_image, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_distance_with_image, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(distance_from_point, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(distance_matrix, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(is_periodic_image, py_mod)?)?;
    // Coordination analysis functions
    py_mod.add_function(wrap_pyfunction!(py_get_coordination_numbers, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(py_get_coordination_number, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(py_get_local_environment, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(py_get_neighbors, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(py_get_cn_voronoi, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(py_get_cn_voronoi_all, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(py_get_voronoi_neighbors, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(py_get_local_environment_voronoi, py_mod)?)?;
    // RDF functions
    py_mod.add_function(wrap_pyfunction!(py_compute_rdf, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(py_compute_element_rdf, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(py_compute_all_element_rdfs, py_mod)?)?;
    // Site label and species functions
    py_mod.add_function(wrap_pyfunction!(site_label, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(site_labels, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(species_strings, py_mod)?)?;
    // Interpolation functions
    py_mod.add_function(wrap_pyfunction!(interpolate, py_mod)?)?;
    // Matching convenience functions
    py_mod.add_function(wrap_pyfunction!(matches, py_mod)?)?;
    // Sorting functions
    py_mod.add_function(wrap_pyfunction!(get_sorted_structure, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_sorted_by_electronegativity, py_mod)?)?;
    // Copy/sanitization functions
    py_mod.add_function(wrap_pyfunction!(copy_structure, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(wrap_to_unit_cell, py_mod)?)?;
    // Symmetry operation functions
    py_mod.add_function(wrap_pyfunction!(apply_operation, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(apply_inversion, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(apply_translation, py_mod)?)?;
    // Property functions
    py_mod.add_function(wrap_pyfunction!(get_structure_metadata, py_mod)?)?;
    // Symmetry analysis functions
    py_mod.add_function(wrap_pyfunction!(get_spacegroup_number, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_spacegroup_symbol, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_hall_number, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_pearson_symbol, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_wyckoff_letters, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_site_symmetry_symbols, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_symmetry_operations, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_equivalent_sites, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_crystal_system, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_symmetry_dataset, py_mod)?)?;
    // Site manipulation functions
    py_mod.add_function(wrap_pyfunction!(translate_sites, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(perturb, py_mod)?)?;
    // Normalization and site property functions
    py_mod.add_function(wrap_pyfunction!(normalize_element_symbol, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_site_properties, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_all_site_properties, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(set_site_property, py_mod)?)?;
    // Composition functions
    py_mod.add_function(wrap_pyfunction!(parse_composition, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_atomic_fraction, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_wt_fraction, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(reduced_composition, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(fractional_composition, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(is_charge_balanced, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(composition_charge, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(compositions_almost_equal, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(formula_hash, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(species_hash, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(remap_elements, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(get_reduced_factor, py_mod)?)?;
    // Transformation functions
    py_mod.add_function(wrap_pyfunction!(to_primitive, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(to_conventional, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(substitute_species, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(remove_species, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(remove_sites, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(deform, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(ewald_energy, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(order_disordered, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(enumerate_derivatives, py_mod)?)?;
    // XRD functions
    py_mod.add_function(wrap_pyfunction!(py_compute_xrd, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(py_get_atomic_scattering_params, py_mod)?)?;
    // Oxidation state functions
    py_mod.add_function(wrap_pyfunction!(py_oxi_state_guesses, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(
        py_add_charges_from_oxi_state_guesses,
        py_mod
    )?)?;
    py_mod.add_function(wrap_pyfunction!(py_compute_bv_sums, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(py_guess_oxidation_states_bvs, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(py_add_oxidation_state_by_element, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(py_add_oxidation_state_by_site, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(py_remove_oxidation_states, py_mod)?)?;
    // Defect generation functions
    py_mod.add_function(wrap_pyfunction!(defect_create_vacancy, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(defect_create_substitution, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(defect_create_interstitial, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(defect_create_antisite, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(defect_find_interstitial_sites, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(defect_find_supercell, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(defect_classify_site, py_mod)?)?;
    // Distortion functions (ShakeNBreak-style)
    py_mod.add_function(wrap_pyfunction!(defect_distort_bonds, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(defect_create_dimer, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(defect_rattle, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(defect_local_rattle, py_mod)?)?;
    // Voronoi interstitials
    py_mod.add_function(wrap_pyfunction!(defect_find_voronoi_interstitials, py_mod)?)?;
    // Defect naming
    py_mod.add_function(wrap_pyfunction!(defect_generate_name, py_mod)?)?;
    // Charge state guessing
    py_mod.add_function(wrap_pyfunction!(defect_guess_charge_states, py_mod)?)?;
    // Defect generator
    py_mod.add_function(wrap_pyfunction!(defect_generate_all, py_mod)?)?;
    // Wyckoff labels
    py_mod.add_function(wrap_pyfunction!(get_wyckoff_labels, py_mod)?)?;
    // Cell operations functions
    py_mod.add_function(wrap_pyfunction!(cell_minimum_image_distance, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(cell_minimum_image_vector, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(cell_wrap_to_unit_cell, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(cell_niggli_reduce, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(cell_is_niggli_reduced, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(cell_delaunay_reduce, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(cell_find_supercell_matrix, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(cell_lattices_equivalent, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(cell_is_supercell, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(cell_perpendicular_distances, py_mod)?)?;
    // Surface analysis functions
    py_mod.add_function(wrap_pyfunction!(surface_enumerate_miller, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(surface_enumerate_terminations, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(surface_find_adsorption_sites, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(surface_get_surface_atoms, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(surface_area, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(surface_calculate_energy, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(surface_d_spacing, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(surface_compute_wulff, py_mod)?)?;
    py_mod.add_function(wrap_pyfunction!(surface_miller_to_normal, py_mod)?)?;
    Ok(())
}
