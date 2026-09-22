// Every arsenal token the shop sells, by game.
//
// Prices are casino money. `max` is how many of one kind a player may arm
// in a single match. The rooms apply the rules; the shop and the record
// write only need the keys and the prices. public/boost.js mirrors this
// list for the client and must be kept in step.
export const ARSENALS = {
  battleship: {
    bs_nuke:    { name: "Nuke Missile",        price: 50_000, max: 2, icon: "☢️" },
    bs_shots:   { name: "Extra Shots",          price: 2_500,  icon: "\u{1F3AF}" },
    bs_ships:   { name: "Extra Ships",          price: 500,     icon: "\u{1F6A2}" },
    bs_strike:  { name: "Tactical Air Strike",  price: 3_500,  icon: "✈️" },
    bs_shield:  { name: "Air Strike Defence",   price: 4_000,  icon: "\u{1F6E1}️" },
    bs_reveal:  { name: "Air Strike Reveal",    price: 1_300,  icon: "\u{1F52D}" },
    bs_torpedo: { name: "Submarine Torpedo",    price: 143,   icon: "\u{1F41F}" },
    bs_sonar:   { name: "Sonar Ping",          price: 900,   max: 4, icon: "\u{1F50A}" },
    bs_radar:   { name: "Radar Sweep",         price: 1_500, max: 3, icon: "\u{1F4E1}" },
    bs_spotter: { name: "Spotter Plane",       price: 1_200, max: 3, icon: "\u{1F6E9}\uFE0F" },
    bs_scope:   { name: "Periscope",           price: 700,   max: 3, icon: "\u{1F52D}" },
    bs_depth:   { name: "Depth Charge",        price: 2_000, max: 3, icon: "\u{1F4A3}" },
    bs_priority:{ name: "Priority Target",     price: 1_000, max: 3, icon: "\u{1F3AF}" },
    bs_point:   { name: "Point Defence",       price: 1_600, max: 3, icon: "\u{1F6DF}" },
    bs_repair:  { name: "Repair Crew",         price: 3_000, max: 2, icon: "\u{1F527}" },
    bs_armour:  { name: "Reinforced Hull",     price: 2_600, max: 2, icon: "\u{1F6E1}" },
    bs_evade:   { name: "Evasive Maneuvers",   price: 2_200, max: 2, icon: "\u2194\uFE0F" },
    bs_smoke:   { name: "Smoke Screen",        price: 4_500, max: 1, icon: "\u{1F32B}\uFE0F" },
  },
  links: {
    gf_mulligan: { name: "Mulligan",            price: 800,   max: 3, icon: "🔄" },
    gf_hint:     { name: "Caddie's Hint",       price: 400,   max: 5, icon: "💡" },
    gf_finder:   { name: "Range Finder",        price: 600,   max: 3, icon: "📏" },
    gf_relief:   { name: "Ground Under Repair", price: 900,   max: 3, icon: "🚧" },
    gf_gimme:    { name: "Gimme",               price: 2_500, max: 2, icon: "🤝" },
    gf_practice: { name: "Practice Swing",      price: 500,   max: 5, icon: "🏌️" },
    gf_fitting:  { name: "Club Fitting",        price: 700,   max: 3, icon: "🔧" },
    gf_bounce:   { name: "Lucky Bounce",        price: 1_800, max: 2, icon: "🍀" },
    gf_local:    { name: "Local Knowledge",     price: 600,   max: 4, icon: "🗺️" },
    gf_club:     { name: "Extra Club",          price: 500,   max: 4, icon: "🏌" },
    gf_drop:     { name: "Drop Zone",           price: 1_200, max: 2, icon: "🎯" },
    gf_tees:     { name: "Preferred Lies",      price: 1_500, max: 2, icon: "⛳" },
    gf_double:   { name: "Double Down",         price: 1_000, max: 3, icon: "⚖️" },
    gf_eagle:    { name: "Eagle Eye",           price: 2_000, max: 2, icon: "🦅" },
    gf_pencil:   { name: "Scorecard Pencil",    price: 3_000, max: 1, icon: "✏️" },
    gf_wind:     { name: "Wind Gauge",          price: 2_200, max: 2, icon: "🌬️" },
    gf_book:     { name: "Caddie's Book",       price: 900,   max: 2, icon: "📒" },
    gf_ace:      { name: "Ace Chaser",          price: 2_800, max: 2, icon: "🎯" },
  },
  minesweeper: {
    ms_reveal:  { name: "Mine Reveal",   price: 2_000,  max: 2, icon: "\u{1F50E}" },
    ms_buster:  { name: "Mine Buster",   price: 500,     max: 5, icon: "\u{1F9E8}" },
    ms_clear:   { name: "Clear Map",     price: 20_000, max: 1, icon: "\u{1F9F9}" },
    ms_shield:  { name: "Invincibility", price: 3_055,  max: 2, icon: "\u{1F6E1}️" },
    ms_detect:  { name: "Metal Detector",    price: 800,    max: 5, icon: "\u{1F9F2}" },
    ms_radar:   { name: "Radar Sweep",       price: 1_200,  max: 4, icon: "\u{1F4E1}" },
    ms_quad:    { name: "Quadrant Scan",     price: 600,    max: 3, icon: "\u{1F5FA}\uFE0F" },
    ms_drone:   { name: "Spotter Drone",     price: 1_500,  max: 3, icon: "\u{1F6F8}" },
    ms_flags:   { name: "Frontier Flags",    price: 2_400,  max: 3, icon: "\u{1F6A9}" },
    ms_gloves:  { name: "Sapper's Gloves",   price: 4_500,  max: 2, icon: "\u{1F9E4}" },
    ms_second:  { name: "Second Sweep",      price: 12_000, max: 1, icon: "\u267B\uFE0F" },
    ms_recon:   { name: "Recon Patrol",      price: 3_200,  max: 3, icon: "\u{1FA96}" },
    ms_demo:    { name: "Demolition Charge", price: 2_500,  max: 2, icon: "\u{1F4A5}" },
    ms_opening: { name: "Lucky Opening",     price: 1_000,  max: 1, icon: "\u{1F331}" },
    ms_chord:   { name: "Chord",             price: 300,    max: 8, icon: "\u26CF\uFE0F" },
    ms_watch:   { name: "Stopwatch",         price: 2_000,  max: 3, icon: "\u23F1\uFE0F" },
    ms_hazard:  { name: "Hazard Pay",        price: 1_800,  max: 2, icon: "\u{1FA79}" },
    ms_promo:   { name: "Field Promotion",   price: 3_500,  max: 1, icon: "\u{1F396}\uFE0F" },
  },
};

/** Every token key to its spec, across the games. */
export const ALL_TOKENS = Object.assign({}, ...Object.values(ARSENALS));
