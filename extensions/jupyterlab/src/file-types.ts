// Which filenames MatterViz claims, and whether each arrives as text or base64.
// Kept free of JupyterLab runtime imports so the patterns stay unit-testable — they
// decide which files MatterViz becomes the *default* opener for, so getting one
// wrong is user-visible in a way a typecheck won't catch.

import type { DocumentRegistry } from '@jupyterlab/docregistry'
import {
  BINARY_VIEWER_EXTENSIONS,
  TEXT_VIEWER_EXTENSIONS,
  VASP_VIEWER_STEMS,
} from '$lib/constants'

// Everything the browser can decode from a UTF-8 string. `.data` is dropped from the shared
// list: these types are `defaultFor`, and an extension that generic would make MatterViz the
// default opener for unrelated files.
const TEXT_EXTENSIONS = TEXT_VIEWER_EXTENSIONS.filter((ext) => ext !== `data`)

// Gzipped variants are registered explicitly rather than claiming bare `.gz`, which
// would hijack every compressed file in the browser. Compressed payloads always
// travel as base64 — the parser peels one layer before dispatching on the inner name.
const GZIP_EXTENSIONS = [...TEXT_EXTENSIONS, ...BINARY_VIEWER_EXTENSIONS].map(
  (ext) => `${ext}.gz`,
)

// VASP's canonical filenames carry no extension, so they need a pattern. The
// trailing group deliberately excludes `.`: a looser `[._-].*` also swallowed
// write_poscar.py, test_xdatcar.ipynb and contcar_reader.rs, and since JupyterLab
// checks patterns before extensions those became MatterViz files by default.
//
// The charge-index-less `aeccar` is dropped for the same reason: VASP only ever writes
// AECCAR0/1/2, so claiming the bare stem would hand MatterViz the default opener for
// anything merely named AECCAR. VS Code keeps it — there a claim only adds a menu entry.
const VASP_STEMS = VASP_VIEWER_STEMS.filter((stem) => stem !== `aeccar`)
const VASP_TOKEN = VASP_STEMS.flatMap((stem) => [stem.toUpperCase(), stem]).join(`|`)
const VASP_NAME_BODY = `^(?:.*[._-])?(?:${VASP_TOKEN})(?:[_-][^.]*)?`

// Base type minus the icon, which `index.ts` attaches — importing LabIcon here
// would drag @jupyterlab/ui-components into the tests.
export type FileTypeSpec = Omit<DocumentRegistry.IFileType, `icon`>

const by_extension = (extensions: string[], file_format: `text` | `base64`): FileTypeSpec[] =>
  extensions.map((ext) => ({
    name: `matterviz-${ext.replaceAll(`.`, `-`)}`,
    displayName: ext.toUpperCase(),
    extensions: [`.${ext}`],
    mimeTypes: [`application/octet-stream`],
    contentType: `file`,
    fileFormat: file_format,
  }))

const by_vasp_name = (suffix: string, file_format: `text` | `base64`): FileTypeSpec => ({
  name: `matterviz-vasp-named${file_format === `base64` ? `-gz` : ``}`,
  displayName: `VASP structure`,
  extensions: [],
  pattern: `${VASP_NAME_BODY}${suffix}$`,
  mimeTypes: [`text/plain`],
  contentType: `file`,
  fileFormat: file_format,
})

export const TEXT_FILE_TYPES: FileTypeSpec[] = [
  ...by_extension(TEXT_EXTENSIONS, `text`),
  by_vasp_name(``, `text`),
]

// Containers that must reach the parser as bytes. The shared binary list is already limited
// to formats with a decoder (no .xtc/.trr/.dcd), which matters more here than in VS Code:
// claiming one would take over files it can only greet with "Unsupported binary format".
// The gzip pattern is separate because pattern-before-extension order otherwise let
// a bare POSCAR.gz match the text type and reach the parser as mangled UTF-8.
export const BASE64_FILE_TYPES: FileTypeSpec[] = [
  ...by_extension([...BINARY_VIEWER_EXTENSIONS, ...GZIP_EXTENSIONS], `base64`),
  by_vasp_name(`\\.gz`, `base64`),
]
