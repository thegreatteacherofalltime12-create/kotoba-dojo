// node scripts/registry-test.mjs
// Guards against the failure that caused the bug: a game that exists but
// never registers, or registers under a name nothing can open.
import { readFileSync } from 'node:fs';
import { GAME_IDS } from '../src/rooms.js';

let bad = 0;
const ok = (l, c) => { console.log(`${c ? '  pass' : '  FAIL'}  ${l}`); if (!c) bad++; };
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const arena = read('public/arena.js');
const app = read('public/app.js');
const declared = [...arena.matchAll(/game:\s*"([a-z]+)"/g)].map((m) => m[1]);
const opened = [...app.matchAll(/^\s{2}([a-z]+):\s*\(_?code/gm)].map((m) => m[1]);

console.log('\nregistry');
ok('every game in the menu has an opener', declared.every((g) => opened.includes(g)));
ok('every opener has a game in the menu', opened.every((g) => declared.includes(g)));
ok('the server knows the same list', declared.every((g) => GAME_IDS.includes(g)));
ok(`every game is wired (${declared.join(', ')})`, declared.length >= 3);

console.log('\nannouncing');
// The casino is solo against the house, so it has no room to announce.
for (const [file, game] of [
  ['src/lobby.js', 'crossword'],
  ['src/battle-lobby.js', 'battleship'],
  ['src/mine-lobby.js', 'minesweeper'],
]) {
  const src = read(file);
  ok(`${game} announces through the shared helper`, src.includes('announceRoom(this.env'));
  ok(`${game} registers under its own name`, src.includes(`game: "${game}"`));
  ok(`${game} announces on join, on change and on leave`, (src.match(/this\.announce\(\)/g) || []).length >= 3);
}

console.log('\nno silent fallback');
ok('an unknown game is reported, not guessed',
  /this version doesn't know/.test(app) && !/enterDojo\(code\);\s*\n\}/.test(app.split('function openRoom')[1] || ''));

console.log(bad ? `\n${bad} failing` : '\nall registry checks passed');
process.exit(bad ? 1 : 0);
