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
  },
};

/** Every token key to its spec, across the games. */
export const ALL_TOKENS = Object.assign({}, ...Object.values(ARSENALS));
