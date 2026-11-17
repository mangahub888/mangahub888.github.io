/**
 * Standalone PSD Exporter using ag-psd
 * Can be run in Node.js locally or in GitHub Actions CI
 */
const fs = require('fs');
const path = require('path');

const AG_PSD_PATH = path.resolve(__dirname, '../app/static/js/vendor/ag-psd.bundle.js');
const agPsd = require(AG_PSD_PATH);

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

    // 3. Text layers group: Font TF LANNA Bold
    const textGroupChildren = [];
    for (const l of textLayers || []) {
        const color = hexToRgb(l.color || "#000000");
        const fontSize = l.fontSize || 24;
        const fontName = l.fontFamily || "TF LANNA Bold";
        const isBold = l.weight === 'bold' || l.weight === '700' || /bold/i.test(fontName);

        const lines = (l.text || "").split('\n');
        const totalTextHeight = fontSize * 1.2 * lines.length;

        const textLayer = {
            name: (l.text || "").replace(/\n/g, ' ').substring(0, 30) || "Text Layer",
            text: {
                text: (l.text || "").replace(/\n/g, '\r'),
                transform: [1, 0, 0, 1, l.x, l.y],
                style: {
                    font: { name: fontName },
                    fontSize: fontSize,
                    fillColor: { r: color.r, g: color.g, b: color.b },
                    autoLeading: true,
                    fauxBold: isBold
                },
                paragraphStyle: { justification: 'center' }
            },
            left: Math.round(l.x - (l.boxWidth / 2) - 20),
            top: Math.round(l.y - (totalTextHeight / 2) - 20),
            right: Math.round(l.x + (l.boxWidth / 2) + 20),
            bottom: Math.round(l.y + (totalTextHeight / 2) + 20)
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
    console.log(`[ag-psd] ✓ Successfully saved: ${outputPath} (${sizeMb} MB) with ${inpaintPatches ? inpaintPatches.length : 0} inpaint layers, ${textLayers.length} text layers`);
}

main().catch(err => {
    console.error('[ag-psd] Error:', err);
    process.exit(1);
});
