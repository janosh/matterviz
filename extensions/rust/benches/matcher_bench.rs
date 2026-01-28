//! Benchmarks for structure matching.
//!
//! Run benchmarks with: `cargo bench`
//!
//! For comprehensive benchmarks comparing ferrox vs pymatgen, use:
//! `python benchmark_large_scale.py`

use criterion::{Criterion, criterion_group, criterion_main};
use ferrox::element::Element;
use ferrox::lattice::Lattice;
use ferrox::matcher::StructureMatcher;
use ferrox::species::Species;
use ferrox::structure::Structure;
use nalgebra::Vector3;
use std::hint::black_box;

fn make_nacl() -> Structure {
    let lattice = Lattice::cubic(5.64);
    let species = vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)];
    let coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
    Structure::new(lattice, species, coords)
}

fn make_fcc(element: Element, a: f64) -> Structure {
    let lattice = Lattice::cubic(a);
    let species = vec![
        Species::neutral(element),
        Species::neutral(element),
        Species::neutral(element),
        Species::neutral(element),
    ];
    let coords = vec![
        Vector3::new(0.0, 0.0, 0.0),
        Vector3::new(0.5, 0.5, 0.0),
        Vector3::new(0.5, 0.0, 0.5),
        Vector3::new(0.0, 0.5, 0.5),
    ];
    Structure::new(lattice, species, coords)
}

fn benchmark_fit_identical(c: &mut Criterion) {
    let s1 = make_nacl();
    let s2 = make_nacl();
    let matcher = StructureMatcher::new();

    c.bench_function("fit_identical_nacl", |b| {
        b.iter(|| matcher.fit(black_box(&s1), black_box(&s2)))
    });
}

fn benchmark_fit_fcc(c: &mut Criterion) {
    let s1 = make_fcc(Element::Cu, 3.6);
    let s2 = make_fcc(Element::Cu, 3.6);
    let matcher = StructureMatcher::new();

    c.bench_function("fit_identical_fcc", |b| {
        b.iter(|| matcher.fit(black_box(&s1), black_box(&s2)))
    });
}

fn benchmark_fit_different(c: &mut Criterion) {
    let s1 = make_nacl();
    let s2 = make_fcc(Element::Cu, 3.6);
    let matcher = StructureMatcher::new();

    c.bench_function("fit_different_composition", |b| {
        b.iter(|| matcher.fit(black_box(&s1), black_box(&s2)))
    });
}

criterion_group!(
    benches,
    benchmark_fit_identical,
    benchmark_fit_fcc,
    benchmark_fit_different
);
criterion_main!(benches);
