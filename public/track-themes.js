// What each circuit looks like.
//
// Six circuits, six skies. The race screen takes the colours of whatever the
// grid voted for, so the moment the lights go out the room is somewhere —
// under a reef, in a canyon, in orbit — rather than on the same dark page
// with a different name at the top.
//
// Keyed by circuit id, because that is what the room says and what the client
// holds; the display name works too, so applyTrackTheme("Neon Reef") does what
// it looks like it does. The names and descriptions here are the ones in
// src/prix.js and must stay in step with them — scripts/prix-test.mjs checks
// that every circuit has a theme and that the words match.

export const TRACK_THEMES = {
  reef: {
    name: "Neon Reef",
    background: "linear-gradient(135deg, #0f2027, #203a43, #2c5364)",
    accentColor: "#00ffcc",
    glowColor: "rgba(0, 255, 204, 0.4)",
    particleType: "bubbles",
    description: "Wide, bright, forgiving",
  },
  cinder: {
    name: "Cinder Rally",
    background: "linear-gradient(135deg, #2b1010, #4a1515, #1f0c0c)",
    accentColor: "#ff4500",
    glowColor: "rgba(255, 69, 0, 0.4)",
    particleType: "embers",
    description: "The one to learn on",
  },
  canyon: {
    name: "The Glass Canyon",
    background: "linear-gradient(135deg, #2c3e50, #3498db, #1abc9c)",
    accentColor: "#f1c40f",
    glowColor: "rgba(241, 196, 15, 0.4)",
    particleType: "dust",
    description: "One long straight",
  },
  orbital: {
    name: "Orbital Ring",
    background: "linear-gradient(135deg, #050515, #10072e, #1a0033)",
    accentColor: "#9b59b6",
    glowColor: "rgba(155, 89, 182, 0.5)",
    particleType: "stars",
    description: "Short laps, constant contact",
  },
  bramble: {
    name: "Bramble Hollow",
    background: "linear-gradient(135deg, #0b2514, #13381a, #1b4d22)",
    accentColor: "#2ecc71",
    glowColor: "rgba(46, 204, 113, 0.4)",
    particleType: "leaves",
    description: "Items everywhere",
  },
  midnight: {
    name: "Midnight Circuit",
    background: "linear-gradient(135deg, #0a0a0a, #1a1a1a, #000000)",
    accentColor: "#3498db",
    glowColor: "rgba(52, 152, 219, 0.3)",
    particleType: "gridlines",
    description: "The hard one",
  },
};

export const DEFAULT_TRACK = "reef";

/** How long a sky takes to become the next one. Matches the CSS. */
export const FADE_MS = 800;

/** How many specks each kind of weather gets. Cheap enough to leave running. */
const PARTICLE_COUNT = { bubbles: 18, embers: 22, dust: 16, stars: 26, leaves: 14, gridlines: 0 };

/** A circuit id, a display name, or an object with either on it. */
export function themeFor(track) {
  if (!track) return TRACK_THEMES[DEFAULT_TRACK];
  const key = typeof track === "string" ? track : track.circuit || track.id || track.name;
  if (TRACK_THEMES[key]) return TRACK_THEMES[key];
  const byName = Object.values(TRACK_THEMES).find((t) => t.name === key);
  return byName || TRACK_THEMES[DEFAULT_TRACK];
}

/**
 * Put a circuit's sky on the screen.
 *
 * The gradient goes on a layer of its own rather than on the element, and a
 * new layer fades in over the old one — because CSS cannot interpolate a
 * gradient, so `transition: background` on the element itself does nothing at
 * all and the sky would snap. Two layers and an opacity is the whole trick.
 *
 * The accent and the glow go out as custom properties, so anything on the
 * screen that wants to match the track can read them without knowing this
 * file exists.
 */
export function applyTrackTheme(track, host) {
  const theme = themeFor(track);
  const screen = host
    || document.getElementById("screen-prix")
    || document.getElementById("game-container")
    || document.body;
  if (!screen) return theme;

  screen.style.setProperty("--track-accent", theme.accentColor);
  screen.style.setProperty("--track-glow", theme.glowColor);
  // Also on the root, for anything outside the screen that wants to match.
  document.documentElement.style.setProperty("--track-accent", theme.accentColor);
  document.documentElement.style.setProperty("--track-glow", theme.glowColor);
  screen.dataset.track = Object.keys(TRACK_THEMES).find((k) => TRACK_THEMES[k] === theme) || DEFAULT_TRACK;

  const sky = skyOf(screen);
  const last = sky.lastElementChild;
  // Already wearing it: nothing to fade, and fading a sky onto itself is a
  // flicker for no reason.
  if (last?.dataset.track === screen.dataset.track) return theme;

  const layer = document.createElement("div");
  layer.className = "track-layer";
  layer.dataset.track = screen.dataset.track;
  layer.style.background = theme.background;
  layer.append(weather(theme));
  sky.append(layer);

  // The layer has to be committed at zero before it is told to be one, or
  // there is nothing to transition from. Reading a layout property does that
  // synchronously — an animation frame would too, except that a tab in the
  // background runs none, and a race that starts while somebody is reading
  // their email should not come back to an invisible sky.
  void layer.offsetWidth;
  layer.classList.add("is-on");
  // Older skies go once this one is up. Kept until then rather than swapped,
  // which is what makes it a fade rather than a cut to black.
  setTimeout(() => {
    while (sky.firstElementChild && sky.firstElementChild !== layer) {
      sky.firstElementChild.remove();
    }
  }, FADE_MS + 60);

  return theme;
}

/** Take the sky away — for a screen that is no longer a race. */
export function clearTrackTheme(host) {
  const screen = host || document.getElementById("screen-prix");
  const sky = screen?.querySelector(".track-sky");
  if (sky) sky.textContent = "";
  if (screen) delete screen.dataset.track;
}

function skyOf(screen) {
  let sky = screen.querySelector(":scope > .track-sky");
  if (!sky) {
    sky = document.createElement("div");
    sky.className = "track-sky";
    sky.setAttribute("aria-hidden", "true");
    screen.prepend(sky);
  }
  return sky;
}

/**
 * The weather: a handful of specks that drift, rise or fall by kind.
 *
 * Deliberately small and deliberately CSS — a canvas would want a loop, and a
 * loop that runs behind a game for the length of a race has to earn its frame
 * budget. Anybody who has asked for less motion gets none of it; the sky still
 * changes colour, which is the part that carries the meaning.
 */
function weather(theme) {
  const field = document.createElement("div");
  field.className = `track-weather track-${theme.particleType}`;
  const n = PARTICLE_COUNT[theme.particleType] || 0;
  for (let i = 0; i < n; i++) {
    const bit = document.createElement("i");
    // Spread in space and in time, so they never arrive as a wave.
    bit.style.left = `${Math.round(Math.random() * 100)}%`;
    bit.style.animationDelay = `${(Math.random() * 14).toFixed(2)}s`;
    bit.style.animationDuration = `${(9 + Math.random() * 12).toFixed(2)}s`;
    bit.style.setProperty("--drift", `${Math.round((Math.random() - 0.5) * 120)}px`);
    bit.style.setProperty("--size", `${(2 + Math.random() * 5).toFixed(1)}px`);
    field.append(bit);
  }
  return field;
}
