// Every arsenal token the shop sells, by game.
//
// Prices are casino money. `max` is how many of one kind a player may arm
// in a single match. The rooms apply the rules; the shop and the record
// write only need the keys and the prices. public/boost.js mirrors this
// list for the client and must be kept in step.
export const ARSENALS = {
  battleship: {
    bs_nuke:    { name: "Nuke Missile",        price: 500_000, max: 2, icon: "☢️" },
    bs_shots:   { name: "Extra Shots",          price: 25_000,  icon: "\u{1F3AF}" },
    bs_ships:   { name: "Extra Ships",          price: 5_000,   icon: "\u{1F6A2}" },
    bs_strike:  { name: "Tactical Air Strike",  price: 35_000,  icon: "✈️" },
    bs_shield:  { name: "Air Strike Defence",   price: 40_000,  icon: "\u{1F6E1}️" },
    bs_reveal:  { name: "Air Strike Reveal",    price: 13_000,  icon: "\u{1F52D}" },
    bs_torpedo: { name: "Submarine Torpedo",    price: 1_437,   icon: "\u{1F41F}" },
  },
  minesweeper: {
    ms_reveal:  { name: "Mine Reveal",   price: 20_000,  max: 2, icon: "\u{1F50E}" },
    ms_buster:  { name: "Mine Buster",   price: 5_000,   max: 5, icon: "\u{1F9E8}" },
    ms_clear:   { name: "Clear Map",     price: 200_000, max: 1, icon: "\u{1F9F9}" },
    ms_shield:  { name: "Invincibility", price: 30_550,  max: 2, icon: "\u{1F6E1}️" },
  },
};

/** Every token key to its spec, across the games. */
export const ALL_TOKENS = Object.assign({}, ...Object.values(ARSENALS));
