/**
 * A QR code as one SVG `<path>`, sized to a box on the card.
 *
 * Why it is on the card at all: the story is going to be screenshotted, and a
 * screenshot cannot be tapped. iOS Live Text and Android Lens both find a QR
 * inside a still image, which is the one route back into the game that survives
 * being photographed off someone else's screen.
 *
 * One path, not a rect per module: a 25×25 symbol is ~300 dark modules, and 300
 * `<rect>` elements is a slower parse and a bigger file for an identical result.
 */
import qrcode from 'qrcode-generator';

/**
 * Level M — 15% recovery. Instagram re-compresses whatever it is handed, and L
 * starts to fail once the card has been through that and a screenshot as well.
 * H would survive more but costs a denser symbol, which loses more to the
 * re-compression than the extra recovery wins back.
 */
const ERROR_CORRECTION = 'M';

/**
 * Quiet zone in modules. The spec says 4 and scanners genuinely need it: with
 * less, the card's own background reads as part of the symbol.
 */
export const QUIET_MODULES = 4;

export interface QrArt {
  /** Path data in the box's own coordinates, ready to drop into the card SVG. */
  path: string;
  /** Modules per side, excluding the quiet zone. */
  moduleCount: number;
  /** Side of one module, in user units. */
  moduleSize: number;
}

/**
 * Never throws. A card without a QR still carries the short URL in large type,
 * which is the fallback the QR exists to improve on — so a QR that cannot be
 * built is a smaller loss than a card that cannot be built.
 */
export function qrArt(text: string, size: number): QrArt | null {
  if (!text || size <= 0) return null;
  try {
    // Type 0 picks the smallest symbol the text fits in.
    const qr = qrcode(0, ERROR_CORRECTION);
    qr.addData(text);
    qr.make();

    const moduleCount = qr.getModuleCount();
    const total = moduleCount + QUIET_MODULES * 2;
    const moduleSize = size / total;
    const offset = QUIET_MODULES * moduleSize;

    const parts: string[] = [];
    for (let row = 0; row < moduleCount; row += 1) {
      // Runs, not modules: consecutive dark modules in a row become one rect,
      // which roughly halves the path on a typical symbol.
      let runStart = -1;
      for (let col = 0; col <= moduleCount; col += 1) {
        const dark = col < moduleCount && qr.isDark(row, col);
        if (dark && runStart === -1) runStart = col;
        if (!dark && runStart !== -1) {
          parts.push(rect(offset + runStart * moduleSize, offset + row * moduleSize, (col - runStart) * moduleSize, moduleSize));
          runStart = -1;
        }
      }
    }

    return { path: parts.join(''), moduleCount, moduleSize };
  } catch {
    return null;
  }
}

/** A closed rectangle subpath, at the precision a rasteriser can actually use. */
function rect(x: number, y: number, width: number, height: number): string {
  return `M${round(x)} ${round(y)}h${round(width)}v${round(height)}h${round(-width)}z`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
