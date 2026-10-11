import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../frontend/package.json',import.meta.url));
const ts = require('typescript');
const modules = {};
function compile(name) {
  const source = readFileSync(new URL(`../frontend/src/utils/${name}.ts`,import.meta.url),'utf8');
  const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const mod = {exports:{}};
  new Function('module','exports','require',js)(mod,mod.exports,id=>modules[id.replace('./','')]);
  return modules[name] = mod.exports;
}
const state = compile('replayState');
const {matchesReplayFilters,playerSideAt,focusedRoundMatchesSide} = compile('replayFilters');
const timeline = {players:[{steamid:'a',name:'A',team_num:2},{steamid:'b',name:'B',team_num:3}],
  positions:{a:[],b:[]},rounds:[],events:[],grenades:[]};
for(let n=1;n<=36;n++) {
  const side = n<=12 ? 2 : n<=27 ? 3 : n<=33 ? 2 : 3;
  timeline.rounds.push({num:n,start_tick:n*1000,freeze_end_tick:n*1000+100,end_tick:n*1000+900});
  timeline.positions.a.push({t:n*1000+100,tn:side,alive:true});
  timeline.positions.b.push({t:n*1000+100,tn:side===2?3:2,alive:true});
}
const identity = state.matchIdentity(timeline,{team1:{name:'Alpha',players:['A']},team2:{name:'Bravo',players:['B']}});
const matching = (sid,team,side,player='all') => timeline.rounds.filter(r=>matchesReplayFilters(timeline,identity,sid,state.roundAnchor(r),team,side,player)).map(r=>r.num);
assert.deepEqual(matching('a','2',2),[1,2,3,4,5,6,7,8,9,10,11,12,28,29,30,31,32,33]);
assert.deepEqual(matching('a','2',3),[13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,34,35,36]);
assert.deepEqual(matching('b','2','all'),[],'Opposing roster is not the selected team even when wearing T');
assert.deepEqual(matching('a','all','all','b'),[],'Player focus intersects the team/side filters');
assert.equal(playerSideAt(timeline,identity,'a',27999),3,'Never read next-round side');
assert.equal(playerSideAt(timeline,identity,'unknown',10100),undefined);
assert.equal(matchesReplayFilters(timeline,identity,'unknown',10100,'all',2),false);
assert.equal(focusedRoundMatchesSide(timeline,identity,['a'],13100,2),false,'Opponents wearing T must not admit focused-player CT rounds');
assert.equal(focusedRoundMatchesSide(timeline,identity,['a'],28100,2),true,'Focused T round may retain CT opponent context');
assert.equal(focusedRoundMatchesSide(timeline,identity,[],13100,'all'),true);
console.log('Replay filters: stable rosters, individual players, regulation/OT side swaps, and no future-state lookahead passed.');
const disconnected=structuredClone(timeline);
disconnected.players.push({steamid:'late',name:'Late',team_num:3});
disconnected.positions.late=[{t:12100,tn:2,alive:true}];
const roster={team1:{name:'Retake',players:['A','Late']},team2:{name:'Opponent',players:['B']}};
const dc=state.matchIdentity(disconnected,roster);
assert.equal(dc.members.late,2,'Roster overrides misleading modal side for late joiners');
assert.equal(playerSideAt(disconnected,dc,'late',13100),3,'Disconnected player inherits current roster side, not stale T uniform');
assert.equal(focusedRoundMatchesSide(disconnected,dc,['a','late'],13100,2),false,'Four-player side changes cannot leak CT rounds into T patterns');
assert.equal(state.snapshotAt([{t:500,tn:2}],100),undefined,'No future lookahead before first join');
if(process.argv[2]) {
  const real=JSON.parse(readFileSync(process.argv[2],'utf8')),info=JSON.parse(readFileSync(process.argv[3],'utf8'));
  const id=state.matchIdentity(real,info),members=Object.keys(id.members).filter(sid=>id.members[sid]===id.team1);
  const tRounds=real.rounds.filter(r=>focusedRoundMatchesSide(real,id,members,state.roundAnchor(r),2)).map(r=>r.num);
  const ctRounds=real.rounds.filter(r=>focusedRoundMatchesSide(real,id,members,state.roundAnchor(r),3)).map(r=>r.num);
  assert.equal(tRounds.length+ctRounds.length,real.rounds.length);assert.ok(tRounds.every(r=>!ctRounds.includes(r)));
  console.log({team:info.team1.name,tRounds,ctRounds});
}
const {popoverPosition}=compile('popoverPosition');
const bottom=popoverPosition({left:1100,top:620,bottom:660,width:220},{width:1280,height:720},320);
assert.ok(bottom.top<620,'Bottom-edge pickers open upwards');
assert.ok(bottom.top+bottom.height<=720);
assert.ok(bottom.left+bottom.width<=1280-8);
const mobile=popoverPosition({left:270,top:500,bottom:540,width:260},{width:320,height:568},320,250);
assert.equal(mobile.width,260);
assert.ok(mobile.left>=8 && mobile.left+mobile.width<=312);
const top=popoverPosition({left:12,top:20,bottom:60,width:260},{width:1280,height:720},320);
assert.equal(top.top,66);
console.log('Picker layout: bottom-edge flipping, mobile clamping and top-edge positioning passed.');
