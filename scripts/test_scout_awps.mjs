import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const ts=require('typescript');
function load(name) {
  const source=readFileSync(new URL(`../frontend/src/utils/${name}.ts`,import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module={exports:{}};new Function('module','exports','require',compiled)(module,module.exports,path=>load(path.split('/').at(-1)));
  return module.exports;
}
const {buildScoutAwps}=load('scoutAwps');
const {scoutTeamIds}=load('teamScout');
const filters={side:'all',phase:'all',site:'all'};
const samples=(step,start=0,end=100,tn=2)=>Array.from({length:Math.floor((end-start)/step)+1},(_,i)=>({t:start+i*step,x:100,y:200,alive:true,tn,w:'awp',inv:['awp'],sc:true}));
function source(step=1) {
  return {demoFile:'one.dem',sids:new Set(['own']),info:{},timeline:{tick_rate:10,players:[{steamid:'own',name:'Primary'},{steamid:'enemy',name:'Enemy'}],
    positions:{own:samples(step),enemy:samples(step)},rounds:[{num:1,start_tick:0,freeze_end_tick:20,end_tick:100,winner:'T'}],
    events:[{tick:60,type:'bomb_plant',data:{site:'A'}},{tick:70,type:'death',data:{attacker:'own',victim:'enemy',weapon:'awp'}},
      {tick:80,type:'death',data:{attacker:'enemy',victim:'own',weapon:'awp'}}],grenades:[]}};
}
const dense=buildScoutAwps([source(1)],filters),sparse=buildScoutAwps([source(5)],filters);
assert.equal(dense.primary.name,'Primary');assert.equal(dense.primary.activeSeconds.toFixed(3),'8.000','Freeze time excluded');
assert.ok(Math.abs(sparse.primary.activeSeconds-dense.primary.activeSeconds)<1e-6);
assert.equal(sparse.points.length,dense.points.length,'Heatmap cadence independent of recorded sample frequency');
assert.equal(sparse.points.filter(p=>p.holding).length,dense.points.filter(p=>p.holding).length);
assert.ok(dense.points.some(p=>p.holding));assert.equal(dense.primary.kills,1);
assert.ok(!JSON.stringify(dense).includes('Enemy'));
assert.equal(buildScoutAwps([source()],{...filters,side:'CT'}).primary,null,'Side filter is respected');
assert.equal(buildScoutAwps([source()],{...filters,site:'B'}).totalRounds,0);
const post=buildScoutAwps([source()],{...filters,phase:'postplant',site:'A'});
assert.equal(post.primary.activeSeconds.toFixed(3),'4.000','Post-plant excludes early AWP use');
const switched=source();switched.timeline.positions.own=switched.timeline.positions.own.map(p=>({...p,w:'smokegrenade'}));
const carrying=buildScoutAwps([switched],filters);
assert.equal(carrying.primary.rounds,1,'AWP retained in inventory still identifies carrier');
assert.equal(carrying.primary.activeSeconds,0);assert.equal(carrying.points.length,0);
const second=source(5);second.demoFile='two.dem';second.timeline.players[0].name='Changed nickname';second.timeline.positions.own=samples(5,0,100,3);
const multi=buildScoutAwps([source(),second],filters);
assert.equal(multi.players.length,1,'SteamID aggregates across demo nickname and side changes');
assert.equal(multi.primary.rounds,2);assert.equal(multi.primary.demos,2);assert.equal(multi.primary.kills,2);
assert.equal(buildScoutAwps([source(),second],{...filters,side:'CT'}).primary.demos,1);
const competition=source();competition.sids.add('secondary');
competition.timeline.players.push({steamid:'secondary',name:'Secondary'});
competition.timeline.positions.secondary=samples(5);
competition.timeline.positions.own=competition.timeline.positions.own.map(p=>({...p,w:'knife'}));
assert.equal(buildScoutAwps([competition],filters).primary.name,'Secondary','Equal AWP rounds are ranked by elapsed active time, not sample count');
const carryAgain=source();carryAgain.demoFile='carry-again.dem';
carryAgain.timeline.positions.own=carryAgain.timeline.positions.own.map(p=>({...p,w:'knife'}));
assert.equal(buildScoutAwps([competition,carryAgain],filters).primary.name,'Primary','Most carrying rounds identify the primary, even during utility/knife switches');
const moving=source();moving.timeline.positions.own=moving.timeline.positions.own.map(p=>({...p,x:p.t*20}));
assert.equal(buildScoutAwps([moving],filters).points.filter(p=>p.holding).length,0,'Running is not a hold');
const gaps=source();gaps.timeline.positions.own=[...samples(1,20,30),...samples(1,80,100)];
assert.equal(buildScoutAwps([gaps],filters).points.filter(p=>p.holding).length,0,'Do not bridge missing samples into a hold');
assert.equal(buildScoutAwps([gaps],filters).primary.activeSeconds.toFixed(3),'3.000');
const shortRounds=source();shortRounds.timeline.rounds=[{num:1,start_tick:0,freeze_end_tick:20,end_tick:30},{num:2,start_tick:50,freeze_end_tick:60,end_tick:70}];
assert.equal(buildScoutAwps([shortRounds],filters).points.filter(p=>p.holding).length,0,'Hold state resets between rounds');
const dead=source();dead.timeline.positions.own=dead.timeline.positions.own.map(p=>({...p,alive:false}));
assert.equal(buildScoutAwps([dead],filters).primary,null,'Dead players cannot establish AWP usage');
const teamkill=source();teamkill.timeline.events=[{tick:40,type:'death',data:{attacker:'own',victim:'own',weapon:'awp'}}];
assert.equal(buildScoutAwps([teamkill],filters).primary.kills,0);
const noWeapons=source();noWeapons.timeline.positions.own=noWeapons.timeline.positions.own.map(({w,inv,sc,...p})=>p);
assert.equal(buildScoutAwps([noWeapons],filters).weaponDataRounds,0,'Missing weapon data is distinguished from no AWP usage');
assert.equal(buildScoutAwps([],filters).totalRounds,0);
console.log('AWP scouting passed: multi-demo identity, side/site/plant filters, inventory, sample-rate independence, holds, gaps, deaths and missing data.');
if(process.argv[2]==='--real-team') {
  const team=process.argv[3];
  const sources=process.argv.slice(4).map(path=>{
    const timeline=JSON.parse(readFileSync(path,'utf8'));
    const demoFile=path.split(/[\\/]/).at(-1).replace(/\.json$/,'');
    const matchId=demoFile.match(/^\d+/)?.[0];
    const info=JSON.parse(readFileSync(new URL(`../demos/${matchId}.roster.json`,import.meta.url),'utf8'));
    return {demoFile,timeline,info,sids:scoutTeamIds(timeline,info,team)};
  }).filter(s=>s.sids.size);
  assert.ok(sources.length>1,'Need multiple matching real demos for integration check');
  const result=buildScoutAwps(sources,filters);
  assert.ok(result.primary);assert.ok(result.points.some(p=>p.holding));
  if(team==='Vitality' && result.players.some(p=>p.name==='ZywOo'))assert.equal(result.primary.name,'ZywOo');
  assert.ok(result.players.every(p=>sources.some(s=>s.sids.has(p.steamid))));
  const ct=buildScoutAwps(sources,{...filters,side:'CT'}),t=buildScoutAwps(sources,{...filters,side:'T'});
  assert.equal(ct.totalRounds+t.totalRounds,result.totalRounds);
  console.log(JSON.stringify({team,demos:sources.length,rounds:result.totalRounds,primary:result.primary.name,
    players:result.players.map(p=>({name:p.name,awpRounds:p.rounds,demos:p.demos,kills:p.kills,activeSeconds:Math.round(p.activeSeconds)})),
    holdPoints:result.points.filter(p=>p.holding).length,ctPrimary:ct.primary?.name,tPrimary:t.primary?.name}));
}
