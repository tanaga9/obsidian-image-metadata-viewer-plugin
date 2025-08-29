# Image Metadata Viewer (Obsidian Plugin)

An Obsidian plugin to view image metadata. It reads PNG `tEXt`/`iTXt`/`zTXt` chunks, robustly parses JPEG EXIF/XMP/COM (with careful text decoding), and renders results in a right‑sidebar view or a modal. When present, common AI‑generation parameters are normalized into readable fields — supports both Stable Diffusion A1111 WebUI and ComfyUI.

## Features
- Right‑sidebar view that keeps metadata for the active image visible
- Modal via ribbon/command palette/file menu
- Copy buttons with notice feedback; PNG “Raw chunks (tEXt/iTXt/zTXt)” expandable and copyable
- ComfyUI: Positive/Negative prompts, Prompt JSON and Workflow JSON (copy + export)
- Stable Diffusion A1111: parameters block exposed as a dedicated section with Copy
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
This plugin parses metadata from PNG, JPEG, and WEBP, then normalizes common AI‑generation parameters (A1111/ComfyUI) into readable fields.

- Formats: PNG (`tEXt`/`iTXt`/`zTXt`), JPEG (EXIF/XMP/COM), WEBP (basic EXIF/XMP).
- A1111: extracts the original multi‑line parameters block intact for easy copying.
- ComfyUI: detects prompt/workflow JSON, exposes prompt fields and pretty‑prints JSON with Copy/Export.
- Text decoding prioritizes preserving original content across encodings.

For complete heuristics, edge cases, and format‑specific details, see [metadata-parsing-knowledge](./metadata-parsing-knowledge.md).

## Security & Scope
- No network calls; only reads local files in your Vault
- Validates file extensions and safely aborts on unsupported types
- Does not write to image files; extraction is read‑only

## Development
- See `AGENTS.md` for coding style and project structure
- Key files:
  - `main.ts`: plugin entry (ribbon/commands/view registration)
  - `view.ts`: right‑sidebar view
  - `ui.ts`: modal (JSON display/copy)
  - `parser.ts`: PNG/JPEG/WEBP parsing and field normalization
  - `styles.css`: minimal styling
  - `rollup.config.mjs`: build config

## Limitations / Future Work
- WEBP: EXIF/XMP extraction can be extended further
- Additional label aliases (non‑English) for settings detection may be added
- No sample images included; test with your own files

Issues and PRs are welcome. Prefer small, focused changes.

## License

MIT License. See the `LICENSE` file for full text.
