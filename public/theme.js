// The palette layer.
//
// A theme chooses four colours: the ground, the type, and two accents.
// Everything that carries structure — hairlines, muted text, card fills — is
// derived from those at a fixed strength, so it can never fade into its own
// background. That is a guarantee, not a convention: themes are not allowed
// to set those values.

export const THEMES = [
  // The house look: store-front blue-grey, a green action colour and a light
  // blue for everything you can follow. Unlike the other palettes this one
  // also changes shape — see the block scoped to [data-theme="os"] in
  // styles.css.
  { id: "os", name: "Origination OS", paper: "#0E1620", ink: "#E6EDF3", a1: "#7FB425", a2: "#66C0F4" },
  { id: "newsprint", name: "Newsprint", paper: "#F4F1EA", ink: "#141414", a1: "#D62828", a2: "#1D3557" },
  { id: "nightdojo", name: "Night Dojo", paper: "#10141f", ink: "#e8e4dc", a1: "#c8a44d", a2: "#6b7f5e" },
  { id: "cobra", name: "Cobra Kai", paper: "#0a0a0c", ink: "#ececf0", a1: "#f5c518", a2: "#c1272d" },
  { id: "slate", name: "Slate & Violet", paper: "#0F172A", ink: "#F1F5F9", a1: "#8B5CF6", a2: "#06B6D4" },
  { id: "tatami", name: "Tatami", paper: "#EFE9DC", ink: "#241F19", a1: "#C0392B", a2: "#4A6B52" },
  { id: "crt", name: "Arcade CRT", paper: "#07060d", ink: "#f2e9ff", a1: "#FF2FB9", a2: "#22E5FF" },
  { id: "blueprint", name: "Blueprint", paper: "#0B2036", ink: "#E0F2FE", a1: "#38BDF8", a2: "#FBBF24" },
  { id: "felt", name: "Championship", paper: "#0C2118", ink: "#F2EDE0", a1: "#C6A664", a2: "#7FB069" },
  { id: "neon", name: "Neon Tokyo", paper: "#0A0713", ink: "#F5F0FF", a1: "#FF3D9A", a2: "#4CC9F0" },
  { id: "terminal", name: "Terminal", paper: "#000000", ink: "#00FF5A", a1: "#B6FF00", a2: "#00C2FF" },
  { id: "sunset", name: "Sunset", paper: "#1A1033", ink: "#FFF3EC", a1: "#FF7E5F", a2: "#FEB47B" },
  { id: "concrete", name: "Concrete", paper: "#1C1C1C", ink: "#F5F5F5", a1: "#FFE500", a2: "#FF5C00" },
  { id: "forest", name: "Forest Ink", paper: "#101C17", ink: "#EDE6D8", a1: "#C98B4B", a2: "#7FA88B" },
  { id: "ember", name: "Ember", paper: "#121110", ink: "#F5F1EA", a1: "#FF8A3D", a2: "#FFC46B" },
];

export const DEFAULT_THEME = "os";

/**
 * Bumping this moves everybody onto the default once, whatever they had
 * chosen. It is a one-off: their next pick sticks as normal. Raising it
 * again is how a future change to the house look reaches existing players.
 */
export const THEME_EPOCH = 4;

/* ── legibility maths ─────────────────────────────────────────────────
   A filled tab has two jobs: its text must be readable on it, and it must be
   distinguishable from the page behind it. Mid-tone accents — brass, sage,
   dusty rose — fail the first against both black and white, so the fill is
   nudged darker or lighter until it passes. The hue survives; only the
   lightness moves. */

const hex2rgb = (h) => {
  const x = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
};
const rgb2hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

function luminance(hex) {
  const [r, g, b] = hex2rgb(hex).map((v) => v / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const toward = (hex, target, amount) =>
  rgb2hex(hex2rgb(hex).map((v, i) => v + (hex2rgb(target)[i] - v) * amount));

/**
 * A fill and the text that goes on it, guaranteed to be readable together.
 * @returns {{fill: string, on: string}}
 */
function chip(accent, minimum = 4.5) {
  let fill = accent;
  let on = contrast("#FFFFFF", fill) >= contrast("#141414", fill) ? "#FFFFFF" : "#141414";
  const away = on === "#FFFFFF" ? "#000000" : "#FFFFFF";
  for (let i = 0; i < 24 && contrast(on, fill) < minimum; i++) fill = toward(fill, away, 0.07);
  return { fill, on };
}

/** Keeps a fill distinguishable from the page it sits on. */
function edged(fill, paper, minimum = 1.6) {
  return contrast(fill, paper) < minimum;
}

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

/** Writes a palette onto the document, deriving everything structural. */
export function applyTheme(id) {
  const t = themeById(id);
  const r = document.documentElement.style;

  r.setProperty("--paper", t.paper);
  r.setProperty("--ink", t.ink);
  r.setProperty("--a1", t.a1);
  r.setProperty("--a2", t.a2);

  // Derived, never chosen — these are the contrast guarantees.
  r.setProperty("--rule", `color-mix(in srgb, ${t.ink} 30%, transparent)`);
  r.setProperty("--rule-solid", `color-mix(in srgb, ${t.ink} 24%, ${t.paper})`);
  r.setProperty("--muted", `color-mix(in srgb, ${t.ink} 64%, ${t.paper})`);
  r.setProperty("--card", `color-mix(in srgb, ${t.ink} 6%, ${t.paper})`);
  r.setProperty("--card-hi", `color-mix(in srgb, ${t.ink} 11%, ${t.paper})`);
  r.setProperty("--wash", `color-mix(in srgb, ${t.ink} 8%, transparent)`);
  // Inverting on hover uses the theme's own pair, or a dark palette hovers
  // black text onto a black button.
  r.setProperty("--flip-bg", t.ink);
  r.setProperty("--flip-ink", t.paper);

  // Filled tabs take the theme's own accents, adjusted until their text is
  // readable, so a tab is never lost whichever palette is on.
  const one = chip(t.a1);
  const two = chip(t.a2);
  r.setProperty("--a1-fill", one.fill);
  r.setProperty("--on-a1", one.on);
  r.setProperty("--a2-fill", two.fill);
  r.setProperty("--on-a2", two.on);
  // Where a fill sits close to the page, an outline keeps its edge.
  r.setProperty("--a1-edge", edged(one.fill, t.paper) ? t.ink : "transparent");
  r.setProperty("--a2-edge", edged(two.fill, t.paper) ? t.ink : "transparent");

  document.documentElement.dataset.theme = t.id;
  try {
    localStorage.setItem("dojo-theme", t.id);
    localStorage.setItem("dojo-theme-epoch", String(THEME_EPOCH));
  } catch { /* private mode */ }
}

/** The theme this browser last used, before any profile has loaded. */
export function savedTheme() {
  try {
    if (Number(localStorage.getItem("dojo-theme-epoch") || 0) < THEME_EPOCH) return DEFAULT_THEME;
    return localStorage.getItem("dojo-theme") || DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Whether a stored choice predates the current house look. */
export const isStale = (epoch) => Number(epoch || 0) < THEME_EPOCH;
