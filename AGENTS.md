# Repository Guidelines

This repository contains an Obsidian plugin that displays image metadata (EXIF and PNG text chunks). It also recognizes common AI-generation parameters (e.g., Stable Diffusion) when present. Follow these guidelines to contribute effectively.

## Project Structure & Module Organization
- `main.ts`: Plugin entry; registers ribbon/commands and view.
- `view.ts`: Right‑sidebar view that renders parsed metadata.
- `ui.ts`: Modal for viewing/copying metadata JSON.
- `parser.ts`: PNG/JPEG/WEBP parsing and common parameter normalization.
- `styles.css`: Minimal UI styling.
- `manifest.json`: Obsidian plugin manifest.
- `rollup.config.mjs`: Build configuration.
- `main.js`: Built output (generated; do not edit).

## Build, Test, and Development Commands
- `npm i`: Install dependencies.
- `npm run dev`: Watch build with Rollup; edits recompile to `main.js`.
- `npm run build`: Production build.

Build timing policy:
- Prefer one build after an important series of changes (not after every tiny edit).
- Always run a fresh build before manual testing and right before a release.
- During active development, you may use `npm run build` to auto‑rebuild.

Run in Obsidian locally:
- Symlink or copy this folder into your vault at `.obsidian/plugins/image-metadata-viewer`, then enable the plugin.
- Example (macOS): `ln -s "$(pwd)" /path/to/Vault/.obsidian/plugins/image-metadata-viewer`

## Coding Style & Naming Conventions
- Language: TypeScript; output CommonJS via Rollup.
- Indentation: 4 spaces; end statements with semicolons; use double quotes.
- Naming: `camelCase` for variables/functions, `PascalCase` for classes, `UPPER_SNAKE_CASE` for constants.
- Files: lowercase; use hyphens for multi‑word names.
- Keep imports relative; avoid Obsidian APIs not declared in `manifest.json`.
- Comments & docs: Write all in-file comments and project documentation (README, guides) in English.

## Testing Guidelines
- No automated tests yet. Perform manual checks in Obsidian:
  - Open a PNG/JPEG/WEBP file; verify fields render and “Copy” works.
  - For PNGs with `tEXt/iTXt/zTXt`, confirm “Raw chunks” expands correctly.
- When changing `parser.ts`, test with several sample images (A1111/ComfyUI output).

## Commit & Pull Request Guidelines
- Commits: Use Conventional Commits (e.g., `feat(parser): add iTXt support`, `fix(view): handle non-image files`). Keep messages imperative and scoped (`parser`, `view`, `ui`, `build`).
- PRs: Provide a clear description, linked issues, screenshots/GIFs of the modal/view, reproduction steps, and risk notes. Keep changes focused and small.

## Security & Configuration Tips
- No external network calls; operate only on local vault files.
- Validate file extensions before parsing; handle errors with `Notice` and avoid noisy logs.
- Do not include large sample assets or secrets in the repo.
