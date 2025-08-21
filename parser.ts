import { unzipSync, strFromU8 } from "fflate";
export type ImageMeta = {
    format: "png" | "jpeg" | "webp" | "unknown";
    fields: Record<string, unknown>;
    raw: Record<string, string>;
};
export async function parseImageMeta(buf: ArrayBuffer, ext: string): Promise<ImageMeta> {
    const u8 = new Uint8Array(buf);
    const lower = ext.toLowerCase();
    if (lower === "png") return parsePng(u8);
    if (lower === "jpg" || lower === "jpeg") return parseJpeg(u8);
    if (lower === "webp") return parseWebp(u8);
    return { format: "unknown", fields: {}, raw: {} };
}
// ---- PNG ----
function parsePng(u8: Uint8Array): ImageMeta {
    const pngSig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (u8[i] !== pngSig[i]) return { format: "png", fields: {}, raw: {} };
    let off = 8;
    const raw: Record<string, string> = {};
    while (off + 8 <= u8.length) {
        const len = readU32(u8, off); off += 4;
        const type = strFromU8(u8.subarray(off, off + 4)); off += 4;
        const data = u8.subarray(off, off + len); off += len;
        off += 4; // skip CRC
        if (type === "tEXt") {
            const { key, text } = parse_tEXt(data);
            if (key) raw[key] = text;
        } else if (type === "iTXt") {
            const { key, text } = parse_iTXt(data);
            if (key) raw[key] = text;
        } else if (type === "zTXt") {
            const { key, text } = parse_zTXt(data);
            if (key) raw[key] = text;
        }
        if (type === "IEND") break;
    }
    const fields = normalizeKnownFields(raw);
    return { format: "png", fields, raw };
}
function readU32(u8: Uint8Array, o: number) {
    return (u8[o] << 24 | u8[o + 1] << 16 | u8[o + 2] << 8 | u8[o + 3]) >>> 0;
}
function parse_tEXt(data: Uint8Array) {
    const zero = data.indexOf(0);
    if (zero < 0) return {
        key: ""
        , text: ""
    };
    const key = strFromU8(data.subarray(0, zero));
    const text = strFromU8(data.subarray(zero + 1));
    return { key, text };
}
function parse_zTXt(data: Uint8Array) {
    const zero = data.indexOf(0);
    if (zero < 0) return {
        key: ""
        , text: ""
    };
    const key = strFromU8(data.subarray(0, zero));
    const method = data[zero + 1];
    if (method !== 0) return { key, text: "" };
    try {
        const inflated = unzipSync({
            _
                : data.subarray(zero + 2)
        })._;
        const text = strFromU8(inflated);
        return { key, text };
    } catch { return { key, text: "" }; }
}
function parse_iTXt(data: Uint8Array) {
    let p = 0;
    function readz(): Uint8Array {
        const z = data.indexOf(0, p); const out = data.subarray(p, z); p = z + 1;
        return out;
    }
    const key = strFromU8(readz());
    const compFlag = data[p++];
    const compMethod = data[p++];
/* language */ readz();
/* translated */ readz();
    const rest = data.subarray(p);
    try {
        const text = compFlag ? strFromU8(unzipSync({
            _
                : rest
        })._) : strFromU8(rest);
        return { key, text };
    } catch { return { key, text: "" }; }

}
// Normalize common generator metadata (e.g., Stable Diffusion) from text chunks
function normalizeKnownFields(raw: Record<string, string>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    // AUTOMATIC1111-style: key = "parameters"
    //   - line 1: prompt
    //   - subsequent lines: key: value
    if (raw["parameters"]) {
        const txt = raw["parameters"]; out["parameters_raw"] = txt;
        const lines = txt.split(/\r?\n/);
        if (lines.length) out["prompt"] = lines[0];
        for (const ln of lines.slice(1)) {
            const m = ln.match(/^([^:]+):\s*(.*)$/);
            if (m) out[m[1].trim()] = m[2].trim();
        }
        // NovelAI/ComfyUI, etc.: key = "prompt" or JSON blob
        for (const k of ["prompt", "negative_prompt", "Prompt", "Negative prompt"]) {
            if (raw[k]) out[k.replace(/\s+/g, "_")] = raw[k];
        }
    }
    // If a value looks like JSON (e.g., ComfyUI workflow), try to parse
    for (const [k, v] of Object.entries(raw)) {
        const t = v.trim();
        if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
            try { out[k + "_json"] = JSON.parse(t); } catch { }
        }
    }
    return out;
}
// ---- JPEG ---- (EXIF UserComment/XPComment may include generation info)
function parseJpeg(_u8: Uint8Array): ImageMeta {
    // Minimal implementation: EXIF parsing to be added later.
    return { format: "jpeg", fields: {}, raw: {} };
}
// ---- WEBP ---- (may carry XMP/EXIF; minimal for now)
function parseWebp(_u8: Uint8Array): ImageMeta {
    return { format: "webp", fields: {}, raw: {} };
}
