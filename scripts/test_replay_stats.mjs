import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url)),ts=require('typescript'),modules={};
for(const name of ['replayState','replayStats']) {
  const source=readFileSync(new URL(`../frontend/src/utils/${name}.ts`,import.meta.url),'utf8'),mod={exports:{}};
  new Function('module','exports','require',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(mod,mod.exports,id=>modules[id.replace('./','')]);
  modules[name]=mod.exports;
}
const {matchIdentity}=modules.replayState,{calculateReplayStats,localWinProbability}=modules.replayStats;
assert.equal(localWinProbability(5,5),.5);
assert.ok(localWinProbability(5,5,true)>.5);
assert.equal(localWinProbability(0,1),0);
assert.equal(localWinProbability(1,0),1);
assert.ok(localWinProbability(0,1,true)>0,'Last T death is not an automatic loss after planting');
assert.equal(localWinProbability(0,0,true),1,'Planted bomb with no surviving CT cannot be defused');
assert.ok(localWinProbability(1,1)-localWinProbability(1,0)<0);
const sample=(t,tn,eq=4000)=>({t,tn,eq,alive:true,hp:100,dmg:0});
const timeline={tick_rate:10,players:[['a','Killer',2],['s','Support',2],['b','B',3],['c','C',3]].map(([steamid,name,team_num])=>({steamid,name,team_num})),
  positions:Object.fromEntries([['a',2],['s',2],['b',3],['c',3]].map(([sid,tn])=>[sid,[sample(0,tn),sample(10,tn),sample(100,tn)]])),
  rounds:[{num:1,start_tick:0,freeze_end_tick:10,end_tick:100,winner:'T'}],grenades:[],events:[
    {type:'damage',tick:15,data:{attacker:'s',victim:'b',dmg:'40'}},
    {type:'damage',tick:19,data:{attacker:'a',victim:'b',dmg:'1000'}},
    {type:'death',tick:20,data:{attacker:'a',victim:'b',headshot:'True'}},
    {type:'death',tick:30,data:{attacker:'c',victim:'s'}},
    {type:'death',tick:40,data:{attacker:'a',victim:'c'}},
    {type:'death',tick:110,data:{attacker:'a',victim:'a'}}]};
const calc=t=>calculateReplayStats(t,matchIdentity(t)),get=(data,sid)=>data.playerTotals.find(s=>s.steamid===sid);
const stats=calc(timeline);
const lethal=structuredClone(timeline);
lethal.events[1].tick=20;
lethal.events.reverse();
assert.equal(get(calc(lethal),'a').dmg,60,'Same-tick lethal damage is counted before its death, regardless of parser batch order');
assert.equal(get(stats,'a').kills,2);
assert.equal(get(stats,'a').deaths,0,'Post-round suicide does not inflate D');
assert.equal(get(stats,'a').dmg,60,'Overkill capped at remaining health');
assert.equal(get(stats,'s').assists,1,'40 damage grants assist');
assert.equal(get(stats,'s').kast,1,'Support damage and/or traded death yields KAST');
assert.ok(stats.playerTotals.every(s=>Number.isFinite(s.rating)));
assert.ok(Math.abs(stats.playerTotals.reduce((n,s)=>n+s.swing,0))<1e-10,'Win-probability credit is conserved');
const eco=structuredClone(timeline);
for(const sid of ['a','s'])eco.positions[sid].forEach(s=>s.eq=8000);
for(const sid of ['b','c'])eco.positions[sid].forEach(s=>s.eq=200);
assert.ok(get(calc(eco),'a').ecoKills<get(stats,'a').ecoKills,'Anti-eco frags receive less kill credit');
const friendly=structuredClone(timeline);friendly.events=[{type:'death',tick:20,data:{attacker:'a',victim:'s'}}];
assert.equal(get(calc(friendly),'a').kills,0,'Team kills do not award frags');
assert.equal(get(calc(friendly),'s').deaths,1);
const missing=structuredClone(timeline);missing.events=missing.events.filter(e=>e.type!=='damage');
Object.values(missing.positions).forEach(list=>list.forEach(s=>delete s.dmg));
assert.equal(get(calc(missing),'a').rating,null,'Missing damage cannot fabricate rating');
const disconnected=structuredClone(timeline);
disconnected.players.push({steamid:'dc',name:'Disconnected',team_num:2});disconnected.positions.dc=[sample(-10,2)];
assert.equal(get(calc(disconnected),'dc').survived,0,'Stale alive state cannot earn survival/KAST');
assert.equal(get(calc(disconnected),'dc').rounds,0);
const flash=structuredClone(timeline);
flash.events[0].data.dmg='10';flash.events[2].data.assister='s';flash.events[2].data.assistedflash='True';
assert.equal(get(calc(flash),'s').assists,1,'Explicit flash assist works below damage threshold');
const save=structuredClone(timeline);save.events=save.events.filter(e=>e.tick!==30 && e.tick!==40);
assert.ok(Math.abs(calc(save).playerTotals.reduce((n,s)=>n+s.swing,0))<1e-10,'Saving residual credit is also conserved');
if(process.argv[2]) {
  const real=JSON.parse(readFileSync(process.argv[2],'utf8')),info=JSON.parse(readFileSync(process.argv[3],'utf8'));
  const data=calculateReplayStats(real,matchIdentity(real,info));
  assert.equal(data.playerTotals.find(p=>p.name==='-AdN-_').deaths,7,'Actual Anubis match excludes the after-match suicide');
  assert.ok(Math.abs(data.playerTotals.reduce((n,s)=>n+s.swing,0))<1e-8);
  console.table(data.playerTotals.map(p=>({name:p.name,K:p.kills,D:p.deaths,A:p.assists,ADR:(p.dmg/real.rounds.length).toFixed(1),swing:p.swingPct.toFixed(2),rating:p.rating?.toFixed(2),present:p.rounds})));
}
console.log('Replay stats: played-round boundaries, capped damage, enemy-only kills, 40-damage/flash assists, trades, economy, zero-sum swing, missing data and disconnected survival passed.');
