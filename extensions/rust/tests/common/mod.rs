//! Shared test utilities for creating crystal structures.
//!
//! Provides helper functions to create common crystal structures for testing.

#![allow(dead_code)]

use ferrox::element::Element;
use ferrox::lattice::Lattice;
use ferrox::species::Species;
use ferrox::structure::Structure;
use nalgebra::Vector3;

/// Create an FCC structure (conventional cell with 4 atoms).
pub fn make_fcc(a: f64, element: Element) -> Structure {
    let lattice = Lattice::cubic(a);
    let species = vec![Species::neutral(element); 4];
    // FCC basis: (0,0,0), (0.5,0.5,0), (0.5,0,0.5), (0,0.5,0.5)
    let frac_coords = vec![
        Vector3::new(0.0, 0.0, 0.0),
        Vector3::new(0.5, 0.5, 0.0),
        Vector3::new(0.5, 0.0, 0.5),
        Vector3::new(0.0, 0.5, 0.5),
    ];
    Structure::new(lattice, species, frac_coords)
}

/// Create an FCC supercell.
pub fn make_fcc_supercell(a: f64, element: Element, nx: usize, ny: usize, nz: usize) -> Structure {
    let base = make_fcc(a, element);
    if nx > 1 || ny > 1 || nz > 1 {
        base.make_supercell([[nx as i32, 0, 0], [0, ny as i32, 0], [0, 0, nz as i32]])
            .unwrap()
    } else {
        base
    }
}

/// Create a large FCC supercell for scaling tests.
pub fn make_fcc_large(a: f64, element: Element, n: usize) -> Structure {
    let supercell_lattice = Lattice::cubic(a * n as f64);
    let mut species = Vec::with_capacity(n * n * n * 4);
    let mut frac_coords = Vec::with_capacity(n * n * n * 4);

    // FCC basis positions
    let basis = [
        Vector3::new(0.0, 0.0, 0.0),
        Vector3::new(0.5, 0.5, 0.0),
        Vector3::new(0.5, 0.0, 0.5),
        Vector3::new(0.0, 0.5, 0.5),
    ];

    for idx_a in 0..n {
        for idx_b in 0..n {
            for idx_c in 0..n {
                for base in &basis {
                    let frac = Vector3::new(
                        (base.x + idx_a as f64) / n as f64,
                        (base.y + idx_b as f64) / n as f64,
                        (base.z + idx_c as f64) / n as f64,
                    );
                    frac_coords.push(frac);
                    species.push(Species::neutral(element));
                }
            }
        }
    }

    Structure::new(supercell_lattice, species, frac_coords)
}

/// Create a BCC structure (conventional cell with 2 atoms).
pub fn make_bcc(a: f64, element: Element) -> Structure {
    let lattice = Lattice::cubic(a);
    let species = vec![Species::neutral(element); 2];
    // BCC basis: (0,0,0), (0.5,0.5,0.5)
    let frac_coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
    Structure::new(lattice, species, frac_coords)
}

/// Create a BCC supercell.
pub fn make_bcc_supercell(a: f64, element: Element, nx: usize, ny: usize, nz: usize) -> Structure {
    let base = make_bcc(a, element);
    if nx > 1 || ny > 1 || nz > 1 {
        base.make_supercell([[nx as i32, 0, 0], [0, ny as i32, 0], [0, 0, nz as i32]])
            .unwrap()
    } else {
        base
    }
}

/// Create a large BCC supercell for scaling tests.
pub fn make_bcc_large(a: f64, element: Element, n: usize) -> Structure {
    let supercell_lattice = Lattice::cubic(a * n as f64);
    let mut species = Vec::with_capacity(n * n * n * 2);
    let mut frac_coords = Vec::with_capacity(n * n * n * 2);

    let basis = [Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];

    for idx_a in 0..n {
        for idx_b in 0..n {
            for idx_c in 0..n {
                for base in &basis {
                    let frac = Vector3::new(
                        (base.x + idx_a as f64) / n as f64,
                        (base.y + idx_b as f64) / n as f64,
                        (base.z + idx_c as f64) / n as f64,
                    );
                    frac_coords.push(frac);
                    species.push(Species::neutral(element));
                }
            }
        }
    }

    Structure::new(supercell_lattice, species, frac_coords)
}

/// Create an HCP structure.
pub fn make_hcp(a: f64, c: f64, element: Element) -> Structure {
    let lattice = Lattice::hexagonal(a, c);
    let species = vec![Species::neutral(element); 2];
    // HCP basis: (0,0,0), (1/3, 2/3, 0.5)
    let frac_coords = vec![
        Vector3::new(0.0, 0.0, 0.0),
        Vector3::new(1.0 / 3.0, 2.0 / 3.0, 0.5),
    ];
    Structure::new(lattice, species, frac_coords)
}

/// Create an HCP supercell.
pub fn make_hcp_supercell(
    a: f64,
    c: f64,
    element: Element,
    nx: usize,
    ny: usize,
    nz: usize,
) -> Structure {
    let base = make_hcp(a, c, element);
    if nx > 1 || ny > 1 || nz > 1 {
        base.make_supercell([[nx as i32, 0, 0], [0, ny as i32, 0], [0, 0, nz as i32]])
            .unwrap()
    } else {
        base
    }
}

/// Create a simple cubic structure (1 atom per cell).
pub fn make_simple_cubic(a: f64, element: Element) -> Structure {
    let lattice = Lattice::cubic(a);
    let species = vec![Species::neutral(element)];
    let frac_coords = vec![Vector3::new(0.0, 0.0, 0.0)];
    Structure::new(lattice, species, frac_coords)
}

/// Create NaCl rocksalt structure.
pub fn make_nacl(a: f64) -> Structure {
    let lattice = Lattice::cubic(a);
    let species = vec![
        Species::neutral(Element::Na),
        Species::neutral(Element::Na),
        Species::neutral(Element::Na),
        Species::neutral(Element::Na),
        Species::neutral(Element::Cl),
        Species::neutral(Element::Cl),
        Species::neutral(Element::Cl),
        Species::neutral(Element::Cl),
    ];
    // Na at FCC positions, Cl at edge centers + body center
    let frac_coords = vec![
        // Na positions (FCC)
        Vector3::new(0.0, 0.0, 0.0),
        Vector3::new(0.5, 0.5, 0.0),
        Vector3::new(0.5, 0.0, 0.5),
        Vector3::new(0.0, 0.5, 0.5),
        // Cl positions (shifted FCC)
        Vector3::new(0.5, 0.0, 0.0),
        Vector3::new(0.0, 0.5, 0.0),
        Vector3::new(0.0, 0.0, 0.5),
        Vector3::new(0.5, 0.5, 0.5),
    ];
    Structure::new(lattice, species, frac_coords)
}

/// Create NaCl supercell for neighbor list tests.
pub fn make_nacl_supercell(a: f64, n: usize) -> Structure {
    let supercell_lattice = Lattice::cubic(a * n as f64);
    let mut species = Vec::with_capacity(n * n * n * 8);
    let mut frac_coords = Vec::with_capacity(n * n * n * 8);

    // Na at FCC positions
    let na_basis = [
        Vector3::new(0.0, 0.0, 0.0),
        Vector3::new(0.5, 0.5, 0.0),
        Vector3::new(0.5, 0.0, 0.5),
        Vector3::new(0.0, 0.5, 0.5),
    ];
    // Cl at shifted FCC positions
    let cl_basis = [
        Vector3::new(0.5, 0.0, 0.0),
        Vector3::new(0.0, 0.5, 0.0),
        Vector3::new(0.0, 0.0, 0.5),
        Vector3::new(0.5, 0.5, 0.5),
    ];

    for idx_a in 0..n {
        for idx_b in 0..n {
            for idx_c in 0..n {
                for base in &na_basis {
                    let frac = Vector3::new(
                        (base.x + idx_a as f64) / n as f64,
                        (base.y + idx_b as f64) / n as f64,
                        (base.z + idx_c as f64) / n as f64,
                    );
                    frac_coords.push(frac);
                    species.push(Species::neutral(Element::Na));
                }
                for base in &cl_basis {
                    let frac = Vector3::new(
                        (base.x + idx_a as f64) / n as f64,
                        (base.y + idx_b as f64) / n as f64,
                        (base.z + idx_c as f64) / n as f64,
                    );
                    frac_coords.push(frac);
                    species.push(Species::neutral(Element::Cl));
                }
            }
        }
    }

    Structure::new(supercell_lattice, species, frac_coords)
}

/// Create a rocksalt structure with specified cation and anion.
pub fn make_rocksalt(cation: Element, anion: Element, a: f64) -> Structure {
    let lattice = Lattice::cubic(a);
    let species = vec![
        Species::neutral(cation),
        Species::neutral(cation),
        Species::neutral(cation),
        Species::neutral(cation),
        Species::neutral(anion),
        Species::neutral(anion),
        Species::neutral(anion),
        Species::neutral(anion),
    ];
    let frac_coords = vec![
        // Cation positions (FCC)
        Vector3::new(0.0, 0.0, 0.0),
        Vector3::new(0.5, 0.5, 0.0),
        Vector3::new(0.5, 0.0, 0.5),
        Vector3::new(0.0, 0.5, 0.5),
        // Anion positions (shifted FCC)
        Vector3::new(0.5, 0.0, 0.0),
        Vector3::new(0.0, 0.5, 0.0),
        Vector3::new(0.0, 0.0, 0.5),
        Vector3::new(0.5, 0.5, 0.5),
    ];
    Structure::new(lattice, species, frac_coords)
}

/// Create a disordered structure with deterministic pseudo-random positions.
pub fn make_disordered(n_atoms: usize, box_size: f64, seed: u64) -> Structure {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let lattice = Lattice::cubic(box_size);
    let mut frac_coords = Vec::with_capacity(n_atoms);

    for idx in 0..n_atoms {
        // Use hash of index + seed for deterministic positions
        let mut hasher = DefaultHasher::new();
        (idx as u64 + seed).hash(&mut hasher);
        let hash = hasher.finish();

        let x = (hash & 0xFFFF) as f64 / 65535.0;
        let y = ((hash >> 16) & 0xFFFF) as f64 / 65535.0;
        let z = ((hash >> 32) & 0xFFFF) as f64 / 65535.0;

        frac_coords.push(Vector3::new(x, y, z));
    }

    Structure::new(
        lattice,
        vec![Species::neutral(Element::Ar); n_atoms],
        frac_coords,
    )
}
