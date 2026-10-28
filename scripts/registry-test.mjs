// node scripts/registry-test.mjs
// Guards against the failure that caused the bug: a game that exists but
// never registers, or registers under a name nothing can open.
import { readFileSync } from 'node:fs';
import { GAME_IDS, ROOM_ROUTES, ROOM_SEGMENTS } from '../src/rooms.js';

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
  ['src/links-course.js', 'links'],
]) {
  const src = read(file);
  ok(`${game} announces through the shared helper`, src.includes('announceRoom(this.env'));
  ok(`${game} registers under its own name`, src.includes(`game: "${game}"`));
  ok(`${game} announces on join, on change and on leave`, (src.match(/this\.announce\(\)/g) || []).length >= 3);
}

console.log('\nevery room that announces');
{
  // Eight Durable Objects announce rooms. Each must say which game it is, in its own
  // words and as one the server lists, and between them they must be every game
  // that has a room (the casino is solo against the house and has none).
  const files = ['lobby', 'battle-lobby', 'mine-lobby', 'links-course', 'grand-prix', 'buzzer-room', 'artillery-room', 'match3-room'];
  const said = [];
  for (const f of files) {
    const src = read(`src/${f}.js`);
    const calls = src.match(/announceRoom\(this\.env[\s\S]{0,60}?game:\s*"([^"]*)"/g) || [];
    const ids = calls.map((c) => /game:\s*"([^"]*)"/.exec(c)[1]);
    ok(`${f} announces once, under a game the server lists`, ids.length === 1 && GAME_IDS.includes(ids[0]));
    said.push(...ids);
  }
  ok('no two rooms announce as the same game', new Set(said).size === said.length);
  ok('and between them they are every game that has a room', GAME_IDS.filter((g) => g !== 'casino').every((g) => said.includes(g)) && said.length === GAME_IDS.length - 1);
}

console.log('\nthe route is built from one table');
{
  const index = read('src/index.js');
  const rooms = read('src/rooms.js');
  const dir = read('src/directory.js');
  ok('the Worker builds the room socket route from the table', /ROOM_SOCKET\s*=\s*new RegExp/.test(index) && /ROOM_SEGMENTS/.test(index) && /resolveRoomRoute\(/.test(index));
  ok('it no longer lists the games by hand, so a new one cannot be added to one list and missed in the other',
    !/\(battle\|mines\|links\|prix\|buzzer\|tanks\|match3\)/.test(index));
  ok('and has no namespace to fall back on when a game has none', !/:\s*env\.BATTLE\s*;/.test(index));
  ok('a game with no room to hand it to is refused with its own status', /return json\(\{ error: route\.error \}, route\.status\)/.test(index));
  ok('the table names every game with a room on a socket route', ROOM_SEGMENTS.length === GAME_IDS.length - 2);
  ok('and Word-Cross keeps its own route', /\/api\\\/dojo\\\/\(\[A-Za-z0-9-\]\{3,16\}\)\\\/ws/.test(index) || /api\/dojo\/\(/.test(index));
  ok('the directory has no default game', !/\|\|\s*"crossword"/.test(dir) && !/\|\|\s*'crossword'/.test(dir));
  ok('and the helper names the crossword once, in the list of games', (rooms.match(/"crossword"/g) || []).length === 1);
  ok('every route points at a game in the list', Object.values(ROOM_ROUTES).every((r) => GAME_IDS.includes(r.game)));
}

console.log('\nno silent fallback');
ok('an unknown game is reported, not guessed',
  /this version doesn't know/.test(app) && !/enterDojo\(code\);\s*\n\}/.test(app.split('function openRoom')[1] || ''));


console.log('\nthe build stamp');
{
  // The page says what it was built from; version.json says what is current.
  // The update bar is the difference between them, so a deploy that moved one
  // and not the other nags every player on every load.
  const meta = /<meta name="build" content="([^"]*)"/.exec(read('public/index.html'))?.[1];
  const json = JSON.parse(read('public/version.json')).build;
  ok('index.html carries a build stamp', !!meta);
  ok('version.json carries a build stamp', !!json);
  ok('and they agree (run `npm run stamp` if not)', meta === json);
}

console.log(bad ? `\n${bad} failing` : '\nall registry checks passed');
process.exit(bad ? 1 : 0);
