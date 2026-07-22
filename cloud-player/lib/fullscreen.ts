/** Cross-browser Fullscreen helpers + CSS fallback for iOS Safari. */

type FsDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FsEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
};

const NATIVE_FS_TIMEOUT_MS = 400;

export function getFullscreenElement(): Element | null {
  const doc = document as FsDoc;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/** iPhone/iPad Safari — element Fullscreen API is unreliable or hangs. */
export function prefersCssFullscreen(): boolean {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return true;
  if (document.fullscreenEnabled === false) return true;

  const ua = navigator.userAgent;
  const iOS =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) return true;

  // Touch devices that claim the API but often fail for non-video elements.
  if (navigator.maxTouchPoints > 0 && /Mobile|Android/i.test(ua)) {
    if (!document.documentElement.requestFullscreen) return true;
  }

  return false;
}

export function nativeFullscreenSupported(el?: HTMLElement | null): boolean {
  if (typeof document === 'undefined') return false;
  if (prefersCssFullscreen()) return false;
  if (document.fullscreenEnabled === false) return false;
  if (!el) {
    return typeof document.documentElement.requestFullscreen === 'function'
      || typeof (document.documentElement as FsEl).webkitRequestFullscreen === 'function'
      || typeof (document.documentElement as FsEl).webkitRequestFullScreen === 'function';
  }
  const node = el as FsEl;
  return typeof node.requestFullscreen === 'function'
    || typeof node.webkitRequestFullscreen === 'function'
    || typeof node.webkitRequestFullScreen === 'function';
}

async function requestNativeFullscreen(el: HTMLElement): Promise<boolean> {
  const node = el as FsEl;
  try {
    if (typeof node.requestFullscreen === 'function') {
      await node.requestFullscreen();
      return getFullscreenElement() === el;
    }
    const webkit = node.webkitRequestFullscreen || node.webkitRequestFullScreen;
    if (webkit) {
      await webkit.call(node);
      return getFullscreenElement() === el;
    }
  } catch {
    /* iOS Safari rejects / no-ops for non-video elements */
  }
  return false;
}

export async function requestElementFullscreen(el: HTMLElement): Promise<boolean> {
  if (prefersCssFullscreen()) return false;

  try {
    return await Promise.race([
      requestNativeFullscreen(el),
      new Promise<boolean>((resolve) => {
        window.setTimeout(() => resolve(false), NATIVE_FS_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return false;
  }
}

export async function exitElementFullscreen(): Promise<void> {
  if (!getFullscreenElement()) return;
  const doc = document as FsDoc;
  try {
    if (typeof document.exitFullscreen === 'function') {
      await document.exitFullscreen();
      return;
    }
    if (typeof doc.webkitExitFullscreen === 'function') {
      await doc.webkitExitFullscreen();
    }
  } catch {
    /* ignore */
  }
}

export function subscribeFullscreenChange(handler: () => void): () => void {
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
  return () => {
    document.removeEventListener('fullscreenchange', handler);
    document.removeEventListener('webkitfullscreenchange', handler);
  };
}
