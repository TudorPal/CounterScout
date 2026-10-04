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
const {scoutTeamIds,buildScoutRounds,filterScoutTimeline,defaultScoutFilters}=load('teamScout');
const info={team1:{name:'Scouted',players:['Old nickname'],players_detailed:[{steamid:'own'}]},team2:{name:'Enemy',players:['Enemy']}};
const timeline={tick_rate:10,map_name:'de_mirage',tick_max:300,players:[{steamid:'own',name:'New nickname',team_num:3},{steamid:'enemy',name:'Enemy',team_num:2}],
  positions:{own:[{t:0,tn:3},{t:20,tn:2,alive:true,x:1,y:2},{t:30,tn:2,alive:true,x:2,y:3},{t:50,tn:2,alive:true,x:3,y:4},{t:90,tn:2,alive:false,x:4,y:5},
                   {t:100,tn:2},{t:140,tn:3,alive:true,x:4,y:5},{t:170,tn:3,alive:true,x:6,y:7},{t:190,tn:3,alive:true,x:7,y:8}],
             enemy:[{t:20,tn:3,x:999,y:999},{t:140,tn:2,x:999,y:999}]},
  rounds:[{num:1,start_tick:0,freeze_end_tick:20,end_tick:90,winner:'T'},{num:13,start_tick:100,freeze_end_tick:140,end_tick:190,winner:'CT'}],
  events:[{type:'bomb_plant',tick:40,data:{site:'A',planter:'own'}},{type:'bomb_plant',tick:160,data:{site:'B',planter:'enemy'}}],
  grenades:[{type:'smokegrenade',thrower:'own',detonate_tick:35,points:[[25,1,2],[35,2,3]]},
            {type:'flashbang',thrower:'own',detonate_tick:175,points:[[165,6,7],[175,7,8]]},
            {type:'smokegrenade',thrower:'enemy',detonate_tick:170,points:[[165,999,999],[170,999,999]]}]};
const sids=scoutTeamIds(timeline,info,'Scouted');assert.deepEqual([...sids],['own'],'SteamIDs survive nickname changes');
const source={demoFile:'one.dem',timeline,info,sids};
const rounds=buildScoutRounds([source],defaultScoutFilters);
assert.equal(rounds.length,2);assert.deepEqual(rounds.map(r=>r.side),['T','CT'],'Use freeze-end sides, not stale spawn sides');
assert.deepEqual(rounds.map(r=>r.anchor),[20,140],'Timeout-aware alignment');
assert.ok(!JSON.stringify(rounds).includes('enemy'),'No enemy identity, position or utility enters the explorer');
const filters={side:'CT',phase:'postplant',site:'B'};
const retake=buildScoutRounds([source],filters);
assert.equal(retake.length,1);assert.equal(retake[0].anchor,160);assert.equal(retake[0].duration,3);
assert.ok(retake[0].positions.own.every(s=>s.t>=160));
assert.equal(retake[0].grenades.length,1);
assert.equal(buildScoutRounds([source],{...filters,site:'A'}).length,0);
assert.equal(buildScoutRounds([] ,defaultScoutFilters).length,0);
assert.equal(buildScoutRounds([source,{...source,demoFile:'two.dem'}],defaultScoutFilters).length,4);
const postT=buildScoutRounds([source],{side:'T',phase:'postplant',site:'A'});
assert.equal(postT[0].grenades.length,1,'Pre-plant smoke still active after plant stays available');
assert.equal(buildScoutRounds([source],{side:'all',phase:'all',site:'none'}).length,0);
const noPlant={...source,timeline:{...timeline,events:[]}};
assert.equal(buildScoutRounds([noPlant],{side:'all',phase:'all',site:'none'}).length,2);
assert.equal(buildScoutRounds([noPlant],{side:'all',phase:'postplant',site:'all'}).length,0,'Never fabricate a plant');
const filtered=filterScoutTimeline(source,filters);
assert.equal(filtered.rounds.length,1);assert.equal(filtered.rounds[0].num,13);
assert.deepEqual(Object.keys(filtered.positions),['own']);assert.equal(filtered.grenades.length,1);
assert.ok(filtered.positions.own.every(s=>s.t>=160));
console.log('Team scouting: selected matches, stable roster identity, side swaps, timeout/plant anchors, site/no-plant filtering and enemy-free explorer passed.');
