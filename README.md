# Image Metadata Viewer (Obsidian Plugin)

An Obsidian plugin to view image metadata. It reads PNG `tEXt`/`iTXt`/`zTXt` chunks and basic info for JPEG/WEBP, and renders results as JSON in a right‑sidebar view or a modal. When present, common AI‑generation parameters are normalized into readable fields — supports both Stable Diffusion A1111 WebUI and ComfyUI.

## Features
- Right‑sidebar view that keeps metadata for the active image visible
- Modal via ribbon/command palette/file menu
- Copy JSON, and expand/copy PNG raw chunks (tEXt/iTXt/zTXt)
- Supported extensions: `png`, `jpg`, `jpeg`, `webp`
- Local‑only; no network access
 - Recognizes Stable Diffusion (AUTOMATIC1111) and ComfyUI parameters/workflows

## Install (from source)
1. Install dependencies
   - Node.js 18+ recommended
   - In repo root: `npm i`
2. Build
   - Dev: `npm run dev` (Rollup watch build)
   - Prod: `npm run build`
3. Place in your Obsidian plugins folder
   - Put this folder at `<Vault>/.obsidian/plugins/image-metadata-viewer`, or symlink it
   - Example (macOS): `ln -s "$(pwd)" /path/to/Vault/.obsidian/plugins/image-metadata-viewer`
4. Restart Obsidian and enable from Settings > Community plugins

Minimum app version is defined in `manifest.json` (`minAppVersion`, currently 1.5.0).

## Usage
- Open an image (`png`/`jpg`/`jpeg`/`webp`) in the editor
- Use the ribbon button or command palette “Show image metadata (modal)” to open the modal and copy JSON
- Use “Open right sidebar metadata view” to show the persistent view
- For PNG, the “Raw chunks (tEXt/iTXt/zTXt)” section shows the raw chunks and lets you copy them
 - When an image file itself is open (not an embedded image in a note), a small “Metadata” button appears in the top‑right of the image; click it to open the modal

## Parser Overview
- PNG: extracts `tEXt`/`iTXt`/`zTXt`, inflating compressed sections when needed
  - Common generation parameters are normalized into readable fields
    - Stable Diffusion A1111 WebUI: parses `parameters` block and `prompt`/`negative_prompt`
    - ComfyUI: detects prompt/workflow JSON and extracts `prompt`, `negative_prompt`, `seed`, `steps`, `cfg_scale`, `sampler`, `scheduler`, `denoise` when available
  - If a value looks like JSON (`{...}`/`[...]`), the plugin attempts to parse it into a `*_json` field (e.g., `prompt_json`, `workflow_json`)
- JPEG/WEBP: currently minimal; detailed EXIF/XMP parsing not implemented and may return empty fields

## Security & Scope
- No network calls; only reads local files in your Vault
- Validates file extensions and safely aborts on unsupported types

## Development
- See `AGENTS.md` for coding style and project structure
- Key files:
  - `main.ts`: plugin entry (ribbon/commands/view registration)
  - `view.ts`: right‑sidebar view
  - `ui.ts`: modal (JSON display/copy)
  - `parser.ts`: lightweight parsers and field normalization
  - `styles.css`: minimal styling
  - `rollup.config.mjs`: build config

## Limitations / Future Work
- Detailed EXIF/XMP parsing for JPEG/WEBP
- No sample images included; test with your own files
- Normalization aims for best effort; tool‑specific variations may not be fully covered

Issues and PRs are welcome. Prefer small, focused changes.

## License

MIT License. See the `LICENSE` file for full text.
