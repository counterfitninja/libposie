/**
 * ISBN barcode scanning. Uses the native BarcodeDetector API where available
 * (Chrome/Android) and falls back to the bundled ZXing decoder everywhere else.
 */

let zxingPromise = null;

function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingPromise) {
    zxingPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/zxing/index.min.js';
      script.onload = () => resolve(window.ZXing);
      script.onerror = () => reject(new Error('Could not load the barcode decoder.'));
      document.head.appendChild(script);
    });
  }
  return zxingPromise;
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

export function cameraSupported() {
  return !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
}

/**
 * Starts the camera and calls onResult(text) for each decoded barcode.
 * Returns a stop() function.
 */
export async function startScanner(videoEl, onResult, onError) {
  let stopped = false;
  let stream = null;
  let controls = null;
  let rafId = null;

  const stop = () => {
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    controls?.stop?.();
    stream?.getTracks().forEach((t) => t.stop());
    videoEl.srcObject = null;
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    if (stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return stop;
    }
    videoEl.srcObject = stream;
    videoEl.setAttribute('playsinline', '');
    await videoEl.play();
  } catch (err) {
    onError?.(
      err.name === 'NotAllowedError'
        ? 'Camera access was blocked. Allow camera permission, or type the ISBN instead.'
        : 'No camera is available on this device. Type the ISBN instead.'
    );
    return stop;
  }

  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = FORMATS.filter((f) => supported.includes(f));
      if (formats.length) {
        const detector = new window.BarcodeDetector({ formats });
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(videoEl);
            if (codes[0]?.rawValue) onResult(codes[0].rawValue);
          } catch {
            /* transient decode failure */
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
        return stop;
      }
    } catch {
      /* fall through to ZXing */
    }
  }

  try {
    const ZXing = await loadZXing();
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.EAN_13,
      ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.UPC_A,
      ZXing.BarcodeFormat.UPC_E
    ]);
    const reader = new ZXing.BrowserMultiFormatReader(hints, 250);
    controls = { stop: () => reader.reset() };
    reader.decodeFromStream(stream, videoEl, (result) => {
      if (!stopped && result) onResult(result.getText());
    });
  } catch (err) {
    onError?.(err.message);
  }

  return stop;
}
