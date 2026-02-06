//! Binary to generate Python type stubs from Rust code using pyo3-stub-gen.
//!
//! Run with: `cargo run --bin stub_gen --features python`

use pyo3_stub_gen::Result;

fn main() -> Result<()> {
    let stub = ferrox::python::stub_info()?;
    stub.generate()?;
    Ok(())
}
