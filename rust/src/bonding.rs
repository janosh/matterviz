mod elements;

use elements::{get_covalent_radii, get_element_props, ElementProps};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Site {
    pub xyz: [f64; 3],
    pub element: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Structure {
    pub sites: Vec<Site>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BondPair {
    pub pos_1: [f64; 3],
    pub pos_2: [f64; 3],
    pub site_idx_1: usize,
    pub site_idx_2: usize,
    pub bond_length: f64,
    pub strength: f64,
    pub transform_matrix: [f32; 16],
}

fn compute_bond_transform(pos_1: [f64; 3], pos_2: [f64; 3]) -> [f32; 16] {
    let dx = pos_2[0] - pos_1[0];
    let dy = pos_2[1] - pos_1[1];
    let dz = pos_2[2] - pos_1[2];
    let height = (dx * dx + dy * dy + dz * dz).sqrt();

    if height < 1e-10 {
        return [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0];
    }

    let dir_x = dx / height;
    let dir_y = dy / height;
    let dir_z = dz / height;

    let (m00, m01, m02, m10, m11, m12, m20, m21, m22) = if (dir_y - 1.0).abs() < 1e-10 {
        (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
    } else if (dir_y + 1.0).abs() < 1e-10 {
        (1.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 1.0)
    } else {
        let rx = -dir_z;
        let rz = dir_x;
        let r_len = (rx * rx + rz * rz).sqrt();
        let right_x = rx / r_len;
        let right_z = rz / r_len;

        let up_x = dir_y * right_z;
        let up_y = dir_z * right_x - dir_x * right_z;
        let up_z = -dir_y * right_x;

        (right_x, dir_x, up_x, 0.0, dir_y, up_y, right_z, dir_z, up_z)
    };

    let px = (pos_1[0] + pos_2[0]) / 2.0;
    let py = (pos_1[1] + pos_2[1]) / 2.0;
    let pz = (pos_1[2] + pos_2[2]) / 2.0;

    [
        m00 as f32,
        m10 as f32,
        m20 as f32,
        0.0,
        (m01 * height) as f32,
        (m11 * height) as f32,
        (m21 * height) as f32,
        0.0,
        m02 as f32,
        m12 as f32,
        m22 as f32,
        0.0,
        px as f32,
        py as f32,
        pz as f32,
        1.0,
    ]
}

fn default_min_bond_dist() -> f64 {
    0.4
}
fn default_same_species_penalty() -> f64 {
    0.5
}

#[derive(Debug, Clone, Deserialize)]
pub struct ElectronegRatioOptions {
    #[serde(default = "default_electronegativity_threshold")]
    pub electronegativity_threshold: f64,
    #[serde(default = "default_max_distance_ratio_electroneg")]
    pub max_distance_ratio: f64,
    #[serde(default = "default_min_bond_dist")]
    pub min_bond_dist: f64,
    #[serde(default = "default_metal_metal_penalty")]
    pub metal_metal_penalty: f64,
    #[serde(default = "default_metal_nonmetal_bonus")]
    pub metal_nonmetal_bonus: f64,
    #[serde(default = "default_similar_electronegativity_bonus")]
    pub similar_electronegativity_bonus: f64,
    #[serde(default = "default_same_species_penalty")]
    pub same_species_penalty: f64,
    #[serde(default = "default_strength_threshold")]
    pub strength_threshold: f64,
}

fn default_electronegativity_threshold() -> f64 {
    1.7
}
fn default_max_distance_ratio_electroneg() -> f64 {
    2.0
}
fn default_metal_metal_penalty() -> f64 {
    0.7
}
fn default_metal_nonmetal_bonus() -> f64 {
    1.5
}
fn default_similar_electronegativity_bonus() -> f64 {
    1.2
}
fn default_strength_threshold() -> f64 {
    0.3
}

impl Default for ElectronegRatioOptions {
    fn default() -> Self {
        Self {
            electronegativity_threshold: default_electronegativity_threshold(),
            max_distance_ratio: default_max_distance_ratio_electroneg(),
            min_bond_dist: default_min_bond_dist(),
            metal_metal_penalty: default_metal_metal_penalty(),
            metal_nonmetal_bonus: default_metal_nonmetal_bonus(),
            similar_electronegativity_bonus: default_similar_electronegativity_bonus(),
            same_species_penalty: default_same_species_penalty(),
            strength_threshold: default_strength_threshold(),
        }
    }
}


fn apply_saturation_penalty(
    strength: f64,
    distance: f64,
    idx_a: usize,
    idx_b: usize,
    closest_distances: &HashMap<usize, f64>,
) -> f64 {
    let mut result = strength;

    if let Some(&closest_a) = closest_distances.get(&idx_a) {
        if distance > closest_a {
            result *= (-(distance / closest_a - 1.0) / 0.5).exp();
        }
    }

    if let Some(&closest_b) = closest_distances.get(&idx_b) {
        if distance > closest_b {
            result *= (-(distance / closest_b - 1.0) / 0.5).exp();
        }
    }

    result
}

#[wasm_bindgen]
pub fn electroneg_ratio(structure_js: JsValue, options_js: JsValue) -> Result<JsValue, JsValue> {
    let structure: Structure = serde_wasm_bindgen::from_value(structure_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize structure: {}", e)))?;

    let options: ElectronegRatioOptions = if options_js.is_undefined() || options_js.is_null() {
        ElectronegRatioOptions::default()
    } else {
        serde_wasm_bindgen::from_value(options_js)
            .map_err(|e| JsValue::from_str(&format!("Failed to deserialize options: {}", e)))?
    };

    let bonds = electroneg_ratio_impl(&structure, &options);

    serde_wasm_bindgen::to_value(&bonds)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize bonds: {}", e)))
}

fn electroneg_ratio_impl(structure: &Structure, options: &ElectronegRatioOptions) -> Vec<BondPair> {
    let sites = &structure.sites;
    if sites.len() < 2 {
        return Vec::new();
    }

    let mut bonds = Vec::new();
    let covalent_radii = get_covalent_radii();
    let element_props = get_element_props();
    let min_dist_sq = options.min_bond_dist * options.min_bond_dist;
    let mut closest_bond_distances: HashMap<usize, f64> = HashMap::new();

    // Pre-calculate site properties
    let site_properties: Vec<_> = sites
        .iter()
        .map(|site| {
            let props = element_props.get(&site.element).cloned().unwrap_or(ElementProps {
                covalent_radius: covalent_radii.get(&site.element).copied(),
                electronegativity: 2.0,
                is_metal: false,
                is_nonmetal: false,
            });
            props
        })
        .collect();

    for idx_a in 0..sites.len() - 1 {
        let site_a = &sites[idx_a];
        let [x1, y1, z1] = site_a.xyz;
        let props_a = &site_properties[idx_a];

        for idx_b in (idx_a + 1)..sites.len() {
            let site_b = &sites[idx_b];
            let [x2, y2, z2] = site_b.xyz;
            let props_b = &site_properties[idx_b];

            let dx = x2 - x1;
            let dy = y2 - y1;
            let dz = z2 - z1;
            let dist_sq = dx * dx + dy * dy + dz * dz;
            let distance = dist_sq.sqrt();

            if dist_sq < min_dist_sq {
                continue;
            }

            if let (Some(r_a), Some(r_b)) = (props_a.covalent_radius, props_b.covalent_radius) {
                let expected_dist = r_a + r_b;
                let max_allowed_dist = expected_dist * options.max_distance_ratio;

                if distance > max_allowed_dist {
                    continue;
                }

                // Enhanced electronegativity weighting
                let electronegativity_diff = (props_a.electronegativity - props_b.electronegativity).abs();
                let electronegativity_ratio = electronegativity_diff /
                    (props_a.electronegativity + props_b.electronegativity);

                let mut bond_strength = 1.0;

                // Chemical bonding preferences
                if props_a.is_metal && props_b.is_metal {
                    bond_strength *= options.metal_metal_penalty;
                } else if (props_a.is_metal && props_b.is_nonmetal) ||
                          (props_a.is_nonmetal && props_b.is_metal) {
                    bond_strength *= options.metal_nonmetal_bonus;
                    if electronegativity_diff > options.electronegativity_threshold {
                        bond_strength *= 1.3; // Ionic character bonus
                    }
                } else if electronegativity_diff < 0.5 {
                    bond_strength *= options.similar_electronegativity_bonus;
                }

                // Distance-dependent weighting
                let distance_ratio = distance / expected_dist;
                let distance_weight = (-(distance_ratio - 1.0).powi(2) / (2.0 * 0.3_f64.powi(2))).exp();

                // Electronegativity-based weighting
                let electro_weight = 1.0 - 0.3 * electronegativity_ratio;

                let mut strength = bond_strength * distance_weight * electro_weight;

                if site_a.element == site_b.element {
                    strength *= options.same_species_penalty;
                }

                strength = apply_saturation_penalty(
                    strength,
                    distance,
                    idx_a,
                    idx_b,
                    &closest_bond_distances,
                );

                if strength > options.strength_threshold {
                    bonds.push(BondPair {
                        pos_1: site_a.xyz,
                        pos_2: site_b.xyz,
                        site_idx_1: idx_a,
                        site_idx_2: idx_b,
                        bond_length: distance,
                        strength,
                        transform_matrix: compute_bond_transform(site_a.xyz, site_b.xyz),
                    });

                    closest_bond_distances
                        .entry(idx_a)
                        .and_modify(|d| *d = d.min(distance))
                        .or_insert(distance);
                    closest_bond_distances
                        .entry(idx_b)
                        .and_modify(|d| *d = d.min(distance))
                        .or_insert(distance);
                }
            }
        }
    }

    bonds
}

// ============================================================================
// Voronoi Tessellation Bonding
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct VoronoiOptions {
    #[serde(default = "default_min_solid_angle")]
    pub min_solid_angle: f64,
    #[serde(default = "default_min_face_area")]
    pub min_face_area: f64,
    #[serde(default = "default_max_distance")]
    pub max_distance: f64,
    #[serde(default = "default_min_bond_dist")]
    pub min_bond_dist: f64,
}

fn default_min_solid_angle() -> f64 {
    0.01  // Very permissive - accept most neighbors
}
fn default_min_face_area() -> f64 {
    0.05  // Very low face area requirement
}
fn default_max_distance() -> f64 {
    5.0  // Generous max distance
}

impl Default for VoronoiOptions {
    fn default() -> Self {
        Self {
            min_solid_angle: default_min_solid_angle(),
            min_face_area: default_min_face_area(),
            max_distance: default_max_distance(),
            min_bond_dist: default_min_bond_dist(),
        }
    }
}

#[wasm_bindgen]
pub fn voronoi(structure_js: JsValue, options_js: JsValue) -> Result<JsValue, JsValue> {
    let structure: Structure = serde_wasm_bindgen::from_value(structure_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize structure: {}", e)))?;

    let options: VoronoiOptions = if options_js.is_undefined() || options_js.is_null() {
        VoronoiOptions::default()
    } else {
        serde_wasm_bindgen::from_value(options_js)
            .map_err(|e| JsValue::from_str(&format!("Failed to deserialize options: {}", e)))?
    };

    let bonds = voronoi_impl(&structure, &options);

    serde_wasm_bindgen::to_value(&bonds)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize bonds: {}", e)))
}

fn voronoi_impl(structure: &Structure, options: &VoronoiOptions) -> Vec<BondPair> {
    let sites = &structure.sites;
    if sites.len() < 2 {
        return Vec::new();
    }

    let mut bonds = Vec::new();
    let covalent_radii = get_covalent_radii();
    let min_dist_sq = options.min_bond_dist * options.min_bond_dist;
    let max_dist_sq = options.max_distance * options.max_distance;

    // Simplified Voronoi approach: For each atom, find all neighbors within max_distance
    // Calculate solid angle based on Voronoi-like face area approximation
    for idx_a in 0..sites.len() - 1 {
        let site_a = &sites[idx_a];
        let [x1, y1, z1] = site_a.xyz;
        let radius_a = covalent_radii.get(&site_a.element);

        for idx_b in (idx_a + 1)..sites.len() {
            let site_b = &sites[idx_b];
            let [x2, y2, z2] = site_b.xyz;
            let radius_b = covalent_radii.get(&site_b.element);

            let dx = x2 - x1;
            let dy = y2 - y1;
            let dz = z2 - z1;
            let dist_sq = dx * dx + dy * dy + dz * dz;
            let distance = dist_sq.sqrt();

            if dist_sq < min_dist_sq || dist_sq > max_dist_sq {
                continue;
            }

            if let (Some(&r_a), Some(&r_b)) = (radius_a, radius_b) {
                let expected_dist = r_a + r_b;

                // Generous face area estimate - use average radius
                let avg_radius = (r_a + r_b) / 2.0;
                let face_area = std::f64::consts::PI * avg_radius * avg_radius;

                // Calculate solid angle: Ω ≈ area / distance²
                let solid_angle = face_area / (distance * distance);

                // Permissive filtering by thresholds
                if solid_angle < options.min_solid_angle || face_area < options.min_face_area {
                    continue;
                }

                // Calculate bond strength based on distance from ideal
                let distance_ratio = distance / expected_dist;

                // Gentle distance penalty
                let distance_penalty = (-(distance_ratio - 1.0).powi(2) / 0.4).exp();

                // Normalize solid angle to bond strength
                let strength_from_angle = (solid_angle / (4.0 * std::f64::consts::PI)).min(1.0);

                let final_strength = strength_from_angle * distance_penalty;

                // Accept most bonds
                if final_strength > 0.05 {
                    bonds.push(BondPair {
                        pos_1: site_a.xyz,
                        pos_2: site_b.xyz,
                        site_idx_1: idx_a,
                        site_idx_2: idx_b,
                        bond_length: distance,
                        strength: final_strength,
                        transform_matrix: compute_bond_transform(site_a.xyz, site_b.xyz),
                    });
                }
            }
        }
    }

    bonds
}
