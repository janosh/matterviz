import pkgutil
import shutil

import emmet.core as emmet
from pydantic2ts import generate_typescript_defs
from tqdm import tqdm

# Set to keep track of written types
written_types: set[str] = set()
written_files: set[str] = set()

shutil.rmtree("./types", ignore_errors=True)

modules = pkgutil.walk_packages(
    path=emmet.__path__, prefix=emmet.__name__ + ".", onerror=lambda: None
)
modules = list(modules)

# Generate TypeScript definitions for each submodule
for _, mod_name, _ in tqdm(modules, desc="pydantic2ts"):
    if mod_name.startswith("_"):
        continue
    output_file = mod_name.split(".")[-1]
    try:
        # Generate TypeScript definitions excluding the written types
        generate_typescript_defs(
            mod_name,
            f"./types/{output_file}.ts",
            exclude=tuple(written_types),
            json2ts_cmd="npx json-schema-to-typescript",
        )
        # Add the types from the current module to the set of written types
        current_module = __import__(mod_name, fromlist=[""])
        written_types.update(set(dir(current_module)))
        written_files.add(output_file)
    except Exception as exc:
        print(f"{mod_name}: {exc}")

with open("./types/index.ts", "w") as file:
    file.write("\n".join(f"export * from './{file}'" for file in sorted(written_files)))
