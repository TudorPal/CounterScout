import type { MatchDemoEntry, MatchInfoResponse } from "../api/client";

export function demoTeams(demo:MatchDemoEntry, info:Record<string,MatchInfoResponse>):string[] {
  const match=info[demo.demo_file];
  return [match?.team1?.name ?? demo.team1_name,match?.team2?.name ?? demo.team2_name].filter((name):name is string=>!!name);
}
export function scoutTeamNames(demos:MatchDemoEntry[], info:Record<string,MatchInfoResponse>):string[] {
  const names=new Map<string,string>();
  for(const demo of demos) for(const name of demoTeams(demo,info)) names.set(name.toLocaleLowerCase(),name);
  return [...names.values()].sort((a,b)=>a.localeCompare(b));
}
export function scoutTeamDemos(demos:MatchDemoEntry[], info:Record<string,MatchInfoResponse>, team:string):MatchDemoEntry[] {
  return team?demos.filter(d=>demoTeams(d,info).some(name=>name.toLocaleLowerCase()===team.toLocaleLowerCase())):demos;
}
