// node scripts/mines-scores-test.mjs
import { MineField } from '../src/mine-lobby.js';
let bad=0; const ok=(l,c)=>{console.log((c?'  pass':'  FAIL')+'  '+l); if(!c)bad++;};

const kv = new Map();
const PUZZLES = {
  get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null),
  put: async (k, v) => kv.set(k, v),
};
const store = new Map(), sockets = [];
const st = { _init:null, blockConcurrencyWhile(f){this._init=f();return this._init;}, waitUntil:p=>p,
  acceptWebSocket:ws=>sockets.push(ws), getWebSockets:()=>sockets,
  storage:{ get: async k => Array.isArray(k)? new Map(k.map(x=>[x,store.get(x)])) : store.get(k),
    put: async o => { for(const[k,v]of Object.entries(o)) store.set(k, structuredClone(v)); },
    deleteAll: async()=>store.clear(), setAlarm:async()=>{}, deleteAlarm:async()=>{} } };

const f = new MineField(st, { PUZZLES, FIREBASE_PROJECT_ID:'t' });
await st._init;
f.g = { code:'X', level:'beginner', players:{} };

await f.recordHighScores([
  { uid:'a', name:'Ada', finishedAt: 41000 },
  { uid:'b', name:'Ben', finishedAt: 62000 },
]);
let list = JSON.parse(kv.get('scores:mines:beginner'));
ok('clears are recorded', list.length === 2);
ok('fastest is first', list[0].name === 'Ada');

await f.recordHighScores([{ uid:'b', name:'Ben', finishedAt: 30000 }]);
list = JSON.parse(kv.get('scores:mines:beginner'));
ok('a better time replaces the old one', list[0].name === 'Ben' && list[0].ms === 30000);
ok('a player appears only once', list.filter(r=>r.uid==='b').length === 1);

await f.recordHighScores([{ uid:'b', name:'Ben', finishedAt: 99000 }]);
list = JSON.parse(kv.get('scores:mines:beginner'));
ok('a worse time does not replace it', list.find(r=>r.uid==='b').ms === 30000);

for (let i=0;i<20;i++) await f.recordHighScores([{ uid:'u'+i, name:'P'+i, finishedAt: 10000+i*100 }]);
list = JSON.parse(kv.get('scores:mines:beginner'));
ok('the board keeps only ten', list.length === 10);
ok('it stays sorted', list.every((r,i)=> i===0 || list[i-1].ms <= r.ms));

f.g.level = 'expert';
await f.recordHighScores([{ uid:'a', name:'Ada', finishedAt: 200000 }]);
ok('each difficulty has its own board',
  JSON.parse(kv.get('scores:mines:expert')).length === 1 &&
  JSON.parse(kv.get('scores:mines:beginner')).length === 10);

console.log(bad ? `\n${bad} failing` : '\nall high score checks passed');
process.exit(bad?1:0);
