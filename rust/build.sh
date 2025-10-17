#!/usr/bin/env bash
set -e

command -v wasm-pack >/dev/null || {
    echo "Error: wasm-pack not installed. Run: cargo install wasm-pack"
    exit 1
}

# Export element data and build WASM
deno run -qA ../src/scripts/export-element-data.ts
RUSTFLAGS="-C link-arg=-s" wasm-pack build --target web --out-dir ../dist/wasm --release

# Remove wasm-pack's .gitignore (we want these files in npm package)
rm -f ../dist/wasm/.gitignore

# Additional size optimization with wasm-opt
if command -v wasm-opt >/dev/null; then
    wasm-opt -Oz --strip-debug --strip-producers \
        --enable-bulk-memory --enable-mutable-globals \
        --enable-nontrapping-float-to-int --enable-sign-ext \
        ../dist/wasm/bonding_wasm_bg.wasm \
        -o ../dist/wasm/bonding_wasm_bg.wasm
fi

# Show final size
ls -lh ../dist/wasm/bonding_wasm_bg.wasm | awk '{print "WASM size:", $5}'
