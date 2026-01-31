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
use crate::io::{
    parse_extxyz_trajectory, parse_structure, parse_structure_json, structure_to_extxyz,
    structure_to_poscar, structure_to_pymatgen_json, write_structure,
};
use crate::matcher::{ComparatorType, StructureMatcher};
use crate::structure::{
    Structure, SymmOp, SymmetryOperation, moyo_ops_to_arrays, spacegroup_to_crystal_system,
};
use nalgebra::{Matrix3, Vector3};

/// A structure input that can be either a JSON string or a dict.
/// This allows ergonomic Python usage: `ferrox.copy_structure(struct.as_dict())` or
/// `ferrox.copy_structure(json.dumps(struct.as_dict()))`.
pub struct StructureJson(String);

impl<'a, 'py> FromPyObject<'a, 'py> for StructureJson {
    type Error = PyErr;

    fn extract(ob: pyo3::Borrowed<'a, 'py, PyAny>) -> PyResult<Self> {
        if let Ok(s) = ob.downcast::<PyString>() {
            Ok(StructureJson(s.to_string()))
        } else if let Ok(dict) = ob.downcast::<PyDict>() {
            // Convert dict to JSON string
            let json_module = ob.py().import("json")?;
            let json_str: String = json_module.call_method1("dumps", (dict,))?.extract()?;
            Ok(StructureJson(json_str))
        } else {
            Err(PyValueError::new_err(
                "Expected a JSON string or dict for structure input",
            ))
        }
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

// ============================================================================
// Structure I/O Functions
// ============================================================================

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

// ============================================================================
// Structure Writing Functions
// ============================================================================

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

// ============================================================================
// Helper Functions
// ============================================================================

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

// ============================================================================
// Structure Manipulation Functions
// ============================================================================

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

// ============================================================================
// Neighbor Finding Functions
// ============================================================================

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

// ============================================================================
// Structure Interpolation Functions
// ============================================================================

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

// ============================================================================
// Structure Matching Convenience Functions
// ============================================================================

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

// ============================================================================
// Structure Sorting Functions
// ============================================================================

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

// ============================================================================
// Structure Copy/Sanitization Functions
// ============================================================================

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

// ============================================================================
// Symmetry Operation Functions
// ============================================================================

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

// ============================================================================
// Structure Properties Functions
// ============================================================================

/// Get the volume of the unit cell in Angstrom^3.
///
/// Args:
///     structure (str): Structure as JSON string
///
/// Returns:
///     float: Volume in Angstrom^3
#[pyfunction]
fn get_volume(structure: StructureJson) -> PyResult<f64> {
    Ok(parse_struct(&structure)?.volume())
}

/// Get the total mass of the structure in atomic mass units (u).
///
/// Args:
///     structure (str): Structure as JSON string
///
/// Returns:
///     float: Total mass in amu
#[pyfunction]
fn get_total_mass(structure: StructureJson) -> PyResult<f64> {
    Ok(parse_struct(&structure)?.total_mass())
}

/// Get the density of the structure in g/cm^3.
///
/// Args:
///     structure (str): Structure as JSON string
///
/// Returns:
///     float | None: Density in g/cm^3, or None if volume is zero
#[pyfunction]
fn get_density(structure: StructureJson) -> PyResult<Option<f64>> {
    Ok(parse_struct(&structure)?.density())
}

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

// ============================================================================
// Symmetry Analysis Functions
// ============================================================================

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

// ============================================================================
// Site Manipulation Functions
// ============================================================================

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

// ============================================================================
// Normalization and Site Properties
// ============================================================================

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

// ============================================================================
// Composition Functions
// ============================================================================

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

// ============================================================================
// Transformation Functions
// ============================================================================

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

// ========== SLAB GENERATION ==========

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

// ========== COORDINATION ANALYSIS ==========

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

/// Register Python module contents.
pub fn register(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PyStructureMatcher>()?;
    // I/O functions (reading)
    m.add_function(wrap_pyfunction!(parse_structure_file, m)?)?;
    m.add_function(wrap_pyfunction!(parse_trajectory, m)?)?;
    // I/O functions (writing)
    m.add_function(wrap_pyfunction!(write_structure_file, m)?)?;
    m.add_function(wrap_pyfunction!(to_poscar, m)?)?;
    m.add_function(wrap_pyfunction!(to_cif, m)?)?;
    m.add_function(wrap_pyfunction!(to_extxyz, m)?)?;
    m.add_function(wrap_pyfunction!(to_pymatgen_json, m)?)?;
    // Supercell functions
    m.add_function(wrap_pyfunction!(make_supercell, m)?)?;
    m.add_function(wrap_pyfunction!(make_supercell_diag, m)?)?;
    // Slab generation functions
    m.add_function(wrap_pyfunction!(generate_slabs, m)?)?;
    m.add_function(wrap_pyfunction!(make_slab, m)?)?;
    // Reduction functions
    m.add_function(wrap_pyfunction!(get_reduced_structure, m)?)?;
    m.add_function(wrap_pyfunction!(get_reduced_structure_with_params, m)?)?;
    // Neighbor finding and distance functions
    m.add_function(wrap_pyfunction!(get_neighbor_list, m)?)?;
    m.add_function(wrap_pyfunction!(get_distance, m)?)?;
    m.add_function(wrap_pyfunction!(get_distance_and_image, m)?)?;
    m.add_function(wrap_pyfunction!(get_distance_with_image, m)?)?;
    m.add_function(wrap_pyfunction!(distance_from_point, m)?)?;
    m.add_function(wrap_pyfunction!(distance_matrix, m)?)?;
    m.add_function(wrap_pyfunction!(is_periodic_image, m)?)?;
    // Coordination analysis functions
    m.add_function(wrap_pyfunction!(py_get_coordination_numbers, m)?)?;
    m.add_function(wrap_pyfunction!(py_get_coordination_number, m)?)?;
    m.add_function(wrap_pyfunction!(py_get_local_environment, m)?)?;
    m.add_function(wrap_pyfunction!(py_get_neighbors, m)?)?;
    m.add_function(wrap_pyfunction!(py_get_cn_voronoi, m)?)?;
    m.add_function(wrap_pyfunction!(py_get_cn_voronoi_all, m)?)?;
    m.add_function(wrap_pyfunction!(py_get_voronoi_neighbors, m)?)?;
    m.add_function(wrap_pyfunction!(py_get_local_environment_voronoi, m)?)?;
    // Site label and species functions
    m.add_function(wrap_pyfunction!(site_label, m)?)?;
    m.add_function(wrap_pyfunction!(site_labels, m)?)?;
    m.add_function(wrap_pyfunction!(species_strings, m)?)?;
    // Interpolation functions
    m.add_function(wrap_pyfunction!(interpolate, m)?)?;
    // Matching convenience functions
    m.add_function(wrap_pyfunction!(matches, m)?)?;
    // Sorting functions
    m.add_function(wrap_pyfunction!(get_sorted_structure, m)?)?;
    m.add_function(wrap_pyfunction!(get_sorted_by_electronegativity, m)?)?;
    // Copy/sanitization functions
    m.add_function(wrap_pyfunction!(copy_structure, m)?)?;
    m.add_function(wrap_pyfunction!(wrap_to_unit_cell, m)?)?;
    // Symmetry operation functions
    m.add_function(wrap_pyfunction!(apply_operation, m)?)?;
    m.add_function(wrap_pyfunction!(apply_inversion, m)?)?;
    m.add_function(wrap_pyfunction!(apply_translation, m)?)?;
    // Property functions
    m.add_function(wrap_pyfunction!(get_volume, m)?)?;
    m.add_function(wrap_pyfunction!(get_total_mass, m)?)?;
    m.add_function(wrap_pyfunction!(get_density, m)?)?;
    m.add_function(wrap_pyfunction!(get_structure_metadata, m)?)?;
    // Symmetry analysis functions
    m.add_function(wrap_pyfunction!(get_spacegroup_number, m)?)?;
    m.add_function(wrap_pyfunction!(get_spacegroup_symbol, m)?)?;
    m.add_function(wrap_pyfunction!(get_hall_number, m)?)?;
    m.add_function(wrap_pyfunction!(get_pearson_symbol, m)?)?;
    m.add_function(wrap_pyfunction!(get_wyckoff_letters, m)?)?;
    m.add_function(wrap_pyfunction!(get_site_symmetry_symbols, m)?)?;
    m.add_function(wrap_pyfunction!(get_symmetry_operations, m)?)?;
    m.add_function(wrap_pyfunction!(get_equivalent_sites, m)?)?;
    m.add_function(wrap_pyfunction!(get_crystal_system, m)?)?;
    m.add_function(wrap_pyfunction!(get_symmetry_dataset, m)?)?;
    // Site manipulation functions
    m.add_function(wrap_pyfunction!(translate_sites, m)?)?;
    m.add_function(wrap_pyfunction!(perturb, m)?)?;
    // Normalization and site property functions
    m.add_function(wrap_pyfunction!(normalize_element_symbol, m)?)?;
    m.add_function(wrap_pyfunction!(get_site_properties, m)?)?;
    m.add_function(wrap_pyfunction!(get_all_site_properties, m)?)?;
    m.add_function(wrap_pyfunction!(set_site_property, m)?)?;
    // Composition functions
    m.add_function(wrap_pyfunction!(parse_composition, m)?)?;
    // Transformation functions
    m.add_function(wrap_pyfunction!(to_primitive, m)?)?;
    m.add_function(wrap_pyfunction!(to_conventional, m)?)?;
    m.add_function(wrap_pyfunction!(substitute_species, m)?)?;
    m.add_function(wrap_pyfunction!(remove_species, m)?)?;
    m.add_function(wrap_pyfunction!(remove_sites, m)?)?;
    m.add_function(wrap_pyfunction!(deform, m)?)?;
    m.add_function(wrap_pyfunction!(ewald_energy, m)?)?;
    m.add_function(wrap_pyfunction!(order_disordered, m)?)?;
    m.add_function(wrap_pyfunction!(enumerate_derivatives, m)?)?;
    Ok(())
}
