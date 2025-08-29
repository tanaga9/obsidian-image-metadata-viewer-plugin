import { unzipSync, strFromU8, inflateSync } from "fflate";
/**
 * Lightweight image metadata parsing for PNG/JPEG/WEBP.
 *
 * Goals:
 * - Keep parsing in-process with no I/O or network calls.
 * - Be permissive and robust: handle EXIF/XMP variants and odd encodings.
 * - Preserve original text (prompts/Negative prompt/settings) without "cleanups".
 * - Normalize common AI parameters (A1111/ComfyUI) into fields for the UI.
 */
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
    const key = latin1FromU8(data.subarray(0, zero));
    const text = latin1FromU8(data.subarray(zero + 1));
    return { key, text };
}
function parse_zTXt(data: Uint8Array) {
    const zero = data.indexOf(0);
    if (zero < 0) return {
        key: ""
        , text: ""
    };
    const key = latin1FromU8(data.subarray(0, zero));
    const method = data[zero + 1];
    if (method !== 0) return { key, text: "" };
    try {
        const inflated = inflateSync(data.subarray(zero + 2));
        // zTXt text is Latin-1 after decompression
        const text = latin1FromU8(inflated);
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
        const text = compFlag ? strFromU8(inflateSync(rest)) : strFromU8(rest);
        return { key, text };
    } catch { return { key, text: "" }; }

}
// PNG tEXt/zTXt are Latin-1 per spec; iTXt is UTF-8.
function latin1FromU8(u: Uint8Array): string {
    let s = "";
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return s;
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

    // ComfyUI support: extract common fields from prompt/workflow JSON
    try {
        const comfy = extractComfy(out);
        if (comfy) Object.assign(out, comfy);
    } catch { /* ignore */ }
    return out;
}

// ---- Common markers (A1111) ----
const NEGATIVE_PROMPT_LABEL = "Negative prompt:";
const NEGATIVE_PROMPT_RE = /(^|[\r\n])[\t ]*Negative prompt:/i;
const SETTINGS_STEPS_RE = /^[\t ]*Steps:[^\n]*/mi;
const SETTINGS_ANY_RE = /^[\t ]*(Sampler:|CFG scale:|Seed:|Size:|Model:|Schedule type:|Denoising strength:|Hires steps:)[^\n]*/mi;
const HAS_STEPS_RE = /(^|[\r\n])[\t ]*Steps:/i;
const HAS_SAMPLER_RE = /(^|[\r\n])[\t ]*Sampler:/i;
const HAS_CFG_RE = /(^|[\r\n])[\t ]*CFG scale:/i;
const HAS_SEED_RE = /(^|[\r\n])[\t ]*Seed:/i;
const HAS_SIZE_RE = /(^|[\r\n])[\t ]*Size:/i;

// Try to extract ComfyUI prompt/workflow info into top-level fields
function extractComfy(parsed: Record<string, unknown>): Record<string, unknown> | null {
    // Gather candidate graphs that look like ComfyUI prompt graphs
    const candidates: any[] = [];
    const pushIfGraph = (g: any) => {
        if (!g || typeof g !== "object") return;
        // Heuristic: object whose values are nodes with class_type
        const vals = Object.values(g as Record<string, any>);
        if (vals.some((n: any) => n && typeof n === "object" && typeof n.class_type === "string")) {
            candidates.push(g);
        }
    };

    if (parsed["prompt_json"]) pushIfGraph(parsed["prompt_json"]);
    if (parsed["workflow_json"]) {
        // workflow_json is usually UI layout; sometimes includes nodes
        const wf = parsed["workflow_json"] as any;
        if (wf && typeof wf === "object" && Array.isArray((wf as any).nodes)) {
            // Convert workflow.nodes list back to an id->node map if possible
            const map: Record<string, any> = {};
            for (const n of (wf as any).nodes) {
                if (n && (n.id !== undefined)) map[String(n.id)] = n;
            }
            pushIfGraph(map);
        }
    }
    // Also scan any *_json that embeds a prompt/workflow inside
    for (const [k, v] of Object.entries(parsed)) {
        if (!k.endsWith("_json")) continue;
        const obj = v as any;
        if (obj && typeof obj === "object") {
            if (obj.prompt) pushIfGraph(obj.prompt);
            if (obj.workflow) pushIfGraph(obj.workflow);
        }
    }

    for (const g of candidates) {
        const extracted = extractFromComfyPromptGraph(g);
        if (extracted) return extracted;
    }
    return null;
}

function extractFromComfyPromptGraph(graph: Record<string, any>): Record<string, unknown> | null {
    const nodes = graph as Record<string, any>;
    const ids = Object.keys(nodes);
    if (!ids.length) return null;
    const findNode = (pred: (n: any) => boolean) => ids.map((id) => nodes[id]).find(pred);

    // Find sampler node (KSampler/KSamplerAdvanced)
    const samplerNode = findNode((n) => typeof n?.class_type === "string" && n.class_type.startsWith("KSampler"));
    if (!samplerNode) return null;

    const out: Record<string, unknown> = { generator: "ComfyUI" };
    const inputs = samplerNode.inputs || {};

    // Copy common fields when present
    if (inputs.seed !== undefined) out["seed"] = inputs.seed;
    if (inputs.steps !== undefined) out["steps"] = inputs.steps;
    if (inputs.cfg !== undefined) out["cfg_scale"] = inputs.cfg;
    if (inputs.sampler_name !== undefined) out["sampler"] = inputs.sampler_name;
    if (inputs.scheduler !== undefined) out["scheduler"] = inputs.scheduler;
    if (inputs.denoise !== undefined) out["denoise"] = inputs.denoise;

    // Resolve text from CLIP encode nodes connected to positive/negative
    const resolveText = (conn: any): string | undefined => {
        if (!conn) return undefined;
        // Connection usually like [nodeId, "output_name"], accept number/string
        const srcId = Array.isArray(conn) ? conn[0] : conn;
        const node = nodes[String(srcId)];
        if (!node) return undefined;
        const inp = node.inputs || {};
        if (typeof inp.text === "string") return inp.text;
        const parts: string[] = [];
        if (typeof inp.text_g === "string") parts.push(inp.text_g);
        if (typeof inp.text_l === "string") parts.push(inp.text_l);
        return parts.length ? parts.join(" ") : undefined;
    };

    const pos = resolveText(inputs.positive);
    const neg = resolveText(inputs.negative);
    if (pos) out["prompt"] = pos;
    if (neg) out["negative_prompt"] = neg;

    return out;
}
// ---- JPEG ---- (EXIF/XMP/Comment may include generation info)
function parseJpeg(u8: Uint8Array): ImageMeta {
    const raw: Record<string, string> = {};
    // Check SOI
    if (u8.length < 2 || u8[0] !== 0xff || u8[1] !== 0xd8) {
        return { format: "jpeg", fields: {}, raw };
    }
    let off = 2;
    let exifBytes: Uint8Array | null = null;
    let jpegComment: string | null = null;
    // XMP (standard + extended) accumulators
    const XMP_STD = strToU8("http://ns.adobe.com/xap/1.0\x00");
    const XMP_EXT = strToU8("http://ns.adobe.com/xmp/extension/\x00");
    const xmpMain: string[] = [];
    const xmpExt: Record<string, { total: number; chunks: Record<number, Uint8Array> }> = {};

    // Iterate segments until SOS (0xDA) or EOI (0xD9)
    while (off + 4 <= u8.length) {
        if (u8[off] !== 0xff) { off++; continue; }
        // Skip fill bytes 0xFF ...
        while (off < u8.length && u8[off] === 0xff) off++;
        if (off >= u8.length) break;
        const marker = u8[off++];
        if (marker === 0xd9 /* EOI */) break;
        if (marker === 0xda /* SOS */) break; // image data follows
        if (marker >= 0xd0 && marker <= 0xd7) continue; // RST markers, no length
        if (off + 2 > u8.length) break;
        const seglen = ((u8[off] << 8) | u8[off + 1]) >>> 0; off += 2;
        if (seglen < 2 || off + seglen - 2 > u8.length) break;
        const seg = u8.subarray(off, off + seglen - 2); off += seglen - 2;

        if (marker === 0xe1 /* APP1 */) {
            // EXIF
            if (startsWith(seg, strToU8("Exif\x00\x00"))) {
                exifBytes = seg;
            } else if (startsWith(seg, XMP_STD)) {
                const xmlBytes = seg.subarray(XMP_STD.length);
                try { xmpMain.push(strFromU8(xmlBytes)); } catch { /* ignore */ }
            } else if (startsWith(seg, XMP_EXT)) {
                const rest = seg.subarray(XMP_EXT.length);
                if (rest.length >= 40) {
                    const guid = safeAscii(rest.subarray(0, 32));
                    const total = readU32BE(rest, 32);
                    const offset = readU32BE(rest, 36);
                    const payload = rest.subarray(40);
                    const d = xmpExt[guid] ?? { total, chunks: {} };
                    d.total = total;
                    d.chunks[offset] = payload;
                    xmpExt[guid] = d;
                }
            }
        } else if (marker === 0xfe /* COM */) {
            // JPEG comment segment
            const txt = tryDecodeUTF8(seg);
            if (txt) jpegComment = txt;
        }
    }

    // Parse EXIF UserComment/ImageDescription/XP* (collect all present)
    const exifTexts: string[] = [];
    if (exifBytes) {
        try {
            const multi = extractExifTextsFromBytes(exifBytes);
            if (multi.user) exifTexts.push(multi.user);
            if (multi.xp) exifTexts.push(multi.xp);
            if (multi.desc) exifTexts.push(multi.desc);
        } catch { /* ignore */ }
    }

    // Reconstruct XMP (standard + extended)
    let xmpXml: string | null = null;
    if (xmpMain.length || Object.keys(xmpExt).length) {
        let extXml = "";
        for (const guid of Object.keys(xmpExt)) {
            const info = xmpExt[guid];
            const offsets = Object.keys(info.chunks).map((k) => parseInt(k, 10)).sort((a, b) => a - b);
            let bufLen = 0; for (const o of offsets) bufLen += info.chunks[o].length;
            const buf = new Uint8Array(bufLen);
            let p = 0; for (const o of offsets) { buf.set(info.chunks[o], p); p += info.chunks[o].length; }
            const total = Math.min(info.total, buf.length);
            try { extXml += strFromU8(buf.subarray(0, total)); } catch { /* ignore */ }
        }
        xmpXml = xmpMain.join("") + extXml;
    }

    // Preferred extraction order: precise A1111 block from EXIF → XMP attrs → XMP text → JPEG comment
    const tryTexts: string[] = [];
    for (const t of exifTexts) tryTexts.push(t);
    if (xmpXml) {
        const attrs = extractFromXmpAttributes(xmpXml);
        tryTexts.push(...attrs);
        tryTexts.push(xmpXml);
    }
    if (jpegComment) tryTexts.push(jpegComment);

    const selected = selectBestParametersFromTexts(tryTexts);
    if (selected) raw["parameters"] = selected;
    if (!raw["parameters"]) {
        const rec = recoverParameters(u8, null);
        if (rec) raw["parameters"] = rec;
    } else if (looksGarbled(raw["parameters"])) {
        const rec = recoverParameters(u8, raw["parameters"]);
        if (rec) raw["parameters"] = rec;
    }

    // Keep raw reference texts for visibility/troubleshooting
    if (exifTexts.length) raw["EXIF"] = exifTexts.join("\n");
    if (xmpXml) raw["XMP"] = xmpXml;
    if (jpegComment) raw["Comment"] = jpegComment;

    // If text looks garbled, attempt a targeted UTF-16 scan as a last fix
    if (raw["parameters"] && looksGarbled(raw["parameters"])) {
        const recovered = scanFileForSdText(u8);
        if (recovered) raw["parameters"] = recovered;
        else {
            const whole = scanWholeFileForUtf16A1111(u8) ?? scanWholeFileForSjisA1111(u8);
            if (whole) raw["parameters"] = whole;
        }
    }

    const fields = normalizeKnownFields(raw);
    return { format: "jpeg", fields, raw };
}
// ---- WEBP ---- (RIFF container; may carry XMP/EXIF)
function parseWebp(u8: Uint8Array): ImageMeta {
    const raw: Record<string, string> = {};
    // RIFF header: 'RIFF' <size LE> 'WEBP'
    if (u8.length < 12 || u8[0] !== 0x52 || u8[1] !== 0x49 || u8[2] !== 0x46 || u8[3] !== 0x46 ||
        u8[8] !== 0x57 || u8[9] !== 0x45 || u8[10] !== 0x42 || u8[11] !== 0x50) {
        return { format: "webp", fields: {}, raw };
    }

    const u32le = (o: number) => (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
    let off = 12;
    let exifChunk: Uint8Array | null = null;
    let xmpXml: string | null = null;
    while (off + 8 <= u8.length) {
        const tag0 = u8[off], tag1 = u8[off + 1], tag2 = u8[off + 2], tag3 = u8[off + 3];
        const size = u32le(off + 4);
        off += 8;
        if (off + size > u8.length) break;
        const data = u8.subarray(off, off + size);
        // 4CC tags of interest: 'EXIF', 'XMP '
        const tag = String.fromCharCode(tag0, tag1, tag2, tag3);
        if (tag === "EXIF") {
            exifChunk = data;
        } else if (tag === "XMP ") {
            try { xmpXml = decodeXmpChunk(data); } catch { /* ignore */ }
        }
        // Chunks are even-padded
        off += size + (size & 1);
    }

    // Parse EXIF: WebP EXIF payload typically starts at TIFF header, without 'Exif\0\0'.
    const exifTexts: string[] = [];
    if (exifChunk && exifChunk.length >= 8) {
        let payload = exifChunk;
        const exifHeader = strToU8("Exif\x00\x00");
        // If missing header, prepend so our JPEG EXIF reader can parse it.
        if (!startsWith(payload, exifHeader)) {
            const buf = new Uint8Array(exifHeader.length + payload.length);
            buf.set(exifHeader, 0); buf.set(payload, exifHeader.length);
            payload = buf;
        }
        try {
            const multi = extractExifTextsFromBytes(payload);
            if (multi) {
                if (multi.user) exifTexts.push(multi.user);
                if (multi.xp) exifTexts.push(multi.xp);
                if (multi.desc) exifTexts.push(multi.desc);
            }
        } catch { /* ignore */ }
    }

    // Try to extract A1111/Forge text from available sources
    const tryTexts: string[] = [];
    for (const t of exifTexts) tryTexts.push(t);
    if (xmpXml) {
        const attrs = extractFromXmpAttributes(xmpXml);
        tryTexts.push(...attrs);
        tryTexts.push(xmpXml);
    }

    const chosen = selectBestParametersFromTexts(tryTexts);
    if (chosen) raw["parameters"] = chosen;
    if (!raw["parameters"]) {
        const rec2 = recoverParameters(u8, null);
        if (rec2) raw["parameters"] = rec2;
    } else if (looksGarbled(raw["parameters"])) {
        const rec2 = recoverParameters(u8, raw["parameters"]);
        if (rec2) raw["parameters"] = rec2;
    }

    // Keep raw references
    if (exifTexts.length) raw["EXIF"] = exifTexts.join("\n");
    if (xmpXml) raw["XMP"] = xmpXml;

    // parameters may have been recovered already via unified pipeline

    const fields = normalizeKnownFields(raw);
    return { format: "webp", fields, raw };
}

// Best-effort decode for XML/text that may be UTF-8 or UTF-16 (LE/BE) with/without BOM
function decodeXmpChunk(data: Uint8Array): string {
    if (data.length >= 2) {
        const b0 = data[0], b1 = data[1];
        // UTF-8 BOM
        if (data.length >= 3 && b0 === 0xef && b1 === 0xbb && data[2] === 0xbf) {
            try { return strFromU8(data.subarray(3)); } catch { /* fallthrough */ }
        }
        // UTF-16 BOMs
        if (b0 === 0xfe && b1 === 0xff) {
            try { return new TextDecoder("utf-16be").decode(data.subarray(2)); } catch { /* ignore */ }
        }
        if (b0 === 0xff && b1 === 0xfe) {
            try { return new TextDecoder("utf-16le").decode(data.subarray(2)); } catch { /* ignore */ }
        }
    }
    // Heuristic: if many zeros, treat as UTF-16 and guess endianness
    const zeros = countByte(data, 0x00);
    if (zeros / Math.max(1, data.length) > 0.2) {
        // Determine whether low or high bytes are zeros more often
        let zeroEven = 0, zeroOdd = 0;
        for (let i = 0; i < data.length; i++) ((i & 1) === 0 ? (data[i] === 0 && (zeroEven++)) : (data[i] === 0 && (zeroOdd++)));
        const preferLE = zeroOdd >= zeroEven; // in UTF-16LE, odd bytes tend to be zeros for ASCII
        try {
            return new TextDecoder(preferLE ? "utf-16le" : "utf-16be").decode(data);
        } catch { /* ignore */ }
    }
    // Last: guess best encoding, but check XML encoding attr if present
    try {
        // Try best-of first (may already succeed without knowing encoding attr)
        let best = decodeBest(data);
        const probe = best ?? new TextDecoder("utf-8").decode(data);
        const m = probe.match(/encoding=[\"']([A-Za-z0-9_\-]+)[\"']/i);
        if (m) {
            const enc = m[1].toLowerCase();
            const byAttr = decodeByXmlEncoding(data, enc) ?? best;
            return byAttr ?? probe;
        }
        return best ?? probe;
    } catch { return ""; }
}
function decodeByXmlEncoding(data: Uint8Array, encAttr: string): string | null {
    try {
        const enc = encAttr.toLowerCase();
        if (enc === "utf-8") return new TextDecoder("utf-8").decode(data);
        if (enc === "utf-16" || enc === "utf-16le") return new TextDecoder("utf-16le").decode(data);
        if (enc === "utf-16be") return new TextDecoder("utf-16be").decode(data);
        if (enc === "shift_jis" || enc === "windows-31j" || enc === "sjis") return decodeShiftJIS(data);
        return null;
    } catch { return null; }
}

// ---- Helpers shared by JPEG parsing ----
function strToU8(s: string): Uint8Array {
    const enc = new TextEncoder();
    return enc.encode(s);
}
function startsWith(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length < b.length) return false;
    for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
function readU32BE(a: Uint8Array, o: number): number { return ((a[o] << 24) | (a[o + 1] << 16) | (a[o + 2] << 8) | a[o + 3]) >>> 0; }
function tryDecodeUTF8(u: Uint8Array): string | null {
    // Use best-of heuristic across common encodings
    return decodeBest(u);
}
function decodeShiftJIS(u: Uint8Array): string | null {
    try { return new TextDecoder("shift_jis" as any).decode(u); } catch { return null; }
}
function safeAscii(u: Uint8Array): string {
    let s = ""; for (let i = 0; i < u.length; i++) { const c = u[i]; if (c < 32 || c > 126) s += "?"; else s += String.fromCharCode(c); }
    return s;
}

// Decode EXIF UserComment bytes or XP* arrays to string
function decodeExifUserComment(raw: Uint8Array | string | number[] | undefined | null): string | null {
    if (raw == null) return null;
    try {
        if (raw instanceof Uint8Array) {
            const prefix = raw.subarray(0, Math.min(8, raw.length));
            const hasEnc = startsWith(prefix, strToU8("ASCII")) || startsWith(prefix, strToU8("UNICODE")) || startsWith(prefix, strToU8("JIS"));
            const data = hasEnc ? raw.subarray(8) : raw;
            // Try multiple decodings and score them
            const candidates: string[] = [];
            // If UNICODE marker, restrict primarily to UTF-16 variants
            const isUnicode = startsWith(prefix, strToU8("UNICODE"));
            const isJis = startsWith(prefix, strToU8("JIS"));
            if (isJis) {
                const sj = decodeBytes(data, "shift_jis"); if (sj) candidates.push(sj);
            }
            if (isUnicode) {
                const le = decodeBytes(data, "utf-16le"); if (le) candidates.push(le);
                const be = decodeBytes(data, "utf-16be"); if (be) candidates.push(be);
            }
            // Generic fallbacks with heuristic ordering by UTF-16 likelihood
            const total = data.length;
            let zeroTotal = 0, zeroEven = 0, zeroOdd = 0;
            for (let i = 0; i < total; i++) {
                if (data[i] === 0) { zeroTotal++; if ((i & 1) === 0) zeroEven++; else zeroOdd++; }
            }
            const utf16Likely = (zeroTotal / Math.max(1, total)) > 0.2;
            const preferLE = utf16Likely ? (zeroOdd >= zeroEven) : false;
            const tryEnc: string[] = [];
            if (!isUnicode && utf16Likely) {
                if (preferLE) { tryEnc.push("utf-16le", "utf-16"); } else { tryEnc.push("utf-16be", "utf-16"); }
                tryEnc.push("utf-8");
            } else {
                tryEnc.push("utf-8", "utf-16le", "utf-16");
            }
            for (const enc of tryEnc) { const s = decodeBytes(data, enc as any); if (s) candidates.push(s); }
            // Also try Shift_JIS when not marked unicode
            if (!isUnicode) { const sj = decodeBytes(data, "shift_jis"); if (sj) candidates.push(sj); }
            // Score: prefer valid SD markers + plausible decoded script (CJK/Kana), penalize �
            let best: string | null = null; let bestScore = -1;
            for (let s of candidates) {
                // Strip NULs
                s = s.replace(/\u0000+/g, ""); if (!s) continue;
                const score = scoreSdTextCandidate(s) + 0.5 * scoreDecodedString(s);
                if (score > bestScore) { bestScore = score; best = s; }
            }
            if (best) return best;
            // Last resort: Latin-1 only if nothing else yielded text
            const s = decodeBytes(data, "latin1" as any);
            return s ? s.replace(/\u0000/g, "") : null;
        } else if (typeof raw === "string") {
            return raw.replace(/\u0000/g, "");
        } else if (Array.isArray(raw)) {
            // XP* often exposed as array of numbers (UTF-16LE)
            const b = new Uint8Array(raw);
            const s = decodeBytes(b, "utf-16le");
            return s ? s.replace(/\u0000+$/g, "") : null;
        }
    } catch { /* ignore */ }
    return null;
}
function scoreSdTextCandidate(s: string): number {
    let score = 0;
    if (NEGATIVE_PROMPT_RE.test(s)) score += 5;
    if (HAS_STEPS_RE.test(s)) score += 4;
    if (HAS_SAMPLER_RE.test(s)) score += 2;
    if (HAS_CFG_RE.test(s)) score += 2;
    if (HAS_SEED_RE.test(s)) score += 2;
    if (HAS_SIZE_RE.test(s)) score += 2;
    // ASCII ratio
    let ascii = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 32 && c <= 126) ascii++; }
    score += ascii / Math.max(1, s.length);
    // Penalize control characters (likely artifacts from wrong decoding), allow \n\r\t
    let controls = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 32 && c !== 9 && c !== 10 && c !== 13) controls++; }
    score -= controls * 5;
    // Prefer presence of Unicode punctuation like U+2019 over raw 0x19 remnants
    if (s.includes("\u2019")) score += 1;
    if (s.includes("\u0019")) score -= 3;
    return score;
}
type TextEncodingName = "utf-8" | "utf-16le" | "utf-16be" | "utf-16" | "latin1" | "shift_jis";
function decodeBytes(b: Uint8Array, enc: TextEncodingName): string | null {
    try {
        if (enc === "latin1") {
            let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
            return s;
        }
        if (enc === "shift_jis") {
            try { return new TextDecoder("shift_jis" as any).decode(b); } catch { return null; }
        }
        if (enc === "utf-16") {
            // Try LE then BE
            try { return new TextDecoder("utf-16le").decode(b); } catch { return new TextDecoder("utf-16be").decode(b); }
        }
        return new TextDecoder(enc as any).decode(b);
    } catch { return null; }
}

// Try multiple encodings and pick the one with the best score (fewest replacements, plausible script)
function decodeBest(data: Uint8Array, prefer?: TextEncodingName): string | null {
    const candidates: { enc: TextEncodingName; text: string | null; score: number }[] = [];
    const list: TextEncodingName[] = [];
    // Heuristic: if bytes look like Shift_JIS pairs, prefer it
    const sjisLikely = looksLikeShiftJis(data);
    if (prefer) list.push(prefer);
    if (sjisLikely && !list.includes("shift_jis")) list.unshift("shift_jis");
    for (const e of ["utf-8", "utf-16le", "utf-16be", "shift_jis", "latin1"]) {
        if (!list.includes(e as TextEncodingName)) list.push(e as TextEncodingName);
    }
    for (const enc of list) {
        const s = decodeBytes(data, enc as TextEncodingName);
        if (s == null) { candidates.push({ enc, text: null, score: -1 }); continue; }
        const score = scoreDecodedString(s);
        candidates.push({ enc, text: s, score });
    }
    candidates.sort((a,b) => b.score - a.score);
    return candidates[0]?.text ?? null;
}
function scoreDecodedString(s: string): number {
    if (!s) return -1;
    let score = 0;
    // Penalize replacement chars
    let repl = 0; for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0xFFFD) repl++;
    score -= repl * 100;
    // Count CJK and Kana
    let cjk = 0, kana = 0, ascii = 0, controls = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF)) cjk++;
        else if ((c >= 0x3040 && c <= 0x30FF) || (c >= 0x31F0 && c <= 0x31FF)) kana++;
        else if (c >= 32 && c <= 126) ascii++;
        else if (c < 32 && c !== 9 && c !== 10 && c !== 13) controls++;
    }
    score += cjk * 5 + kana * 4 + ascii * 0.3;
    score -= controls * 5;
    // Reward presence of common separators (, : ; ) in ascii for parameters text
    const sepCount = countChar(s, ",") + countChar(s, ":") + countChar(s, ";");
    score += sepCount * 0.5;
    return score;
}
function looksLikeShiftJis(b: Uint8Array): boolean {
    let pairs = 0, i = 0;
    while (i < b.length) {
        const x = b[i];
        if ((x >= 0x81 && x <= 0x9f) || (x >= 0xe0 && x <= 0xfc)) {
            const y = b[i + 1];
            if (y !== undefined && ((y >= 0x40 && y <= 0x7e) || (y >= 0x80 && y <= 0xfc))) { pairs++; i += 2; continue; }
        }
        i++;
    }
    const ratio = pairs / Math.max(1, Math.floor(b.length / 2));
    return ratio > 0.05; // heuristic threshold
}
function countByte(u: Uint8Array, v: number): number { let c = 0; for (let i = 0; i < u.length; i++) if (u[i] === v) c++; return c; }
function countChar(s: string, ch: string): number { let c = 0; for (let i = 0; i < s.length; i++) if (s[i] === ch) c++; return c; }
function maybeFixUtf16EndianMisdecode(s: string | null): string | null {
    if (!s) return s;
    try {
        let zeroLow = 0; for (let i = 0; i < s.length; i++) if ((s.charCodeAt(i) & 0xff) === 0) zeroLow++;
        const ratio = zeroLow / Math.max(1, s.length);
        if (ratio > 0.3) {
            // Reinterpret code units as if UTF-16BE bytes, then decode as UTF-16LE
            const bytes = new Uint8Array(s.length * 2);
            for (let i = 0; i < s.length; i++) {
                const code = s.charCodeAt(i);
                bytes[i * 2] = (code >> 8) & 0xff;      // high byte
                bytes[i * 2 + 1] = code & 0xff;         // low byte
            }
            try { return new TextDecoder("utf-16le").decode(bytes); } catch { return s; }
        }
    } catch { /* ignore */ }
    return s;
}

// Extract textish fields from EXIF bytes (APP1) → select UserComment/XPComment/ImageDescription
function extractExifTextsFromBytes(exif: Uint8Array): { user?: string | null; xp?: string | null; desc?: string | null } {
    if (!startsWith(exif, strToU8("Exif\x00\x00"))) return null;
    const data = exif; const base = 6;
    if (data.length < base + 8) return null;
    const endian = String.fromCharCode(data[base], data[base + 1]);
    const isLE = endian === "II";
    const u16 = (o: number) => isLE ? (data[o] | (data[o + 1] << 8)) : ((data[o] << 8) | data[o + 1]);
    const u32 = (o: number) => isLE ? (data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24)) >>> 0
        : ((data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3]) >>> 0;
    const magic = u16(base + 2);
    if (magic !== 42) return null;
    const ifd0 = base + u32(base + 4);

    function readIFD(off: number): { tags: Record<number, [number, number, Uint8Array]>; next: number } {
        const tags: Record<number, [number, number, Uint8Array]> = {};
        if (off <= 0 || off + 2 > data.length) return { tags, next: 0 };
        const count = u16(off);
        let p = off + 2;
        for (let i = 0; i < count; i++) {
            const e = p + i * 12; if (e + 12 > data.length) break;
            const tag = u16(e);
            const typ = u16(e + 2);
            const cnt = u32(e + 4);
            const valraw = data.subarray(e + 8, e + 12);
            const typeSize = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 } as any)[typ] ?? 1;
            const total = typeSize * cnt;
            let value: Uint8Array;
            if (total <= 4) value = valraw.subarray(0, total);
            else {
                const offv = u32(e + 8);
                const abs = base + offv;
                if (abs + total > data.length) continue;
                value = data.subarray(abs, abs + total);
            }
            tags[tag] = [typ, cnt, value];
        }
        const next = (off + 2 + count * 12 + 4 <= data.length) ? u32(off + 2 + count * 12) : 0;
        return { tags, next };
    }

    const { tags: tags0 } = readIFD(ifd0);
    // ImageDescription 0x010E
    let desc: string | null = null;
    if (tags0[0x010e]) {
        const vb = tags0[0x010e][2];
        let v = vb;
        // trim trailing NULs
        while (v.length && v[v.length - 1] === 0) v = v.subarray(0, v.length - 1);
        // Heuristic: UTF-16 if many NULs or BOM
        const utf16 = (v.length >= 2 && ((v[0] === 0xff && v[1] === 0xfe) || (v[0] === 0xfe && v[1] === 0xff))) || (v.length && (countByte(v, 0x00) / v.length) > 0.2);
        if (utf16) {
            const s = decodeBytes(v, "utf-16");
            desc = s ?? null;
        } else {
            // Try UTF-8; if it looks broken, fall back to Shift_JIS
            const utf8 = tryDecodeUTF8(v);
            if (utf8 && utf8.includes("\uFFFD")) {
                const sj = decodeShiftJIS(v);
                desc = sj ?? utf8;
            } else {
                desc = utf8;
            }
        }
    }
    // ExifIFD pointer 0x8769 ⇒ UserComment 0x9286
    let user: string | null = null;
    if (tags0[0x8769]) {
        const ptr = tags0[0x8769][2];
        let voff = 0; for (let i = 0; i < Math.min(4, ptr.length); i++) voff = (voff << 8) | ptr[i];
        const sub = base + (isLE ? ((ptr[0] | (ptr[1] << 8) | (ptr[2] << 16) | (ptr[3] << 24)) >>> 0) : ((ptr[0] << 24) | (ptr[1] << 16) | (ptr[2] << 8) | ptr[3]) >>> 0);
        const { tags: exifTags } = readIFD(sub);
        if (exifTags[0x9286]) {
            user = decodeExifUserComment(exifTags[0x9286][2]) ?? null;
        }
    }
    // XPComment (0x9C9C), XPTitle (0x9C9B)
    let xp: string | null = null;
    for (const t of [0x9c9c, 0x9c9b]) {
        if (tags0[t]) {
            const vb = tags0[t][2];
            const s = decodeBytes(vb, "utf-16le");
            if (s) { xp = s.replace(/\u0000+$/g, ""); break; }
        }
    }
    if (typeof desc === "string") desc = maybeFixUtf16EndianMisdecode(desc);
    if (typeof user === "string") user = maybeFixUtf16EndianMisdecode(user);
    if (typeof xp === "string") xp = maybeFixUtf16EndianMisdecode(xp);
    return { user, xp, desc };
}

// Try to recognize Stable Diffusion parameters text or Forge JSON, convert to A1111 style text
function interpretSdText(text: string | null): string | null {
    if (!text) return null;
    const fixed = maybeFixUtf16EndianMisdecode(text) ?? text;
    const obj = tryParseJsonPayload(fixed);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const md = (obj as any)["sd-metadata"] || (obj as any)["sd_metadata"] || obj;
        const asText = forgeMetadataToParameters(md) || (obj as any)["parameters"];
        if (asText && typeof asText === "string") return asText;
    }
    if (NEGATIVE_PROMPT_RE.test(fixed) || HAS_STEPS_RE.test(fixed)) return fixed;
    // Heuristic: long comma-separated positive prompt
    if ((fixed.match(/,/g) || []).length >= 2 || fixed.length > 80) return fixed;
    return null;
}

function tryParseJsonPayload(text: string): any | null {
    // Direct
    try { return JSON.parse(text); } catch { /* ignore */ }
    // Find first {...}
    const s = text.indexOf("{"); const e = text.lastIndexOf("}");
    if (s !== -1 && e !== -1 && e > s) {
        try { return JSON.parse(text.slice(s, e + 1)); } catch { /* ignore */ }
    }
    return null;
}

function forgeMetadataToParameters(md: any): string | null {
    if (!md || typeof md !== "object") return null;
    try {
        const prompt = md.prompt || md.Prompt || "";
        const neg = md.negativePrompt || md["Negative prompt"] || md.negative_prompt || "";
        const steps = md.steps ?? md.Steps;
        const sampler = md.sampler || md.Sampler;
        const cfg = md.cfgScale ?? md.cfg ?? md["CFG scale"];
        const seed = md.seed ?? md.Seed;
        const width = md.width ?? md.Width;
        const height = md.height ?? md.Height;
        const model = md.model ?? md.Model ?? (md.hashes && md.hashes.model);
        const lines: string[] = [String(prompt).trim()];
        lines.push(neg ? `Negative prompt: ${neg}` : "Negative prompt:");
        const tail: string[] = [];
        if (steps !== undefined) tail.push(`Steps: ${steps}`);
        if (sampler) tail.push(`Sampler: ${sampler}`);
        if (cfg !== undefined) tail.push(`CFG scale: ${cfg}`);
        if (seed !== undefined) tail.push(`Seed: ${seed}`);
        if (width && height) tail.push(`Size: ${width}x${height}`);
        if (model) tail.push(`Model: ${model}`);
        if (tail.length) lines.push(tail.join(", "));
        return lines.join("\n").trim();
    } catch { return null; }
}

// Heuristic: detect if a string is mostly non-ASCII (likely mis-decoded)
function looksGarbled(s: string): boolean {
    if (!s) return false;
    // If replacement chars or NULs are present at all, treat as garbled
    if (s.indexOf("\uFFFD") !== -1) return true;
    if (s.indexOf("\u0000") !== -1) return true;
    const len = s.length;
    let high = 0, alpha = 0;
    for (let i = 0; i < len; i++) {
        const c = s.charCodeAt(i);
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) alpha++;
        if (c > 0x7e) high++;
    }
    const highRatio = high / Math.max(1, len);
    return highRatio > 0.5 && alpha < len * 0.1;
}

// Raw scan: search for UTF-16LE/BE 'Negative prompt:' and decode a nearby block
function scanFileForSdText(u8: Uint8Array): string | null {
    const ascii = "Negative prompt:";
    const le = new Uint8Array(ascii.length * 2);
    const be = new Uint8Array(ascii.length * 2);
    for (let i = 0; i < ascii.length; i++) { const ch = ascii.charCodeAt(i); le[i * 2] = ch; le[i * 2 + 1] = 0; be[i * 2] = 0; be[i * 2 + 1] = ch; }
    const idxLE = indexOfBytes(u8, le);
    const idxBE = indexOfBytes(u8, be);
    if (idxLE >= 0) {
        const start = Math.max(0, idxLE - 4096);
        const end = Math.min(u8.length, idxLE + 8192);
        try {
            const text = new TextDecoder("utf-16le").decode(u8.subarray(start, end));
            const blk = extractParametersBlock(text);
            if (blk) return blk;
        } catch { /* ignore */ }
    }
    if (idxBE >= 0) {
        const start = Math.max(0, idxBE - 4096);
        const end = Math.min(u8.length, idxBE + 8192);
        try {
            const text = new TextDecoder("utf-16be").decode(u8.subarray(start, end));
            const blk = extractParametersBlock(text);
            if (blk) return blk;
        } catch { /* ignore */ }
    }
    return null;
}
function indexOfBytes(hay: Uint8Array, needle: Uint8Array): number {
    outer: for (let i = 0; i + needle.length <= hay.length; i++) {
        for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
        return i;
    }
    return -1;
}
/**
 * Given a window of text that contains an A1111-style block, return
 * the original substring from the start through the first settings line.
 * Preserves all original whitespace and newlines.
 */
function extractParametersBlock(text: string): string | null {
    const k = text.indexOf("Negative prompt:");
    if (k === -1) return null;
    const nlAfterNeg = text.indexOf("\n", k);
    const tailStart = nlAfterNeg > 0 ? nlAfterNeg + 1 : text.length;
    const tail = text.slice(tailStart);
    const picked = pickSettingsLineWithIndex(tail);
    if (picked) {
        const endGlobal = tailStart + picked.end;
        // Preserve original content from start up to the end of the settings line
        return text.slice(0, endGlobal);
    }
    // No settings found; return everything up to the end of provided text
    return text;
}

// assembleParameters/isLikelyPrompt were removed in favor of single-source extraction

function pickSettingsLine(s: string): string | null {
    // Prefer the canonical A1111 settings line starting with Steps:
    let m = s.match(SETTINGS_STEPS_RE);
    if (m) return m[0].trim();
    // Otherwise, pick the first line that starts with any known key (case-insensitive)
    m = s.match(SETTINGS_ANY_RE);
    return m ? m[0].trim() : null;
}

function pickSettingsLineWithIndex(s: string): { line: string; index: number; end: number } | null {
    let m = SETTINGS_STEPS_RE.exec(s);
    if (!m) m = SETTINGS_ANY_RE.exec(s);
    if (!m) return null;
    const line = m[0].trim();
    const index = m.index;
    const end = index + m[0].length;
    return { line, index, end };
}

// Extract clean A1111 block from a single text source without mixing multiple strings
function extractA1111BlockFromText(src: string): string | null {
    if (!src) return null;
    const s = maybeFixUtf16EndianMisdecode(src) ?? src;
    const negIdx = s.indexOf("Negative prompt:");
    if (negIdx < 0) return null;
    const nlAfterNeg = s.indexOf("\n", negIdx);
    const tailStart = nlAfterNeg > 0 ? nlAfterNeg + 1 : s.length;
    const tail = s.slice(tailStart);
    const picked = pickSettingsLineWithIndex(tail);
    if (picked) {
        const endGlobal = tailStart + picked.end;
        // Preserve original content from start up to the end of the settings line
        return s.slice(0, endGlobal);
    }
    // No settings found; return everything (keeps entire negative block)
    return s;
}

function scoreA1111Block(s: string): number {
    if (!s) return 0;
    let score = 0;
    const lower = s.toLowerCase();
    if (lower.includes("negative prompt:")) score += 5;
    if (lower.includes("steps:")) score += 4;
    if (lower.includes("sampler:")) score += 2;
    if (lower.includes("cfg scale:")) score += 2;
    if (lower.includes("seed:")) score += 2;
    if (lower.includes("size:")) score += 2;
    // Prefer blocks that look like two or three lines
    const lines = s.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
    if (lines === 3) score += 3; else if (lines === 2) score += 2; else if (lines >= 4) score += 1;
    // Penalize very long or very short
    const len = s.length; if (len > 50 && len < 4000) score += 1;
    return score;
}

// Extract potential sd-metadata/parameters strings from XMP XML attributes
function extractFromXmpAttributes(xml: string): string[] {
    const out: string[] = [];
    const keys = ["sd-metadata", "sd_metadata", "parameters", "Parameters"];
    for (const key of keys) {
        const re = new RegExp(key + "\\s*=\\s*([\"'])(.*?)\\1", "is");
        const m = xml.match(re);
        if (m && m[2]) {
            const val = htmlUnescape(m[2]);
            out.push(val);
        }
    }
    return out;
}
function htmlUnescape(s: string): string {
    return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// Scan entire file bytes for embedded JSON (sd-metadata) or parameters text
function scanWholeFileForMeta(u8: Uint8Array): string | null {
    // Try UTF-8 decode with replacement to allow scanning
    let text: string;
    try { text = new TextDecoder("utf-8").decode(u8); } catch { return null; }
    // JSON block containing sd-metadata
    for (const key of ["sd-metadata", "sd_metadata", '"prompt"', '"Negative prompt"', 'Negative prompt:']) {
    const idx = text.indexOf(key);
        if (idx !== -1) {
            // Try to find the surrounding JSON braces
            const startBrace = text.lastIndexOf("{", idx);
            const endBrace = text.indexOf("}", idx);
            if (startBrace !== -1 && endBrace !== -1) {
                // Expand to matching closing brace
                let depth = 0; let end: number | null = null;
                for (let i = startBrace; i < text.length; i++) {
                    const c = text[i];
                    if (c === '{') depth++;
                    else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
                }
                if (end) {
                    const snippet = text.slice(startBrace, end);
                    try {
                        const obj = JSON.parse(snippet);
                        const md = (obj as any)["sd-metadata"] || (obj as any)["sd_metadata"] || obj;
                        const asText = forgeMetadataToParameters(md) || (obj as any)["parameters"];
                        if (asText) return asText;
                    } catch { /* ignore */ }
                }
            }
            // If not JSON, but parameters text nearby
            if (NEGATIVE_PROMPT_RE.test(text)) {
                const nidx = text.search(NEGATIVE_PROMPT_RE);
                const start = Math.max(0, nidx - 1200);
                const firstLineEnd = text.indexOf("\n", start);
                const end = text.indexOf("\n\n", nidx);
                const block = text.slice(start, (end !== -1 ? end : (firstLineEnd !== -1 ? firstLineEnd : nidx + 2000)));
                if (block && block.length > 0) return block.trim();
            }
        }
    }
    return null;
}

// Decode entire file as UTF-16LE/BE and try to extract a clean A1111 block
function scanWholeFileForUtf16A1111(u8: Uint8Array): string | null {
    const variants: { enc: "utf-16le" | "utf-16be"; text: string | null }[] = [];
    try { variants.push({ enc: "utf-16le", text: new TextDecoder("utf-16le").decode(u8) }); } catch { variants.push({ enc: "utf-16le", text: null }); }
    try { variants.push({ enc: "utf-16be", text: new TextDecoder("utf-16be").decode(u8) }); } catch { variants.push({ enc: "utf-16be", text: null }); }
    let best: { text: string; score: number } | null = null;
    for (const v of variants) {
        if (!v.text) continue;
        // Prefer exact Negative prompt block, else fall back to settings line only
        const blk = extractA1111BlockFromText(v.text) || extractBySettingsLineOnly(v.text);
        if (!blk) continue;
        const sc = scoreA1111Block(blk) - (looksGarbled(blk) ? 5 : 0);
        if (!best || sc > best.score) best = { text: blk, score: sc };
    }
    return best?.text ?? null;
}
function scanWholeFileForSjisA1111(u8: Uint8Array): string | null {
    try {
        const text = new TextDecoder("shift_jis" as any).decode(u8);
        const blk = extractA1111BlockFromText(text) || extractBySettingsLineOnly(text);
        return blk ?? null;
    } catch { return null; }
}

// Select the best A1111-style parameters block from provided texts
function selectBestParametersFromTexts(texts: string[]): string | null {
    let best: { text: string; score: number } | null = null;
    for (const t of texts) {
        if (!t) continue;
        const primary = extractA1111BlockFromText(t);
        if (primary) {
            const sc = scoreA1111Block(primary);
            if (!best || sc > best.score) best = { text: primary, score: sc };
            continue;
        }
        const interp = interpretSdText(t);
        if (interp) {
            const blk = extractA1111BlockFromText(interp) || interp;
            const sc = scoreA1111Block(blk);
            if (!best || sc > best.score) best = { text: blk, score: sc };
        }
    }
    return best?.text ?? null;
}

// Unified recovery pipeline when parameters are missing or garbled
function recoverParameters(u8: Uint8Array, existing: string | null): string | null {
    if (!existing) {
        // Absent: try JSON scan, then UTF-16 near Negative prompt, then full UTF-16/Shift_JIS
        const j = scanWholeFileForMeta(u8); if (j) return j;
        const near = scanFileForSdText(u8); if (near) return near;
        const utf16 = scanWholeFileForUtf16A1111(u8); if (utf16) return utf16;
        const sj = scanWholeFileForSjisA1111(u8); if (sj) return sj;
        return null;
    }
    if (!looksGarbled(existing)) return null;
    const near = scanFileForSdText(u8); if (near) return near;
    const utf16 = scanWholeFileForUtf16A1111(u8); if (utf16) return utf16;
    const sj = scanWholeFileForSjisA1111(u8); if (sj) return sj;
    return null;
}
function extractBySettingsLineOnly(text: string): string | null {
    const picked = pickSettingsLineWithIndex(text);
    if (!picked) return null;
    // Take content from start up to settings line end
    return text.slice(0, picked.end);
}
