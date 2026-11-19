// Light / dark / follow-the-device appearance, remembered on this device (localStorage).
// index.html applies the saved choice before first paint; Settings changes it.
export const THEMES = ['auto', 'light', 'dark'];
export const THEME_LABEL = { auto: 'Match device', light: 'Light', dark: 'Dark' };
const KEY = 'bey-lab-theme';

export function loadTheme(storage = globalThis.localStorage) {
  try {
    const v = storage?.getItem(KEY);
    return THEMES.includes(v) ? v : 'auto';
  } catch { return 'auto'; }
}

// Sets data-theme on <html> (none for 'auto', so the device setting decides) and saves the choice.
export function applyTheme(theme, { root = globalThis.document?.documentElement, storage = globalThis.localStorage } = {}) {
  const t = THEMES.includes(theme) ? theme : 'auto';
  if (root) {
    if (t === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
  }
  try {
    if (t === 'auto') storage?.removeItem(KEY);
    else storage?.setItem(KEY, t);
  } catch { /* private mode: still applied for this session */ }
  return t;
}
