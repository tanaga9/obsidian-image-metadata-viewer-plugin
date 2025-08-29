# Metadata Parsing Knowledge

This document describes how to extract Stable Diffusion metadata from PNG, JPEG, and WebP images. It covers supported formats, general goals, detailed parsing strategies for each format, and cross-cutting concerns such as encoding heuristics and recovery methods.

## Supported Formats

- PNG
- JPEG
- WebP

## General Goals

The primary objectives for metadata parsing include:

- Robust in-process parsing of metadata from various sources.
- Preservation of original text without modification.
- Compatibility with popular tools such as Stable Diffusion WebUI AUTOMATIC1111 (A1111), Forge, and ComfyUI.
- Handling of odd or uncommon text encodings.

## PNG

PNG images contain metadata primarily in text chunks and sometimes embedded JSON.

### Text Chunks

PNG metadata is stored in text chunks such as `tEXt`, `zTXt`, and `iTXt`. The parser collects key→text pairs from these chunks:

- `tEXt` and `zTXt` chunks use Latin-1 (ISO-8859-1) encoding. `zTXt` chunks are compressed and require decompression before decoding.
- `iTXt` chunks use UTF-8 encoding and may be optionally compressed; decompression is needed if compressed.
- The key `parameters` is used by A1111 to store metadata. The first line is the prompt, and subsequent lines are `Key: Value` pairs.
- Other recognized keys include `prompt`, `negative_prompt`, `Prompt`, and `Negative prompt`. Raw values are stored, and if a value resembles JSON (`{...}` or `[...]`), it is parsed into a corresponding `key_json` field.
- ComfyUI information is integrated into the fields (see ComfyUI Extraction section).

### Encoding

- `tEXt` and `zTXt` chunks use Latin-1 encoding.
- `iTXt` chunks use UTF-8 encoding.
- Compressed chunks (`zTXt` and optionally compressed `iTXt`) must be decompressed before decoding.

## JPEG

JPEG images contain metadata in various segments, including EXIF, XMP, and JPEG Comment segments.

### Segment Scan

The parser walks through JPEG markers until the Start of Scan (SOS) or End of Image (EOI) marker is reached. Relevant segments include:

- `APP1` segments, which may contain EXIF or XMP data.
- `COM` segments, which contain JPEG comments.

### EXIF

EXIF metadata extraction focuses on textual fields:

- Extracts texts from `UserComment`, `ImageDescription`, and XP* tags such as `XPComment` and `XPTitle`.
- `UserComment` may contain ASCII, Unicode, or JIS encodings. The first 8 bytes specify the encoding type (`ASCII\0\0\0`, `UNICODE\0`, or `JIS\0\0\0`). This prefix is dropped, and the remainder is decoded accordingly.
- `ImageDescription` is ASCII only; multi-byte text should be stored in `UserComment`.
- XP* tags are stored as UCS-2/UTF-16LE. Some libraries expose these as arrays of 16-bit numbers; these must be reassembled and decoded as UTF-16LE.

### XMP

- Supports standard XMP and Extended XMP across multiple APP1 segments.
- Extended XMP chunks are reassembled by GUID with total and offset bookkeeping before decoding into one XML string.

### JPEG Comment

- The JPEG Comment segment has no defined encoding.
- Decoding is best-effort and treated as low priority.

### Encoding

- The `UserComment` prefix guides decoding attempts:
  - `ASCII` prefix → ASCII decoding.
  - `UNICODE` prefix → UTF-16LE or UTF-16BE decoding.
  - `JIS` prefix → Shift_JIS decoding.
- XP* tags are decoded as UTF-16LE.
- Best-effort decoding is applied for JPEG Comments.

## WebP

WebP images store metadata in RIFF chunks.

### Chunk Walk

- Verifies the presence of `RIFF` + `WEBP` headers.
- Iterates through chunks to locate metadata.

### EXIF

- Reads the `EXIF` chunk payload.
- The payload starts directly at the TIFF header (e.g., `II*` or `MM*`) without the `Exif\x00\x00` prefix.
- When using a JPEG-style EXIF parser, the `Exif\x00\x00` prefix must be prepended.
- Extracts `UserComment`, `ImageDescription`, and XP* tags using the same decoding heuristics as JPEG.

### XMP

- Reads the `XMP ` chunk.
- Robustly decodes XML/text (see Encoding Heuristics).
- Treats XMP data similarly to JPEG XMP.

### Priority

- EXIF-derived texts have the highest priority.
- Followed by XMP attribute values.
- Then XMP full text.
- Finally, fallback recovery scans are applied.

### Encoding

- Same encoding heuristics as JPEG for EXIF and XMP.

## XMP Handling

XMP metadata is extracted and interpreted with the following considerations:

- A1111 and Forge do not use XMP by default; PNG tEXt and EXIF are primary sources. Some tools do use XMP, and those cases are supported.
- Attribute Extraction:
  - Extract attribute values for keys such as `sd-metadata`, `sd_metadata`, `parameters`, and `Parameters` from the XML.
  - HTML-unescape entities like `&quot;`, `&amp;`, etc.
- Text Extraction:
  - If no attribute value is present, the entire XML content is considered as a candidate text source.

## A1111 Block Extraction

A1111-style metadata blocks are identified and extracted as follows:

- Look for the marker `Negative prompt:` followed by a settings line starting with known keys such as `Steps:`, `Sampler:`, `CFG scale:`, `Seed:`, `Size:`, or `Model:`.
- Extract the original substring from the beginning (prompt) through the first settings line, preserving whitespace and newlines.
- Score candidates based on marker presence and reasonable length.
- Select the best-scoring block.

## JSON Conversion

Some tools or forks embed JSON metadata similar to `sd-metadata` or `sd_metadata` (not the default for A1111/Forge). When detected:

- Convert JSON to an A1111-style text block:
  - Line 1: `prompt`
  - Line 2: `Negative prompt: <negativePrompt>` (empty allowed)
  - Subsequent lines: append `Steps`, `Sampler`, `CFG scale`, `Seed`, `Size` (`width x height`), and `Model` when present.

## ComfyUI Extraction

ComfyUI embeds metadata differently and requires special handling:

- Saves JSON strings into PNG metadata under the key `prompt` (always) and additional keys from `extra_pnginfo` (commonly `workflow`), all as JSON strings.
- Searches for graphs in any `*_json` values resembling ComfyUI prompt or workflow structures.
- Picks a sampler node (`KSampler*`) and reads inputs such as `seed`, `steps`, `cfg` (mapped to `cfg_scale`), `sampler_name`, `scheduler`, and `denoise`.
- Resolves positive and negative prompts from connected CLIP encode nodes (`text`, `text_g`, `text_l`).
- Sets `fields.generator` to `"ComfyUI"` and attaches extracted fields.

## Forge Specifics

Forge uses a saving format similar to A1111 but adds optional stealth features:

- Saves PNG metadata under the `parameters` key and JPEG EXIF under `UserComment` (same as A1111).
- Adds optional “Stealth PNGinfo” embedding:
  - Embeds the `parameters` text into PNG alpha or RGB least significant bits (LSB), optionally gzip-compressed.
  - Implementation reference: `modules/stealth_infotext.py` (`add_stealth_pnginfo` and `read_info_from_image_stealth`).
- No XMP writing is performed in the default Forge implementation.

## Encoding Heuristics

Decoding metadata requires heuristics to handle various encodings:

- **UserComment Prefix**: The first 8 bytes indicate encoding (`ASCII`, `UNICODE`, `JIS`), guiding initial decoding attempts:
  - `UNICODE` suggests UTF-16LE or UTF-16BE.
  - `JIS` suggests MS932 (a Microsoft variant of Shift_JIS), so attempt MS932 decoding first, falling back to generic Shift_JIS if needed.
- **UTF-16 Likelihood**: Counts of NUL bytes in even or odd positions help decide between UTF-16LE and UTF-16BE.
- **XMP Decoding**:
  - Honor Byte Order Marks (BOMs) for UTF-8 and UTF-16.
  - Without BOM, choose between `utf-16le` and `utf-16be` based on zero distribution.
  - Fall back to best-of decoding and consider XML `encoding="..."` attributes.
- **Best-Of Decoder**:
  - Attempts multiple encodings: `utf-8`, `utf-16le`, `utf-16be`, `shift_jis`, and `latin1`.
  - Selects the best decoding based on Stable Diffusion markers, ASCII ratio, control-character penalties, and plausible Unicode punctuation.

## Recovery Heuristics

When standard extraction fails, recovery heuristics attempt to locate metadata:

- **Targeted UTF-16 Scan**:
  - Searches file bytes for UTF-16LE/BE encoded `Negative prompt:` strings.
  - Decodes a window around the match and extracts an A1111 block.
- **Whole-File Scan**:
  - Decodes the entire file as UTF-16LE, UTF-16BE, or Shift_JIS.
  - Extracts the best A1111 block if direct extraction appears garbled.
- **Meta JSON Scan**:
  - Decodes the entire file as UTF-8.
  - Searches for JSON containing `sd-metadata` or `sd_metadata` or nearby `Negative prompt:` blocks.
  - Converts compatible JSON to an A1111-style text block when possible.

## Selection Strategy

The extraction process prioritizes sources to obtain a coherent and self-contained metadata block:

- Preference order:
  1. Exact, self-contained blocks from structured sources (EXIF `UserComment`, XP*, `ImageDescription`).
  2. Attribute values in XMP.
  3. Inline XMP XML text.
  4. JPEG Comment.
  5. Recovery scans (UTF-16 window, whole-file UTF-16/Shift_JIS, JSON scan).
- The original text is returned without cleanup.
- Normalization into structured `fields` is performed separately for UI presentation.

## Field Normalization

Normalization organizes extracted data into a consistent structure:

- From `parameters` text:
  - Sets `parameters_raw` and `prompt`.
  - Parses trailing `Key: Value` lines into the `fields` dictionary.
- From JSON:
  - Parses any value resembling JSON into `key_json`.
  - If ComfyUI graphs are detected, extracts sampler, seed, steps, and prompts.
- The final object has the form:
  ```json
  {
    "format": "png" | "jpeg" | "webp" | "unknown",
    "fields": Record<string, unknown>,
    "raw": Record<string, string>
  }
  ```

## Implementation Notes

- WebP EXIF chunks often omit the `Exif\x00\x00` header; prepend it when using a JPEG-style EXIF parser.
- XP* tags may be exposed as arrays of numbers representing UTF-16LE; convert these to bytes and decode accordingly.
- Extended XMP requires reassembly by GUID with `total` and `offset` bookkeeping before UTF decoding.
- Do not mix sources: extract a single coherent A1111 block from one source rather than concatenating across multiple sources.

## References

- **AUTOMATIC1111**
  - Saves PNG parameters via `PIL.PngImagePlugin.PngInfo` under the key `parameters`.
  - For JPEG, inserts EXIF `UserComment` (Unicode) with the same text.
  - See `modules/images.py` functions `save_image_with_geninfo` and `save_image`.
- **ComfyUI**
  - Saves PNG metadata using `PngInfo`.
  - Adds `prompt` as a JSON string and additional `extra_pnginfo` entries (often including `workflow`) as JSON.
  - See `nodes.py` `SaveImage.save_images`, where `metadata.add_text("prompt", json.dumps(prompt))` and `metadata.add_text(x, json.dumps(extra_pnginfo[x]))` are called.
- **Forge (Stable Diffusion WebUI Forge)**
  - Uses PNG `parameters` and JPEG EXIF `UserComment` similarly to A1111.
  - Adds “Stealth PNGinfo” embedding option.
  - See `modules/stealth_infotext.py`.
