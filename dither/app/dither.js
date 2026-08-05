const BAYER_MATRIX = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
];

// Normalize matrix values to 0-1 range
const BAYER_NORMALIZED = BAYER_MATRIX.map(row =>
    row.map(val => (val + 0.5) / 16)
);

// Exposure compensation value (-2 to +2 EV)
let exposureCompensation = 0;

// Dither strength (0 to 1, where 1 is full dither)
let ditherStrength = 1.0;

function setExposureCompensation(ev) {
    exposureCompensation = Math.max(-2, Math.min(2, ev));
}

function setDitherStrength(strength) {
    ditherStrength = Math.max(0, Math.min(1, strength));
}

function applyDithering(imageData, width, height) {
    const data = imageData.data;
    
    // Calculate exposure multiplier
    // EV -2 = 0.25x brightness, EV 0 = 1x, EV +2 = 4x
    const evMultiplier = Math.pow(2, exposureCompensation);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;

            // Get Bayer threshold for this pixel position
            const threshold = BAYER_NORMALIZED[y % 4][x % 4];

            // Apply threshold to RGB channels
            let r = data[idx];
            let g = data[idx + 1];
            let b = data[idx + 2];

            // Apply exposure compensation BEFORE dithering
            r = Math.min(255, r * evMultiplier);
            g = Math.min(255, g * evMultiplier);
            b = Math.min(255, b * evMultiplier);

            // Add dither noise (scaled by dither strength)
            const ditherAmount = (threshold - 0.5) * 64 * ditherStrength;
            r = Math.min(255, Math.max(0, r + ditherAmount));
            g = Math.min(255, Math.max(0, g + ditherAmount));
            b = Math.min(255, Math.max(0, b + ditherAmount));

            // Find closest color in current palette
            const colorIdx = findClosestColor(r, g, b);
            const [finalR, finalG, finalB] = currentPalette[colorIdx];

            // Write back to imageData
            data[idx] = finalR;
            data[idx + 1] = finalG;
            data[idx + 2] = finalB;
            // Alpha channel unchanged
        }
    }
}
