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
    // Standalone repository paths only
];
const agPsdPath = candidatePaths.find(p => fs.existsSync(p));
if (!agPsdPath) {
    console.error('Error: ag-psd.bundle.js not found in candidate paths: ' + JSON.stringify(candidatePaths));
    process.exit(1);
}
const agPsd = require(agPsdPath);

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

        const lineHeightMul = 1.2;
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
                left: Math.round(tx - halfW),
                top: Math.round(l.y - halfH),
                right: Math.round(tx + halfW),
                bottom: Math.round(l.y + halfH),
                style: {
                    font: { name: postScriptName },
                    fontSize: fontSize,
                    fillColor: { r: color.r, g: color.g, b: color.b },
                    autoLeading: true,
                    fauxBold: isBold && !hasNativeBold,
                    fauxItalic: isItalic && !hasNativeItalic
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

    const psd = {
        width: width,
        height: height,
        children: children
    };

    const psdBuffer = agPsd.writePsdBuffer(psd, {
        invalidateTextLayers: true,
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
