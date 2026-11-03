import { parseImageMeta } from "../parser.js";

const encoder = new TextEncoder();

function assertEqual(actual: unknown, expected: unknown): void {
    if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
    }
}

function assertTrue(value: boolean, message: string): void {
    if (!value) throw new Error(message);
}

function concat(...parts: Uint8Array[]): Uint8Array {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}

function utf16(text: string, littleEndian: boolean, bom = false): Uint8Array {
    const bytes: number[] = [];
    if (bom) bytes.push(...(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]));
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        bytes.push(...(littleEndian ? [code & 0xff, code >>> 8] : [code >>> 8, code & 0xff]));
    }
    return Uint8Array.from(bytes);
}

function jpegWithApp1(payload: Uint8Array): Uint8Array {
    const segmentLength = payload.length + 2;
    assertTrue(segmentLength <= 0xffff, "APP1 fixture must fit in one segment");
    return concat(
        Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, segmentLength >>> 8, segmentLength & 0xff]),
        payload,
        Uint8Array.from([0xff, 0xd9]),
    );
}

function jpegWithXmp(xmlBytes: Uint8Array): Uint8Array {
    const xmpHeader = encoder.encode("http://ns.adobe.com/xap/1.0\0");
    return jpegWithApp1(concat(xmpHeader, xmlBytes));
}

function jpegWithExtendedXmp(xmlBytes: Uint8Array): Uint8Array {
    const xmpHeader = encoder.encode("http://ns.adobe.com/xmp/extension/\0");
    const guid = encoder.encode("0123456789ABCDEF0123456789ABCDEF");
    const bookkeeping = new Uint8Array(8);
    const view = new DataView(bookkeeping.buffer);
    view.setUint32(0, xmlBytes.length, false);
    view.setUint32(4, 0, false);
    return jpegWithApp1(concat(xmpHeader, guid, bookkeeping, xmlBytes));
}

function jpegWithPrefixlessUserComment(parameters: string): Uint8Array {
    const comment = utf16(parameters, true);
    const tiff = new Uint8Array(44 + comment.length);
    const view = new DataView(tiff.buffer);

    tiff.set(encoder.encode("II"), 0);
    view.setUint16(2, 42, true);
    view.setUint32(4, 8, true);

    view.setUint16(8, 1, true);
    view.setUint16(10, 0x8769, true);
    view.setUint16(12, 4, true);
    view.setUint32(14, 1, true);
    view.setUint32(18, 26, true);
    view.setUint32(22, 0, true);

    view.setUint16(26, 1, true);
    view.setUint16(28, 0x9286, true);
    view.setUint16(30, 7, true);
    view.setUint32(32, comment.length, true);
    view.setUint32(36, 44, true);
    view.setUint32(40, 0, true);
    tiff.set(comment, 44);

    return jpegWithApp1(concat(encoder.encode("Exif\0\0"), tiff));
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function testUtf16JpegXmp() {
    const parameters = "portrait 猫\nNegative prompt: blur\nSchedule type: Karras, Seed: 1";
    const xml = `<x:xmpmeta><rdf:Description parameters="${parameters}"/></x:xmpmeta>`;
    const variants = [utf16(xml, true, true), utf16(xml, false)];

    return parseImageMeta(asArrayBuffer(jpegWithXmp(variants[0])), "jpg").then((metadata) => {
        assertEqual(metadata.raw.parameters, parameters);
        return parseImageMeta(asArrayBuffer(jpegWithXmp(variants[1])), "jpg");
    }).then((metadata) => {
        assertEqual(metadata.raw.parameters, parameters);
        return parseImageMeta(asArrayBuffer(jpegWithExtendedXmp(utf16(xml, false, true))), "jpg");
    }).then((metadata) => {
        assertEqual(metadata.raw.parameters, parameters);
    });
}

function testInlineXmpDoesNotReturnXmlMarkup() {
    const parameters = "portrait 猫\nNegative prompt: blur\nSteps: 20, Sampler: Euler";
    const xml = `<x:xmpmeta><rdf:Description description="literal > Negative prompt: ignore">${parameters}</rdf:Description></x:xmpmeta>`;
    return parseImageMeta(asArrayBuffer(jpegWithXmp(encoder.encode(xml))), "jpg").then((metadata) => {
        assertEqual(metadata.raw.parameters, parameters);
    });
}

async function testJpegXmpBodyOutranksPromptGuess() {
    const parameters = "portrait 猫\nSteps: 20, Sampler: Euler";
    for (const attribute of [
        "",
        ' parameters="camera note, lighting note, location note"',
        ' other_parameters="wrong\nSteps: 1"',
    ]) {
        const xml = `<rdf:Description${attribute}>${parameters}</rdf:Description>`;
        const jpeg = jpegWithXmp(encoder.encode(xml));
        const metadata = await parseImageMeta(asArrayBuffer(jpeg), "jpg");
        assertEqual(metadata.raw.parameters, parameters);
    }
}

function testPrefixlessUtf16UserComment() {
    const parameters = "portrait 猫\nNegative prompt: blur\nHires steps: 10, Seed: 1";
    return parseImageMeta(asArrayBuffer(jpegWithPrefixlessUserComment(parameters)), "jpg").then((metadata) => {
        assertEqual(metadata.raw.parameters, parameters);
    });
}

async function testJpegExifTakesPriorityOverHigherScoringXmp() {
    const exifParameters = "EXIF portrait\nNegative prompt: blur\nSeed: 1";
    const xmpParameters = "XMP portrait\nNegative prompt: blur\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 2, Size: 512x512";
    const xmp = jpegWithXmp(encoder.encode(`<rdf:Description sd:parameters="${xmpParameters}"/>`));
    for (const [exifText, expected] of [
        [exifParameters, exifParameters],
        ["Camera comment without generation parameters", xmpParameters],
        ["A long camera note describing the weather, the location, and the lighting conditions during the portrait session.", xmpParameters],
    ]) {
        const exif = jpegWithPrefixlessUserComment(exifText);
        const jpeg = concat(exif.subarray(0, exif.length - 2), xmp.subarray(2));
        const metadata = await parseImageMeta(asArrayBuffer(jpeg), "jpg");
        assertEqual(metadata.raw.parameters, expected);
    }
}

async function testJpegCommentPriority() {
    const xmpPrompt = "portrait, soft lighting, film grain";
    const xmp = jpegWithXmp(encoder.encode(`<rdf:Description parameters="${xmpPrompt}"/>`));
    const commentParameters = "portrait\nNegative prompt: blur\nSteps: 20, Sampler: Euler";
    for (const [comment, expected] of [
        ["Camera note, lighting note, location note", xmpPrompt],
        [commentParameters, commentParameters],
    ]) {
        const payload = encoder.encode(comment);
        const length = payload.length + 2;
        const segment = Uint8Array.of(0xff, 0xfe, length >>> 8, length & 0xff);
        const jpeg = concat(xmp.subarray(0, xmp.length - 2), segment, payload, Uint8Array.of(0xff, 0xd9));
        const metadata = await parseImageMeta(asArrayBuffer(jpeg), "jpg");
        assertEqual(metadata.raw.parameters, expected);
    }
}

function main() {
    return testUtf16JpegXmp()
        .then(() => testInlineXmpDoesNotReturnXmlMarkup())
        .then(() => testJpegXmpBodyOutranksPromptGuess())
        .then(() => testPrefixlessUtf16UserComment())
        .then(() => testJpegExifTakesPriorityOverHigherScoringXmp())
        .then(() => testJpegCommentPriority());
}

main().then(() => {
    console.log("Parser regression tests passed.");
}).catch((error) => {
    console.error(error);
    throw error;
});
