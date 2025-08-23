# Image Metadata Viewer (Obsidian Plugin)

An Obsidian plugin to view image metadata. It reads PNG `tEXt`/`iTXt`/`zTXt` chunks and basic info for JPEG/WEBP, and renders results as JSON in a right‑sidebar view or a modal. When present, common AI‑generation parameters are normalized into readable fields — supports both Stable Diffusion A1111 WebUI and ComfyUI.

## Features
- Right‑sidebar view that keeps metadata for the active image visible
- Modal via ribbon/command palette/file menu
- Per‑section Copy buttons with notice feedback; PNG “Raw chunks (tEXt/iTXt/zTXt)” expandable and copyable
- ComfyUI: Positive/Negative prompts, Prompt JSON and Workflow JSON (copy + export)
- Stable Diffusion A1111: parameters block surfaced with a header + Copy
- Supported extensions: `png`, `jpg`, `jpeg`, `webp`
- Local‑only; no network access

## Install (from source)
1. Install dependencies
   - Node.js 18+ recommended
   - In repo root: `npm i`
2. Build
   - Dev: `npm run dev` (Rollup watch build)
   - Prod: `npm run build`
3. Place in your Obsidian plugins folder
   - Copy or symlink this folder into `<Vault>/.obsidian/plugins/` (the folder name is arbitrary)
   - Example (macOS): `ln -s "$(pwd)" /path/to/Vault/.obsidian/plugins/image-metadata-viewer`
4. Restart Obsidian and enable from Settings > Community plugins

Minimum app version is defined in `manifest.json` (`minAppVersion`, currently 1.5.0).

## Usage
- Open an image (`png`/`jpg`/`jpeg`/`webp`) in the editor
- Use the ribbon button or command palette “Show image metadata (modal)” to open the modal
- Use “Open right sidebar metadata view” to show the persistent view (auto‑updates with the active image)
- For PNG, the “Raw chunks (tEXt/iTXt/zTXt)” section (details) expands; its summary row has a Copy button that works even while collapsed
- When a Markdown note contains exactly one embedded image, opening that note will treat it like opening the image itself and update the right sidebar for that image

## Parser Overview
- PNG: extracts `tEXt`/`iTXt`/`zTXt`, inflating compressed sections when needed
  - Common generation parameters are normalized into readable fields
    - Stable Diffusion A1111 WebUI: surfaces the multi‑line `parameters` block; shows it as a dedicated section with Copy
    - ComfyUI: detects Prompt/Workflow JSON and extracts `prompt`, `negative_prompt`, `seed`, `steps`, `cfg_scale`, `sampler`, `scheduler`, `denoise` when available; both JSON blobs are pretty‑printed with Copy/Export
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
