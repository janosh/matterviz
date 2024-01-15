"""Generate TypeScript definitions for all Emmet pydantic models."""

import os
import pkgutil
import shutil
from inspect import getmembers, isclass

import emmet.core as emmet
from pydantic import BaseModel
from pydantic2ts import generate_typescript_defs

__author__ = "Janosh Riebesell"
__date__ = "2024-07-11"

# Set to keep track of written types
written_types = {"Element"}
written_files: set[str] = set()

this_dir = os.path.dirname(__file__)
if input(f"Delete existing types in {this_dir}/types? [y/n] ").lower() == "y":
    shutil.rmtree(f"{this_dir}/types", ignore_errors=True)
os.makedirs(f"{this_dir}/types", exist_ok=True)

modules = pkgutil.walk_packages(
    path=emmet.__path__, prefix=emmet.__name__ + ".", onerror=lambda: None
)
modules = list(modules)

for idx, (mod_path, mod_name, is_pkg) in enumerate(modules):
    if mod_name.startswith("_"):
        continue
    output_file = mod_name.split(".")[-1]
    try:
        current_module = __import__(mod_name)
        models = {
            name
            for name, obj in getmembers(current_module, isclass)
            if issubclass(obj, BaseModel)
        }
        if not models:  # skip modules without Pydantic models
            print(f"{mod_name}: no pydantic models found {is_pkg=} {mod_path=}")
            continue

        # Generate TypeScript definitions for all Pydantic models in the current module
        generate_typescript_defs(
            mod_name,
            f"{this_dir}/types/{output_file}.ts",
            exclude=tuple(written_types),
            json2ts_cmd="npx json-schema-to-typescript",
        )
        # Add the types from the current module to the set of written types
        written_types |= models
        written_files.add(output_file)
    except Exception as exc:
        print(f"{mod_name}: {exc}")


# Generate index.ts file with convenience re-exports for all types
with open("./types/index.ts", "w") as file:
    file.write("\n".join(f"export * from './{file}'" for file in sorted(written_files)))
