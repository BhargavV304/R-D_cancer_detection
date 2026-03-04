const fs = require('fs-extra');
const path = require('path');
const dicomParser = require('dicom-parser');
const sharp = require('sharp');
const glob = require('glob');
const sanitize = require('sanitize-filename');

function cleanForFilename(str) {
    return sanitize(str.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_')).replace(/^_+|_+$/g, '');
}

function normalizeTo8Bit(pixelData, rows, columns) {
    // pixelData is usually Int16/Uint16 Buffer → convert to array for math
    const values = new Int16Array(pixelData.buffer, pixelData.byteOffset, pixelData.length / 2);

    // Find approximate min/max using percentiles (rough but fast)
    const sorted = [...values].sort((a, b) => a - b);
    const lowIdx = Math.floor(sorted.length * 0.005);
    const highIdx = Math.floor(sorted.length * 0.995);
    let minVal = sorted[lowIdx];
    let maxVal = sorted[highIdx];

    if (maxVal === minVal) {
        minVal = Math.min(...values);
        maxVal = Math.max(...values);
    }

    const range = maxVal - minVal || 1;

    // Create 8-bit image data
    const uint8 = new Uint8Array(rows * columns);
    for (let i = 0; i < values.length; i++) {
        let norm = (values[i] - minVal) / range;
        norm = Math.max(0, Math.min(1, norm));
        uint8[i] = Math.round(norm * 255);
    }

    return uint8;
}

async function convertDcmToPng(dcmPath, outputDir) {
    try {
        const buffer = await fs.readFile(dcmPath);
        const dataSet = dicomParser.parseDicom(buffer);

        const rows = dataSet.uint16('x00280010');
        const columns = dataSet.uint16('x00280011');
        const pixelDataElement = dataSet.elements.x7fe00010;

        if (!pixelDataElement || !rows || !columns) {
            console.warn(`Skipping ${path.basename(dcmPath)} — missing pixel data / dimensions`);
            return false;
        }

        const pixelData = new Uint8Array(
            buffer.buffer,
            pixelDataElement.dataOffset,
            pixelDataElement.length
        );

        const pixel8bit = normalizeTo8Bit(pixelData, rows, columns);

        // Build filename with relative path info
        const relPath = path.relative(rootFolder, path.dirname(dcmPath));
        const folderPart = relPath === '' ? 'root' : cleanForFilename(relPath);
        const baseName = cleanForFilename(path.basename(dcmPath, path.extname(dcmPath)));

        const pngName = `${folderPart}__${baseName}.png`;
        const pngPath = path.join(outputDir, pngName);

        await sharp({
            create: {
                width: columns,
                height: rows,
                channels: 1,
                background: { r: 0, g: 0, b: 0, alpha: 1 }
            }
        })
            .raw()
            .toBuffer({ resolveWithObject: true })
            .then(({ data }) => {
                // data is reference — we replace it
                pixel8bit.copy(data);
            })
            .then(() => sharp(pixel8bit, { raw: { width: columns, height: rows, channels: 1 } })
                .png()
                .toFile(pngPath)
            );

        console.log(`Saved: ${pngName}`);
        return true;

    } catch (err) {
        console.error(`Error processing ${path.basename(dcmPath)}:`, err.message);
        return false;
    }
}

async function main() {
    // ────────────────────────────────────────────────
    const rootFolder = "MSB-00101";               // ← change this
    const outputFolder = "MSB-00101_png";     // ← change this
    // ────────────────────────────────────────────────

    await fs.ensureDir(outputFolder);

    console.log(`Scanning: ${rootFolder}`);
    const pattern = path.join(rootFolder, '**', '*.dcm'); // also catches *.DCM etc.
    const files = glob.sync(pattern, { nocase: true });

    console.log(`Found ${files.length} .dcm files`);

    if (files.length === 0) {
        console.log("Nothing to convert.");
        return;
    }

    let success = 0;
    for (const file of files) {
        const ok = await convertDcmToPng(file, outputFolder);
        if (ok) success++;
    }

    console.log(`\nFinished: ${success}/${files.length} files converted`);
    console.log(`Output folder: ${outputFolder}`);
    console.log("Filename format: relative_folder_path__original_name.png");
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});