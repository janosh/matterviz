//! Integration tests for the neighbors module.
//!
//! These tests verify large-scale behavior and cross-cutoff consistency.

mod common;

use common::{make_bcc, make_bcc_large, make_fcc, make_fcc_large, make_nacl, make_nacl_supercell};
use ferrox::element::Element;
use ferrox::neighbors::{NeighborListConfig, build_neighbor_list};
use std::time::Instant;

// === Large System Scaling Tests ===

#[test]
fn test_large_fcc_scaling_1000_atoms() {
    // 6x6x6 FCC supercell = 864 atoms
    let large_fcc = make_fcc_large(3.61, Element::Cu, 6);
    let n_atoms = large_fcc.num_sites();
    assert!(
        n_atoms >= 800,
        "Expected at least 800 atoms, got {}",
        n_atoms
    );

    let config = NeighborListConfig {
        cutoff: 3.0,
        ..Default::default()
    };

    let start = Instant::now();
    let nl = build_neighbor_list(&large_fcc, &config);
    let elapsed = start.elapsed();

    // Performance: should complete in < 2 seconds
    assert!(
        elapsed.as_secs_f64() < 2.0,
        "Took {:.2}s for {} atoms - expected < 2s",
        elapsed.as_secs_f64(),
        n_atoms
    );

    // Correctness: each atom should have 12 neighbors
    let mut counts = vec![0usize; n_atoms];
    for &center in &nl.center_indices {
        counts[center] += 1;
    }

    let all_12 = counts.iter().all(|&c| c == 12);
    assert!(all_12, "All FCC atoms should have CN=12");

    println!(
        "Large FCC ({}  atoms): {} pairs in {:.3}s",
        n_atoms,
        nl.len(),
        elapsed.as_secs_f64()
    );
}

#[test]
fn test_large_bcc_scaling_1000_atoms() {
    // 8x8x8 BCC supercell = 1024 atoms
    let large_bcc = make_bcc_large(2.87, Element::Fe, 8);
    let n_atoms = large_bcc.num_sites();
    assert!(
        n_atoms >= 1000,
        "Expected at least 1000 atoms, got {}",
        n_atoms
    );

    let config = NeighborListConfig {
        cutoff: 2.6, // First shell
        ..Default::default()
    };

    let start = Instant::now();
    let nl = build_neighbor_list(&large_bcc, &config);
    let elapsed = start.elapsed();

    // Performance
    assert!(
        elapsed.as_secs_f64() < 2.0,
        "Took {:.2}s for {} atoms",
        elapsed.as_secs_f64(),
        n_atoms
    );

    // Correctness: each atom should have 8 neighbors
    let mut counts = vec![0usize; n_atoms];
    for &center in &nl.center_indices {
        counts[center] += 1;
    }

    let all_8 = counts.iter().all(|&c| c == 8);
    assert!(all_8, "All BCC atoms should have CN=8");

    println!(
        "Large BCC ({} atoms): {} pairs in {:.3}s",
        n_atoms,
        nl.len(),
        elapsed.as_secs_f64()
    );
}

#[test]
fn test_large_nacl_scaling() {
    // 5x5x5 NaCl supercell = 1000 atoms
    let large_nacl = make_nacl_supercell(5.64, 5);
    let n_atoms = large_nacl.num_sites();
    assert!(
        n_atoms >= 1000,
        "Expected at least 1000 atoms, got {}",
        n_atoms
    );

    let config = NeighborListConfig {
        cutoff: 3.5, // First shell Na-Cl distance
        ..Default::default()
    };

    let start = Instant::now();
    let nl = build_neighbor_list(&large_nacl, &config);
    let elapsed = start.elapsed();

    // Performance
    assert!(
        elapsed.as_secs_f64() < 2.0,
        "Took {:.2}s for {} atoms",
        elapsed.as_secs_f64(),
        n_atoms
    );

    // Correctness: each atom should have 6 neighbors (rocksalt CN=6)
    let mut counts = vec![0usize; n_atoms];
    for &center in &nl.center_indices {
        counts[center] += 1;
    }

    let all_6 = counts.iter().all(|&c| c == 6);
    assert!(all_6, "All NaCl atoms should have CN=6");

    println!(
        "Large NaCl ({} atoms): {} pairs in {:.3}s",
        n_atoms,
        nl.len(),
        elapsed.as_secs_f64()
    );
}

// === Cutoff and Coordination Number Tests ===

#[test]
fn test_coordination_numbers_fcc() {
    // FCC Cu: verify expected coordination numbers at specific cutoffs
    let fcc = make_fcc(3.61, Element::Cu);
    let n_atoms = fcc.num_sites();

    // First shell: distance = a/sqrt(2) ≈ 2.55 Å, CN = 12
    let config = NeighborListConfig {
        cutoff: 2.6,
        ..Default::default()
    };
    let nl = build_neighbor_list(&fcc, &config);
    let avg_cn = nl.len() / n_atoms;
    assert_eq!(
        avg_cn, 12,
        "FCC first shell should have CN=12, got {avg_cn}"
    );

    // Second shell includes: CN = 12 + 6 = 18
    let config = NeighborListConfig {
        cutoff: 3.7,
        ..Default::default()
    };
    let nl = build_neighbor_list(&fcc, &config);
    let avg_cn = nl.len() / n_atoms;
    assert_eq!(
        avg_cn, 18,
        "FCC first+second shell should have CN=18, got {avg_cn}"
    );
}

#[test]
fn test_coordination_numbers_bcc() {
    // BCC Fe: verify expected coordination numbers
    let bcc = make_bcc(2.87, Element::Fe);
    let n_atoms = bcc.num_sites();

    // First shell: distance = a*sqrt(3)/2 ≈ 2.48 Å, CN = 8
    let config = NeighborListConfig {
        cutoff: 2.5,
        ..Default::default()
    };
    let nl = build_neighbor_list(&bcc, &config);
    let avg_cn = nl.len() / n_atoms;
    assert_eq!(avg_cn, 8, "BCC first shell should have CN=8, got {avg_cn}");

    // Second shell includes: CN = 8 + 6 = 14
    let config = NeighborListConfig {
        cutoff: 2.9,
        ..Default::default()
    };
    let nl = build_neighbor_list(&bcc, &config);
    let avg_cn = nl.len() / n_atoms;
    assert_eq!(
        avg_cn, 14,
        "BCC first+second shell should have CN=14, got {avg_cn}"
    );
}

#[test]
fn test_coordination_numbers_nacl() {
    // NaCl: verify expected coordination numbers
    let nacl = make_nacl(5.64);
    let n_atoms = nacl.num_sites();

    // Na-Cl first shell: distance = a/2 ≈ 2.82 Å, each atom has CN=6 to opposite type
    let config = NeighborListConfig {
        cutoff: 3.0,
        ..Default::default()
    };
    let nl = build_neighbor_list(&nacl, &config);
    let avg_cn = nl.len() / n_atoms;
    assert_eq!(avg_cn, 6, "NaCl first shell should have CN=6, got {avg_cn}");
}

#[test]
fn test_first_shell_distance_values() {
    // Verify that first shell distances match expected crystallographic values
    let fcc = make_fcc(3.61, Element::Cu);
    let expected_nn_dist = 3.61 / 2.0_f64.sqrt(); // FCC first shell: a/sqrt(2) ≈ 2.553 Å

    let config = NeighborListConfig {
        cutoff: 2.6, // Just past first shell
        ..Default::default()
    };
    let nl = build_neighbor_list(&fcc, &config);

    // All distances should be approximately equal to first shell distance
    for dist in &nl.distances {
        let error = (dist - expected_nn_dist).abs();
        assert!(
            error < 0.01,
            "Distance {:.3} differs from expected NN distance {:.3}",
            dist,
            expected_nn_dist
        );
    }
}
