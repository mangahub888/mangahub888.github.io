/**
 * Standalone PSD Exporter using ag-psd
 * Can be run in Node.js locally or in GitHub Actions CI
 */
const fs = require('fs');
const path = require('path');

// Resolve ag-psd bundle across tools, scripts, or vendor dir
const candidatePaths = [
    path.resolve(__dirname, './ag-psd.bundle.js'),
    path.resolve(__dirname, '../tools/ag-psd.bundle.js'),
    path.resolve(__dirname, '../scripts/ag-psd.bundle.js'),
    path.resolve(__dirname, '../app/static/js/vendor/ag-psd.bundle.js')
];
const agPsdPath = candidatePaths.find(p => fs.existsSync(p));
if (!agPsdPath) {
    console.error('Error: ag-psd.bundle.js not found in candidate paths: ' + JSON.stringify(candidatePaths));
    process.exit(1);
}
const agPsd = require(agPsdPath);

// Embedded Adobe Photoshop CoolType Font List template (global Txt2 block)
// This ensures Photoshop recognizes the PSD as a native text-engine document
// with 0 missing font warnings (T ⚠️ icon is completely eliminated).
const EMBEDDED_TXT2_TEMPLATE_B64 = "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HCkgLzMgKP7/IBopIC80ICj+/yAYKSA+PiA8PCAvMCA1IC8xICj+/yAeKSAvMiAo/v8gHCkgLzMgKP7/IBopIC80ICj+/yAYKSA+PiA8PCAvMCA2IC8xICj+/wCrKSAvMiAo/v8AuykgLzMgKP7/IDkpIC80ICj+/yA6KSA+PiA8PCAvMCA3IC8xICj+/yAcKSAvMiAo/v8gHSkgLzMgKP7/IBgpIC80ICj+/yAZKSA+PiA8PCAvMCA4IC8xICj+/wCrKSAvMiAo/v8AuykgLzMgKP7/IBgpIC80ICj+/yAZKSA+PiA8PCAvMCA5IC8xICj+/wCrKSAvMiAo/v8AuykgLzMgKP7/IBgpIC80ICj+/yAZKSA+PiA8PCAvMCAxMCAvMSAo/v8gHCkgLzIgKP7/IB0pIC8zICj+/yAYKSAvNCAo/v8gGSkgPj4gPDwgLzAgMTEgLzEgKP7/IBwpIC8yICj+/yAdKSAvMyAo/v8gGCkgLzQgKP7/IBkpID4+IDw8IC8wIDEyIC8xICj+/yAcKSAvMiAo/v8gHSkgLzMgKP7/IBgpIC80ICj+/yAZKSA+PiA8PCAvMCAxMyAvMSAo/v8gHSkgLzIgKP7/IB0pIC8zICj+/yAZKSAvNCAo/v8gGSkgPj4gPDwgLzAgMTQgLzEgKP7/IBwpIC8yICj+/yAdKSAvMyAo/v8gGCkgLzQgKP7/IBkpID4+IDw8IC8wIDE1IC8xICj+/yAcKSAvMiAo/v8gHSkgLzMgKP7/IBgpIC80ICj+/yAZKSA+PiA8PCAvMCAxNiAvMSAo/v8gHSkgLzIgKP7/IB0pIC8zICj+/yAZKSAvNCAo/v8gGSkgPj4gPDwgLzAgMTcgLzEgKP7/IBwpIC8yICj+/yAdKSAvMyAo/v8gGCkgLzQgKP7/IBkpID4+IDw8IC8wIDE4IC8xICj+/wCrKSAvMiAo/v8AuykgLzMgKP7/IBgpIC80ICj+/yAZKSA+PiA8PCAvMCAxOSAvMSAo/v8AqykgLzIgKP7/ALspIC8zICj+/yAYKSAvNCAo/v8gGSkgPj4gPDwgLzAgMjAgLzEgKP7/IB4pIC8yICj+/yAcKSAvMyAo/v8gGikgLzQgKP7/IBgpID4+IDw8IC8wIDIxIC8xICj+/yAeKSAvMiAo/v8gHCkgLzMgKP7/IBopIC80ICj+/yAYKSA+PiA8PCAvMCAyMiAvMSAo/v8gHikgLzIgKP7/IBwpIC8zICj+/yAaKSAvNCAo/v8gGCkgPj4gPDwgLzAgMjMgLzEgKP7/IB4pIC8yICj+/yAdKSAvMyAo/v8gGCkgLzQgKP7/IBkpID4+IDw8IC8wIDI0IC8xICj+/yAeKSAvMiAo/v8gHSkgLzMgKP7/IBopIC80ICj+/yAZKSA+PiA8PCAvMCAyNSAvMSAo/v8AqykgLzIgKP7/ALspIC8zICj+/yA5KSAvNCAo/v8gOikgPj4gPDwgLzAgMjYgLzEgKP7/IBwpIC8yICj+/yAdKSAvMyAo/v8gGCkgLzQgKP7/IBkpID4+IDw8IC8wIDI3IC8xICj+/yAcKSAvMiAo/v8gHSkgLzMgKP7/IBgpIC80ICj+/yAZKSA+PiA8PCAvMCAyOCAvMSAo/v8gHikgLzIgKP7/IB0pIC8zICj+/yAZKSAvNCAo/v8gGSkgPj4gPDwgLzAgMjkgLzEgKP7/MB0pIC8yICj+/zAeKSA+PiA8PCAvMCAzMCAvMSAo/v8wDCkgLzIgKP7/MA0pID4+IDw8IC8wIDMxIC8xICj+/yAeKSAvMiAo/v8gHCkgLzMgKP7/IBgpIC80ICj+/yAZKSA+PiA8PCAvMCAzMiAvMSAo/v8gHCkgLzIgKP7/IB0pIC8zICj+/yAYKSAvNCAo/v8gGSkgPj4gPDwgLzAgMzMgLzEgKP7/IB4pIC8yICj+/yAcKSAvMyAo/v8gGikgLzQgKP7/IBgpID4+IDw8IC8wIDM0IC8xICj+/wCrKSAvMiAo/v8AuykgLzMgKP7/IBgpIC80ICj+/yAZKSA+PiA8PCAvMCAzNSAvMSAo/v8gHCkgLzIgKP7/IB0pIC8zICj+/yAYKSAvNCAo/v8gGSkgPj4gPDwgLzAgMzYgLzEgKP7/IB4pIC8yICj+/yAcKSAvMyAo/v8gGikgLzQgKP7/IBgpID4+IDw8IC8wIDM3IC8xICj+/wCrKSAvMiAo/v8AuykgLzMgKP7/IBgpIC80ICj+/yAZKSA+PiA8PCAvMCAzOCAvMSAo/v8gHikgLzIgKP7/IBwpIC8zICj+/yAaKSAvNCAo/v8gGCkgPj4gPDwgLzAgMzkgLzEgKP7/AKspIC8yICj+/wC7KSAvMyAo/v8APCkgLzQgKP7/AD4pID4+IDw8IC8wIDQwIC8xICj+/yAeKSAvMiAo/v8gHCkgLzMgKP7/IBopIC80ICj+/yAYKSA+PiA8PCAvMCA0MSAvMSAo/v8AqykgLzIgKP7/ALspIC8zICj+/wA8KSAvNCAo/v8APikgPj4gPDwgLzAgNDIgLzEgKP7/IB4pIC8yICj+/yAcKSAvMyAo/v8gGikgLzQgKP7/IBgpID4+IDw8IC8wIDQzIC8xICj+/yAcKSAvMiAo/v8gHSkgLzMgKP7/IBgpIC80ICj+/yAZKSA+PiA8PCAvMCA0NCAvMSAo/v8AqykgLzIgKP7/ALspIC8zICj+/yA5KSAvNCAo/v8gOikgPj4gPDwgLzAgNDUgLzEgKP7/IBwpIC8yICj+/yAdKSAvMyAo/v8gGCkgLzQgKP7/IBkpID4+IF0gLzE1IDw8IC8wICj+/ykgPj4gLzE2IHRydWUgLzE3IDAgPj4gLzUgWyA8PCAvMCAwIC8xIDw8IC8wIDcgLzEgMTEgLzIgMCAvMyAo/v8AUABoAG8AdABvAHMAaABvAHApID4+IC8yICgwMDEwMDAwMDAxMDAxMDAxMTExMDExMTAwMDExMTAwMDExMTAxMTAwMDAwMDEwMDAwMTEwMDAwMDAwKSAvMyAoMDExMTApIC80IFsgPDwgLzAgMCAvMSAo/v8AVgBlAHIAcwBpAG8AbgAgADEALgAwADAAMCkgPj4gXSA+PiBdIC8xIFsgPDwgLzAgPDwgLzAgKP7/AFQAZQBzAHQAIABMAGEAbgBuAGEAIABOAGEAdABpAHYAZQANKSAvNSA8PCAvMCBbIDw8IC8wIDw8IC8wIDw8IC8wICj+/ykgLzUgPDwgLzAgMCAvMSAwLjAgLzIgMC4wIC8zIDAuMCAvNCAwLjAgLzUgMC4wIC83IDEuMiAvOCAwIC85IGZhbHNlIC8xNyBbIC44IDEuMCAxLjMzIF0gLzE4IFsgMC4wIDAuMCAwLjAgXSAvMTkgWyAxLjAgMS4wIDEuMCBdIC8yMSBmYWxzZSAvMjQgMCAvMjUgMCAvMjcgL25pbCAvMjggL25pbCAvMjkgZmFsc2UgLzMzIDAgLzM1IDEgLzM2IC9uaWwgLzM3IDAgLzQwIDIgPj4gLzYgMSA+PiA+PiAvMSAxOCA+PiBdID4+IC82IDw8IC8wIFsgPDwgLzAgPDwgLzAgPDwgLzAgKP7/KSAvNSAxIC82IDw8IC8wIDAgLzEgMjQuMCAvMiBmYWxzZSAvMyBmYWxzZSAvNCB0cnVlIC81IDE0LjQgLzYgMS4wIC83IDEuMCAvOCAwIC85IDAuMCAvMTEgMSAvMTIgMCAvMTMgMCAvMTQgMCAvMTUgMCAvMTYgMCAvMTggdHJ1ZSAvMTkgZmFsc2UgLzIwIGZhbHNlIC8yMyBmYWxzZSAvMjQgZmFsc2UgLzI1IGZhbHNlIC8yNiBmYWxzZSAvMjcgZmFsc2UgLzI4IGZhbHNlIC8yOSBmYWxzZSAvMzAgMCAvMzEgZmFsc2UgLzMyIGZhbHNlIC8zMyBmYWxzZSAvMzUgMSAvMzYgMC4wIC8zNyAyIC8zOCA0NiAvMzkgMCAvNTIgZmFsc2UgLzUzIDw8IC85OSAvU2ltcGxlUGFpbnQgLzAgPDwgLzAgMSAvMSBbIDEuMCAwLjAgMC4wIDAuMCBdID4+ID4+IC81NCA8PCAvOTkgL1NpbXBsZVBhaW50IC8wIDw8IC8wIDEgLzEgWyAxLjAgMC4wIDAuMCAwLjAgXSA+PiA+PiAvNjggMCAvNzAgMCAvNzIgMC4wIC83MyAwLjAgLzc1IGZhbHNlIC84NSAwIC84NyAxMDAuMCAvODggZmFsc2UgLzkyIDAuMCA+PiA+PiA+PiAvMSAxOCA+PiBdID4+IC8xMCA8PCAvMCAxIC8yIHRydWUgPj4gPj4gLzEgPDwgLzQgPDwgLzAgNyAvMSAxMSAvMiAwIC8zICj+/wBQAGgAbwB0AG8AcwBoAG8AcCkgPj4gLzUgMCAvMCBbIDw8IC8wIDAgPj4gXSAvMSA8PCAvMCBbIDw8IC8wIDw8IC8xIDEgPj4gLzEgMTggPj4gXSA+PiAvMiBbIDw8IC85OSAvUEMgLzUgMCAvNiBbIDw8IC85OSAvRiAvMTAgMCAvNSAyIC82IFsgPDwgLzk5IC9SIC82IFsgPDwgLzk5IC9SIC81IDIgLzYgWyA8PCAvOTkgL0wgLzE0IC0xNy4zMjggLzE1IDkuMTQzOTIgLzE2IC0yMC4zOTk3OCAvMTcgMTEuMDM5NzkgLzEgWyAwLjAgLTE3LjMyOCAwLjAgOS4xNDM5MiBdIC82IFsgPDwgLzk5IC9TIC8xNSA8PCAvMCAxOCAvMiAxOCAvNSB0cnVlIC82IDAgLzcgPDwgLzAgMTggLzEgMTggLzIgMTggLzMgWyAxOCAwIF0gLzUgMTggLzcgWyA4LjgwOCAxNy40NzIgMjYuMTM2IDMxLjMyIDM3LjE3NiA0Ni43MDQgNTUuMzY4IDY0Ljg5NiA3NC40MjQgODMuMDg4MDEgODguOTQ0MDEgMTAwLjIwMDAxIDEwOC44NjQwMSAxMTQuMDQ4MDEgMTE4LjM5MjAxIDEyNy4wNTYwMiAxMzUuNzIwMDIgMTQxLjU3NjAyIF0gLzEzIGZhbHNlIC8xNCBbIDI4OSBdIC8xNSA8PCAvMCBbIDAgXSAvMSBbIDE4IF0gPj4gLzE3IDE4ID4+ID4+IC8xNiAwIC82IFsgPDwgLzk5IC9HIC8xIFsgMC4wIC0xNy4zMjggMTM1LjcyIDkuMTQzOTIgXSAvMjQgMCAvOCBbIDAuMCAtMTcuMzI4IDEzNS43MiA5LjE0MzkyIF0gLzkgWyAwLjAgLTE3LjMyOCAxNDYuNzgzOTcgOS4xNDM5MiBdIC8xMCA8PCAvMCBbIDw8IC84IGZhbHNlIC85IDAgPj4gXSAvMSBbIDE4IF0gPj4gLzExIHRydWUgLzEyIC0xNy4zMjggLzEzIDkuMTQzOTIgLzI1IC0yMC4zOTk3OCAvMjYgMTEuMDM5NzkgLzE0IHRydWUgLzIwIDAgLzIxIDw8IC8wIFsgNTMgNzAgODQgODUgMyA0NSA2NiA3OSA3OSA2NiAzIDQ3IDY2IDg1IDc0IDg3IDcwIDMgXSAvMSBbIDAuMCA4LjgwOCAxNy40NzIgMjYuMTM2IDMxLjMyIDM3LjE3NiA0Ni43MDQgNTUuMzY4IDY0Ljg5NiA3NC40MjQgODMuMDg4IDg4Ljk0NCAxMDAuMiAxMDguODY0IDExNC4wNDggMTE4LjM5MiAxMjcuMDU2IDEzNS43MiAxNDEuNTc2MDIgXSAvMiBbIDE3LjMyOCBdIC81IDEgPj4gLzIyIDw8IC8wIFsgMTE0IDExNCA0IF0gLzEgWyAzMS43NjQxOCA4My41MzIxNyAxMzUuNzIgMTQxLjU3NjAyIF0gLzIgWyAxNy4zMjggXSA+PiAvMjMgdHJ1ZSA+PiBdID4+IF0gPj4gXSA+PiBdID4+IF0gPj4gXSA+PiBdID4+ID4+IF0gLzIgPDwgLzAgMSAvMSAxMi4wIC8yIGZhbHNlIC8zIGZhbHNlIC80IHRydWUgLzUgMC4wIC82IDEuMCAvNyAxLjAgLzggMCAvOSAwLjAgLzEwIDAuMCAvMTEgMSAvMTIgMCAvMTMgMCAvMTQgMCAvMTUgMCAvMTYgMCAvMTcgMC4wIC8xOCB0cnVlIC8xOSBmYWxzZSAvMjAgZmFsc2UgLzIxIGZhbHNlIC8yMiBmYWxzZSAvMjMgZmFsc2UgLzI0IGZhbHNlIC8yNSBmYWxzZSAvMjYgZmFsc2UgLzI3IGZhbHNlIC8yOCBmYWxzZSAvMjkgZmFsc2UgLzMwIDAgLzMxIGZhbHNlIC8zMiBmYWxzZSAvMzMgZmFsc2UgLzM0IGZhbHNlIC8zNSAyIC8zNiAwLjAgLzM3IDIgLzM4IDAgLzM5IDAgLzQwIGZhbHNlIC80MSAyIC80MiAwIC80MyA8PCAvMCAuNSA+PiAvNDQgMiAvNDUgMiAvNDYgNyAvNDcgMCAvNDggMCAvNDkgLTEuMCAvNTAgLTEuMCAvNTEgMCAvNTIgZmFsc2UgLzUzIDw8IC85OSAvU2ltcGxlUGFpbnQgLzAgPDwgLzAgMSAvMSBbIDEuMCAwLjAgMC4wIDAuMCBdID4+ID4+IC81NCA8PCAvOTkgL1NpbXBsZVBhaW50IC8wIDw8IC8wIDEgLzEgWyAxLjAgMC4wIDAuMCAwLjAgXSA+PiA+PiAvNTUgPDwgLzk5IC9TaW1wbGVCbGVuZGVyID4+IC81NiB0cnVlIC81NyBmYWxzZSAvNTggdHJ1ZSAvNTkgZmFsc2UgLzYwIGZhbHNlIC82MSAwIC82MiAwIC82MyAxLjAgLzY0IDQuMCAvNjUgMC4wIC82NiBbIF0gLzY3IFsgXSAvNjggMCAvNjkgMCAvNzAgMCAvNzEgNCAvNzIgMC4wIC83MyAwLjAgLzc0IGZhbHNlIC83NSBmYWxzZSAvNzYgZmFsc2UgLzc3IHRydWUgLzc4IHRydWUgLzc5IDw8IC85OSAvU2ltcGxlUGFpbnQgLzAgPDwgLzAgMSAvMSBbIDEuMCAxLjAgMS4wIDAuMCBdID4+ID4+IC84MCBmYWxzZSAvODEgMCAvODIgMy4wIC84MyAzLjAgLzg0IGZhbHNlIC84NSAwIC84NiA8PCAvOTkgL1NpbXBsZUN1c3RvbUZlYXR1cmUgPj4gLzg3IDEwMC4wIC84OCB0cnVlIC85MSAxIC85MiAwLjAgLzk1IDw8IC8wIDAuMCAvMSAwID4+IC85NiB0cnVlID4+IC8zIDw8IC8wIDAgLzEgMC4wIC8yIDAuMCAvMyAwLjAgLzQgMC4wIC81IDAuMCAvNiAxIC83IDEuMiAvOCAwIC85IHRydWUgLzEwIDYgLzExIDIgLzEyIDIgLzEzIDAgLzE0IDM2LjAgLzE1IHRydWUgLzE2IC41IC8xNyBbIC44IDEuMCAxLjMzIF0gLzE4IFsgMC4wIDAuMCAwLjAgXSAvMTkgWyAxLjAgMS4wIDEuMCBdIC8yMCA2IC8yMSBmYWxzZSAvMjIgMCAvMjMgdHJ1ZSAvMjQgMCAvMjUgMCAvMjcgL25pbCAvMjYgZmFsc2UgLzI4IC9uaWwgLzI5IGZhbHNlIC8zMCA8PCA+PiAvMzEgMzYuMCAvMzIgPDwgPj4gLzMzIDAgLzM0IDcgLzM1IDEgLzM2IC9uaWwgLzM3IDAgLzM4IGZhbHNlIC8zOSAwIC80MCAyIC80MSAwIC80NyBmYWxzZSAvNDggL25pbCA+PiA+Pg==";

function getGlobalEngineDataBase64(fontNames) {
    const candidateBinPaths = [
        path.resolve(__dirname, "./global_txt2_template.bin"),
        path.resolve(__dirname, "../tools/global_txt2_template.bin"),
        path.resolve(__dirname, "../scripts/global_txt2_template.bin")
    ];
    const binPath = candidateBinPaths.find(p => fs.existsSync(p));
    let buf = binPath ? fs.readFileSync(binPath) : Buffer.from(EMBEDDED_TXT2_TEMPLATE_B64, "base64");

    let str = buf.toString("latin1");
    for (const fn of fontNames || []) {
        if (!fn) continue;
        let utf16 = Buffer.alloc(fn.length * 2 + 2);
        utf16[0] = 0xfe; utf16[1] = 0xff;
        for (let i = 0; i < fn.length; i++) utf16.writeUInt16BE(fn.charCodeAt(i), 2 + i * 2);
        let utf16Str = utf16.toString("latin1");
        if (!str.includes(utf16Str)) {
            // Replace MyriadPro-Regular placeholder with this font
            let placeholder = Buffer.from("feff004d0079007200690061006400500072006f002d0052006500670075006c00610072", "hex").toString("latin1");
            if (str.includes(placeholder)) {
                str = str.replace(placeholder, utf16Str);
            }
        }
    }
    return Buffer.from(str, "latin1").toString("base64");
}


function parseArgs() {
    const args = process.argv.slice(2);
    const params = {};
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        params[key] = args[i + 1];
    }
    return params;
}

function hexToRgb(hex) {
    if (!hex) return { r: 0, g: 0, b: 0 };
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
    }
    const num = parseInt(hex, 16);
    return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255
    };
}

/**
 * Resolves font display/family name to the exact PostScript name recognized by Adobe Photoshop.
 * This prevents the missing font warning ([Font Name] with ⚠️ icon) in Photoshop.
 */
function resolvePostScriptName(fontName, isBold, isItalic) {
    if (!fontName) {
        return isBold ? 'TFLanna-Bold' : (isItalic ? 'TFLanna-Italic' : 'TFLanna');
    }
    const clean = fontName.trim();
    const lower = clean.toLowerCase();

    // TF Lanna font family variants (installed as TFLanna-Bold, TFLanna, TFLanna-Italic)
    if (lower.includes('lanna') || lower.includes('tf')) {
        if (lower.includes('ita') || isItalic) return 'TFLanna-Italic';
        if (lower.includes('bol') || isBold) return 'TFLanna-Bold';
        return 'TFLanna';
    }

    // Prompt font family variants
    if (lower.includes('prompt')) {
        if (lower.includes('ita') || isItalic) return isBold ? 'Prompt-BoldItalic' : 'Prompt-Italic';
        if (lower.includes('bol') || isBold) return 'Prompt-Bold';
        if (lower.includes('med')) return 'Prompt-Medium';
        if (lower.includes('sem')) return 'Prompt-SemiBold';
        return 'Prompt-Regular';
    }

    // Tahoma
    if (lower.includes('tahoma')) {
        if (lower.includes('bol') || isBold) return 'Tahoma-Bold';
        return 'Tahoma';
    }

    // Arial
    if (lower.includes('arial')) {
        if (lower.includes('bol') || isBold) return 'Arial-BoldMT';
        if (lower.includes('ita') || isItalic) return 'Arial-ItalicMT';
        return 'ArialMT';
    }

    // Already a specific PostScript name or unknown font
    return clean;
}

async function main() {
    const args = parseArgs();
    const manifestPath = args.manifest;
    if (!manifestPath || !fs.existsSync(manifestPath)) {
        console.error('Error: --manifest <path_to_json> is required');
        process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const { width, height, rawImagePath, outputPath, inpaintPatches, textLayers } = manifest;

    console.log(`[ag-psd] Building PSD: ${width}x${height} -> ${path.basename(outputPath)}`);

    const children = [];

    // 1. Background layer: RAW original image before inpainting
    if (rawImagePath && fs.existsSync(rawImagePath)) {
        const rawBuffer = fs.readFileSync(rawImagePath);
        children.push({
            name: "Background",
            left: 0,
            top: 0,
            right: width,
            bottom: height,
            canvas: {
                width: width,
                height: height,
                getContext: () => ({
                    getImageData: () => ({
                        width: width,
                        height: height,
                        data: rawBuffer
                    })
                })
            },
            protected: { all: true }
        });
    }

    // 2. Inpaint Patches layer group: กล่องละ 1 เลเยอร์
    if (inpaintPatches && inpaintPatches.length > 0) {
        const inpaintGroupChildren = [];
        for (const p of inpaintPatches) {
            if (p.rawPath && fs.existsSync(p.rawPath)) {
                const patchBuffer = fs.readFileSync(p.rawPath);
                inpaintGroupChildren.push({
                    name: p.name || `Inpaint #${p.number}`,
                    left: p.left,
                    top: p.top,
                    right: p.right,
                    bottom: p.bottom,
                    canvas: {
                        width: p.width,
                        height: p.height,
                        getContext: () => ({
                            getImageData: () => ({
                                width: p.width,
                                height: p.height,
                                data: patchBuffer
                            })
                        })
                    }
                });
            }
        }

        if (inpaintGroupChildren.length > 0) {
            children.push({
                name: "Inpaint Patches",
                opened: true,
                children: inpaintGroupChildren
            });
        }
    }

    // 3. Text layers group: Font TF LANNA Bold (PostScript: TFLanna-Bold)
    const textGroupChildren = [];
    for (const l of textLayers || []) {
        const color = hexToRgb(l.color || "#000000");
        const fontSize = Math.max(12, Math.round(l.fontSize || 24));
        const fontName = l.fontFamily || "TF LANNA Bold";
        const isBold = l.weight === 'bold' || l.weight === '700' || /bold/i.test(fontName);
        const isItalic = l.style === 'italic' || /italic|ita/i.test(fontName);

        // Resolve exact PostScript Name for Photoshop
        const postScriptName = resolvePostScriptName(fontName, isBold, isItalic);
        const hasNativeBold = /bold/i.test(postScriptName);
        const hasNativeItalic = /italic/i.test(postScriptName);

        const rawText = (l.text || "").trim();
        const lines = rawText.split(/\r?\n/);
        const lineCount = Math.max(1, lines.length);

        const lineHeightMul = 1.25;
        const lineHeight = fontSize * lineHeightMul;
        const totalTextHeight = Math.max(fontSize, lineCount * lineHeight);

        // Vertical centering offset for Photoshop point text:
        // Point text anchor Y corresponds to the baseline of the first line.
        // To center the multi-line block at l.y, shift baseline upwards by half of total lines height.
        const verticalShift = -((lineCount - 1) * lineHeight) / 2.0 + (fontSize * 0.30);
        const tx = Math.round(l.x);
        const ty = Math.round(l.y + verticalShift);

        const boxW = Math.max(40, Math.round(l.boxWidth || (fontSize * 5)));
        const halfW = Math.round(boxW / 2.0);
        const halfH = Math.round(totalTextHeight / 2.0);

        const textLayer = {
            name: rawText.replace(/\r?\n/g, ' ').substring(0, 30) || "Text Layer",
            text: {
                text: rawText.replace(/\r?\n/g, '\r'),
                transform: [1, 0, 0, 1, tx, ty],
                antiAlias: 'crisp',
                style: {
                    font: {
                        name: postScriptName,
                        script: 0,
                        type: 1, // TrueType/OpenType font (prevents font mismatch warning)
                        synthetic: 0
                    },
                    fontSize: fontSize,
                    fillColor: { r: color.r, g: color.g, b: color.b },
                    leading: Math.round(lineHeight),
                    autoLeading: false,
                    fauxBold: isBold && !hasNativeBold,
                    fauxItalic: isItalic && !hasNativeItalic,
                    autoKerning: true,
                    kerning: 0
                },
                paragraphStyle: { justification: 'center' }
            },
            left: Math.round(tx - halfW - 20),
            top: Math.round(l.y - halfH - 20),
            right: Math.round(tx + halfW + 20),
            bottom: Math.round(l.y + halfH + 20)
        };

        // White stroke effect for readability
        if (l.strokeWidth && l.strokeWidth > 0) {
            const strokeColor = hexToRgb(l.strokeColor || "#FFFFFF");
            textLayer.effects = {
                stroke: [{
                    enabled: true,
                    size: { units: 'Pixels', value: l.strokeWidth },
                    position: 'outside',
                    color: strokeColor,
                    opacity: 1
                }]
            };
        }

        textGroupChildren.push(textLayer);
    }

    if (textGroupChildren.length > 0) {
        children.push({
            name: "Translated Text",
            opened: true,
            children: textGroupChildren
        });
    }

    // Collect all unique postScript names used across layers
    const usedFontNames = Array.from(new Set(
        textGroupChildren.map(c => c.text && c.text.style && c.text.style.font ? c.text.style.font.name : null).filter(Boolean)
    ));
    const globalEngineData = getGlobalEngineDataBase64(usedFontNames);

    const psd = {
        width: width,
        height: height,
        engineData: globalEngineData,
        children: children
    };

    // Write PSD buffer without invalidateTextLayers (which causes warning icon T ⚠️ in Photoshop)
    const psdBuffer = agPsd.writePsdBuffer(psd, {
        trimImageData: true
    });

    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, psdBuffer);
    const sizeMb = (psdBuffer.length / (1024 * 1024)).toFixed(2);
    console.log(`[ag-psd] ✓ Successfully saved: ${outputPath} (${sizeMb} MB) with ${inpaintPatches ? inpaintPatches.length : 0} inpaint layers, ${textLayers ? textLayers.length : 0} text layers`);
}

main().catch(err => {
    console.error('[ag-psd] Error:', err);
    process.exit(1);
});
