// node scripts/routing-test.mjs
import { DojoDirectory } from '../src/directory.js';
let bad=0; const ok=(l,c)=>{console.log((c?'  pass':'  FAIL')+'  '+l); if(!c)bad++;};
const store=new Map();
const st={_init:null,blockConcurrencyWhile(f){this._init=f();return this._init;},
  storage:{get:async k=>store.get(k),put:async o=>{for(const[k,v]of Object.entries(o))store.set(k,structuredClone(v));}}};
const d=new DojoDirectory(st); await st._init;
const post=(p,b)=>d.fetch(new Request('https://x'+p,{method:'POST',body:JSON.stringify(b)}));
const find=async code=>(await (await d.fetch(new Request('https://x/find?code='+code))).json());

await post('/announce',{code:'AAA',game:'crossword',sensei:'Matt',players:2,phase:'LOBBY'});
await post('/announce',{code:'BBB',game:'battleship',sensei:'Matt',players:2,phase:'LOBBY'});
await post('/announce',{code:'CCC',game:'minesweeper',sensei:'Wife',players:2,phase:'LOBBY'});

ok('a crossword code resolves to the crossword', (await find('AAA')).game === 'crossword');
ok('a battleship code resolves to battleship', (await find('BBB')).game === 'battleship');
ok('a minesweeper code resolves to minesweeper', (await find('CCC')).game === 'minesweeper');
ok('an unknown code resolves to nothing', (await find('ZZZ')).game === null);

await post('/announce',{code:'BBB',game:'battleship',sensei:'Matt',players:0,phase:'LOBBY'});
ok('an emptied room stops resolving', (await find('BBB')).game === null);

const list=(await (await d.fetch(new Request('https://x/list'))).json()).dojos;
ok('the board carries the game type', list.every(r=>!!r.game));
ok('a room with no game stated defaults to crossword',
  (await post('/announce',{code:'DDD',sensei:'X',players:1,phase:'LOBBY'}),
   (await find('DDD')).game === 'crossword'));
console.log(bad?`\n${bad} failing`:'\nall routing checks passed');
process.exit(bad?1:0);
