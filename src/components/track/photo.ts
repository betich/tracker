import { MAX_PHOTO_CHARS } from "@tracker/protocol";

/** Longest edge, in px, of the first encoding attempt. */
const START_EDGE = 1400;
/** JPEG quality of the first attempt, and the floor it will not go below. */
const START_QUALITY = 0.75;
const MIN_QUALITY = 0.4;
/** Each retry shrinks by this factor before dropping quality again. */
const SHRINK = 0.75;
const MIN_EDGE = 480;

/**
 * Turn a picked file into a JPEG data URL small enough to cross a WebSocket.
 *
 * Phone cameras produce multi-megabyte images and a Workers frame caps at 1 MiB,
 * so this steps size and quality down until the encoding fits, rather than
 * failing on a photo the user just took.
 */
export async function toDataUrl(file: File): Promise<string> {
  // Phone cameras record rotation in EXIF rather than in the pixels, so without
  // this a portrait shot is drawn to the canvas on its side.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  try {
    let edge = Math.min(START_EDGE, Math.max(bitmap.width, bitmap.height));
    let quality = START_QUALITY;

    for (let attempt = 0; attempt < 8; attempt++) {
      const scale = edge / Math.max(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));

      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const encoded = canvas.toDataURL("image/jpeg", quality);
      if (encoded.length <= MAX_PHOTO_CHARS) return encoded;

      // Trade quality first — it's cheaper visually than losing resolution.
      if (quality > MIN_QUALITY) quality = Math.max(MIN_QUALITY, quality - 0.12);
      else if (edge > MIN_EDGE) edge = Math.max(MIN_EDGE, Math.round(edge * SHRINK));
      else break;
    }

    throw new Error("That photo is too large to send.");
  } finally {
    bitmap.close();
  }
}
