// Run: node scripts/test_replay_state.mjs
// Exercise the production pure-state helpers without installing a test runner.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../frontend/src/utils/replayState.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const module = {exports:{}};
new Function("module","exports",compiled)(module,module.exports);
const {matchIdentity,scoreAt,roundResult,roundAnchor,snapshotAt,teamSide,economyAt} = module.exports;
const sideForA = n => n <= 12 ? 2 : n <= 27 ? 3 : n <= 33 ? 2 : 3;
const winsA = new Set([1,2,4,5,13,14,15,16,17,18,19,20,25,27,28,31,34]);
const timeline = {players:[],positions:{},events:[],rounds:[]};
for(let i=0;i<10;i++) {
  const a=i<5, sid=String(i);
  // Deliberately misleading static modal side and warmup side.
  timeline.players.push({steamid:sid,name:i===0?"PVR":`Player${i}`,team_num:a?3:2});
  timeline.positions[sid]=[{t:0,tn:a?3:2,alive:true,cash:800,eq:200}];
  for(let n=1;n<=36;n++) {
    const side=sideForA(n), previous=sideForA(Math.max(1,n-1));
    timeline.positions[sid].push({t:n*1000,tn:a?previous:previous===2?3:2,alive:true,cash:800,eq:200});
    timeline.positions[sid].push({t:n*1000+300,tn:a?side:side===2?3:2,alive:true,cash:1000+i*100,eq:3000});
  }
}
for(let n=1;n<=36;n++) {
  const winnerSide=winsA.has(n)?sideForA(n):sideForA(n)===2?3:2;
  timeline.rounds.push({num:n,start_tick:n*1000,freeze_end_tick:n*1000+300,end_tick:n*1000+900,winner:winnerSide===2?"T":"CT"});
}
for(const victim of ["0","1","2","3","5","6","7"]) timeline.events.push({type:"death",tick:3500,data:{victim}});
timeline.events.push({type:"death",tick:3501,data:{victim:"0"}}); // duplicate must not kill two players
const info={team1:{name:"Bannda",players:["PVR"],players_detailed:[{steamid:"0"}]},team2:{name:"Opponent",players:[]}};
const identity=matchIdentity(timeline,info);
assert.equal(identity.members["0"],2,"Ignore warmup/modal side");
assert.equal(identity.labels[2],"Bannda");
assert.deepEqual(scoreAt(timeline,identity,12900),{2:4,3:8});
assert.deepEqual(scoreAt(timeline,identity,24900),{2:12,3:12});
assert.deepEqual(scoreAt(timeline,identity),{2:17,3:19},"Multiple OTs keep organisation scores");
assert.equal(teamSide(timeline,identity,2,roundAnchor(timeline.rounds[27])),2,"OT halftime uses freeze-end side");
assert.equal(snapshotAt([{t:1,tn:2},{t:10,tn:3}],9).tn,2,"Discrete state never reads future");
const result=roundResult(timeline,timeline.rounds[2]);
assert.deepEqual([result.tAlive,result.ctAlive],[1,2],"Round result is independent of selected playback tick");
assert.equal(economyAt(timeline,3300)[2].cash,6000);
assert.equal(economyAt(timeline,3300)[3].cash,8500);
console.log("Replay state: identity, regulation, multiple overtime halves, survivors, discrete state and economy passed.");
// Optional integration check against a real cached demo and its roster.
if(process.argv[2]) {
  const real=JSON.parse(readFileSync(process.argv[2],"utf8"));
  const roster=JSON.parse(readFileSync(process.argv[3],"utf8"));
  const id=matchIdentity(real,roster), score=scoreAt(real,id);
  console.log({teams:id.labels,score,rounds:real.rounds.length,cashSamples:Object.values(real.positions).flat().filter(s=>s.cash!=null).length});
}
