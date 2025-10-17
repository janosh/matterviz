#!/usr/bin/env bash
set -e

echo "📦 Building matterviz package..."

# Step 1: Build WASM
echo "🦀 Building Rust WASM..."
cd rust && bash build.sh
cd ..

# Step 2: Save WASM files to temp location
echo "💾 Saving WASM files..."
mkdir -p tmp/wasm
cp -r dist/wasm/* tmp/wasm/

# Step 3: Run svelte-package (this clears dist/)
echo "📦 Running svelte-package..."
svelte-package

# Step 4: Restore WASM files
echo "🔄 Restoring WASM files..."
mkdir -p dist/wasm
cp -r tmp/wasm/* dist/wasm/

# Step 5: Cleanup
rm -rf tmp/wasm

echo "✅ Package build complete!"
echo "📊 WASM file sizes:"
ls -lh dist/wasm/*.wasm
