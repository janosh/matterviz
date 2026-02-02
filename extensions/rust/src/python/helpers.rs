//! Shared helper functions for Python bindings.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};

use crate::composition::Composition;
use crate::defects;
use crate::io::{parse_structure_json, structure_to_pymatgen_json};
use crate::structure::Structure;

/// A structure input that can be either a JSON string, dict, or pymatgen object.
///
/// Accepts:
/// - `ferrox.func(struct)` (pymatgen Structure object directly)
/// - `ferrox.func(struct.as_dict())` (dict from as_dict())
/// - `ferrox.func(json.dumps(struct.as_dict()))` (JSON string)
///
/// Note: Functions using `parse_struct` internally expect periodic Structure data.
/// For molecules, use the dedicated molecule functions (e.g., `parse_molecule_json`).
pub struct StructureJson(pub String);

impl<'a, 'py> FromPyObject<'a, 'py> for StructureJson {
    type Error = PyErr;

    fn extract(ob: pyo3::Borrowed<'a, 'py, PyAny>) -> PyResult<Self> {
        use pyo3::types::PyString;
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
pub fn parse_comp(formula: &str) -> PyResult<Composition> {
    Composition::from_formula(formula)
        .map_err(|err| PyValueError::new_err(format!("Error parsing formula: {err}")))
}

/// Parse a structure from StructureJson (string or dict), returning a PyResult.
pub fn parse_struct(input: &StructureJson) -> PyResult<Structure> {
    parse_structure_json(&input.0)
        .map_err(|err| PyValueError::new_err(format!("Error parsing structure: {err}")))
}

/// Convert a JSON string to a Python dict.
pub fn json_to_pydict(py: Python<'_>, json: &str) -> PyResult<Py<PyDict>> {
    let result = py.import("json")?.call_method1("loads", (json,))?;
    Ok(result.cast::<PyDict>()?.clone().unbind())
}

/// Parse a pair of structure inputs, returning a PyResult.
pub fn parse_structure_pair(
    struct1: &StructureJson,
    struct2: &StructureJson,
) -> PyResult<(Structure, Structure)> {
    Ok((parse_struct(struct1)?, parse_struct(struct2)?))
}

/// Convert Vec<String> to Vec<&str> for batch operations.
pub fn to_str_refs(strings: &[String]) -> Vec<&str> {
    strings.iter().map(|s| s.as_str()).collect()
}

/// Check if site indices are within bounds, returning PyIndexError if not.
pub fn check_site_bounds(num_sites: usize, indices: &[usize]) -> PyResult<()> {
    for &idx in indices {
        if idx >= num_sites {
            return Err(pyo3::exceptions::PyIndexError::new_err(format!(
                "Site index {idx} out of bounds (num_sites={num_sites})"
            )));
        }
    }
    Ok(())
}

/// Check if a single site index is within bounds.
#[inline]
pub fn check_site_idx(site_idx: usize, num_sites: usize) -> PyResult<()> {
    if site_idx >= num_sites {
        return Err(pyo3::exceptions::PyValueError::new_err(format!(
            "Site index {site_idx} out of bounds (num_sites={num_sites})"
        )));
    }
    Ok(())
}

/// Check if a pair of site indices are within bounds.
#[inline]
pub fn check_site_pair(idx_a: usize, idx_b: usize, num_sites: usize) -> PyResult<()> {
    if idx_a >= num_sites || idx_b >= num_sites {
        return Err(pyo3::exceptions::PyValueError::new_err(format!(
            "Site index out of bounds (num_sites={num_sites})"
        )));
    }
    Ok(())
}

/// Convert a Structure to a Python dict in pymatgen format.
pub fn structure_to_pydict<'py>(
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
pub fn json_to_py(py: Python<'_>, value: &serde_json::Value) -> PyResult<Py<PyAny>> {
    use pyo3::IntoPyObject;

    match value {
        serde_json::Value::Null => Ok(py.None()),
        serde_json::Value::Bool(b) => Ok(b.into_pyobject(py)?.to_owned().unbind().into_any()),
        serde_json::Value::Number(n) => {
            if let Some(idx) = n.as_i64() {
                Ok(idx.into_pyobject(py)?.unbind().into_any())
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
                .map(|val| json_to_py(py, val))
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

/// Helper to build a Python dict from a DefectStructure result.
pub fn defect_result_to_pydict(
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

/// Parse reduction algorithm from string.
pub fn parse_reduction_algo(algo: &str) -> PyResult<crate::structure::ReductionAlgo> {
    match algo.to_lowercase().as_str() {
        "niggli" => Ok(crate::structure::ReductionAlgo::Niggli),
        "lll" => Ok(crate::structure::ReductionAlgo::LLL),
        _ => Err(PyValueError::new_err(format!(
            "Unknown reduction algorithm: {algo}. Use 'niggli' or 'lll'."
        ))),
    }
}

/// Convert nalgebra Matrix3 to nested array for Python.
#[inline]
pub fn mat3_to_array(mat: &nalgebra::Matrix3<f64>) -> [[f64; 3]; 3] {
    [
        [mat[(0, 0)], mat[(0, 1)], mat[(0, 2)]],
        [mat[(1, 0)], mat[(1, 1)], mat[(1, 2)]],
        [mat[(2, 0)], mat[(2, 1)], mat[(2, 2)]],
    ]
}

/// Convert nested array to nalgebra Matrix3.
#[inline]
pub fn array_to_mat3(arr: [[f64; 3]; 3]) -> nalgebra::Matrix3<f64> {
    nalgebra::Matrix3::from_row_slice(&[
        arr[0][0], arr[0][1], arr[0][2], arr[1][0], arr[1][1], arr[1][2], arr[2][0], arr[2][1],
        arr[2][2],
    ])
}

/// Convert slice of [f64; 3] arrays to Vec of nalgebra Vector3.
#[inline]
pub fn positions_to_vec3(positions: &[[f64; 3]]) -> Vec<nalgebra::Vector3<f64>> {
    positions
        .iter()
        .map(|p| nalgebra::Vector3::from(*p))
        .collect()
}

/// Convert slice of nalgebra Vector3 to Vec of [f64; 3] arrays.
#[inline]
pub fn vec3_to_positions(vecs: &[nalgebra::Vector3<f64>]) -> Vec<[f64; 3]> {
    vecs.iter().map(|v| [v.x, v.y, v.z]).collect()
}

/// Default pbc based on whether cell is provided.
/// Returns [true, true, true] if cell is Some, [false, false, false] otherwise.
#[inline]
pub fn default_pbc(pbc: Option<[bool; 3]>, has_cell: bool) -> [bool; 3] {
    pbc.unwrap_or(if has_cell {
        [true, true, true]
    } else {
        [false, false, false]
    })
}

/// Maximum safe integer that can be exactly represented in f64.
pub const MAX_SAFE_F64_INT: f64 = (1_u64 << 53) as f64; // 2^53

/// Validate a float value as a valid array index, returning usize.
/// Returns error if value is not finite, negative, non-integer, or exceeds MAX_SAFE_F64_INT.
pub fn validate_array_index(value: f64, context: &str) -> PyResult<usize> {
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 || value > MAX_SAFE_F64_INT {
        return Err(PyValueError::new_err(format!(
            "{context}={value} is invalid (must be finite non-negative integer <= {MAX_SAFE_F64_INT})"
        )));
    }
    Ok(value as usize)
}

/// Convert a HashMap of JSON values to a Python dict.
pub fn props_to_pydict<'py>(
    py: Python<'py>,
    props: &std::collections::HashMap<String, serde_json::Value>,
) -> PyResult<Bound<'py, PyDict>> {
    let dict = PyDict::new(py);
    for (key, val) in props {
        dict.set_item(key, json_to_py(py, val)?)?;
    }
    Ok(dict)
}

/// Convert Python object to serde_json::Value.
#[allow(deprecated)]
pub fn py_to_json_value(obj: &Bound<'_, pyo3::PyAny>) -> PyResult<serde_json::Value> {
    if obj.is_none() {
        Ok(serde_json::Value::Null)
    } else if let Ok(b) = obj.extract::<bool>() {
        Ok(serde_json::Value::Bool(b))
    } else if let Ok(i) = obj.extract::<i64>() {
        Ok(serde_json::json!(i))
    } else if let Ok(u) = obj.extract::<u64>() {
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
