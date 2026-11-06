// Photo resizing. downscaleDimensions is pure; resizeImage needs a browser (no work at import time).

export function downscaleDimensions(w, h, maxEdge = 1280) {
  const long = Math.max(w, h);
  if (long <= maxEdge) return { w, h };
  const k = maxEdge / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close?.() };
    } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close() {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function resizeImage(file) {
  const d = await decode(file);
  try {
    const { w, h } = downscaleDimensions(d.w, d.h);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(d.src, 0, 0, w, h);
    const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the photo.'))), 'image/jpeg', 0.85));
    return { blob, w, h };
  } finally {
    d.close();
  }
}
