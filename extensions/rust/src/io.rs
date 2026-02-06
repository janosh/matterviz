//! I/O utilities for structure parsing.
//!
//! This module provides functions for parsing structures from various formats:
//! - Pymatgen JSON (`Structure.as_dict()`)
//! - VASP POSCAR/CONTCAR
//! - extXYZ (Extended XYZ format)
//! - CIF (Crystallographic Information File)
//!
//! Use [`parse_structure`] for automatic format detection, or the format-specific
//! functions for explicit control.

use crate::cif::parse_cif;
use crate::element::Element;
use crate::error::{FerroxError, Result};
use crate::lattice::Lattice;
use crate::species::{SiteOccupancy, Species};
use crate::structure::Structure;
use nalgebra::Vector3;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

// === Unified API ===

/// Supported structure file formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StructureFormat {
    /// Pymatgen JSON format (`Structure.as_dict()`)
    PymatgenJson,
    /// VASP POSCAR/CONTCAR format
    Poscar,
    /// Extended XYZ format
    ExtXyz,
    /// Crystallographic Information File
    Cif,
}

impl StructureFormat {
    /// Detect format from file path (extension and filename).
    ///
    /// # Examples
    ///
    /// ```
    /// use std::path::Path;
    /// use ferrox::io::StructureFormat;
    ///
    /// assert_eq!(StructureFormat::from_path(Path::new("structure.json")), Some(StructureFormat::PymatgenJson));
    /// assert_eq!(StructureFormat::from_path(Path::new("POSCAR")), Some(StructureFormat::Poscar));
    /// assert_eq!(StructureFormat::from_path(Path::new("trajectory.xyz")), Some(StructureFormat::ExtXyz));
    /// assert_eq!(StructureFormat::from_path(Path::new("diamond.cif")), Some(StructureFormat::Cif));
    /// ```
    pub fn from_path(path: &Path) -> Option<Self> {
        // Check extension first
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let ext_lower = ext.to_lowercase();
            match ext_lower.as_str() {
                "json" => return Some(Self::PymatgenJson),
                "xyz" | "extxyz" => return Some(Self::ExtXyz),
                "cif" => return Some(Self::Cif),
                "vasp" => return Some(Self::Poscar),
                _ => {}
            }
        }

        // Check filename for POSCAR/CONTCAR
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            let name_upper = name.to_uppercase();
            if name_upper.starts_with("POSCAR") || name_upper.starts_with("CONTCAR") {
                return Some(Self::Poscar);
            }
        }

        None
    }
}

/// Parse a structure from a file with automatic format detection.
///
/// The format is detected based on:
/// 1. File extension (`.json`, `.xyz`, `.cif`, `.vasp`)
/// 2. Filename pattern (`POSCAR*`, `CONTCAR*`)
///
/// # Arguments
///
/// * `path` - Path to the structure file
///
/// # Returns
///
/// The parsed structure or an error if parsing fails.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::io::parse_structure;
/// use std::path::Path;
///
/// let structure = parse_structure(Path::new("structure.cif"))?;
/// ```
pub fn parse_structure(path: &Path) -> Result<Structure> {
    let format = StructureFormat::from_path(path).ok_or_else(|| FerroxError::UnknownFormat {
        path: path.display().to_string(),
    })?;

    match format {
        StructureFormat::PymatgenJson => parse_structure_file(path),
        StructureFormat::Poscar => parse_poscar(path),
        StructureFormat::ExtXyz => parse_extxyz(path),
        StructureFormat::Cif => parse_cif(path),
    }
}

/// Represents a species entry in pymatgen JSON.
#[derive(Debug, Deserialize)]
#[allow(dead_code)] // Fields parsed for compatibility but not all used
struct PymatgenSpecies {
    element: String,
    #[serde(default = "default_occu")]
    occu: f64,
    #[serde(default, deserialize_with = "deserialize_oxidation_state")]
    oxidation_state: Option<i32>,
}

/// Deserialize oxidation_state from either integer or float.
///
/// Validates that the value fits within i32 range before conversion to avoid
/// undefined behavior from overflow.
fn deserialize_oxidation_state<'de, D>(
    deserializer: D,
) -> std::result::Result<Option<i32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;

    let value: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match value {
        None => Ok(None),
        Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Number(n)) => {
            if let Some(int_val) = n.as_i64() {
                // Check i64 fits in i32 before converting
                if int_val < i32::MIN as i64 || int_val > i32::MAX as i64 {
                    return Err(D::Error::custom(format!(
                        "oxidation_state {int_val} overflows i32 range"
                    )));
                }
                Ok(Some(int_val as i32))
            } else if let Some(float_val) = n.as_f64() {
                // Check float is finite and within i32 range before converting
                let rounded = float_val.round();
                if !rounded.is_finite() || rounded < i32::MIN as f64 || rounded > i32::MAX as f64 {
                    return Err(D::Error::custom(format!(
                        "oxidation_state {float_val} overflows i32 range"
                    )));
                }
                Ok(Some(rounded as i32))
            } else {
                Err(D::Error::custom("oxidation_state must be a number"))
            }
        }
        Some(other) => Err(D::Error::custom(format!(
            "oxidation_state must be a number, got {:?}",
            other
        ))),
    }
}

fn default_occu() -> f64 {
    1.0
}

/// Parse a species entry from pymatgen JSON, returning the Species with occupancy and metadata.
///
/// Handles element symbol normalization, oxidation state validation/conflict detection,
/// and occupancy validation.
fn parse_species_entry(
    sp_json: &PymatgenSpecies,
    site_idx: usize,
) -> Result<(Species, f64, HashMap<String, serde_json::Value>)> {
    // Use normalize_symbol for comprehensive element parsing
    let normalized =
        crate::element::normalize_symbol(&sp_json.element).map_err(|e| FerroxError::JsonError {
            path: "inline".to_string(),
            reason: format!("Invalid element symbol '{}': {}", sp_json.element, e),
        })?;

    // Validate oxidation state range BEFORE casting to i8 (to avoid silent truncation)
    if let Some(oxi) = sp_json.oxidation_state
        && (oxi < i8::MIN as i32 || oxi > i8::MAX as i32)
    {
        return Err(FerroxError::JsonError {
            path: "inline".to_string(),
            reason: format!("Oxidation state {oxi} out of range [-128, 127]"),
        });
    }

    // Check for oxidation state conflict (safe to cast now - range validated above)
    let json_oxi = sp_json.oxidation_state.map(|o| o as i8);
    let final_oxi = match (json_oxi, normalized.oxidation_state) {
        (Some(json), Some(sym)) if json != sym => {
            return Err(FerroxError::JsonError {
                path: "inline".to_string(),
                reason: format!(
                    "Conflicting oxidation states for '{}': symbol implies {}, but JSON has {}",
                    sp_json.element,
                    sym,
                    sp_json.oxidation_state.unwrap()
                ),
            });
        }
        (Some(json), _) => Some(json),
        (None, Some(sym)) => Some(sym),
        (None, None) => None,
    };

    let sp = Species::new(normalized.element, final_oxi);

    // Validate occupancy: must be finite and in range (0.0, 1.0]
    let occu = sp_json.occu;
    if !occu.is_finite() || occu <= 0.0 || occu > 1.0 {
        return Err(FerroxError::JsonError {
            path: "inline".to_string(),
            reason: format!(
                "Site {site_idx} species {} has invalid occupancy {occu} (must be in (0.0, 1.0])",
                sp_json.element
            ),
        });
    }

    Ok((sp, occu, normalized.metadata))
}

/// Represents a site in pymatgen JSON.
///
/// For structures, `abc` (fractional coords) is required.
/// For molecules, `xyz` (Cartesian coords) is used and `abc` may be absent.
#[derive(Debug, Deserialize)]
#[allow(dead_code)] // Fields parsed for compatibility but not all used
struct PymatgenSite {
    species: Vec<PymatgenSpecies>,
    /// Fractional coordinates (required for structures, optional for molecules)
    #[serde(default)]
    abc: Option<[f64; 3]>,
    /// Cartesian coordinates (optional for structures, required for molecules)
    #[serde(default)]
    xyz: Option<[f64; 3]>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    properties: serde_json::Value,
}

/// Represents the lattice in pymatgen JSON.
#[derive(Debug, Deserialize)]
struct PymatgenLattice {
    matrix: [[f64; 3]; 3],
    #[serde(default = "default_pbc")]
    pbc: [bool; 3],
}

fn default_pbc() -> [bool; 3] {
    [true, true, true]
}

/// Represents a pymatgen Structure JSON.
#[derive(Debug, Deserialize)]
#[allow(dead_code)] // Fields parsed for compatibility but not all used
struct PymatgenStructure {
    #[serde(rename = "@module")]
    _module: Option<String>,
    #[serde(rename = "@class")]
    _class: Option<String>,
    lattice: PymatgenLattice,
    sites: Vec<PymatgenSite>,
    #[serde(default)]
    charge: Option<f64>,
    #[serde(default)]
    properties: serde_json::Value,
}

/// Parse a structure from pymatgen's JSON format.
///
/// Supports the format produced by `Structure.as_dict()` in pymatgen.
///
/// # Limitations
///
/// - **Disordered sites**: Sites with multiple species (partial occupancy) use only
///   the first species. Full disorder support is not yet implemented.
///
/// # Arguments
///
/// * `json` - JSON string in pymatgen Structure.as_dict() format
///
/// # Returns
///
/// The parsed structure or an error if parsing fails.
///
/// # Example
///
/// ```rust,ignore
/// let json = r#"{
///     "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
///     "sites": [{"species": [{"element": "Fe"}], "abc": [0,0,0]}]
/// }"#;
/// let structure = parse_structure_json(json)?;
/// ```
pub fn parse_structure_json(json: &str) -> Result<Structure> {
    let parsed: PymatgenStructure =
        serde_json::from_str(json).map_err(|e| FerroxError::JsonError {
            path: "inline".to_string(),
            reason: e.to_string(),
        })?;

    // Build lattice from row-major matrix
    let mat = &parsed.lattice.matrix;
    let matrix = nalgebra::Matrix3::new(
        mat[0][0], mat[0][1], mat[0][2], mat[1][0], mat[1][1], mat[1][2], mat[2][0], mat[2][1],
        mat[2][2],
    );
    let mut lattice = Lattice::new(matrix);
    lattice.pbc = parsed.lattice.pbc;

    // Build site occupancies and coordinates (supports disordered sites)
    let mut site_occupancies = Vec::with_capacity(parsed.sites.len());
    let mut frac_coords = Vec::with_capacity(parsed.sites.len());

    for (idx, site) in parsed.sites.iter().enumerate() {
        if site.species.is_empty() {
            return Err(FerroxError::JsonError {
                path: "inline".to_string(),
                reason: format!("Site {idx} has no species"),
            });
        }

        // Parse all species with their occupancies using shared helper
        let mut species_vec = Vec::with_capacity(site.species.len());
        let mut site_props: HashMap<String, serde_json::Value> = HashMap::new();
        let mut species_metadata: Vec<HashMap<String, serde_json::Value>> =
            Vec::with_capacity(site.species.len());

        for sp_json in &site.species {
            let (sp, occu, metadata) = parse_species_entry(sp_json, idx)?;
            species_vec.push((sp, occu));
            species_metadata.push(metadata);
        }

        // Only merge species metadata for single-species sites (no conflict possible)
        // For multi-species sites, per-species metadata would be ambiguous at site level
        if species_metadata.len() == 1 {
            for (key, val) in species_metadata.into_iter().next().unwrap() {
                site_props.insert(key, val);
            }
        }

        // Add site label if present
        if let Some(ref label) = site.label {
            site_props.insert("label".to_string(), serde_json::json!(label));
        }

        // Merge site properties from JSON (takes precedence over normalization metadata)
        if let serde_json::Value::Object(map) = &site.properties {
            for (key, val) in map {
                site_props.insert(key.clone(), val.clone());
            }
        }

        site_occupancies.push(SiteOccupancy::with_properties(species_vec, site_props));

        // For structures, abc (fractional coords) is required
        let abc = site.abc.ok_or_else(|| FerroxError::JsonError {
            path: "inline".to_string(),
            reason: format!("Site {idx} missing 'abc' (fractional coordinates)"),
        })?;
        frac_coords.push(Vector3::new(abc[0], abc[1], abc[2]));
    }

    // Extract structure-level properties from JSON
    let properties: HashMap<String, serde_json::Value> = match parsed.properties {
        serde_json::Value::Object(map) => map.into_iter().collect(),
        _ => HashMap::new(),
    };

    // Extract charge (default 0.0 for structures)
    let charge = parsed.charge.unwrap_or(0.0);

    // Use pbc from lattice (defaults to [true, true, true] if not specified)
    let pbc = parsed.lattice.pbc;

    Structure::try_new_full(
        lattice,
        site_occupancies,
        frac_coords,
        pbc,
        charge,
        properties,
    )
}

/// Serialize a structure to pymatgen's JSON format.
///
/// Produces JSON compatible with pymatgen's `Structure.from_dict()`.
///
/// # Arguments
///
/// * `structure` - The structure to serialize
///
/// # Returns
///
/// JSON string in pymatgen format.
pub fn structure_to_pymatgen_json(structure: &Structure) -> String {
    use serde_json::{Value, json};

    // Build lattice
    let mat = structure.lattice.matrix();
    let lattice = json!({
        "matrix": [
            [mat[(0, 0)], mat[(0, 1)], mat[(0, 2)]],
            [mat[(1, 0)], mat[(1, 1)], mat[(1, 2)]],
            [mat[(2, 0)], mat[(2, 1)], mat[(2, 2)]]
        ],
        "pbc": structure.lattice.pbc
    });

    // Build sites with all species and their occupancies
    let cart_coords = structure.cart_coords();
    let sites: Vec<Value> = structure
        .site_occupancies
        .iter()
        .zip(structure.frac_coords.iter())
        .zip(cart_coords.iter())
        .map(|((site_occ, frac), cart)| {
            let species_list: Vec<Value> = site_occ
                .species
                .iter()
                .map(|(sp, occ)| {
                    let mut entry = json!({
                        "element": sp.element.symbol(),
                        "occu": occ
                    });
                    if let Some(oxi) = sp.oxidation_state {
                        entry["oxidation_state"] = json!(oxi);
                    }
                    entry
                })
                .collect();

            // Extract label from properties if present (pymatgen uses top-level label)
            let label = site_occ
                .properties
                .get("label")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            // Build site properties (excluding label which is at top level)
            let props: serde_json::Map<String, Value> = site_occ
                .properties
                .iter()
                .filter(|(k, _)| k.as_str() != "label")
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();

            // Generate default label from species symbols if not present
            let default_label: String = site_occ
                .species
                .iter()
                .map(|(sp, _)| sp.element.symbol())
                .collect::<Vec<_>>()
                .join(",");

            // Build site JSON with both fractional and Cartesian coords
            // Always include label and properties for JavaScript compatibility
            json!({
                "species": species_list,
                "abc": [frac.x, frac.y, frac.z],
                "xyz": [cart.x, cart.y, cart.z],
                "label": label.unwrap_or(default_label),
                "properties": Value::Object(props)
            })
        })
        .collect();

    // Build structure properties
    let properties: serde_json::Map<String, Value> =
        structure.properties.clone().into_iter().collect();

    // Build full structure
    let mut result = json!({
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": lattice,
        "sites": sites,
        "properties": properties
    });

    // Include charge if non-zero
    if structure.charge.abs() > 1e-10 {
        result["charge"] = json!(structure.charge);
    }

    result.to_string()
}

/// Parse a structure from a JSON file.
///
/// # Arguments
///
/// * `path` - Path to the JSON file
///
/// # Returns
///
/// The parsed structure or an error if parsing/reading fails.
pub fn parse_structure_file(path: &Path) -> Result<Structure> {
    let json = std::fs::read_to_string(path)?;
    parse_structure_json(&json).map_err(|e| {
        if let FerroxError::JsonError { reason, .. } = e {
            FerroxError::JsonError {
                path: path.display().to_string(),
                reason,
            }
        } else {
            e
        }
    })
}

/// Parse multiple structures from JSON files matching a glob pattern.
///
/// # Arguments
///
/// * `pattern` - Glob pattern (e.g., "structures/*.json")
///
/// # Returns
///
/// Vector of (path, structure) pairs, or error if any file fails to parse.
/// File access errors (permissions, broken symlinks) during glob iteration
/// are logged as warnings but do not cause the function to fail.
pub fn parse_structures_glob(pattern: &str) -> Result<Vec<(String, Structure)>> {
    let paths: Vec<_> = glob::glob(pattern)
        .map_err(|e| FerroxError::JsonError {
            path: pattern.to_string(),
            reason: format!("Invalid glob pattern: {e}"),
        })?
        .filter_map(|result| match result {
            Ok(path) => Some(path),
            Err(err) => {
                // Log glob errors (permissions, broken symlinks, etc.) for debugging
                tracing::warn!("Glob iteration error: {err}");
                None
            }
        })
        .collect();

    let mut results = Vec::with_capacity(paths.len());
    for path in paths {
        let structure = parse_structure_file(&path)?;
        results.push((path.display().to_string(), structure));
    }

    Ok(results)
}

/// Serialize a structure to pymatgen JSON format.
///
/// Alias for [`structure_to_pymatgen_json`] for backwards compatibility.
#[inline]
pub fn structure_to_json(structure: &Structure) -> String {
    structure_to_pymatgen_json(structure)
}

// === POSCAR Parser ===

/// Parse a structure from VASP POSCAR format.
///
/// Supports VASP 5+ format with element symbols. VASP 4 format (without symbols)
/// is not supported and will return an error.
///
/// # Arguments
///
/// * `path` - Path to the POSCAR/CONTCAR file
///
/// # Returns
///
/// The parsed structure or an error if parsing fails.
pub fn parse_poscar(path: &Path) -> Result<Structure> {
    let content = std::fs::read_to_string(path)?;
    parse_poscar_str_impl(&content, &path.display().to_string())
}

/// Parse a structure from POSCAR content string.
///
/// # Arguments
///
/// * `content` - POSCAR file content as string
///
/// # Returns
///
/// The parsed structure or an error if parsing fails.
pub fn parse_poscar_str(content: &str) -> Result<Structure> {
    parse_poscar_str_impl(content, "inline")
}

/// Internal POSCAR parser implementation.
///
/// POSCAR format (VASP 5+):
/// ```text
/// Comment line
/// scale_factor (positive) OR -volume (negative)
/// a1 a2 a3       # lattice vector a
/// b1 b2 b3       # lattice vector b
/// c1 c2 c3       # lattice vector c
/// El1 El2 ...    # element symbols (VASP 5+)
/// N1 N2 ...      # atom counts per element
/// [Selective dynamics]  # optional
/// Direct|Cartesian      # coordinate type
/// x1 y1 z1 [T T T] [El] # coordinates with optional selective dynamics and element
/// ...
/// ```
fn parse_poscar_str_impl(content: &str, path: &str) -> Result<Structure> {
    let err = |reason: String| FerroxError::ParseError {
        path: path.to_string(),
        reason,
    };

    // Split into non-empty lines, preserving original for coordinate parsing
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() < 8 {
        return Err(err("POSCAR must have at least 8 lines".to_string()));
    }

    // Line 0: Comment (ignored)
    // Line 1: Scale factor
    let scale_str = lines[1].trim();
    let scale_raw: f64 = scale_str
        .parse()
        .map_err(|_| err(format!("Invalid scale factor: '{scale_str}'")))?;
    if !scale_raw.is_finite() || scale_raw == 0.0 {
        return Err(err(format!(
            "Scale factor must be finite and non-zero, got '{scale_str}'"
        )));
    }

    // Lines 2-4: Lattice vectors (3x3)
    let mut lattice_vecs = [[0.0f64; 3]; 3];
    for (idx, line) in lines[2..5].iter().enumerate() {
        let parts: Vec<f64> = line
            .split_whitespace()
            .take(3)
            .map(|s| {
                s.parse()
                    .map_err(|_| err(format!("Invalid lattice vector component: '{s}'")))
            })
            .collect::<Result<_>>()?;
        if parts.len() != 3 {
            return Err(err(format!(
                "Lattice vector {} must have 3 components, got {}",
                idx + 1,
                parts.len()
            )));
        }
        if !parts.iter().all(|v| v.is_finite()) {
            return Err(err(format!(
                "Non-finite lattice vector component in vector {}",
                idx + 1
            )));
        }
        lattice_vecs[idx] = [parts[0], parts[1], parts[2]];
    }

    // Compute actual scale factor (handle negative = volume specification)
    let scale = if scale_raw < 0.0 {
        // Negative scale means the absolute value is the desired volume
        let det = lattice_vecs[0][0]
            * (lattice_vecs[1][1] * lattice_vecs[2][2] - lattice_vecs[1][2] * lattice_vecs[2][1])
            - lattice_vecs[0][1]
                * (lattice_vecs[1][0] * lattice_vecs[2][2]
                    - lattice_vecs[1][2] * lattice_vecs[2][0])
            + lattice_vecs[0][2]
                * (lattice_vecs[1][0] * lattice_vecs[2][1]
                    - lattice_vecs[1][1] * lattice_vecs[2][0]);
        (scale_raw.abs() / det.abs()).powf(1.0 / 3.0)
    } else {
        scale_raw
    };

    // Build scaled lattice matrix
    let matrix = nalgebra::Matrix3::from_row_slice(&[
        lattice_vecs[0][0] * scale,
        lattice_vecs[0][1] * scale,
        lattice_vecs[0][2] * scale,
        lattice_vecs[1][0] * scale,
        lattice_vecs[1][1] * scale,
        lattice_vecs[1][2] * scale,
        lattice_vecs[2][0] * scale,
        lattice_vecs[2][1] * scale,
        lattice_vecs[2][2] * scale,
    ]);
    let lattice = Lattice::new(matrix);

    // Line 5: Either element symbols (VASP 5+) or atom counts (VASP 4)
    let line5_parts: Vec<&str> = lines[5].split_whitespace().collect();

    // VASP 4 format (no element symbols) - reject early
    if line5_parts
        .first()
        .is_some_and(|s| s.parse::<usize>().is_ok())
    {
        return Err(err(
            "VASP 4 format (no element symbols) not supported. Use VASP 5+ format.".to_string(),
        ));
    }

    // Clean VASP 6.4.2+ POTCAR hash format (e.g., "Mg_pv/f474ac0d" -> "Mg")
    let clean_symbol = |s: &str| {
        s.split('/')
            .next()
            .unwrap_or(s)
            .split('_')
            .next()
            .unwrap_or(s)
            .to_string()
    };

    // VASP 5+ format - line 5 is element symbols
    let mut all_symbols: Vec<String> = line5_parts.iter().map(|s| clean_symbol(s)).collect();
    let mut all_counts = Vec::new();
    let mut line_idx = 6;

    // Handle multi-line symbols/counts (atoms > 20 groups wrap to multiple lines)
    // POSCAR format: symbols come first, then counts, then coordinate type
    // Once we've read ANY counts, we stop looking for more symbols
    let mut reading_counts = false;
    while line_idx < lines.len() {
        let line = lines[line_idx].trim();
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            line_idx += 1;
            continue;
        }

        // Check if first part is a number (counts line)
        if parts[0].parse::<usize>().is_ok() {
            reading_counts = true;
            for part in &parts {
                let count: usize = part
                    .parse()
                    .map_err(|_| err(format!("Invalid atom count: '{part}'")))?;
                all_counts.push(count);
            }
            line_idx += 1;
            continue;
        }

        // If we've already started reading counts, this must be the coordinate type line
        // (prevents "c" for Cartesian being matched as Carbon element)
        if reading_counts {
            break;
        }

        // Check if first part is a valid element symbol (more symbols line)
        // Only valid before we start reading counts
        let first_cleaned = clean_symbol(parts[0]);
        if Element::from_symbol(&first_cleaned).is_some() {
            for part in &parts {
                all_symbols.push(clean_symbol(part));
            }
            line_idx += 1;
            continue;
        }

        // Not counts and not element symbols - must be coordinate type line (Direct/Cartesian/Selective)
        break;
    }

    let (symbols, counts, coord_line_start) = (all_symbols, all_counts, line_idx);

    if symbols.len() != counts.len() {
        return Err(err(format!(
            "Number of element symbols ({}) doesn't match number of counts ({})",
            symbols.len(),
            counts.len()
        )));
    }

    // Validate and expand element symbols
    let mut species = Vec::new();
    for (symbol, &count) in symbols.iter().zip(counts.iter()) {
        let element = Element::from_symbol(symbol)
            .ok_or_else(|| err(format!("Unknown element symbol: '{symbol}'")))?;
        for _ in 0..count {
            species.push(Species::neutral(element));
        }
    }

    let total_atoms: usize = counts.iter().sum();

    // Find coordinate type line (Direct/Cartesian or Selective dynamics)
    let mut coord_start = coord_line_start;
    if coord_start >= lines.len() {
        return Err(err("Missing coordinate type line".to_string()));
    }

    // Skip optional "Selective dynamics" line
    if lines[coord_start].trim().to_lowercase().starts_with('s') {
        coord_start += 1;
        if coord_start >= lines.len() {
            return Err(err(
                "Missing coordinate type line after Selective dynamics".to_string()
            ));
        }
    }

    let is_cartesian = lines[coord_start].trim().to_lowercase().starts_with('c');
    coord_start += 1;

    // Parse coordinates
    let mut coords = Vec::with_capacity(total_atoms);
    for idx in 0..total_atoms {
        let line_idx = coord_start + idx;
        if line_idx >= lines.len() {
            return Err(err(format!(
                "Expected {} coordinates but only found {}",
                total_atoms, idx
            )));
        }

        let line = lines[line_idx];
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            return Err(err(format!(
                "Coordinate line {} must have at least 3 values",
                idx + 1
            )));
        }

        let x: f64 = parts[0]
            .parse()
            .map_err(|_| err(format!("Invalid x coordinate: '{}'", parts[0])))?;
        let y: f64 = parts[1]
            .parse()
            .map_err(|_| err(format!("Invalid y coordinate: '{}'", parts[1])))?;
        let z: f64 = parts[2]
            .parse()
            .map_err(|_| err(format!("Invalid z coordinate: '{}'", parts[2])))?;

        if !x.is_finite() || !y.is_finite() || !z.is_finite() {
            return Err(err(format!(
                "Non-finite coordinate at atom {}: ({x}, {y}, {z})",
                idx + 1
            )));
        }

        coords.push(Vector3::new(x, y, z));
    }

    // Convert to fractional if Cartesian (apply scale)
    let frac_coords = if is_cartesian {
        let cart_coords: Vec<Vector3<f64>> = coords
            .into_iter()
            .map(|c| Vector3::new(c.x * scale, c.y * scale, c.z * scale))
            .collect();
        lattice.get_fractional_coords(&cart_coords)
    } else {
        coords
    };

    Structure::try_new(lattice, species, frac_coords)
}

// === extXYZ Parser ===

/// Parse a single structure from an extXYZ file.
///
/// For multi-frame trajectory files, only the first frame is returned.
/// Use [`parse_extxyz_trajectory`] to get all frames.
///
/// # Arguments
///
/// * `path` - Path to the XYZ/extXYZ file
///
/// # Returns
///
/// The parsed structure or an error if parsing fails.
pub fn parse_extxyz(path: &Path) -> Result<Structure> {
    let frames = parse_extxyz_trajectory(path)?;
    frames
        .into_iter()
        .next()
        .ok_or_else(|| FerroxError::EmptyFile {
            path: path.display().to_string(),
        })?
}

/// Parse all frames from an extXYZ trajectory file.
///
/// Returns a vector of structures for all frames in the file.
///
/// # Arguments
///
/// * `path` - Path to the XYZ/extXYZ file
///
/// # Returns
///
/// Vector of Result<Structure> for each frame.
pub fn parse_extxyz_trajectory(path: &Path) -> Result<Vec<Result<Structure>>> {
    let path_str = path.to_string_lossy().to_string();
    // Use 0.. to read all frames
    let frames = extxyz::read_xyz_frames(&path_str, 0..).map_err(|e| FerroxError::ParseError {
        path: path.display().to_string(),
        reason: format!("extXYZ read error: {e}"),
    })?;

    Ok(frames
        .map(|frame| frame_to_structure(&frame, path))
        .collect())
}

fn frame_to_structure(frame: &str, path: &Path) -> Result<Structure> {
    let atoms = extxyz::RawAtoms::parse_from(frame).map_err(|e| FerroxError::ParseError {
        path: path.display().to_string(),
        reason: format!("extXYZ parse error: {e}"),
    })?;

    // Parse comment line for lattice and properties
    let info: extxyz::Info = atoms.comment.parse().map_err(|e| FerroxError::ParseError {
        path: path.display().to_string(),
        reason: format!("extXYZ info parse error: {e}"),
    })?;

    // Extract lattice (REQUIRED for crystal structures)
    let lattice_value = info
        .get("Lattice")
        .ok_or_else(|| FerroxError::MissingLattice {
            path: path.display().to_string(),
        })?;

    // Parse lattice - format is "ax ay az bx by bz cx cy cz" as a JSON string or array
    let lattice_str = match lattice_value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => {
            // Array of 9 numbers - reject non-numeric values with error (don't silently drop)
            let mut values = Vec::with_capacity(arr.len());
            for (idx, v) in arr.iter().enumerate() {
                let num = v.as_f64().ok_or_else(|| FerroxError::ParseError {
                    path: path.display().to_string(),
                    reason: format!("Lattice array element {idx} is not a number: {v}"),
                })?;
                values.push(num.to_string());
            }
            values.join(" ")
        }
        _ => {
            return Err(FerroxError::ParseError {
                path: path.display().to_string(),
                reason: "Lattice must be a string or array".to_string(),
            });
        }
    };

    let lattice_vals: Vec<f64> = lattice_str
        .split_whitespace()
        .map(|s| {
            s.parse::<f64>().map_err(|e| FerroxError::ParseError {
                path: path.display().to_string(),
                reason: format!("Invalid lattice value '{s}': {e}"),
            })
        })
        .collect::<Result<_>>()?;

    if lattice_vals.len() != 9 {
        return Err(FerroxError::ParseError {
            path: path.display().to_string(),
            reason: format!(
                "Lattice must have 9 values (3x3 matrix), got {}",
                lattice_vals.len()
            ),
        });
    }

    // Build lattice matrix (rows are lattice vectors a, b, c)
    let matrix = nalgebra::Matrix3::from_row_slice(&lattice_vals);
    let mut lattice = Lattice::new(matrix);

    // Parse PBC if present (default to [true, true, true])
    if let Some(pbc_value) = info.get("pbc") {
        lattice.pbc = parse_pbc_value(pbc_value);
    }

    // Parse species and coordinates
    let mut species = Vec::with_capacity(atoms.atoms.len());
    let mut cart_coords = Vec::with_capacity(atoms.atoms.len());

    for atom in &atoms.atoms {
        let element =
            Element::from_symbol(atom.element).ok_or_else(|| FerroxError::ParseError {
                path: path.display().to_string(),
                reason: format!("Unknown element symbol: {}", atom.element),
            })?;
        species.push(Species::neutral(element));

        // extXYZ uses Cartesian coordinates
        cart_coords.push(Vector3::new(
            atom.position[0],
            atom.position[1],
            atom.position[2],
        ));
    }

    // Convert Cartesian to fractional using Lattice method
    let frac_coords = lattice.get_fractional_coords(&cart_coords);

    // Extract properties (energy, charge, etc.)
    let mut properties = HashMap::new();
    let mut charge = 0.0;

    if let Some(energy_value) = info.get("energy")
        && let Some(energy) = energy_value.as_f64()
    {
        properties.insert("energy".to_string(), serde_json::json!(energy));
    }

    if let Some(charge_value) = info.get("charge")
        && let Some(ch) = charge_value.as_f64()
    {
        charge = ch;
    }

    // Store other info as properties (exclude structure-specific and already-handled keys)
    let skip_keys = ["Lattice", "pbc", "energy", "charge", "Properties"];
    for (key, value) in info.raw_map().iter() {
        if !skip_keys.contains(&key.as_str()) {
            properties.insert(key.to_string(), value.clone());
        }
    }

    // Use try_new_full to preserve pbc from lattice
    let pbc = lattice.pbc;
    Structure::try_new_full(
        lattice,
        species.into_iter().map(SiteOccupancy::ordered).collect(),
        frac_coords,
        pbc,
        charge,
        properties,
    )
}

fn parse_pbc_value(pbc_value: &serde_json::Value) -> [bool; 3] {
    match pbc_value {
        serde_json::Value::String(s) => {
            let parts: Vec<&str> = s.split_whitespace().collect();
            if parts.len() >= 3 {
                [
                    parts[0] == "T" || parts[0].eq_ignore_ascii_case("true"),
                    parts[1] == "T" || parts[1].eq_ignore_ascii_case("true"),
                    parts[2] == "T" || parts[2].eq_ignore_ascii_case("true"),
                ]
            } else {
                [true, true, true]
            }
        }
        serde_json::Value::Array(arr) if arr.len() >= 3 => [
            arr[0].as_bool().unwrap_or(true),
            arr[1].as_bool().unwrap_or(true),
            arr[2].as_bool().unwrap_or(true),
        ],
        _ => [true, true, true],
    }
}

// === Structure Writers ===

/// Convert a structure to VASP POSCAR format string.
///
/// The output uses VASP 5+ format with element symbols.
///
/// # Arguments
///
/// * `structure` - The structure to serialize
/// * `comment` - Optional comment line (defaults to reduced formula)
///
/// # Returns
///
/// POSCAR format string.
///
/// # Example
///
/// ```rust,ignore
/// let poscar_string = structure_to_poscar(&structure, None);
/// ```
pub fn structure_to_poscar(structure: &Structure, comment: Option<&str>) -> String {
    let mat = structure.lattice.matrix();

    // Check for disordered/partial-occupancy sites and collect warnings
    // POSCAR format cannot represent multi-species or partial occupancy sites
    let warnings: Vec<String> = structure
        .site_occupancies
        .iter()
        .enumerate()
        .filter_map(|(idx, site_occ)| {
            let total_occ = site_occ.total_occupancy();
            let is_disordered = !site_occ.is_ordered();
            let has_partial_occ = (total_occ - 1.0).abs() > 1e-6;

            if !is_disordered && !has_partial_occ {
                return None;
            }

            let species_str = site_occ
                .species
                .iter()
                .map(|(sp, occ)| format!("{sp}:{occ:.3}"))
                .collect::<Vec<_>>()
                .join(", ");
            let dominant = site_occ.dominant_species();

            Some(if is_disordered && has_partial_occ {
                format!(
                    "  Site {idx}: disordered+partial (total={total_occ:.3}): [{species_str}] -> {dominant}"
                )
            } else if is_disordered {
                format!("  Site {idx}: disordered: [{species_str}] -> {dominant}")
            } else {
                format!("  Site {idx}: partial occupancy (total={total_occ:.3}): [{species_str}]")
            })
        })
        .collect();

    if !warnings.is_empty() {
        tracing::warn!(
            "POSCAR cannot represent disorder/partial occupancy. {} site(s) simplified:\n{}",
            warnings.len(),
            warnings.join("\n")
        );
    }

    // Group sites by element (POSCAR requires contiguous blocks)
    // Use IndexMap to preserve insertion order (first occurrence)
    let mut element_sites: indexmap::IndexMap<&str, Vec<usize>> = indexmap::IndexMap::new();
    for (idx, site_occ) in structure.site_occupancies.iter().enumerate() {
        let symbol = site_occ.dominant_species().element.symbol();
        element_sites.entry(symbol).or_default().push(idx);
    }

    // Build the POSCAR string
    let mut lines = Vec::new();

    // Line 1: Comment (use provided or fall back to formula)
    lines.push(match comment {
        Some(c) if !c.is_empty() => c.to_string(),
        _ => structure.composition().reduced_formula(),
    });

    // Line 2: Scaling factor
    lines.push("1.0".to_string());

    // Lines 3-5: Lattice vectors (rows are a, b, c)
    for row in 0..3 {
        lines.push(format!(
            "  {:20.16}  {:20.16}  {:20.16}",
            mat[(row, 0)],
            mat[(row, 1)],
            mat[(row, 2)]
        ));
    }

    // Line 6: Element symbols
    let symbols: Vec<&str> = element_sites.keys().copied().collect();
    lines.push(format!("  {}", symbols.join("  ")));

    // Line 7: Element counts
    let counts: Vec<String> = element_sites
        .values()
        .map(|v| v.len().to_string())
        .collect();
    lines.push(format!("  {}", counts.join("  ")));

    // Line 8: Direct (fractional coordinates)
    lines.push("Direct".to_string());

    // Coordinate lines (in element order)
    for indices in element_sites.values() {
        for &idx in indices {
            let frac = &structure.frac_coords[idx];
            lines.push(format!(
                "  {:20.16}  {:20.16}  {:20.16}",
                frac.x, frac.y, frac.z
            ));
        }
    }

    lines.join("\n") + "\n"
}

/// Write a structure to a POSCAR file.
///
/// # Arguments
///
/// * `structure` - The structure to write
/// * `path` - Path to the output file
/// * `comment` - Optional comment line
///
/// # Returns
///
/// Result indicating success or file I/O error.
pub fn write_poscar(structure: &Structure, path: &Path, comment: Option<&str>) -> Result<()> {
    let content = structure_to_poscar(structure, comment);
    std::fs::write(path, content)?;
    Ok(())
}

/// Format a JSON value for extXYZ comment line.
/// Returns None for arrays/objects which can't be represented inline.
fn format_extxyz_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::String(s) => {
            // Escape quotes, backslashes, and newlines to prevent malformed output
            let escaped = s
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n");
            Some(format!("\"{}\"", escaped))
        }
        serde_json::Value::Bool(b) => Some(b.to_string()),
        _ => None, // Skip arrays/objects
    }
}

/// Convert a structure to extXYZ format string.
///
/// The output follows the extended XYZ format with lattice in the comment line.
///
/// # Arguments
///
/// * `structure` - The structure to serialize
/// * `properties` - Optional additional properties for the comment line
///
/// # Returns
///
/// extXYZ format string.
pub fn structure_to_extxyz(
    structure: &Structure,
    properties: Option<&HashMap<String, serde_json::Value>>,
) -> String {
    let mat = structure.lattice.matrix();
    let pbc = structure.lattice.pbc;

    // Line 1: Number of atoms
    let mut lines = vec![structure.num_sites().to_string()];

    // Line 2: Comment with Lattice and properties
    // Format: Lattice="ax ay az bx by bz cx cy cz" pbc="T T T" [other properties]
    let lattice_str = format!(
        "{:.10} {:.10} {:.10} {:.10} {:.10} {:.10} {:.10} {:.10} {:.10}",
        mat[(0, 0)],
        mat[(0, 1)],
        mat[(0, 2)],
        mat[(1, 0)],
        mat[(1, 1)],
        mat[(1, 2)],
        mat[(2, 0)],
        mat[(2, 1)],
        mat[(2, 2)]
    );

    let pbc_str = pbc.map(|b| if b { "T" } else { "F" }).join(" ");

    let mut comment_parts = vec![
        format!("Lattice=\"{}\"", lattice_str),
        format!("pbc=\"{}\"", pbc_str),
    ];

    // Add structure properties and additional properties
    let all_props = structure
        .properties
        .iter()
        .chain(properties.into_iter().flatten());
    for (key, value) in all_props {
        if key != "Lattice"
            && key != "pbc"
            && let Some(value_str) = format_extxyz_value(value)
        {
            comment_parts.push(format!("{}={}", key, value_str));
        }
    }

    lines.push(comment_parts.join(" "));

    // Atom lines: Element X Y Z (Cartesian coordinates)
    let cart_coords = structure.cart_coords();
    for (site_occ, cart) in structure.site_occupancies.iter().zip(cart_coords.iter()) {
        let symbol = site_occ.dominant_species().element.symbol();
        lines.push(format!(
            "{} {:20.16} {:20.16} {:20.16}",
            symbol, cart.x, cart.y, cart.z
        ));
    }

    lines.join("\n") + "\n"
}

/// Write a structure to an extXYZ file.
///
/// # Arguments
///
/// * `structure` - The structure to write
/// * `path` - Path to the output file
/// * `properties` - Optional additional properties
///
/// # Returns
///
/// Result indicating success or file I/O error.
pub fn write_extxyz(
    structure: &Structure,
    path: &Path,
    properties: Option<&HashMap<String, serde_json::Value>>,
) -> Result<()> {
    let content = structure_to_extxyz(structure, properties);
    std::fs::write(path, content)?;
    Ok(())
}

/// Write a structure to a file with automatic format detection.
///
/// The format is determined by the file extension:
/// - `.json` - Pymatgen JSON format
/// - `.cif` - CIF format
/// - `.xyz`, `.extxyz` - extXYZ format
/// - `.vasp`, `POSCAR*`, `CONTCAR*` - POSCAR format
///
/// # Arguments
///
/// * `structure` - The structure to write
/// * `path` - Path to the output file
///
/// # Returns
///
/// Result indicating success or error.
pub fn write_structure(structure: &Structure, path: &Path) -> Result<()> {
    let format = StructureFormat::from_path(path).ok_or_else(|| FerroxError::UnknownFormat {
        path: path.display().to_string(),
    })?;

    match format {
        StructureFormat::PymatgenJson => {
            std::fs::write(path, structure_to_pymatgen_json(structure))?;
        }
        StructureFormat::Poscar => write_poscar(structure, path, None)?,
        StructureFormat::ExtXyz => write_extxyz(structure, path, None)?,
        StructureFormat::Cif => crate::cif::write_cif(structure, path, None)?,
    }
    Ok(())
}

// === Molecule Parsers ===

/// Represents a pymatgen Molecule JSON structure.
#[derive(Debug, Deserialize)]
#[allow(dead_code)] // Fields parsed for compatibility but not all used
struct PymatgenMolecule {
    #[serde(rename = "@module")]
    _module: Option<String>,
    #[serde(rename = "@class")]
    _class: Option<String>,
    sites: Vec<PymatgenSite>,
    #[serde(default)]
    charge: f64,
    #[serde(default)]
    properties: serde_json::Value,
}

/// Parse a molecule from pymatgen's Molecule JSON format.
///
/// Supports the format produced by `Molecule.as_dict()` in pymatgen.
///
/// # Arguments
///
/// * `json` - JSON string in pymatgen Molecule.as_dict() format
///
/// # Returns
///
/// The parsed molecule or an error if parsing fails.
///
/// # Example
///
/// ```rust,ignore
/// let json = r#"{
///     "sites": [
///         {"species": [{"element": "O"}], "xyz": [0, 0, 0]},
///         {"species": [{"element": "H"}], "xyz": [0.96, 0, 0]},
///         {"species": [{"element": "H"}], "xyz": [-0.24, 0.93, 0]}
///     ],
///     "charge": 0
/// }"#;
/// let molecule = parse_molecule_json(json)?;
/// ```
pub fn parse_molecule_json(json: &str) -> Result<Structure> {
    let parsed: PymatgenMolecule =
        serde_json::from_str(json).map_err(|e| FerroxError::JsonError {
            path: "inline".to_string(),
            reason: e.to_string(),
        })?;

    // Build site occupancies and coordinates
    let mut site_occupancies = Vec::with_capacity(parsed.sites.len());
    let mut cart_coords = Vec::with_capacity(parsed.sites.len());

    for (idx, site) in parsed.sites.iter().enumerate() {
        if site.species.is_empty() {
            return Err(FerroxError::JsonError {
                path: "inline".to_string(),
                reason: format!("Site {idx} has no species"),
            });
        }

        // Parse all species with their occupancies using shared helper
        let mut species_vec = Vec::with_capacity(site.species.len());
        let mut site_props: HashMap<String, serde_json::Value> = HashMap::new();
        let mut species_metadata: Vec<HashMap<String, serde_json::Value>> =
            Vec::with_capacity(site.species.len());

        for sp_json in &site.species {
            let (sp, occu, metadata) = parse_species_entry(sp_json, idx)?;
            species_vec.push((sp, occu));
            species_metadata.push(metadata);
        }

        // Only merge species metadata for single-species sites
        if species_metadata.len() == 1 {
            for (key, val) in species_metadata.into_iter().next().unwrap() {
                site_props.insert(key, val);
            }
        }

        // Add site label if present
        if let Some(ref label) = site.label {
            site_props.insert("label".to_string(), serde_json::json!(label));
        }

        // Merge site properties from JSON
        if let serde_json::Value::Object(map) = &site.properties {
            for (key, val) in map {
                site_props.insert(key.clone(), val.clone());
            }
        }

        site_occupancies.push(SiteOccupancy::with_properties(species_vec, site_props));

        // Molecules require Cartesian (xyz) coordinates - fractional (abc) coordinates
        // don't make sense without a lattice to convert them
        let coords = site.xyz.ok_or_else(|| FerroxError::JsonError {
            path: "inline".to_string(),
            reason: format!(
                "Site {idx} missing 'xyz' (Cartesian coordinates required for molecules)"
            ),
        })?;
        cart_coords.push(Vector3::new(coords[0], coords[1], coords[2]));
    }

    // Extract molecule-level properties from JSON
    let properties: HashMap<String, serde_json::Value> = match parsed.properties {
        serde_json::Value::Object(map) => map.into_iter().collect(),
        _ => HashMap::new(),
    };

    Structure::try_new_molecule_from_occupancies(
        site_occupancies,
        cart_coords,
        parsed.charge,
        properties,
    )
}

/// Serialize a non-periodic structure (molecule) to pymatgen's Molecule JSON format.
///
/// Produces JSON compatible with pymatgen's `Molecule.from_dict()`.
///
/// # Arguments
///
/// * `structure` - The structure to serialize (should have `pbc = [false, false, false]`)
///
/// # Returns
///
/// JSON string in pymatgen Molecule format.
pub fn molecule_to_pymatgen_json(structure: &Structure) -> String {
    use serde_json::{Value, json};

    let cart_coords = structure.cart_coords();

    // Build sites with all species and their occupancies
    let sites: Vec<Value> = structure
        .site_occupancies
        .iter()
        .zip(cart_coords.iter())
        .map(|(site_occ, cart)| {
            let species_list: Vec<Value> = site_occ
                .species
                .iter()
                .map(|(sp, occ)| {
                    let mut entry = json!({
                        "element": sp.element.symbol(),
                        "occu": occ
                    });
                    if let Some(oxi) = sp.oxidation_state {
                        entry["oxidation_state"] = json!(oxi);
                    }
                    entry
                })
                .collect();

            // Extract label from properties if present
            let label = site_occ
                .properties
                .get("label")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            // Build site properties (excluding label which is at top level)
            let props: serde_json::Map<String, Value> = site_occ
                .properties
                .iter()
                .filter(|(k, _)| k.as_str() != "label")
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();

            // Generate default label from species symbols if not present
            let default_label: String = site_occ
                .species
                .iter()
                .map(|(sp, _)| sp.element.symbol())
                .collect::<Vec<_>>()
                .join(",");

            json!({
                "species": species_list,
                "xyz": [cart.x, cart.y, cart.z],
                "label": label.unwrap_or(default_label),
                "properties": Value::Object(props)
            })
        })
        .collect();

    // Build molecule properties
    let properties: serde_json::Map<String, Value> =
        structure.properties.clone().into_iter().collect();

    // Build full molecule
    let result = json!({
        "@module": "pymatgen.core.structure",
        "@class": "Molecule",
        "charge": structure.charge,
        "sites": sites,
        "properties": properties
    });

    result.to_string()
}

/// Parse a molecule from a plain XYZ file (no lattice required).
///
/// This function parses standard XYZ format with Cartesian coordinates.
/// For files with lattice information, use [`parse_extxyz`] instead.
///
/// # Arguments
///
/// * `path` - Path to the XYZ file
///
/// # Returns
///
/// The parsed structure (non-periodic) or an error if parsing fails.
pub fn parse_xyz(path: &Path) -> Result<Structure> {
    let frames = parse_xyz_molecules(path)?;
    frames
        .into_iter()
        .next()
        .ok_or_else(|| FerroxError::EmptyFile {
            path: path.display().to_string(),
        })?
}

/// Parse a molecule from XYZ content string.
///
/// # Arguments
///
/// * `content` - XYZ file content as string
///
/// # Returns
///
/// The parsed structure (non-periodic) or an error if parsing fails.
pub fn parse_xyz_str(content: &str) -> Result<Structure> {
    frame_to_molecule(content, Path::new("inline"))
}

/// Parse all frames from an XYZ file as molecules.
///
/// Returns a vector of molecules for all frames in the file.
///
/// # Arguments
///
/// * `path` - Path to the XYZ file
///
/// # Returns
///
/// Vector of Result<Structure> (non-periodic) for each frame.
pub fn parse_xyz_molecules(path: &Path) -> Result<Vec<Result<Structure>>> {
    let path_str = path.to_string_lossy().to_string();
    let frames = extxyz::read_xyz_frames(&path_str, 0..).map_err(|e| FerroxError::ParseError {
        path: path.display().to_string(),
        reason: format!("XYZ read error: {e}"),
    })?;

    Ok(frames
        .map(|frame| frame_to_molecule(&frame, path))
        .collect())
}

fn frame_to_molecule(frame: &str, path: &Path) -> Result<Structure> {
    let atoms = extxyz::RawAtoms::parse_from(frame).map_err(|e| FerroxError::ParseError {
        path: path.display().to_string(),
        reason: format!("XYZ parse error: {e}"),
    })?;

    // Try to parse comment line for properties (but NOT lattice - this is for molecules)
    // Plain XYZ comments (like "Water" or "Methane") won't parse as extXYZ info - that's OK
    let info: extxyz::Info = atoms.comment.parse().unwrap_or_default();

    // Parse species and coordinates
    let mut species = Vec::with_capacity(atoms.atoms.len());
    let mut cart_coords = Vec::with_capacity(atoms.atoms.len());

    for atom in &atoms.atoms {
        let element =
            Element::from_symbol(atom.element).ok_or_else(|| FerroxError::ParseError {
                path: path.display().to_string(),
                reason: format!("Unknown element symbol: {}", atom.element),
            })?;
        species.push(Species::neutral(element));
        cart_coords.push(Vector3::new(
            atom.position[0],
            atom.position[1],
            atom.position[2],
        ));
    }

    // Extract properties (energy, charge, etc.)
    let mut properties = HashMap::new();
    let mut charge = 0.0;

    if let Some(energy_value) = info.get("energy")
        && let Some(energy) = energy_value.as_f64()
    {
        properties.insert("energy".to_string(), serde_json::json!(energy));
    }

    if let Some(charge_value) = info.get("charge")
        && let Some(ch) = charge_value.as_f64()
    {
        charge = ch;
    }

    // Store other info as properties (exclude structure-specific and already-handled keys)
    let skip_keys = ["Lattice", "pbc", "energy", "charge", "Properties"];
    for (key, value) in info.raw_map().iter() {
        if !skip_keys.contains(&key.as_str()) {
            properties.insert(key.to_string(), value.clone());
        }
    }

    Structure::try_new_molecule(species, cart_coords, charge, properties)
}

/// Convert a non-periodic structure (molecule) to plain XYZ format string.
///
/// # Arguments
///
/// * `structure` - The structure to serialize (should have `pbc = [false, false, false]`)
/// * `comment` - Optional comment (defaults to formula)
///
/// # Returns
///
/// XYZ format string.
pub fn molecule_to_xyz(structure: &Structure, comment: Option<&str>) -> String {
    let mut lines = vec![structure.num_sites().to_string()];

    // Comment line (second line)
    let comment_str = comment
        .map(|c| c.to_string())
        .unwrap_or_else(|| structure.composition().reduced_formula());
    lines.push(comment_str);

    // Atom lines: Element X Y Z
    let cart_coords = structure.cart_coords();
    for (site_occ, cart) in structure.site_occupancies.iter().zip(cart_coords.iter()) {
        let symbol = site_occ.dominant_species().element.symbol();
        lines.push(format!(
            "{} {:20.16} {:20.16} {:20.16}",
            symbol, cart.x, cart.y, cart.z
        ));
    }

    lines.join("\n") + "\n"
}

/// Convert a non-periodic structure (molecule) to extXYZ format string with properties.
///
/// This produces an extXYZ file but without lattice information,
/// suitable for molecular data with attached properties.
///
/// # Arguments
///
/// * `structure` - The structure to serialize (should have `pbc = [false, false, false]`)
/// * `properties` - Optional additional properties for the comment line
///
/// # Returns
///
/// extXYZ format string (without lattice).
pub fn molecule_to_extxyz(
    structure: &Structure,
    properties: Option<&HashMap<String, serde_json::Value>>,
) -> String {
    // Line 1: Number of atoms
    let mut lines = vec![structure.num_sites().to_string()];

    // Line 2: Comment with properties (no lattice for molecules)
    // Format: pbc="F F F" [other properties]
    let mut comment_parts = vec!["pbc=\"F F F\"".to_string()];

    // Add charge if non-zero
    if structure.charge.abs() > 1e-10 {
        comment_parts.push(format!("charge={}", structure.charge));
    }

    // Add molecule properties and additional properties
    let all_props = structure
        .properties
        .iter()
        .chain(properties.into_iter().flatten());
    for (key, value) in all_props {
        if key != "pbc"
            && key != "charge"
            && let Some(value_str) = format_extxyz_value(value)
        {
            comment_parts.push(format!("{key}={value_str}"));
        }
    }

    lines.push(comment_parts.join(" "));

    // Atom lines: Element X Y Z (Cartesian coordinates)
    let cart_coords = structure.cart_coords();
    for (site_occ, cart) in structure.site_occupancies.iter().zip(cart_coords.iter()) {
        let symbol = site_occ.dominant_species().element.symbol();
        lines.push(format!(
            "{} {:20.16} {:20.16} {:20.16}",
            symbol, cart.x, cart.y, cart.z
        ));
    }

    lines.join("\n") + "\n"
}

/// Write a non-periodic structure (molecule) to an XYZ file.
///
/// # Arguments
///
/// * `structure` - The structure to write (should have `pbc = [false, false, false]`)
/// * `path` - Path to the output file
/// * `comment` - Optional comment line
///
/// # Returns
///
/// Result indicating success or file I/O error.
pub fn write_xyz(structure: &Structure, path: &Path, comment: Option<&str>) -> Result<()> {
    let content = molecule_to_xyz(structure, comment);
    std::fs::write(path, content)?;
    Ok(())
}

/// Deprecated: Use `Structure` with `is_molecule()` instead.
///
/// This enum is kept for backward compatibility but will be removed in a future version.
/// Since `Structure` now has `pbc` and `charge` fields, it can represent both periodic
/// and non-periodic systems.
#[derive(Debug, Clone)]
#[deprecated(
    since = "0.1.0",
    note = "Use Structure with is_molecule() check instead"
)]
pub enum StructureOrMolecule {
    /// A periodic crystal structure with lattice
    Structure(Structure),
    /// A non-periodic structure (molecule) - internally just Structure with pbc=[false,false,false]
    Molecule(Structure),
}

// === ASE Atoms Dict Conversion ===

/// Represents an ASE Atoms dict structure.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct AseAtomsDict {
    /// Element symbols for each atom
    symbols: Vec<String>,
    /// Cartesian positions [[x1, y1, z1], ...]
    positions: Vec<[f64; 3]>,
    /// Cell matrix (3x3), optional for molecules
    #[serde(default)]
    cell: Option<[[f64; 3]; 3]>,
    /// Periodic boundary conditions [pbc_x, pbc_y, pbc_z]
    #[serde(default = "default_ase_pbc")]
    pbc: [bool; 3],
    /// Additional info dict (charge, energy, etc.)
    #[serde(default)]
    info: HashMap<String, serde_json::Value>,
}

fn default_ase_pbc() -> [bool; 3] {
    [false, false, false]
}

/// Parse ASE Atoms dict format from JSON.
///
/// Returns a Structure if a cell is present and pbc contains at least one true,
/// otherwise returns a Molecule.
///
/// # Arguments
///
/// * `json` - JSON string in ASE Atoms dict format
///
/// # Returns
///
/// Either a Structure or Molecule depending on periodicity.
///
/// # Example
///
/// ```rust,ignore
/// let json = r#"{
///     "symbols": ["Fe", "O"],
///     "positions": [[0, 0, 0], [2, 0, 0]],
///     "cell": [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
///     "pbc": [true, true, true]
/// }"#;
/// let result = parse_ase_atoms_json(json)?;
/// ```
#[allow(deprecated)]
pub fn parse_ase_atoms_json(json: &str) -> Result<StructureOrMolecule> {
    let parsed: AseAtomsDict = serde_json::from_str(json).map_err(|e| FerroxError::JsonError {
        path: "inline".to_string(),
        reason: e.to_string(),
    })?;

    // Validate lengths match
    if parsed.symbols.len() != parsed.positions.len() {
        return Err(FerroxError::JsonError {
            path: "inline".to_string(),
            reason: format!(
                "symbols and positions must have same length: {} vs {}",
                parsed.symbols.len(),
                parsed.positions.len()
            ),
        });
    }

    // Parse species
    let mut species = Vec::with_capacity(parsed.symbols.len());
    for symbol in &parsed.symbols {
        let element = Element::from_symbol(symbol).ok_or_else(|| FerroxError::JsonError {
            path: "inline".to_string(),
            reason: format!("Unknown element symbol: {symbol}"),
        })?;
        species.push(Species::neutral(element));
    }

    // Parse coordinates
    let cart_coords: Vec<Vector3<f64>> = parsed
        .positions
        .iter()
        .map(|pos| Vector3::new(pos[0], pos[1], pos[2]))
        .collect();

    // Check if periodic (has cell and at least one pbc direction)
    let is_periodic = parsed.cell.is_some() && parsed.pbc.iter().any(|&p| p);

    // Extract charge from info (used by both branches)
    let charge = parsed
        .info
        .get("charge")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    if is_periodic {
        // Create periodic Structure
        // ASE cell is row-major: cell[0] = a vector, cell[1] = b vector, cell[2] = c vector
        let cell = parsed.cell.unwrap();
        let matrix = nalgebra::Matrix3::from_row_slice(&[
            cell[0][0], cell[0][1], cell[0][2], cell[1][0], cell[1][1], cell[1][2], cell[2][0],
            cell[2][1], cell[2][2],
        ]);
        let mut lattice = Lattice::new(matrix);
        lattice.pbc = parsed.pbc;

        // Convert Cartesian to fractional
        let frac_coords = lattice.get_fractional_coords(&cart_coords);

        // Extract properties from info (excluding charge which is a dedicated field)
        let properties: HashMap<String, serde_json::Value> = parsed
            .info
            .into_iter()
            .filter(|(k, _)| k != "charge")
            .collect();

        // Use try_new_full to preserve pbc and charge from ASE
        let pbc = parsed.pbc;
        #[allow(deprecated)]
        Ok(StructureOrMolecule::Structure(Structure::try_new_full(
            lattice,
            species.into_iter().map(SiteOccupancy::ordered).collect(),
            frac_coords,
            pbc,
            charge,
            properties,
        )?))
    } else {
        // Create non-periodic Structure (molecule)
        let properties: HashMap<String, serde_json::Value> = parsed
            .info
            .into_iter()
            .filter(|(k, _)| k != "charge")
            .collect();

        #[allow(deprecated)]
        Ok(StructureOrMolecule::Molecule(Structure::try_new_molecule(
            species,
            cart_coords,
            charge,
            properties,
        )?))
    }
}

/// Convert a Structure to ASE Atoms dict format.
///
/// # Arguments
///
/// * `structure` - The structure to convert
///
/// # Returns
///
/// JSON Value in ASE Atoms dict format.
pub fn structure_to_ase_atoms_dict(structure: &Structure) -> serde_json::Value {
    use serde_json::json;

    // Get symbols (dominant species for each site)
    let symbols: Vec<&str> = structure
        .site_occupancies
        .iter()
        .map(|so| so.dominant_species().element.symbol())
        .collect();

    // Get Cartesian positions
    let cart_coords = structure.cart_coords();
    let positions: Vec<[f64; 3]> = cart_coords.iter().map(|c| [c.x, c.y, c.z]).collect();

    // Get cell matrix (row vectors)
    let mat = structure.lattice.matrix();
    let cell = [
        [mat[(0, 0)], mat[(0, 1)], mat[(0, 2)]],
        [mat[(1, 0)], mat[(1, 1)], mat[(1, 2)]],
        [mat[(2, 0)], mat[(2, 1)], mat[(2, 2)]],
    ];

    // Build info dict from properties, including charge if non-zero
    let mut info: serde_json::Map<String, serde_json::Value> =
        structure.properties.clone().into_iter().collect();
    if structure.charge.abs() > 1e-10 {
        info.insert("charge".to_string(), json!(structure.charge));
    }

    json!({
        "symbols": symbols,
        "positions": positions,
        "cell": cell,
        "pbc": structure.pbc,
        "info": info
    })
}

/// Convert a non-periodic structure (molecule) to ASE Atoms dict format.
///
/// # Arguments
///
/// * `structure` - The structure to convert (should have `pbc = [false, false, false]`)
///
/// # Returns
///
/// JSON Value in ASE Atoms dict format (with pbc=[false, false, false]).
pub fn molecule_to_ase_atoms_dict(structure: &Structure) -> serde_json::Value {
    use serde_json::json;

    // Get symbols (dominant species for each site)
    let symbols: Vec<&str> = structure
        .site_occupancies
        .iter()
        .map(|so| so.dominant_species().element.symbol())
        .collect();

    // Get Cartesian positions
    let cart_coords = structure.cart_coords();
    let positions: Vec<[f64; 3]> = cart_coords.iter().map(|c| [c.x, c.y, c.z]).collect();

    // Build info dict from properties, including charge
    let mut info: serde_json::Map<String, serde_json::Value> =
        structure.properties.clone().into_iter().collect();
    if structure.charge.abs() > 1e-10 {
        info.insert("charge".to_string(), json!(structure.charge));
    }

    json!({
        "symbols": symbols,
        "positions": positions,
        "cell": serde_json::Value::Null,
        "pbc": [false, false, false],
        "info": info
    })
}

/// Batch convert structures to ASE Atoms dicts.
///
/// # Arguments
///
/// * `structures` - Slice of structures to convert
///
/// # Returns
///
/// Vector of JSON Values in ASE Atoms dict format.
pub fn structures_to_ase_atoms_dicts(structures: &[Structure]) -> Vec<serde_json::Value> {
    structures.iter().map(structure_to_ase_atoms_dict).collect()
}

/// Batch convert non-periodic structures (molecules) to ASE Atoms dicts.
///
/// # Arguments
///
/// * `structures` - Slice of structures to convert (should have `pbc = [false, false, false]`)
///
/// # Returns
///
/// Vector of JSON Values in ASE Atoms dict format.
pub fn molecules_to_ase_atoms_dicts(structures: &[Structure]) -> Vec<serde_json::Value> {
    structures.iter().map(molecule_to_ase_atoms_dict).collect()
}

/// Convert ASE Atoms dict JSON string to pymatgen JSON.
///
/// This is a convenience function for conversion between formats.
/// Returns Structure JSON for periodic systems, Molecule JSON for non-periodic.
///
/// # Arguments
///
/// * `ase_json` - JSON string in ASE Atoms dict format
///
/// # Returns
///
/// JSON string in pymatgen format (Structure or Molecule based on pbc).
#[allow(deprecated)]
pub fn ase_atoms_to_pymatgen_json(ase_json: &str) -> Result<String> {
    match parse_ase_atoms_json(ase_json)? {
        StructureOrMolecule::Structure(s) => Ok(structure_to_pymatgen_json(&s)),
        StructureOrMolecule::Molecule(m) => Ok(molecule_to_pymatgen_json(&m)),
    }
}

/// Parse an XYZ file, returning either a Structure or Molecule.
///
/// If the file contains lattice information (extXYZ format), returns a Structure.
/// Otherwise, returns a Molecule.
///
/// # Arguments
///
/// * `path` - Path to the XYZ file
///
/// # Returns
///
/// Either a Structure (if lattice present) or non-periodic Structure (if no lattice).
#[allow(deprecated)]
pub fn parse_xyz_flexible(path: &Path) -> Result<StructureOrMolecule> {
    let path_str = path.to_string_lossy().to_string();
    let mut frames =
        extxyz::read_xyz_frames(&path_str, 0..).map_err(|e| FerroxError::ParseError {
            path: path.display().to_string(),
            reason: format!("XYZ read error: {e}"),
        })?;

    let frame = frames.next().ok_or_else(|| FerroxError::EmptyFile {
        path: path.display().to_string(),
    })?;

    let atoms = extxyz::RawAtoms::parse_from(&frame).map_err(|e| FerroxError::ParseError {
        path: path.display().to_string(),
        reason: format!("XYZ parse error: {e}"),
    })?;

    // Try to parse comment line - plain XYZ comments won't parse as extXYZ info, that's OK
    let info: extxyz::Info = atoms.comment.parse().unwrap_or_default();

    // Check if lattice is present
    if info.get("Lattice").is_some() {
        // Has lattice - parse as periodic structure
        Ok(StructureOrMolecule::Structure(frame_to_structure(
            &frame, path,
        )?))
    } else {
        // No lattice - parse as non-periodic structure (molecule)
        Ok(StructureOrMolecule::Molecule(frame_to_molecule(
            &frame, path,
        )?))
    }
}

// === TorchSim State Conversion ===

/// Transpose cell matrix from row-major (ASE/pymatgen) to column-major (TorchSim).
fn cell_to_column_major(mat: &nalgebra::Matrix3<f64>) -> [[f64; 3]; 3] {
    [
        [mat[(0, 0)], mat[(1, 0)], mat[(2, 0)]], // column a
        [mat[(0, 1)], mat[(1, 1)], mat[(2, 1)]], // column b
        [mat[(0, 2)], mat[(1, 2)], mat[(2, 2)]], // column c
    ]
}

/// Transpose cell matrix from column-major (TorchSim) to row-major (ASE/pymatgen).
fn cell_from_column_major(cols: &[[f64; 3]; 3]) -> nalgebra::Matrix3<f64> {
    nalgebra::Matrix3::new(
        cols[0][0], cols[1][0], cols[2][0], // row 0
        cols[0][1], cols[1][1], cols[2][1], // row 1
        cols[0][2], cols[1][2], cols[2][2], // row 2
    )
}

/// Represents a TorchSim SimState for serialization.
///
/// TorchSim uses batched states where multiple systems can be stored together.
/// The `system_idx` field indicates which system each atom belongs to.
///
/// Note: Cell matrices use column-major convention (transposed from ASE).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TorchSimState {
    /// Cartesian positions for all atoms, shape (n_total_atoms, 3)
    pub positions: Vec<[f64; 3]>,
    /// Atomic masses in amu, shape (n_total_atoms,)
    pub masses: Vec<f64>,
    /// Cell matrices for each system, shape (n_systems, 3, 3)
    /// Uses column-major convention: cell[i] contains columns [a, b, c]
    pub cell: Vec<[[f64; 3]; 3]>,
    /// Periodic boundary conditions [pbc_x, pbc_y, pbc_z]
    pub pbc: [bool; 3],
    /// Atomic numbers for all atoms, shape (n_total_atoms,)
    pub atomic_numbers: Vec<i32>,
    /// System index for each atom, shape (n_total_atoms,)
    /// Indicates which system (0-indexed) each atom belongs to
    pub system_idx: Vec<usize>,
    /// Total charge for each system, shape (n_systems,)
    #[serde(default)]
    pub charge: Vec<f64>,
    /// Spin multiplicity for each system, shape (n_systems,)
    #[serde(default)]
    pub spin: Vec<f64>,
}

/// Convert a single Structure to TorchSim state format.
///
/// # Arguments
///
/// * `structure` - The structure to convert
///
/// # Returns
///
/// TorchSimState with a single system (system_idx all zeros).
pub fn structure_to_torch_sim_state(structure: &Structure) -> TorchSimState {
    let n_atoms = structure.num_sites();
    let cart_coords = structure.cart_coords();

    // Positions as [x, y, z] arrays
    let positions: Vec<[f64; 3]> = cart_coords.iter().map(|c| [c.x, c.y, c.z]).collect();

    // Masses from elements
    let masses: Vec<f64> = structure
        .site_occupancies
        .iter()
        .map(|so| so.dominant_species().element.atomic_mass())
        .collect();

    // Cell matrix - transpose to column-major for TorchSim
    let cell = vec![cell_to_column_major(structure.lattice.matrix())];

    // Atomic numbers
    let atomic_numbers: Vec<i32> = structure
        .site_occupancies
        .iter()
        .map(|so| so.dominant_species().element.atomic_number() as i32)
        .collect();

    // All atoms belong to system 0
    let system_idx = vec![0usize; n_atoms];

    // Extract spin from properties if present (like ASE's atoms.info["spin"])
    let spin = structure
        .properties
        .get("spin")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    TorchSimState {
        positions,
        masses,
        cell,
        pbc: structure.lattice.pbc,
        atomic_numbers,
        system_idx,
        charge: vec![structure.charge],
        spin: vec![spin],
    }
}

/// Convert multiple Structures to a batched TorchSim state.
///
/// # Arguments
///
/// * `structures` - Slice of structures to convert
///
/// # Returns
///
/// TorchSimState with all systems batched together.
///
/// # Errors
///
/// Returns an error if structures have inconsistent PBC settings.
pub fn structures_to_torch_sim_state(structures: &[Structure]) -> Result<TorchSimState> {
    if structures.is_empty() {
        return Ok(TorchSimState {
            positions: vec![],
            masses: vec![],
            cell: vec![],
            pbc: [true, true, true],
            atomic_numbers: vec![],
            system_idx: vec![],
            charge: vec![],
            spin: vec![],
        });
    }

    // Verify consistent PBC
    let first_pbc = structures[0].lattice.pbc;
    for (idx, structure) in structures.iter().enumerate().skip(1) {
        if structure.lattice.pbc != first_pbc {
            return Err(FerroxError::JsonError {
                path: "inline".to_string(),
                reason: format!(
                    "Structure {} has pbc {:?}, but structure 0 has pbc {:?}. All structures must have the same periodic boundary conditions.",
                    idx, structure.lattice.pbc, first_pbc
                ),
            });
        }
    }

    let total_atoms: usize = structures.iter().map(|s| s.num_sites()).sum();

    let mut positions = Vec::with_capacity(total_atoms);
    let mut masses = Vec::with_capacity(total_atoms);
    let mut atomic_numbers = Vec::with_capacity(total_atoms);
    let mut system_idx = Vec::with_capacity(total_atoms);
    let mut cell = Vec::with_capacity(structures.len());
    let mut charge = Vec::with_capacity(structures.len());
    let mut spin = Vec::with_capacity(structures.len());

    for (sys_idx, structure) in structures.iter().enumerate() {
        let cart_coords = structure.cart_coords();

        for (site_occ, cart) in structure.site_occupancies.iter().zip(cart_coords.iter()) {
            positions.push([cart.x, cart.y, cart.z]);
            masses.push(site_occ.dominant_species().element.atomic_mass());
            atomic_numbers.push(site_occ.dominant_species().element.atomic_number() as i32);
            system_idx.push(sys_idx);
        }

        // Cell matrix - transpose to column-major
        cell.push(cell_to_column_major(structure.lattice.matrix()));

        charge.push(structure.charge);
        // Extract spin from properties if present
        let sys_spin = structure
            .properties
            .get("spin")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        spin.push(sys_spin);
    }

    Ok(TorchSimState {
        positions,
        masses,
        cell,
        pbc: first_pbc,
        atomic_numbers,
        system_idx,
        charge,
        spin,
    })
}

/// Convert TorchSim state JSON to a list of Structures.
///
/// # Arguments
///
/// * `json_str` - JSON string in TorchSim state format
///
/// # Returns
///
/// Vector of Structures, one per system in the batched state.
pub fn parse_torch_sim_state(json_str: &str) -> Result<Vec<Structure>> {
    let state: TorchSimState =
        serde_json::from_str(json_str).map_err(|e| FerroxError::JsonError {
            path: "inline".to_string(),
            reason: format!("Invalid TorchSim state JSON: {e}"),
        })?;

    torch_sim_state_to_structures(&state)
}

/// Convert a TorchSimState to a list of Structures.
///
/// # Arguments
///
/// * `state` - The TorchSim state to convert
///
/// # Returns
///
/// Vector of Structures, one per system in the batched state.
pub fn torch_sim_state_to_structures(state: &TorchSimState) -> Result<Vec<Structure>> {
    if state.positions.is_empty() {
        return Ok(vec![]);
    }

    // Validate array lengths match
    let n_atoms = state.positions.len();
    if state.atomic_numbers.len() != n_atoms || state.system_idx.len() != n_atoms {
        return Err(FerroxError::JsonError {
            path: "inline".to_string(),
            reason: format!(
                "Array length mismatch: positions={}, atomic_numbers={}, system_idx={}",
                n_atoms,
                state.atomic_numbers.len(),
                state.system_idx.len()
            ),
        });
    }
    // Validate masses length if provided
    if !state.masses.is_empty() && state.masses.len() != n_atoms {
        return Err(FerroxError::JsonError {
            path: "inline".to_string(),
            reason: format!(
                "masses length {} doesn't match positions length {}",
                state.masses.len(),
                n_atoms
            ),
        });
    }

    // Determine number of systems
    let n_systems = state.cell.len();
    if n_systems == 0 {
        return Err(FerroxError::JsonError {
            path: "inline".to_string(),
            reason: "TorchSim state has positions but no cell matrices".to_string(),
        });
    }

    // Validate system_idx bounds - ensure no atom references a non-existent system
    if let Some(&max_sid) = state.system_idx.iter().max()
        && max_sid >= n_systems
    {
        return Err(FerroxError::JsonError {
            path: "inline".to_string(),
            reason: format!(
                "system_idx contains {max_sid} but only {n_systems} cell matrices are present"
            ),
        });
    }

    // Validate charge and spin lengths if provided
    if !state.charge.is_empty() && state.charge.len() != n_systems {
        return Err(FerroxError::JsonError {
            path: "inline".to_string(),
            reason: format!(
                "charge length ({}) must match number of systems ({n_systems})",
                state.charge.len()
            ),
        });
    }
    if !state.spin.is_empty() && state.spin.len() != n_systems {
        return Err(FerroxError::JsonError {
            path: "inline".to_string(),
            reason: format!(
                "spin length ({}) must match number of systems ({n_systems})",
                state.spin.len()
            ),
        });
    }

    let mut structures = Vec::with_capacity(n_systems);

    for sys_idx in 0..n_systems {
        // Find atoms belonging to this system
        let atom_indices: Vec<usize> = state
            .system_idx
            .iter()
            .enumerate()
            .filter_map(|(idx, &sid)| (sid == sys_idx).then_some(idx))
            .collect();

        if atom_indices.is_empty() {
            return Err(FerroxError::JsonError {
                path: "inline".to_string(),
                reason: format!("System {sys_idx} has no atoms"),
            });
        }

        // Extract positions for this system
        let cart_coords: Vec<Vector3<f64>> = atom_indices
            .iter()
            .map(|&idx| {
                let pos = state.positions[idx];
                Vector3::new(pos[0], pos[1], pos[2])
            })
            .collect();

        // Extract species for this system
        let species: Result<Vec<Species>> = atom_indices
            .iter()
            .map(|&idx| {
                let z_i32 = state.atomic_numbers[idx];
                // Validate range before casting to u8 to catch negative/overflow values
                if z_i32 <= 0 || z_i32 > u8::MAX as i32 {
                    return Err(FerroxError::JsonError {
                        path: "inline".to_string(),
                        reason: format!("Invalid atomic number: {z_i32}"),
                    });
                }
                let z = z_i32 as u8;
                let elem =
                    Element::from_atomic_number(z).ok_or_else(|| FerroxError::JsonError {
                        path: "inline".to_string(),
                        reason: format!("Invalid atomic number: {z}"),
                    })?;
                Ok(Species::neutral(elem))
            })
            .collect();
        let species = species?;

        // Cell matrix - transpose from column-major back to row-major
        let mut lattice = Lattice::new(cell_from_column_major(&state.cell[sys_idx]));
        lattice.pbc = state.pbc;

        // Convert Cartesian to fractional
        let frac_coords = lattice.get_fractional_coords(&cart_coords);

        // Get charge and spin for this system
        let charge = state.charge.get(sys_idx).copied().unwrap_or(0.0);
        let spin = state.spin.get(sys_idx).copied().unwrap_or(0.0);

        // Build properties map with spin if non-zero
        let mut properties = HashMap::new();
        if spin.abs() > 1e-10 {
            properties.insert("spin".to_string(), serde_json::json!(spin));
        }

        let structure = Structure::try_new_full(
            lattice,
            species.into_iter().map(SiteOccupancy::ordered).collect(),
            frac_coords,
            state.pbc,
            charge,
            properties,
        )?;

        structures.push(structure);
    }

    Ok(structures)
}

/// Convert TorchSim state to JSON string.
///
/// # Arguments
///
/// * `state` - The TorchSim state to serialize
///
/// # Returns
///
/// JSON string representation of the state.
pub fn torch_sim_state_to_json(state: &TorchSimState) -> String {
    serde_json::to_string(state).expect("TorchSimState serialization should not fail")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::Element;
    use tempfile::{NamedTempFile, TempDir};

    // Helper to count elements in a structure (counts dominant species per site)
    fn count_element(structure: &Structure, elem: Element) -> usize {
        structure
            .species()
            .iter()
            .filter(|sp| sp.element == elem)
            .count()
    }

    #[test]
    fn test_parse_simple_structure() {
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [
                {"species": [{"element": "Fe"}], "abc": [0,0,0]},
                {"species": [{"element": "Fe"}], "abc": [0.5,0.5,0.5]}
            ]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.num_sites(), 2);
        assert_eq!(s.species()[0].element, Element::Fe);
        assert_eq!(s.species()[1].element, Element::Fe);
        assert!((s.lattice.volume() - 64.0).abs() < 1e-10);
    }

    #[test]
    fn test_parse_with_oxidation_states() {
        let json = r#"{
            "lattice": {"matrix": [[5.64,0,0],[0,5.64,0],[0,0,5.64]]},
            "sites": [
                {"species": [{"element": "Na", "oxidation_state": 1}], "abc": [0,0,0]},
                {"species": [{"element": "Cl", "oxidation_state": -1}], "abc": [0.5,0.5,0.5]}
            ]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.species()[0].oxidation_state, Some(1));
        assert_eq!(s.species()[1].oxidation_state, Some(-1));
    }

    #[test]
    fn test_parse_oxidation_states_as_floats() {
        // Pymatgen serializes oxidation states as floats (e.g., 3.0 instead of 3)
        let json = r#"{
            "lattice": {"matrix": [[5.0,0,0],[0,5.0,0],[0,0,5.0]]},
            "sites": [
                {"species": [{"element": "Bi", "oxidation_state": 3.0}], "abc": [0,0,0]},
                {"species": [{"element": "Zr", "oxidation_state": 4.0}], "abc": [0.5,0.5,0.5]}
            ]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.species()[0].oxidation_state, Some(3));
        assert_eq!(s.species()[1].oxidation_state, Some(4));
    }

    #[test]
    fn test_parse_oxidation_states_null() {
        // Test that null oxidation_state is handled correctly
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [
                {"species": [{"element": "Fe", "oxidation_state": null}], "abc": [0,0,0]}
            ]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.species()[0].oxidation_state, None);
    }

    #[test]
    fn test_parse_full_pymatgen_format() {
        // Test with all optional fields present
        let json = r#"{
            "@module": "pymatgen.core.structure",
            "@class": "Structure",
            "charge": 0,
            "lattice": {
                "matrix": [[3.84, 0, 0], [0, 3.84, 0], [0, 0, 3.84]],
                "pbc": [true, true, true]
            },
            "sites": [
                {"species": [{"element": "Cu", "occu": 1.0}], "abc": [0, 0, 0], "properties": {}}
            ],
            "properties": {}
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.num_sites(), 1);
        assert_eq!(s.species()[0].element, Element::Cu);
    }

    #[test]
    fn test_parse_unknown_element_becomes_dummy() {
        // Unknown elements are now mapped to Dummy with original_symbol in properties
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [{"species": [{"element": "Zzz"}], "abc": [0,0,0]}]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.num_sites(), 1);
        assert_eq!(s.species()[0].element, Element::Dummy);

        // The original symbol should be stored in site properties
        let props = &s.site_occupancies[0].properties;
        assert_eq!(
            props.get("original_symbol").and_then(|v| v.as_str()),
            Some("Zzz")
        );
    }

    #[test]
    fn test_parse_empty_symbol_fails() {
        // Empty symbol should fail
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [{"species": [{"element": ""}], "abc": [0,0,0]}]
        }"#;

        let result = parse_structure_json(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_pseudo_elements() {
        // Dummy atoms are now valid
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [
                {"species": [{"element": "X"}], "abc": [0,0,0]},
                {"species": [{"element": "D"}], "abc": [0.5,0,0]},
                {"species": [{"element": "T"}], "abc": [0,0.5,0]}
            ]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.num_sites(), 3);
        assert_eq!(s.species()[0].element, Element::Dummy);
        assert_eq!(s.species()[1].element, Element::D);
        assert_eq!(s.species()[2].element, Element::T);
    }

    #[test]
    fn test_parse_oxidation_state_from_symbol() {
        // Oxidation state extracted from symbol (e.g., Fe2+)
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [{"species": [{"element": "Fe2+"}], "abc": [0,0,0]}]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.species()[0].element, Element::Fe);
        assert_eq!(s.species()[0].oxidation_state, Some(2));
    }

    #[test]
    fn test_parse_oxidation_state_conflict_error() {
        // Conflicting oxidation state: symbol says 2+, JSON says 3
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [{"species": [{"element": "Fe2+", "oxidation_state": 3}], "abc": [0,0,0]}]
        }"#;

        let result = parse_structure_json(json);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Conflicting oxidation states"));
    }

    #[test]
    fn test_parse_oxidation_state_match_ok() {
        // Same oxidation state in symbol and JSON is fine
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [{"species": [{"element": "Fe2+", "oxidation_state": 2}], "abc": [0,0,0]}]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.species()[0].oxidation_state, Some(2));
    }

    #[test]
    fn test_parse_site_properties() {
        // Site properties should be preserved
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [{
                "species": [{"element": "Fe"}],
                "abc": [0,0,0],
                "label": "Fe1_oct",
                "properties": {"magmom": 2.5, "selective_dynamics": [true, true, false]}
            }]
        }"#;

        let s = parse_structure_json(json).unwrap();
        let props = s.site_properties(0);

        // Check label is in properties
        assert_eq!(props.get("label").and_then(|v| v.as_str()), Some("Fe1_oct"));

        // Check magmom
        assert_eq!(props.get("magmom").and_then(|v| v.as_f64()), Some(2.5));

        // Check selective_dynamics
        let sd = props.get("selective_dynamics").and_then(|v| v.as_array());
        assert!(sd.is_some());
    }

    #[test]
    fn test_parse_potcar_suffix() {
        // POTCAR suffix should be extracted to metadata
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [{"species": [{"element": "Ca_pv"}], "abc": [0,0,0]}]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.species()[0].element, Element::Ca);

        // Check potcar_suffix in site properties
        let props = s.site_properties(0);
        assert_eq!(
            props.get("potcar_suffix").and_then(|v| v.as_str()),
            Some("_pv")
        );
    }

    #[test]
    fn test_parse_multi_species_no_metadata_overwrite() {
        // Multi-species sites should NOT merge per-species metadata to avoid overwrites
        // E.g., a disordered site with Fe_pv and Ni_sv should not lose one's suffix
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [{"species": [
                {"element": "Fe_pv", "occu": 0.5},
                {"element": "Ni_sv", "occu": 0.5}
            ], "abc": [0,0,0]}]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.num_sites(), 1);

        // Both species should be present
        let site_occ = &s.site_occupancies[0];
        assert_eq!(site_occ.species.len(), 2);

        // Metadata should NOT be merged (would cause overwrite conflicts)
        let props = s.site_properties(0);
        assert!(
            props.get("potcar_suffix").is_none(),
            "Multi-species metadata should not be merged to avoid overwrites"
        );
    }

    #[test]
    fn test_structure_charge() {
        // Helper to build minimal structure JSON with optional charge
        let make_json = |charge: Option<f64>| {
            let base = r#"{"lattice":{"matrix":[[4,0,0],[0,4,0],[0,0,4]]},"sites":[{"species":[{"element":"Na"}],"abc":[0,0,0]}]"#;
            charge.map_or(format!("{base}}}"), |c| format!("{base},\"charge\":{c}}}"))
        };

        // Parse: positive, negative, missing charge
        for (input, expected) in [(Some(1.0), 1.0), (Some(-1.5), -1.5), (None, 0.0)] {
            let s = parse_structure_json(&make_json(input)).unwrap();
            assert!((s.charge - expected).abs() < 1e-10, "input={input:?}");
            assert!(
                !s.properties.contains_key("charge"),
                "charge not in properties"
            );
        }

        // Roundtrip: charge survives serialize -> parse
        let s = Structure::try_new_full(
            Lattice::cubic(4.0),
            vec![SiteOccupancy::ordered(Species::neutral(Element::Li))],
            vec![Vector3::new(0.0, 0.0, 0.0)],
            [true, true, true],
            2.5,
            HashMap::new(),
        )
        .unwrap();
        let parsed = parse_structure_json(&structure_to_pymatgen_json(&s)).unwrap();
        assert!((parsed.charge - 2.5).abs() < 1e-10);
    }

    #[test]
    fn test_site_properties_serialization() {
        // Site properties should round-trip through serialization
        let lattice = Lattice::cubic(4.0);
        let species = Species::neutral(Element::Fe);
        let coords = vec![Vector3::new(0.0, 0.0, 0.0)];

        let mut props = HashMap::new();
        props.insert("magmom".to_string(), serde_json::json!(2.5));
        props.insert("label".to_string(), serde_json::json!("Fe1"));

        let site_occ = crate::species::SiteOccupancy::with_properties(vec![(species, 1.0)], props);

        let s1 = Structure::try_new_from_occupancies(lattice, vec![site_occ], coords).unwrap();

        // Serialize and parse back
        let json = structure_to_pymatgen_json(&s1);
        let s2 = parse_structure_json(&json).unwrap();

        // Check properties are preserved
        let props2 = s2.site_properties(0);
        assert_eq!(props2.get("magmom").and_then(|v| v.as_f64()), Some(2.5));
        assert_eq!(props2.get("label").and_then(|v| v.as_str()), Some("Fe1"));
    }

    #[test]
    fn test_parse_empty_species() {
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [{"species": [], "abc": [0,0,0]}]
        }"#;

        let result = parse_structure_json(json);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("no species"));
    }

    #[test]
    fn test_parse_invalid_json() {
        let json = "not valid json";
        let result = parse_structure_json(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_structure_to_json_roundtrip() {
        let lattice = Lattice::cubic(5.64);
        let species = vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)];
        let coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        let s1 = Structure::new(lattice, species, coords);

        let json = structure_to_json(&s1);
        let s2 = parse_structure_json(&json).unwrap();

        assert_eq!(s1.num_sites(), s2.num_sites());
        assert_eq!(s1.species()[0].element, s2.species()[0].element);
        assert_eq!(s1.species()[1].element, s2.species()[1].element);
        assert!((s1.lattice.volume() - s2.lattice.volume()).abs() < 1e-10);
        assert_eq!(s1.lattice.pbc, s2.lattice.pbc);
    }

    #[test]
    fn test_structure_to_json_preserves_pbc() {
        // Test non-standard PBC (e.g., slab with vacuum in z-direction)
        let mut lattice = Lattice::cubic(10.0);
        lattice.pbc = [true, true, false]; // Non-periodic in z
        let species = vec![Species::neutral(Element::Si)];
        let coords = vec![Vector3::new(0.5, 0.5, 0.5)];
        let s1 = Structure::new(lattice, species, coords);

        let json = structure_to_json(&s1);
        assert!(
            json.contains(r#""pbc":[true,true,false]"#),
            "JSON should contain pbc: {json}"
        );

        let s2 = parse_structure_json(&json).unwrap();
        assert_eq!(
            s2.lattice.pbc,
            [true, true, false],
            "PBC should be preserved in roundtrip"
        );
    }

    #[test]
    fn test_structure_to_json_preserves_properties() {
        // Test that properties survive JSON round-trip
        let json_with_props = r#"{
            "lattice": {"matrix": [[5.0,0,0],[0,5.0,0],[0,0,5.0]]},
            "sites": [{"species": [{"element": "Fe"}], "abc": [0.0, 0.0, 0.0]}],
            "properties": {"energy": -3.5, "source": "dft", "tags": ["test", "example"]}
        }"#;

        let s1 = parse_structure_json(json_with_props).unwrap();
        assert_eq!(s1.properties.len(), 3);
        assert_eq!(s1.properties["energy"], serde_json::json!(-3.5));
        assert_eq!(s1.properties["source"], serde_json::json!("dft"));

        // Round-trip through JSON
        let json_out = structure_to_json(&s1);
        let s2 = parse_structure_json(&json_out).unwrap();

        assert_eq!(s2.properties.len(), 3);
        assert_eq!(s2.properties["energy"], serde_json::json!(-3.5));
        assert_eq!(s2.properties["source"], serde_json::json!("dft"));
        assert_eq!(
            s2.properties["tags"],
            serde_json::json!(["test", "example"])
        );
    }

    #[test]
    fn test_parse_rocksalt() {
        // Full NaCl structure
        let json = r#"{
            "lattice": {"matrix": [[5.64,0,0],[0,5.64,0],[0,0,5.64]]},
            "sites": [
                {"species": [{"element": "Na"}], "abc": [0.0, 0.0, 0.0]},
                {"species": [{"element": "Na"}], "abc": [0.5, 0.5, 0.0]},
                {"species": [{"element": "Na"}], "abc": [0.5, 0.0, 0.5]},
                {"species": [{"element": "Na"}], "abc": [0.0, 0.5, 0.5]},
                {"species": [{"element": "Cl"}], "abc": [0.5, 0.0, 0.0]},
                {"species": [{"element": "Cl"}], "abc": [0.0, 0.5, 0.0]},
                {"species": [{"element": "Cl"}], "abc": [0.0, 0.0, 0.5]},
                {"species": [{"element": "Cl"}], "abc": [0.5, 0.5, 0.5]}
            ]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.num_sites(), 8);

        // Check composition
        let comp = s.composition();
        assert_eq!(comp.reduced_formula(), "NaCl");
    }

    #[test]
    fn test_parse_oxidation_state_overflow_i8() {
        // Oxidation states outside i8 range should error (after successful parsing)
        for oxi in [200, -200] {
            let json = format!(
                r#"{{"lattice": {{"matrix": [[4,0,0],[0,4,0],[0,0,4]]}},
                    "sites": [{{"species": [{{"element": "Fe", "oxidation_state": {oxi}}}], "abc": [0,0,0]}}]}}"#
            );
            let result = parse_structure_json(&json);
            assert!(result.is_err(), "oxi={oxi} should error");
            assert!(result.unwrap_err().to_string().contains("out of range"));
        }
    }

    #[test]
    fn test_parse_oxidation_state_overflow_i32() {
        // Float values that would overflow i32 should error during deserialization
        for oxi in ["3e10", "-3e10"] {
            let json = format!(
                r#"{{"lattice": {{"matrix": [[4,0,0],[0,4,0],[0,0,4]]}},
                    "sites": [{{"species": [{{"element": "Fe", "oxidation_state": {oxi}}}], "abc": [0,0,0]}}]}}"#
            );
            let result = parse_structure_json(&json);
            assert!(result.is_err(), "oxi={oxi} should error");
            assert!(
                result.unwrap_err().to_string().contains("overflow"),
                "Error for oxi={oxi} should mention overflow"
            );
        }
    }

    #[test]
    fn test_parse_disordered_site() {
        // Multiple species per site (disordered)
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [
                {"species": [
                    {"element": "Fe", "occu": 0.5},
                    {"element": "Co", "occu": 0.5}
                ], "abc": [0,0,0]}
            ]
        }"#;

        // Should parse successfully with all species preserved
        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.num_sites(), 1);
        assert!(!s.is_ordered());

        // Check all species are present
        let site_occ = &s.site_occupancies[0];
        assert_eq!(site_occ.species.len(), 2);
        assert!((site_occ.total_occupancy() - 1.0).abs() < 1e-10);

        // Verify both Fe and Co are present
        let elements: Vec<_> = site_occ.species.iter().map(|(sp, _)| sp.element).collect();
        assert!(elements.contains(&Element::Fe));
        assert!(elements.contains(&Element::Co));
    }

    #[test]
    fn test_parse_invalid_occupancy_rejected() {
        // Test various invalid occupancy values
        for (occu, desc) in [(-0.5, "negative"), (0.0, "zero"), (1.5, "> 1.0")] {
            let json = format!(
                r#"{{"lattice":{{"matrix":[[4,0,0],[0,4,0],[0,0,4]]}},"sites":[{{"species":[{{"element":"Fe","occu":{occu}}}],"abc":[0,0,0]}}]}}"#
            );
            let result = parse_structure_json(&json);
            assert!(result.is_err(), "{desc} occupancy should be rejected");
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("invalid occupancy"),
                "{desc} occupancy error should mention 'invalid occupancy': {err}"
            );
        }
    }

    #[test]
    fn test_parse_overflow_occupancy_rejected() {
        // 1e309 overflows f64 to infinity - JSON parser catches this as "out of range"
        let json = r#"{"lattice":{"matrix":[[4,0,0],[0,4,0],[0,0,4]]},"sites":[{"species":[{"element":"Fe","occu":1e309}],"abc":[0,0,0]}]}"#;
        let result = parse_structure_json(json);
        assert!(result.is_err(), "Overflow occupancy should be rejected");
    }

    #[test]
    fn test_parse_xyz_coords() {
        // Test parsing with xyz (Cartesian) coordinates
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [
                {"species": [{"element": "Fe"}], "xyz": [2, 2, 2], "abc": [0.5, 0.5, 0.5]}
            ]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.num_sites(), 1);
        // Check fractional coords are used
        assert!((s.frac_coords[0][0] - 0.5).abs() < 1e-10);
    }

    #[test]
    fn test_parse_minimal_lattice() {
        // Lattice with only matrix (no pbc field)
        let json = r#"{
            "lattice": {"matrix": [[3,0,0],[0,3,0],[0,0,3]]},
            "sites": [{"species": [{"element": "Cu"}], "abc": [0,0,0]}]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.num_sites(), 1);
        assert!((s.lattice.volume() - 27.0).abs() < 1e-10);
    }

    // === POSCAR Parser Tests ===

    #[test]
    fn test_parse_poscar_cubic_diamond() {
        let poscar = r#"cubic diamond
  3.7
    0.5 0.5 0.0
    0.0 0.5 0.5
    0.5 0.0 0.5
   C
   2
Direct
  0.0 0.0 0.0
  0.25 0.25 0.25
"#;
        let s = parse_poscar_str(poscar).unwrap();
        assert_eq!(s.num_sites(), 2);
        assert_eq!(s.species()[0].element, Element::C);
        assert_eq!(s.species()[1].element, Element::C);

        // Check fractional coordinates
        assert!((s.frac_coords[0].x - 0.0).abs() < 1e-10);
        assert!((s.frac_coords[1].x - 0.25).abs() < 1e-10);
    }

    #[test]
    fn test_parse_poscar_nacl() {
        let poscar = r#"NaCl
   5.64
     1.0  0.0  0.0
     0.0  1.0  0.0
     0.0  0.0  1.0
   Na Cl
   1 1
Direct
   0.0  0.0  0.0
   0.5  0.5  0.5
"#;
        let s = parse_poscar_str(poscar).unwrap();
        assert_eq!(s.num_sites(), 2);
        assert_eq!(s.species()[0].element, Element::Na);
        assert_eq!(s.species()[1].element, Element::Cl);

        // Check volume (5.64^3)
        assert!((s.lattice.volume() - 5.64f64.powi(3)).abs() < 1e-6);
    }

    #[test]
    fn test_parse_poscar_cartesian() {
        // POSCAR with Cartesian coordinates
        // Note: In POSCAR, Cartesian coords are already scaled by the lattice constant
        // So (1.435, 1.435, 1.435) with scale 2.87 gives actual coords (4.12, 4.12, 4.12)
        // which maps to fractional (0.5, 0.5, 0.5) with a=2.87*2=5.74
        let poscar = r#"Fe BCC
   2.87
     1.0  0.0  0.0
     0.0  1.0  0.0
     0.0  0.0  1.0
   Fe
   2
Cartesian
   0.0     0.0     0.0
   0.5     0.5     0.5
"#;
        let s = parse_poscar_str(poscar).unwrap();
        assert_eq!(s.num_sites(), 2);
        assert_eq!(s.species()[0].element, Element::Fe);

        // First atom at origin
        assert!((s.frac_coords[0].x - 0.0).abs() < 1e-10);

        // Second atom should be at (0.5, 0.5, 0.5) in fractional
        // Cartesian (0.5, 0.5, 0.5) * scale 2.87 = (1.435, 1.435, 1.435) in Å
        // Divide by lattice length 2.87 = (0.5, 0.5, 0.5) in fractional
        assert!((s.frac_coords[1].x - 0.5).abs() < 1e-6);
        assert!((s.frac_coords[1].y - 0.5).abs() < 1e-6);
        assert!((s.frac_coords[1].z - 0.5).abs() < 1e-6);
    }

    #[test]
    fn test_parse_poscar_vasp4_error() {
        // VASP 4 format without element symbols should error
        let poscar = r#"Si
   5.43
     0.5 0.5 0.0
     0.0 0.5 0.5
     0.5 0.0 0.5
   2
Direct
   0.0 0.0 0.0
   0.25 0.25 0.25
"#;
        let result = parse_poscar_str(poscar);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("VASP 4 format"));
    }

    #[test]
    fn test_parse_poscar_negative_scale_factor() {
        // Negative scale factor means volume = |scale|
        let poscar = r#"Test with volume scaling
  -27.0
    3.0 0.0 0.0
    0.0 3.0 0.0
    0.0 0.0 3.0
   H
   1
Direct
  0.0 0.0 0.0
"#;
        let s = parse_poscar_str(poscar).unwrap();
        assert_eq!(s.num_sites(), 1);
        // Volume should be 27.0 (scale factor applied)
        assert!((s.lattice.volume() - 27.0).abs() < 1e-3);
    }

    #[test]
    fn test_parse_poscar_multiple_elements() {
        // BaTiO3 tetragonal structure
        let poscar = r#"Ba1 Ti1 O3
1.0
4.001368 0.000000 0.000000
0.000000 4.001368 0.000000
0.000000 0.000000 4.215744
Ba Ti O
1 1 3
direct
0.000000 0.000000 0.020273
0.500000 0.500000 0.538852
0.000000 0.500000 0.492022
0.500000 0.000000 0.492022
0.500000 0.500000 0.970829
"#;
        let s = parse_poscar_str(poscar).unwrap();
        assert_eq!(s.num_sites(), 5);
        assert_eq!(s.species()[0].element, Element::Ba);
        assert_eq!(s.species()[1].element, Element::Ti);
        assert_eq!(s.species()[2].element, Element::O);
        assert_eq!(s.species()[3].element, Element::O);
        assert_eq!(s.species()[4].element, Element::O);

        // Check lattice parameters (a, b, c)
        let lengths = s.lattice.lengths();
        assert!((lengths.x - 4.001368).abs() < 1e-5);
        assert!((lengths.z - 4.215744).abs() < 1e-5);
    }

    #[test]
    fn test_parse_poscar_rocksalt_full() {
        // Full NaCl structure (8 atoms)
        let poscar = r#"Na Cl
   1.00000000000000
     5.6903014761756712    0.0000000000000000    0.0000000000000000
     0.0000000000000000    5.6903014761756712    0.0000000000000000
     0.0000000000000000    0.0000000000000000    5.6903014761756712
  Na  Cl
   4   4
Direct
  0.0000000000000000  0.0000000000000000  0.0000000000000000
  0.0000000000000000  0.5000000000000000  0.5000000000000000
  0.5000000000000000  0.0000000000000000  0.5000000000000000
  0.5000000000000000  0.5000000000000000  0.0000000000000000
  0.5000000000000000  0.5000000000000000  0.5000000000000000
  0.5000000000000000  0.0000000000000000  0.0000000000000000
  0.0000000000000000  0.5000000000000000  0.0000000000000000
  0.0000000000000000  0.0000000000000000  0.5000000000000000
"#;
        let s = parse_poscar_str(poscar).unwrap();
        assert_eq!(s.num_sites(), 8);

        // Count elements
        assert_eq!(count_element(&s, Element::Na), 4);
        assert_eq!(count_element(&s, Element::Cl), 4);

        // Check lattice constant (a = first length)
        let lengths = s.lattice.lengths();
        assert!((lengths.x - 5.6903014762).abs() < 1e-6);
    }

    #[test]
    fn test_parse_poscar_selective_dynamics() {
        // Selective dynamics (should be parsed but flags ignored)
        let poscar = r#"Silicon slab with selective dynamics
1.0
   5.4689999999999999    0.0000000000000000    0.0000000000000000
   0.0000000000000000    5.4689999999999999    0.0000000000000000
   0.0000000000000000    0.0000000000000000   20.0000000000000000
Si
8
Selective dynamics
Direct
0.000 0.000 0.100 F F F
0.500 0.000 0.100 F F F
0.000 0.500 0.100 F F F
0.500 0.500 0.100 F F F
0.250 0.250 0.150 T T T
0.750 0.250 0.150 T T T
0.250 0.750 0.150 T T T
0.750 0.750 0.150 T T T
"#;
        let s = parse_poscar_str(poscar).unwrap();
        assert_eq!(s.num_sites(), 8);
        assert_eq!(s.species()[0].element, Element::Si);

        // Check some coordinates
        assert!((s.frac_coords[0].x - 0.0).abs() < 1e-10);
        assert!((s.frac_coords[0].z - 0.1).abs() < 1e-10);
        assert!((s.frac_coords[4].x - 0.25).abs() < 1e-10);
    }

    // === extXYZ Parser Tests ===

    #[test]
    fn test_parse_extxyz_quartz() {
        // Quartz structure in extXYZ format
        let extxyz = r#"6
Lattice="4.916 0.0 0.0 -2.458 4.257 0.0 0.0 0.0 5.405" Properties=species:S:1:pos:R:3
Si 1.229 0.0 0.0
Si -1.229 2.128 2.703
O 2.679 0.0 1.624
O -2.679 2.128 4.327
O 0.0 1.578 3.781
O 0.0 -1.578 1.081
"#;
        // Write to temp file and parse
        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.join("test_quartz.xyz");
        std::fs::write(&temp_path, extxyz).unwrap();

        let s = parse_extxyz(&temp_path).unwrap();
        std::fs::remove_file(&temp_path).ok();

        assert_eq!(s.num_sites(), 6);

        // Count elements
        assert_eq!(count_element(&s, Element::Si), 2);
        assert_eq!(count_element(&s, Element::O), 4);

        // Check lattice (a, b, c)
        let lengths = s.lattice.lengths();
        assert!((lengths.x - 4.916).abs() < 0.01);
        assert!((lengths.z - 5.405).abs() < 0.01);

        // Verify fractional coordinates are sensible (within reasonable bounds)
        // First Si at Cartesian (1.229, 0, 0) should have fractional x ≈ 0.25
        assert!(
            s.frac_coords[0].x > 0.1 && s.frac_coords[0].x < 0.5,
            "First Si x-coord should be ~0.25, got {}",
            s.frac_coords[0].x
        );
        // All fractional coordinates should be finite
        for (idx, coord) in s.frac_coords.iter().enumerate() {
            assert!(coord.x.is_finite(), "Site {idx} x not finite");
            assert!(coord.y.is_finite(), "Site {idx} y not finite");
            assert!(coord.z.is_finite(), "Site {idx} z not finite");
        }
    }

    #[test]
    fn test_parse_extxyz_with_energy() {
        // extXYZ with energy property
        let extxyz = r#"2
Lattice="5.0 0.0 0.0 0.0 5.0 0.0 0.0 0.0 5.0" energy=-10.5
H 0.0 0.0 0.0
O 2.5 2.5 2.5
"#;
        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.join("test_with_energy.xyz");
        std::fs::write(&temp_path, extxyz).unwrap();

        let s = parse_extxyz(&temp_path).unwrap();
        std::fs::remove_file(&temp_path).ok();

        assert_eq!(s.num_sites(), 2);
        // Check energy is preserved in properties
        assert!(s.properties.contains_key("energy"));
        assert_eq!(s.properties["energy"], serde_json::json!(-10.5));
    }

    #[test]
    fn test_parse_extxyz_with_pbc() {
        // extXYZ with PBC specification
        let extxyz = r#"1
Lattice="4.0 0.0 0.0 0.0 4.0 0.0 0.0 0.0 4.0" pbc="T T F"
C 2.0 2.0 2.0
"#;
        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.join("test_with_pbc.xyz");
        std::fs::write(&temp_path, extxyz).unwrap();

        let s = parse_extxyz(&temp_path).unwrap();
        std::fs::remove_file(&temp_path).ok();

        assert_eq!(s.num_sites(), 1);
        assert_eq!(s.lattice.pbc, [true, true, false]);
    }

    #[test]
    fn test_parse_extxyz_missing_lattice_error() {
        // Plain XYZ without lattice should error for crystal structure
        let xyz = r#"2
Cyclohexane (no lattice)
C 0.0 0.0 0.0
H 1.0 0.0 0.0
"#;
        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.join("test_no_lattice.xyz");
        std::fs::write(&temp_path, xyz).unwrap();

        let result = parse_extxyz(&temp_path);
        std::fs::remove_file(&temp_path).ok();

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("lattice"));
    }

    #[test]
    fn test_parse_extxyz_trajectory() {
        // Multi-frame trajectory
        let extxyz = r#"2
Lattice="4.0 0.0 0.0 0.0 4.0 0.0 0.0 0.0 4.0" energy=-5.0
H 0.0 0.0 0.0
H 2.0 2.0 2.0
2
Lattice="4.0 0.0 0.0 0.0 4.0 0.0 0.0 0.0 4.0" energy=-5.5
H 0.1 0.1 0.1
H 2.1 2.1 2.1
"#;
        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.join("test_trajectory.xyz");
        std::fs::write(&temp_path, extxyz).unwrap();

        let frames = parse_extxyz_trajectory(&temp_path).unwrap();
        std::fs::remove_file(&temp_path).ok();

        assert_eq!(frames.len(), 2);

        // Check first frame
        let s1 = frames[0].as_ref().unwrap();
        assert_eq!(s1.num_sites(), 2);
        assert_eq!(s1.properties["energy"], serde_json::json!(-5.0));

        // Check second frame
        let s2 = frames[1].as_ref().unwrap();
        assert_eq!(s2.num_sites(), 2);
        assert_eq!(s2.properties["energy"], serde_json::json!(-5.5));
    }

    #[test]
    fn test_parse_extxyz_cubic_lattice() {
        // Simple cubic lattice with single atom
        let extxyz = r#"1
Lattice="3.0 0.0 0.0 0.0 3.0 0.0 0.0 0.0 3.0"
Fe 1.5 1.5 1.5
"#;
        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.join("test_cubic.xyz");
        std::fs::write(&temp_path, extxyz).unwrap();

        let s = parse_extxyz(&temp_path).unwrap();
        std::fs::remove_file(&temp_path).ok();

        assert_eq!(s.num_sites(), 1);
        assert_eq!(s.species()[0].element, Element::Fe);

        // Check fractional coords (1.5 / 3.0 = 0.5)
        assert!((s.frac_coords[0].x - 0.5).abs() < 1e-10);
        assert!((s.frac_coords[0].y - 0.5).abs() < 1e-10);
        assert!((s.frac_coords[0].z - 0.5).abs() < 1e-10);
    }

    #[test]
    fn test_parse_extxyz_hexagonal_lattice() {
        // Hexagonal lattice (non-orthogonal)
        let a = 3.0;
        let c = 5.0;
        let extxyz = format!(
            r#"1
Lattice="{a} 0.0 0.0 {} {} 0.0 0.0 0.0 {c}"
Mg 0.0 0.0 0.0
"#,
            -a / 2.0,
            a * (3.0_f64).sqrt() / 2.0
        );
        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.join("test_hex.xyz");
        std::fs::write(&temp_path, &extxyz).unwrap();

        let s = parse_extxyz(&temp_path).unwrap();
        std::fs::remove_file(&temp_path).ok();

        assert_eq!(s.num_sites(), 1);
        // Atom at origin should have fractional coords (0, 0, 0)
        assert!((s.frac_coords[0].x - 0.0).abs() < 1e-10);
        assert!((s.frac_coords[0].y - 0.0).abs() < 1e-10);
        assert!((s.frac_coords[0].z - 0.0).abs() < 1e-10);
    }

    // === Format Detection Tests ===

    #[test]
    fn test_format_detection() {
        // Consolidated format detection test covering all cases:
        // - basic extensions, case-insensitive, POSCAR variants, and unknown
        let cases: &[(&str, Option<StructureFormat>)] = &[
            // Basic extensions
            ("structure.json", Some(StructureFormat::PymatgenJson)),
            ("structure.cif", Some(StructureFormat::Cif)),
            ("trajectory.xyz", Some(StructureFormat::ExtXyz)),
            ("structure.extxyz", Some(StructureFormat::ExtXyz)),
            ("structure.vasp", Some(StructureFormat::Poscar)),
            // Case-insensitive
            ("structure.JSON", Some(StructureFormat::PymatgenJson)),
            ("structure.CIF", Some(StructureFormat::Cif)),
            ("structure.XYZ", Some(StructureFormat::ExtXyz)),
            // POSCAR variants
            ("POSCAR", Some(StructureFormat::Poscar)),
            ("POSCAR.vasp", Some(StructureFormat::Poscar)),
            ("CONTCAR", Some(StructureFormat::Poscar)),
            ("CONTCAR.relax", Some(StructureFormat::Poscar)),
            // Unknown
            ("unknown.txt", None),
        ];
        for (path, expected) in cases {
            assert_eq!(
                StructureFormat::from_path(Path::new(path)),
                *expected,
                "Format detection failed for '{path}'"
            );
        }
    }

    // === parse_structure() auto-detection tests ===

    #[test]
    fn test_parse_structure_detects_json() {
        let temp_dir = std::env::temp_dir();
        let path = temp_dir.join("test_struct_detect.json");
        std::fs::write(
            &path,
            r#"{"lattice":{"matrix":[[4,0,0],[0,4,0],[0,0,4]]},"sites":[{"species":[{"element":"Fe"}],"abc":[0,0,0]}]}"#,
        )
        .unwrap();

        let s = parse_structure(&path).unwrap();
        std::fs::remove_file(&path).ok();

        assert_eq!(s.num_sites(), 1);
        assert_eq!(s.species()[0].element, Element::Fe);
    }

    #[test]
    fn test_parse_structure_unknown_extension_error() {
        let path = Path::new("structure.unknown");
        let result = parse_structure(path);
        assert!(result.is_err(), "Unknown extension should return error");
        let err = result.unwrap_err();
        assert!(
            err.to_string().contains("Unknown"),
            "Error should mention unknown format: {err}"
        );
    }

    // === parse_structures_glob() tests ===

    #[test]
    fn test_parse_structures_glob_basic() {
        let temp_dir = TempDir::new().unwrap();

        // Create two JSON files
        let json = r#"{"lattice":{"matrix":[[4,0,0],[0,4,0],[0,0,4]]},"sites":[{"species":[{"element":"Cu"}],"abc":[0,0,0]}]}"#;
        std::fs::write(temp_dir.path().join("struct1.json"), json).unwrap();
        std::fs::write(temp_dir.path().join("struct2.json"), json).unwrap();

        let pattern = temp_dir.path().join("*.json").to_string_lossy().to_string();
        let results = parse_structures_glob(&pattern).unwrap();

        assert_eq!(results.len(), 2, "Should find 2 JSON files");
        // TempDir automatically cleans up on drop
    }

    #[test]
    fn test_parse_structures_glob_no_matches() {
        let pattern = "/nonexistent/path/*.json";
        let results = parse_structures_glob(pattern).unwrap();
        assert!(results.is_empty(), "No matches should return empty vec");
    }

    #[test]
    fn test_parse_structures_glob_invalid_pattern() {
        let pattern = "[invalid";
        let result = parse_structures_glob(pattern);
        assert!(result.is_err(), "Invalid glob pattern should return error");
    }

    // === Pymatgen Edge Case Tests (ported from pymatgen test suite) ===

    #[test]
    fn test_poscar_edge_cases() {
        // Fluorine element (not confused with False)
        let f_poscar = "F test\n1.0\n4.0 0.0 0.0\n0.0 4.0 0.0\n0.0 0.0 4.0\nF\n2\nDirect\n0.0 0.0 0.0\n0.5 0.5 0.5\n";
        let s = parse_poscar_str(f_poscar).unwrap();
        assert_eq!(s.num_sites(), 2);
        assert!(s.species().iter().all(|sp| sp.element == Element::F));

        // Selective dynamics with F element (T/F flags shouldn't affect element)
        let sd_poscar = "F slab\n1.0\n4.0 0.0 0.0\n0.0 4.0 0.0\n0.0 0.0 10.0\nF\n2\nSelective dynamics\nDirect\n0.0 0.0 0.1 F F F\n0.5 0.5 0.1 T T T\n";
        let s2 = parse_poscar_str(sd_poscar).unwrap();
        assert!(s2.species().iter().all(|sp| sp.element == Element::F));

        // Scale factor 1.1 scales lattice
        let scaled =
            "Scaled\n1.1\n4.0 0.0 0.0\n0.0 4.0 0.0\n0.0 0.0 4.0\nFe\n1\nCartesian\n2.0 2.0 2.0\n";
        assert!((parse_poscar_str(scaled).unwrap().lattice.lengths().x - 4.4).abs() < 1e-6);

        // Negative lattice vectors
        let neg = "Neg\n1.0\n-4.0 0.0 0.0\n0.0 4.0 0.0\n2.0 2.0 4.0\nFe\n1\nDirect\n0.0 0.0 0.0\n";
        assert!(parse_poscar_str(neg).unwrap().lattice.volume().abs() > 0.0);

        // Large structure (27 atoms)
        let mut large =
            String::from("Large\n1.0\n10.0 0.0 0.0\n0.0 10.0 0.0\n0.0 0.0 10.0\nFe\n27\nDirect\n");
        for i in 0..27 {
            large.push_str(&format!("{:.1} 0.0 0.0\n", i as f64 / 27.0));
        }
        assert_eq!(parse_poscar_str(&large).unwrap().num_sites(), 27);
    }

    #[test]
    fn test_extxyz_edge_cases() {
        use std::io::Write;

        // With forces column - verify parsing succeeds with extra per-atom columns
        // Note: per-atom properties (forces) are parsed by extxyz crate but not
        // currently extracted to site_properties; only structure is verified
        let forces = "2\nLattice=\"4.0 0.0 0.0 0.0 4.0 0.0 0.0 0.0 4.0\" Properties=species:S:1:pos:R:3:forces:R:3\nFe 0.0 0.0 0.0 0.1 0.2 0.3\nFe 2.0 2.0 2.0 -0.1 -0.2 -0.3\n";
        let mut p1 = NamedTempFile::with_suffix(".xyz").unwrap();
        p1.write_all(forces.as_bytes()).unwrap();
        let s_forces = parse_extxyz(p1.path()).unwrap();
        assert_eq!(s_forces.num_sites(), 2);
        assert_eq!(s_forces.species()[0].element, Element::Fe);

        // With energy property - verify global property is extracted
        let energy = "2\nLattice=\"4.0 0.0 0.0 0.0 4.0 0.0 0.0 0.0 4.0\" energy=-5.5\nH 0.0 0.0 0.0\nH 2.0 2.0 2.0\n";
        let mut p2 = NamedTempFile::with_suffix(".xyz").unwrap();
        p2.write_all(energy.as_bytes()).unwrap();
        let s_energy = parse_extxyz(p2.path()).unwrap();
        assert!(s_energy.properties.contains_key("energy"));
        assert_eq!(
            s_energy.properties.get("energy").unwrap().as_f64(),
            Some(-5.5)
        );
        // NamedTempFile automatically cleans up on drop
    }

    #[test]
    fn test_json_edge_cases() {
        // Oxidation states - verify the oxidation state is parsed
        let oxi = r#"{"lattice":{"matrix":[[4,0,0],[0,4,0],[0,0,4]]},"sites":[{"species":[{"element":"Fe","oxidation_state":2,"occu":1.0}],"abc":[0,0,0]}]}"#;
        let s_oxi = parse_structure_json(oxi).unwrap();
        assert_eq!(s_oxi.num_sites(), 1);
        assert_eq!(s_oxi.species()[0].oxidation_state, Some(2));

        // Disordered site - verify it's recognized as disordered
        let dis = r#"{"lattice":{"matrix":[[4,0,0],[0,4,0],[0,0,4]]},"sites":[{"species":[{"element":"Fe","occu":0.5},{"element":"Mn","occu":0.5}],"abc":[0,0,0]}]}"#;
        let s_dis = parse_structure_json(dis).unwrap();
        assert_eq!(s_dis.num_sites(), 1);
        assert!(!s_dis.is_ordered());
    }

    // === Structure Writer Tests ===

    #[test]
    fn test_structure_to_poscar_roundtrip() {
        // NaCl structure - tests format and coordinate roundtrip
        let lattice = Lattice::cubic(5.64);
        let species = vec![
            Species::neutral(Element::Na),
            Species::neutral(Element::Na),
            Species::neutral(Element::Cl),
            Species::neutral(Element::Cl),
        ];
        let coords = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.5, 0.5, 0.0),
            Vector3::new(0.5, 0.0, 0.5),
            Vector3::new(0.0, 0.5, 0.5),
        ];
        let s1 = Structure::new(lattice, species, coords);

        let poscar = structure_to_poscar(&s1, Some("NaCl test"));

        // Verify format
        assert!(poscar.starts_with("NaCl test\n"));
        assert!(poscar.contains("Direct\n"));

        // Roundtrip and compare
        let s2 = parse_poscar_str(&poscar).unwrap();
        assert_eq!(s1.num_sites(), s2.num_sites());
        assert!((s1.lattice.volume() - s2.lattice.volume()).abs() < 1e-6);
        assert_eq!(
            count_element(&s1, Element::Na),
            count_element(&s2, Element::Na)
        );

        // Verify coordinates (POSCAR groups by element, so match by position)
        let (cart1, cart2) = (s1.cart_coords(), s2.cart_coords());
        for c1 in &cart1 {
            assert!(
                cart2.iter().any(|c2| (c1 - c2).norm() < 1e-6),
                "Coordinate {:?} not found",
                c1
            );
        }
    }

    #[test]
    fn test_structure_to_poscar_multi_element() {
        // BaTiO3 - tests element grouping with 3 species
        let s = Structure::new(
            Lattice::cubic(5.0),
            vec![
                Species::neutral(Element::Ba),
                Species::neutral(Element::Ti),
                Species::neutral(Element::O),
                Species::neutral(Element::O),
                Species::neutral(Element::O),
            ],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.5, 0.5, 0.5),
                Vector3::new(0.5, 0.5, 0.0),
                Vector3::new(0.5, 0.0, 0.5),
                Vector3::new(0.0, 0.5, 0.5),
            ],
        );

        let poscar = structure_to_poscar(&s, None);
        let s2 = parse_poscar_str(&poscar).unwrap();

        assert_eq!(s2.num_sites(), 5);
        assert_eq!(count_element(&s2, Element::Ba), 1);
        assert_eq!(count_element(&s2, Element::Ti), 1);
        assert_eq!(count_element(&s2, Element::O), 3);
    }

    #[test]
    fn test_structure_to_extxyz_roundtrip() {
        use std::io::Write;
        // Non-cubic lattice catches vector ordering bugs
        let s1 = Structure::new(
            Lattice::from_parameters(3.0, 4.0, 5.0, 90.0, 90.0, 90.0),
            vec![Species::neutral(Element::H), Species::neutral(Element::O)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        let xyz = structure_to_extxyz(&s1, None);

        // Verify format
        let lines: Vec<&str> = xyz.lines().collect();
        assert_eq!(lines[0], "2");
        assert!(lines[1].contains("Lattice="));
        assert!(lines[1].contains("pbc="));

        // Roundtrip via temp file
        let mut temp_file = NamedTempFile::with_suffix(".xyz").unwrap();
        temp_file.write_all(xyz.as_bytes()).unwrap();
        let s2 = parse_extxyz(temp_file.path()).unwrap();

        // Compare lattice (catches ordering bugs)
        let (len1, len2) = (s1.lattice.lengths(), s2.lattice.lengths());
        assert!((len1.x - len2.x).abs() < 1e-6, "a mismatch");
        assert!((len1.y - len2.y).abs() < 1e-6, "b mismatch");
        assert!((len1.z - len2.z).abs() < 1e-6, "c mismatch");

        // Compare species and coords
        assert_eq!(s1.species()[0].element, s2.species()[0].element);
        assert_eq!(s1.species()[1].element, s2.species()[1].element);
        let (cart1, cart2) = (s1.cart_coords(), s2.cart_coords());
        for idx in 0..2 {
            assert!((cart1[idx] - cart2[idx]).norm() < 1e-6);
        }
    }

    #[test]
    fn test_write_structure_auto_format() {
        let temp_dir = TempDir::new().unwrap();
        let s = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Cu)],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        );

        // Test that each format writes non-empty content and can be read back
        for filename in ["test.json", "POSCAR", "test.xyz", "test.cif"] {
            let path = temp_dir.path().join(filename);
            write_structure(&s, &path).unwrap();
            let content = std::fs::read_to_string(&path).unwrap();
            assert!(
                !content.is_empty(),
                "{} should produce non-empty output",
                filename
            );
            // Verify roundtrip: read back and check structure properties
            let read_back = parse_structure(&path).unwrap();
            assert_eq!(
                read_back.num_sites(),
                s.num_sites(),
                "{} roundtrip should preserve atom count",
                filename
            );
        }
    }

    #[test]
    fn test_structure_to_extxyz_escapes_strings() {
        let s = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Fe)],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        );

        // Test with problematic string values
        let mut props = HashMap::new();
        props.insert("with_quote".to_string(), serde_json::json!("foo\"bar"));
        props.insert(
            "with_newline".to_string(),
            serde_json::json!("line1\nline2"),
        );
        props.insert(
            "with_backslash".to_string(),
            serde_json::json!("path\\to\\file"),
        );

        let xyz = structure_to_extxyz(&s, Some(&props));
        let lines: Vec<&str> = xyz.lines().collect();

        // Output should be exactly 3 lines (count, comment, atom)
        assert_eq!(lines.len(), 3, "Newlines in properties should be escaped");

        // Check escaped values are in comment line
        assert!(
            lines[1].contains(r#"with_quote="foo\"bar""#),
            "Quotes should be escaped"
        );
        assert!(
            lines[1].contains(r#"with_newline="line1\nline2""#),
            "Newlines should be escaped"
        );
        assert!(
            lines[1].contains(r#"with_backslash="path\\to\\file""#),
            "Backslashes should be escaped"
        );
    }

    // === Fixture-based Roundtrip Tests (matches TypeScript coverage) ===

    #[test]
    fn test_roundtrip_poscar_batio3_fixture() {
        // Parse BaTiO3 fixture, export, reparse - verifies real-world POSCAR handling
        let fixture = include_str!("../../../src/site/structures/BaTiO3-tetragonal.poscar");
        let s1 = parse_poscar_str(fixture).unwrap();
        let exported = structure_to_poscar(&s1, None);
        let s2 = parse_poscar_str(&exported).unwrap();

        assert_eq!(s1.num_sites(), s2.num_sites());
        assert!((s1.lattice.volume() - s2.lattice.volume()).abs() < 1e-3);
        // Verify all coordinates roundtrip
        let (cart1, cart2) = (s1.cart_coords(), s2.cart_coords());
        for c1 in &cart1 {
            assert!(cart2.iter().any(|c2| (c1 - c2).norm() < 1e-4));
        }
    }

    #[test]
    fn test_roundtrip_cif_tio2_fixture() {
        // Parse TiO2 CIF fixture, export, reparse
        let fixture = include_str!("../../../src/site/structures/TiO2.cif");
        let s1 = crate::cif::parse_cif_str(fixture, std::path::Path::new("TiO2.cif")).unwrap();
        let exported = crate::cif::structure_to_cif(&s1, None);
        let s2 =
            crate::cif::parse_cif_str(&exported, std::path::Path::new("exported.cif")).unwrap();

        assert_eq!(s1.num_sites(), s2.num_sites());
        let (len1, len2) = (s1.lattice.lengths(), s2.lattice.lengths());
        assert!((len1.x - len2.x).abs() < 1e-4);
        assert!((len1.y - len2.y).abs() < 1e-4);
        assert!((len1.z - len2.z).abs() < 1e-4);
    }

    #[test]
    fn test_parse_cif_li10gep2s12_symmetry_expansion() {
        // Li10GeP2S12: P42/nmc (space group 137) with 16 symmetry ops, 9 unique sites
        let fixture = include_str!("../../../src/site/structures/Li10GeP2S12.cif");
        let structure =
            crate::cif::parse_cif_str(fixture, std::path::Path::new("Li10GeP2S12.cif")).unwrap();

        // After symmetry expansion: 62 sites (Ge1 and P1 share a position but are separate entries)
        // Element counts match pymatgen: Ge=4, Li=28, P=6, S=24
        assert_eq!(structure.num_sites(), 62);
        assert_eq!(count_element(&structure, Element::Li), 28);
        assert_eq!(count_element(&structure, Element::Ge), 4);
        assert_eq!(count_element(&structure, Element::P), 6);
        assert_eq!(count_element(&structure, Element::S), 24);
    }

    #[test]
    fn test_parse_cif_mof_irmof1_symmetry_expansion() {
        // IRMOF-1: Fm-3m (space group 225) with 192 symmetry ops, 7 unique sites
        let fixture = include_str!("../../../src/site/structures/mof-issue-127.cif");
        let structure =
            crate::cif::parse_cif_str(fixture, std::path::Path::new("mof-issue-127.cif")).unwrap();

        // Same as pymatgen: 424 sites (C=192, H=96, O=104, Zn=32)
        assert_eq!(structure.num_sites(), 424);
        assert_eq!(count_element(&structure, Element::Zn), 32);
        assert_eq!(count_element(&structure, Element::O), 104);
        assert_eq!(count_element(&structure, Element::C), 192);
        assert_eq!(count_element(&structure, Element::H), 96);
    }

    #[test]
    fn test_parse_cif_p24ru4_aniso_loop_skipping() {
        // P24Ru4H252C296S24N16: C 1 2/c 1 (space group 15) with 8 symmetry ops, 63 unique sites
        // Also has _atom_site_aniso_* loop that must be skipped to find real coordinates
        let fixture = include_str!("../../../src/site/structures/P24Ru4H252C296S24N16.cif");
        let structure =
            crate::cif::parse_cif_str(fixture, std::path::Path::new("P24Ru4H252C296S24N16.cif"))
                .unwrap();

        // Same as pymatgen: 616 sites (C=296, H=252, N=16, P=24, Ru=4, S=24)
        assert_eq!(structure.num_sites(), 616);
        assert_eq!(count_element(&structure, Element::C), 296);
        assert_eq!(count_element(&structure, Element::H), 252);
        assert_eq!(count_element(&structure, Element::Ru), 4);
    }

    #[test]
    fn test_parse_cif_pf_sd_multi_data_blocks() {
        // PF-sd-1601634: CIF with multiple data_ blocks where later blocks have '?' placeholders
        let fixture = include_str!("../../../src/site/structures/PF-sd-1601634.cif");
        let structure =
            crate::cif::parse_cif_str(fixture, std::path::Path::new("PF-sd-1601634.cif")).unwrap();

        // First data block has 10 sites with mixed _atom_site and _sm_ headers
        assert_eq!(structure.num_sites(), 10);
        assert_eq!(count_element(&structure, Element::As), 1);
        assert_eq!(count_element(&structure, Element::Pb), 2);
    }

    #[test]
    fn test_roundtrip_extxyz_quartz_fixture() {
        use std::io::Write;
        // Parse quartz extXYZ fixture, export, reparse
        let fixture = include_str!("../../../src/site/structures/quartz.extxyz");
        let mut temp = NamedTempFile::with_suffix(".xyz").unwrap();
        temp.write_all(fixture.as_bytes()).unwrap();
        let s1 = parse_extxyz(temp.path()).unwrap();

        let exported = structure_to_extxyz(&s1, None);
        let mut temp2 = NamedTempFile::with_suffix(".xyz").unwrap();
        temp2.write_all(exported.as_bytes()).unwrap();
        let s2 = parse_extxyz(temp2.path()).unwrap();

        assert_eq!(s1.num_sites(), s2.num_sites());
        let (len1, len2) = (s1.lattice.lengths(), s2.lattice.lengths());
        assert!((len1.x - len2.x).abs() < 1e-4);
        assert!((len1.y - len2.y).abs() < 1e-4);
        assert!((len1.z - len2.z).abs() < 1e-4);
    }

    #[test]
    fn test_roundtrip_json_mp1_fixture() {
        // Parse mp-1 JSON fixture, export, reparse
        let fixture = include_str!("../../../src/site/structures/mp-1.json");
        let s1 = parse_structure_json(fixture).unwrap();
        let exported = structure_to_pymatgen_json(&s1);
        let s2 = parse_structure_json(&exported).unwrap();

        assert_eq!(s1.num_sites(), s2.num_sites());
        assert!((s1.lattice.volume() - s2.lattice.volume()).abs() < 1e-6);
    }

    // === Triclinic/Non-orthogonal Lattice Tests ===

    #[test]
    fn test_poscar_triclinic_lattice() {
        // Triclinic lattice with all angles non-90
        let s1 = Structure::new(
            Lattice::from_parameters(3.0, 4.0, 5.0, 80.0, 85.0, 95.0),
            vec![Species::neutral(Element::C)],
            vec![Vector3::new(0.25, 0.5, 0.75)],
        );
        let poscar = structure_to_poscar(&s1, None);
        let s2 = parse_poscar_str(&poscar).unwrap();

        // Verify angles preserved
        let (a1, a2) = (s1.lattice.angles(), s2.lattice.angles());
        assert!((a1.x - a2.x).abs() < 1e-4, "alpha mismatch");
        assert!((a1.y - a2.y).abs() < 1e-4, "beta mismatch");
        assert!((a1.z - a2.z).abs() < 1e-4, "gamma mismatch");
    }

    #[test]
    fn test_cif_triclinic_lattice() {
        let s1 = Structure::try_new(
            Lattice::from_parameters(3.0, 4.0, 5.0, 70.0, 80.0, 100.0),
            vec![Species::neutral(Element::Si)],
            vec![Vector3::new(0.1, 0.2, 0.3)],
        )
        .unwrap();
        let cif = crate::cif::structure_to_cif(&s1, None);
        let s2 = crate::cif::parse_cif_str(&cif, std::path::Path::new("tri.cif")).unwrap();

        let (a1, a2) = (s1.lattice.angles(), s2.lattice.angles());
        assert!((a1.x - a2.x).abs() < 1e-4);
        assert!((a1.y - a2.y).abs() < 1e-4);
        assert!((a1.z - a2.z).abs() < 1e-4);
    }

    // === High Precision Tests ===

    #[test]
    fn test_poscar_high_precision_coords() {
        let s1 = Structure::new(
            Lattice::cubic(10.0),
            vec![Species::neutral(Element::H)],
            vec![Vector3::new(0.123456789, 0.987654321, 0.555555555)],
        );
        let poscar = structure_to_poscar(&s1, None);

        // Verify high precision is preserved in roundtrip (16 decimal format)
        let s2 = parse_poscar_str(&poscar).unwrap();
        let (f1, f2) = (&s1.frac_coords[0], &s2.frac_coords[0]);
        assert!((f1.x - f2.x).abs() < 1e-10, "x precision loss");
        assert!((f1.y - f2.y).abs() < 1e-10, "y precision loss");
        assert!((f1.z - f2.z).abs() < 1e-10, "z precision loss");
    }

    // === Disordered Site Handling (CIF preserves occupancy) ===

    #[test]
    fn test_cif_disordered_site_roundtrip() {
        use crate::species::SiteOccupancy;
        // Create structure with disordered site
        let lattice = Lattice::cubic(4.0);
        let disordered = SiteOccupancy::new(vec![
            (Species::neutral(Element::Fe), 0.6),
            (Species::neutral(Element::Co), 0.4),
        ]);
        let s1 = Structure::try_new_from_occupancies(
            lattice,
            vec![disordered],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        )
        .unwrap();

        let cif = crate::cif::structure_to_cif(&s1, None);

        // Verify both species and occupancies appear
        assert!(cif.contains("Fe"));
        assert!(cif.contains("Co"));
        assert!(cif.contains("0.600000") || cif.contains("0.6"));
        assert!(cif.contains("0.400000") || cif.contains("0.4"));
    }

    // === CIF Data Block Name Sanitization ===

    #[test]
    fn test_cif_data_name_sanitization() {
        let s = Structure::try_new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::H)],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        )
        .unwrap();

        // Spaces and hyphens should be replaced with underscores
        let cif = crate::cif::structure_to_cif(&s, Some("test-structure name"));
        assert!(cif.starts_with("data_test_structure_name\n"));

        // Formula used when no name provided
        let cif2 = crate::cif::structure_to_cif(&s, None);
        assert!(cif2.starts_with("data_H\n"));
    }

    // === Large Structure Handling ===

    #[test]
    fn test_large_structure_export() {
        // Create 500-site structure (TypeScript tests 1000, but smaller for speed)
        let lattice = Lattice::cubic(20.0);
        let species: Vec<Species> = (0..500).map(|_| Species::neutral(Element::H)).collect();
        let coords: Vec<Vector3<f64>> = (0..500)
            .map(|idx| {
                Vector3::new(
                    (idx % 10) as f64 / 10.0,
                    ((idx / 10) % 10) as f64 / 10.0,
                    (idx / 100) as f64 / 5.0,
                )
            })
            .collect();
        let s = Structure::new(lattice, species, coords);

        // All formats should handle large structures without panicking
        let poscar = structure_to_poscar(&s, None);
        let xyz = structure_to_extxyz(&s, None);
        let cif = crate::cif::structure_to_cif(&s, None);
        let json = structure_to_pymatgen_json(&s);

        // Verify all 500 sites are exported
        let s2 = parse_poscar_str(&poscar).unwrap();
        assert_eq!(s2.num_sites(), 500);

        let xyz_lines: Vec<&str> = xyz.lines().collect();
        assert_eq!(xyz_lines[0], "500"); // First line is atom count

        assert!(cif.matches("H").count() >= 500);
        assert!(json.contains("\"sites\""));
    }

    // === POSCAR Default Comment (formula) ===

    #[test]
    fn test_poscar_default_comment_uses_formula() {
        let s = Structure::new(
            Lattice::cubic(5.0),
            vec![
                Species::neutral(Element::Li),
                Species::neutral(Element::Fe),
                Species::neutral(Element::P),
                Species::neutral(Element::O),
            ],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.25, 0.25, 0.25),
                Vector3::new(0.5, 0.5, 0.5),
                Vector3::new(0.75, 0.75, 0.75),
            ],
        );
        let poscar = structure_to_poscar(&s, None);

        // First line should be the reduced formula
        let first_line = poscar.lines().next().unwrap();
        assert!(
            first_line.contains("Li") && first_line.contains("Fe"),
            "Default comment should contain formula elements"
        );
    }

    // === extXYZ Properties Preservation ===

    #[test]
    fn test_extxyz_preserves_properties() {
        use std::io::Write;
        let mut s = Structure::new(
            Lattice::cubic(5.0),
            vec![Species::neutral(Element::Fe)],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        );
        s.properties
            .insert("energy".to_string(), serde_json::json!(-5.5));
        s.properties
            .insert("config_type".to_string(), serde_json::json!("relaxed"));

        let xyz = structure_to_extxyz(&s, None);

        // Properties should appear in comment line
        assert!(xyz.contains("energy=-5.5") || xyz.contains("energy="));
        assert!(xyz.contains("config_type=\"relaxed\""));

        // Roundtrip preserves properties
        let mut temp = NamedTempFile::with_suffix(".xyz").unwrap();
        temp.write_all(xyz.as_bytes()).unwrap();
        let s2 = parse_extxyz(temp.path()).unwrap();
        assert_eq!(s2.properties.get("energy"), Some(&serde_json::json!(-5.5)));
    }

    #[test]
    fn test_extxyz_preserves_charge() {
        use std::io::Write;
        // Create extXYZ with charge in info
        let xyz = r#"1
Lattice="5.0 0.0 0.0 0.0 5.0 0.0 0.0 0.0 5.0" charge=1.0 Properties=species:S:1:pos:R:3
Li 0.0 0.0 0.0
"#;
        let mut temp = NamedTempFile::with_suffix(".xyz").unwrap();
        temp.write_all(xyz.as_bytes()).unwrap();
        let s = parse_extxyz(temp.path()).unwrap();

        // Charge should be extracted from info, not stored in properties
        assert!((s.charge - 1.0).abs() < 1e-10, "charge should be 1.0");
        assert!(
            !s.properties.contains_key("charge"),
            "charge should not be in properties"
        );
    }

    // === Molecule IO Tests ===

    fn water_molecule() -> Structure {
        let species = vec![
            Species::neutral(Element::O),
            Species::neutral(Element::H),
            Species::neutral(Element::H),
        ];
        let coords = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.96, 0.0, 0.0),
            Vector3::new(-0.24, 0.93, 0.0),
        ];
        Structure::try_new_molecule(species, coords, 0.0, std::collections::HashMap::new()).unwrap()
    }

    #[test]
    fn test_parse_molecule_json() {
        // Water molecule
        let json = r#"{
            "sites": [
                {"species": [{"element": "O"}], "xyz": [0, 0, 0]},
                {"species": [{"element": "H"}], "xyz": [0.96, 0, 0]},
                {"species": [{"element": "H"}], "xyz": [-0.24, 0.93, 0]}
            ],
            "charge": 0
        }"#;
        let mol = parse_molecule_json(json).unwrap();
        assert_eq!(mol.num_sites(), 3);
        assert_eq!(mol.composition().reduced_formula(), "H2O");
        let cart = mol.cart_coords();
        assert!((cart[1].x - 0.96).abs() < 1e-10);
        // Charged ion
        let ion_json =
            r#"{"sites": [{"species": [{"element": "Na"}], "xyz": [0, 0, 0]}], "charge": 1.0}"#;
        let ion = parse_molecule_json(ion_json).unwrap();
        assert!((ion.charge - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_parse_molecule_json_with_oxidation_states() {
        let json = r#"{
            "sites": [
                {"species": [{"element": "Na", "oxidation_state": 1}], "xyz": [0, 0, 0]},
                {"species": [{"element": "Cl", "oxidation_state": -1}], "xyz": [2.0, 0, 0]}
            ],
            "charge": 0
        }"#;

        let mol = parse_molecule_json(json).unwrap();
        assert_eq!(mol.species()[0].oxidation_state, Some(1));
        assert_eq!(mol.species()[1].oxidation_state, Some(-1));
    }

    #[test]
    fn test_molecule_to_pymatgen_json_roundtrip() {
        let mol1 = water_molecule();
        let json = molecule_to_pymatgen_json(&mol1);
        let mol2 = parse_molecule_json(&json).unwrap();

        assert_eq!(mol1.num_sites(), mol2.num_sites());
        assert_eq!(
            mol1.composition().reduced_formula(),
            mol2.composition().reduced_formula()
        );

        // Check coordinates roundtrip
        let cart1 = mol1.cart_coords();
        let cart2 = mol2.cart_coords();
        for idx in 0..mol1.num_sites() {
            assert!((cart1[idx] - cart2[idx]).norm() < 1e-6);
        }
    }

    #[test]
    fn test_molecule_to_xyz() {
        let mol = water_molecule();
        // Default comment (formula)
        let xyz = molecule_to_xyz(&mol, None);
        let lines: Vec<&str> = xyz.lines().collect();
        assert_eq!(lines[0], "3");
        assert_eq!(lines[1], "H2O");
        // Custom comment
        let xyz2 = molecule_to_xyz(&mol, Some("Water"));
        assert!(xyz2.lines().nth(1).unwrap() == "Water");
        // Round-trip preserves coordinates
        let reparsed = parse_xyz_str(&xyz).unwrap();
        let cart_orig = mol.cart_coords();
        let cart_reparsed = reparsed.cart_coords();
        for idx in 0..mol.num_sites() {
            assert!((cart_orig[idx] - cart_reparsed[idx]).norm() < 1e-10);
        }
    }

    #[test]
    fn test_parse_xyz_str() {
        let xyz = "3\nWater\nO 0.0 0.0 0.0\nH 0.96 0.0 0.0\nH -0.24 0.93 0.0\n";
        let mol = parse_xyz_str(xyz).unwrap();

        assert_eq!(mol.num_sites(), 3);
        assert_eq!(mol.species()[0].element, Element::O);
        assert_eq!(mol.composition().reduced_formula(), "H2O");
    }

    #[test]
    fn test_xyz_roundtrip() {
        use std::io::Write;

        let mol1 = water_molecule();
        let xyz = molecule_to_xyz(&mol1, None);

        // Write to temp file and parse back
        let mut temp = NamedTempFile::with_suffix(".xyz").unwrap();
        temp.write_all(xyz.as_bytes()).unwrap();
        let mol2 = parse_xyz(temp.path()).unwrap();

        assert_eq!(mol1.num_sites(), mol2.num_sites());
        let cart1 = mol1.cart_coords();
        let cart2 = mol2.cart_coords();
        for idx in 0..mol1.num_sites() {
            assert!((cart1[idx] - cart2[idx]).norm() < 1e-6);
        }
    }

    #[test]
    fn test_molecule_to_extxyz() {
        let mut mol = water_molecule();
        mol.properties
            .insert("energy".to_string(), serde_json::json!(-10.5));
        mol.charge = -1.0;

        let xyz = molecule_to_extxyz(&mol, None);

        let lines: Vec<&str> = xyz.lines().collect();
        assert_eq!(lines[0], "3");
        assert!(lines[1].contains("pbc=\"F F F\""));
        assert!(lines[1].contains("charge=-1"));
        assert!(lines[1].contains("energy=-10.5"));
    }

    #[test]
    #[allow(deprecated)]
    fn test_parse_xyz_flexible_with_lattice() {
        use std::io::Write;

        // extXYZ with lattice should return Structure
        let extxyz = r#"1
Lattice="4.0 0.0 0.0 0.0 4.0 0.0 0.0 0.0 4.0"
Fe 2.0 2.0 2.0
"#;
        let mut temp = NamedTempFile::with_suffix(".xyz").unwrap();
        temp.write_all(extxyz.as_bytes()).unwrap();

        match parse_xyz_flexible(temp.path()).unwrap() {
            StructureOrMolecule::Structure(s) => {
                assert_eq!(s.num_sites(), 1);
                assert_eq!(s.species()[0].element, Element::Fe);
            }
            StructureOrMolecule::Molecule(_) => {
                panic!("Expected Structure, got Molecule");
            }
        }
    }

    #[test]
    #[allow(deprecated)]
    fn test_parse_xyz_flexible_without_lattice() {
        use std::io::Write;

        // XYZ without lattice should return Molecule
        let xyz = "3\nWater\nO 0.0 0.0 0.0\nH 0.96 0.0 0.0\nH -0.24 0.93 0.0\n";
        let mut temp = NamedTempFile::with_suffix(".xyz").unwrap();
        temp.write_all(xyz.as_bytes()).unwrap();

        match parse_xyz_flexible(temp.path()).unwrap() {
            StructureOrMolecule::Molecule(m) => {
                assert_eq!(m.num_sites(), 3);
                assert_eq!(m.composition().reduced_formula(), "H2O");
            }
            StructureOrMolecule::Structure(_) => {
                panic!("Expected Molecule, got Structure");
            }
        }
    }

    #[test]
    fn test_write_xyz() {
        let mol = water_molecule();
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("water.xyz");

        write_xyz(&mol, &path, Some("Test water")).unwrap();

        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.starts_with("3\n"));
        assert!(content.contains("Test water"));
    }

    #[test]
    fn test_parse_molecule_json_empty_species_error() {
        let json = r#"{
            "sites": [{"species": [], "xyz": [0, 0, 0]}],
            "charge": 0
        }"#;

        let result = parse_molecule_json(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_molecule_json_abc_only_error() {
        // Molecules require xyz (Cartesian) coords - abc (fractional) coords are invalid
        let json = r#"{
            "sites": [{"species": [{"element": "H"}], "abc": [0.5, 0.5, 0.5]}],
            "charge": 0
        }"#;
        let result = parse_molecule_json(json);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("xyz"));
    }

    #[test]
    fn test_parse_molecule_json_with_properties() {
        let json = r#"{
            "sites": [{"species": [{"element": "C"}], "xyz": [0, 0, 0]}],
            "charge": 0,
            "properties": {"source": "test", "computed": true}
        }"#;

        let mol = parse_molecule_json(json).unwrap();
        assert_eq!(
            mol.properties.get("source"),
            Some(&serde_json::json!("test"))
        );
        assert_eq!(
            mol.properties.get("computed"),
            Some(&serde_json::json!(true))
        );
    }

    #[test]
    fn test_molecule_json_with_labels() {
        let json = r#"{
            "sites": [
                {"species": [{"element": "C"}], "xyz": [0, 0, 0], "label": "C1"},
                {"species": [{"element": "H"}], "xyz": [1, 0, 0], "label": "H1"}
            ],
            "charge": 0
        }"#;

        let mol = parse_molecule_json(json).unwrap();

        // Check labels are preserved in site properties
        assert_eq!(
            mol.site_occupancies[0]
                .properties
                .get("label")
                .and_then(|v| v.as_str()),
            Some("C1")
        );
        assert_eq!(
            mol.site_occupancies[1]
                .properties
                .get("label")
                .and_then(|v| v.as_str()),
            Some("H1")
        );

        // Roundtrip should preserve labels
        let json_out = molecule_to_pymatgen_json(&mol);
        assert!(json_out.contains("C1"));
        assert!(json_out.contains("H1"));
    }

    // === ASE Atoms Dict Conversion Tests ===

    #[test]
    #[allow(deprecated)]
    fn test_parse_ase_atoms_structure() {
        let json = r#"{
            "symbols": ["Fe", "Fe"],
            "positions": [[0, 0, 0], [1.435, 1.435, 1.435]],
            "cell": [[2.87, 0, 0], [0, 2.87, 0], [0, 0, 2.87]],
            "pbc": [true, true, true]
        }"#;

        match parse_ase_atoms_json(json).unwrap() {
            StructureOrMolecule::Structure(s) => {
                assert_eq!(s.num_sites(), 2);
                assert_eq!(s.species()[0].element, Element::Fe);
                assert!((s.lattice.volume() - 2.87_f64.powi(3)).abs() < 1e-6);
                // Verify pbc is correctly set on Structure
                assert_eq!(s.pbc, [true, true, true]);
                assert!(s.is_periodic());
                assert!(!s.is_molecule());
            }
            StructureOrMolecule::Molecule(_) => {
                panic!("Expected Structure, got Molecule");
            }
        }
    }

    #[test]
    #[allow(deprecated)]
    fn test_parse_ase_atoms_partial_pbc() {
        // 2D material with pbc only in x and y directions
        let json = r#"{
            "symbols": ["C", "C"],
            "positions": [[0, 0, 0], [1.23, 0.71, 0]],
            "cell": [[2.46, 0, 0], [1.23, 2.13, 0], [0, 0, 20]],
            "pbc": [true, true, false]
        }"#;

        match parse_ase_atoms_json(json).unwrap() {
            StructureOrMolecule::Structure(s) => {
                assert_eq!(s.num_sites(), 2);
                // Verify pbc is correctly propagated to Structure
                assert_eq!(s.pbc, [true, true, false]);
                assert_eq!(s.lattice.pbc, [true, true, false]);
                // is_periodic should be true (any pbc dimension)
                assert!(s.is_periodic());
                assert!(!s.is_molecule());
            }
            StructureOrMolecule::Molecule(_) => {
                panic!("Expected Structure with partial pbc, got Molecule");
            }
        }
    }

    #[test]
    #[allow(deprecated)]
    fn test_parse_ase_atoms_molecule() {
        let json = r#"{
            "symbols": ["O", "H", "H"],
            "positions": [[0, 0, 0], [0.96, 0, 0], [-0.24, 0.93, 0]],
            "pbc": [false, false, false],
            "info": {"charge": 0, "energy": -10.5}
        }"#;

        match parse_ase_atoms_json(json).unwrap() {
            StructureOrMolecule::Molecule(m) => {
                assert_eq!(m.num_sites(), 3);
                assert_eq!(m.composition().reduced_formula(), "H2O");
                assert_eq!(m.properties.get("energy"), Some(&serde_json::json!(-10.5)));
            }
            StructureOrMolecule::Structure(_) => {
                panic!("Expected Molecule, got Structure");
            }
        }
    }

    #[test]
    #[allow(deprecated)]
    fn test_parse_ase_atoms_molecule_no_cell() {
        // ASE molecules often have null cell
        let json = r#"{
            "symbols": ["C", "H", "H", "H", "H"],
            "positions": [[0, 0, 0], [1.09, 0, 0], [-0.36, 1.03, 0], [-0.36, -0.51, 0.89], [-0.36, -0.51, -0.89]]
        }"#;

        match parse_ase_atoms_json(json).unwrap() {
            StructureOrMolecule::Molecule(m) => {
                assert_eq!(m.num_sites(), 5);
                // Composition should have 1 C and 4 H regardless of formula ordering
                let comp = m.composition();
                assert!((comp.get_element_total(Element::C) - 1.0).abs() < 1e-10);
                assert!((comp.get_element_total(Element::H) - 4.0).abs() < 1e-10);
            }
            StructureOrMolecule::Structure(_) => {
                panic!("Expected Molecule, got Structure");
            }
        }
    }

    #[test]
    fn test_structure_to_ase_atoms_dict() {
        let lattice = Lattice::cubic(4.0);
        let s = Structure::new(
            lattice,
            vec![Species::neutral(Element::Cu), Species::neutral(Element::Cu)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        let ase_dict = structure_to_ase_atoms_dict(&s);

        assert_eq!(
            ase_dict["symbols"].as_array().unwrap(),
            &vec![serde_json::json!("Cu"), serde_json::json!("Cu")]
        );
        assert!(ase_dict["cell"].is_array());
        assert_eq!(ase_dict["pbc"], serde_json::json!([true, true, true]));
    }

    #[test]
    fn test_structure_to_ase_atoms_dict_with_charge() {
        // Charged structure should include charge in info dict
        let lattice = Lattice::cubic(4.0);
        let s = Structure::try_new_full(
            lattice,
            vec![
                SiteOccupancy::ordered(Species::neutral(Element::Li)),
                SiteOccupancy::ordered(Species::neutral(Element::Li)),
            ],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
            [true, true, true],
            1.0, // positive charge
            HashMap::new(),
        )
        .unwrap();

        let ase_dict = structure_to_ase_atoms_dict(&s);

        // Charge should be in info dict
        assert_eq!(ase_dict["info"]["charge"], serde_json::json!(1.0));
    }

    #[test]
    fn test_structure_to_ase_atoms_dict_zero_charge() {
        // Zero charge should NOT be in info dict
        let lattice = Lattice::cubic(4.0);
        let s = Structure::new(
            lattice,
            vec![Species::neutral(Element::Cu), Species::neutral(Element::Cu)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        let ase_dict = structure_to_ase_atoms_dict(&s);

        // info dict should not have charge key when charge is zero
        assert!(!ase_dict["info"].as_object().unwrap().contains_key("charge"));
    }

    #[test]
    fn test_molecule_to_ase_atoms_dict() {
        let mol = water_molecule();
        let ase_dict = molecule_to_ase_atoms_dict(&mol);

        assert_eq!(
            ase_dict["symbols"].as_array().unwrap(),
            &vec![
                serde_json::json!("O"),
                serde_json::json!("H"),
                serde_json::json!("H")
            ]
        );
        assert!(ase_dict["cell"].is_null());
        assert_eq!(ase_dict["pbc"], serde_json::json!([false, false, false]));
    }

    #[test]
    #[allow(deprecated)]
    fn test_ase_atoms_roundtrip_structure() {
        let s1 = Structure::new(
            Lattice::cubic(5.64),
            vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        let ase_dict = structure_to_ase_atoms_dict(&s1);
        let json = serde_json::to_string(&ase_dict).unwrap();

        match parse_ase_atoms_json(&json).unwrap() {
            StructureOrMolecule::Structure(s2) => {
                assert_eq!(s1.num_sites(), s2.num_sites());
                assert!((s1.lattice.volume() - s2.lattice.volume()).abs() < 1e-6);
                // Check positions (Cartesian)
                let (cart1, cart2) = (s1.cart_coords(), s2.cart_coords());
                for idx in 0..s1.num_sites() {
                    assert!((cart1[idx] - cart2[idx]).norm() < 1e-6);
                }
            }
            StructureOrMolecule::Molecule(_) => {
                panic!("Expected Structure, got Molecule");
            }
        }
    }

    #[test]
    #[allow(deprecated)]
    fn test_ase_atoms_roundtrip_molecule() {
        let m1 = water_molecule();

        let ase_dict = molecule_to_ase_atoms_dict(&m1);
        let json = serde_json::to_string(&ase_dict).unwrap();

        match parse_ase_atoms_json(&json).unwrap() {
            StructureOrMolecule::Molecule(m2) => {
                assert_eq!(m1.num_sites(), m2.num_sites());
                let cart1 = m1.cart_coords();
                let cart2 = m2.cart_coords();
                for idx in 0..m1.num_sites() {
                    assert!((cart1[idx] - cart2[idx]).norm() < 1e-6);
                }
            }
            StructureOrMolecule::Structure(_) => {
                panic!("Expected Molecule, got Structure");
            }
        }
    }

    #[test]
    fn test_batch_structures_to_ase_dicts() {
        let structures = vec![
            Structure::new(
                Lattice::cubic(4.0),
                vec![Species::neutral(Element::Fe)],
                vec![Vector3::zeros()],
            ),
            Structure::new(
                Lattice::cubic(5.0),
                vec![Species::neutral(Element::Cu)],
                vec![Vector3::zeros()],
            ),
        ];

        let dicts = structures_to_ase_atoms_dicts(&structures);
        assert_eq!(dicts.len(), 2);
        assert_eq!(dicts[0]["symbols"], serde_json::json!(["Fe"]));
        assert_eq!(dicts[1]["symbols"], serde_json::json!(["Cu"]));
    }

    #[test]
    fn test_ase_to_pymatgen_conversion() {
        // Structure
        let ase_struct = r#"{
            "symbols": ["Si", "Si"],
            "positions": [[0, 0, 0], [1.36, 1.36, 1.36]],
            "cell": [[2.72, 2.72, 0], [2.72, 0, 2.72], [0, 2.72, 2.72]],
            "pbc": [true, true, true]
        }"#;

        let pymatgen_json = ase_atoms_to_pymatgen_json(ase_struct).unwrap();
        assert!(pymatgen_json.contains("\"@class\":\"Structure\""));
        assert!(pymatgen_json.contains("\"lattice\""));

        // Molecule
        let ase_mol = r#"{
            "symbols": ["H", "H"],
            "positions": [[0, 0, 0], [0.74, 0, 0]],
            "pbc": [false, false, false]
        }"#;

        let pymatgen_json = ase_atoms_to_pymatgen_json(ase_mol).unwrap();
        assert!(pymatgen_json.contains("\"@class\":\"Molecule\""));
    }

    #[test]
    #[allow(deprecated)]
    fn test_ase_atoms_with_info() {
        let json = r#"{
            "symbols": ["Fe"],
            "positions": [[0, 0, 0]],
            "cell": [[2.87, 0, 0], [0, 2.87, 0], [0, 0, 2.87]],
            "pbc": [true, true, true],
            "info": {"energy": -5.5, "forces": [[0.1, 0.2, 0.3]], "config_type": "relaxed"}
        }"#;

        match parse_ase_atoms_json(json).unwrap() {
            StructureOrMolecule::Structure(s) => {
                assert_eq!(s.properties.get("energy"), Some(&serde_json::json!(-5.5)));
                assert_eq!(
                    s.properties.get("config_type"),
                    Some(&serde_json::json!("relaxed"))
                );
            }
            StructureOrMolecule::Molecule(_) => {
                panic!("Expected Structure, got Molecule");
            }
        }
    }

    #[test]
    fn test_ase_atoms_length_mismatch_error() {
        let json = r#"{
            "symbols": ["Fe", "O"],
            "positions": [[0, 0, 0]]
        }"#;

        let result = parse_ase_atoms_json(json);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("same length"));
    }
}
