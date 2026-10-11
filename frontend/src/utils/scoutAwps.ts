import type { TimelinePosition } from "../api/client";
import { scoutRoundContext } from "./teamScout";
import type { ScoutFilters, ScoutSource } from "./teamScout";

export type AwperSummary = {
  steamid: string; name: string; rounds: number; demos: number;
  equippedSeconds: number; activeSeconds: number; scopedSeconds: number; kills: number;
};
export type AwpPoint = { steamid: string; x: number; y: number; holding: boolean; scoped: boolean };
const weapon = (name: string | undefined) => (name ?? "").toLowerCase().replace(/^weapon_/, "");
const carriesAwp = (s: TimelinePosition) => weapon(s.w) === "awp" || (s.inv ?? []).some(w => weapon(w) === "awp");

/** Aggregate original samples, not the explorer's display-decimated paths.
 * Windows start at freeze end / bomb plant and never cross rounds or demos.
 * Time uses observed tick intervals, capped at one second to avoid filling
 * missing data. Radar observations use a fixed one-second cadence so demos
 * with different sample rates cannot dominate the heatmap.
 */
export function buildScoutAwps(sources: ScoutSource[], filters: ScoutFilters) {
  const players = new Map<string, AwperSummary & { roundKeys: Set<string>; demoKeys: Set<string> }>();
  const points: AwpPoint[] = [];
  let totalRounds = 0, awpRounds = 0, weaponDataRounds = 0;
  for (const source of sources) {
    const tl = source.timeline, rate = tl.tick_rate || 64;
    for (const round of tl.rounds) {
      const context = scoutRoundContext(source, round, filters);
      if (!context) continue;
      totalRounds++;
      const roundKey = `${source.demoFile}:${round.num}`;
      const side = context.side === "T" ? 2 : 3;
      let roundHasAwp = false, roundHasWeaponData = false;
      const entry = (sid: string) => {
        let player = players.get(sid);
        if (!player) {
          player = { steamid: sid, name: tl.players.find(p => p.steamid === sid)?.name ?? sid,
            rounds: 0, demos: 0, equippedSeconds: 0, activeSeconds: 0, scopedSeconds: 0, kills: 0,
            roundKeys: new Set(), demoKeys: new Set() };
          players.set(sid, player);
        }
        return player;
      };
      for (const sid of source.sids) {
        const samples = tl.positions[sid] ?? [];
        // Lower-bound search avoids rescanning a match for every round.
        let lo = 0, hi = samples.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (samples[mid].t < context.anchor) lo = mid + 1; else hi = mid; }
        let stableSeconds = 0, origin: TimelinePosition | undefined, lastBin = -1;
        for (let i = lo; i < samples.length && samples[i].t <= round.end_tick; i++) {
          const s = samples[i], next = samples[i + 1];
          if (!s.alive || (s.tn ?? side) !== side) { stableSeconds = 0; origin = undefined; continue; }
          if (s.w !== undefined || s.inv !== undefined) roundHasWeaponData = true;
          if (!carriesAwp(s)) { stableSeconds = 0; origin = undefined; continue; }
          roundHasAwp = true;
          const player = entry(sid);
          player.roundKeys.add(roundKey); player.demoKeys.add(source.demoFile);
          const gap = next ? (next.t - s.t) / rate : 0;
          const seconds = gap > 0 && gap <= 1 ? Math.max(0, (Math.min(next.t, round.end_tick) - s.t) / rate) : 0;
          player.equippedSeconds += seconds;
          if (weapon(s.w) !== "awp") { stableSeconds = 0; origin = undefined; continue; }
          player.activeSeconds += seconds;
          if (s.sc) player.scopedSeconds += seconds;
          if (!origin) origin = s;
          const finite = Number.isFinite(s.x) && Number.isFinite(s.y);
          const stationary = finite && seconds > 0 && next?.alive && (next.tn ?? side) === side && weapon(next.w) === "awp"
            && Math.hypot(next.x - s.x, next.y - s.y) / gap <= 50
            && Math.hypot(next.x - origin.x, next.y - origin.y) <= 50;
          const bin = Math.floor((s.t - context.anchor) / rate);
          if (finite && bin !== lastBin) {
            points.push({ steamid: sid, x: s.x, y: s.y, holding: stableSeconds >= 2 - 1e-6 && !!stationary, scoped: !!s.sc });
            lastBin = bin;
          }
          if (stationary) stableSeconds += seconds;
          else { stableSeconds = 0; origin = undefined; }
        }
      }
      for (const event of tl.events) {
        if (event.type === "death" && event.tick >= context.anchor && event.tick <= round.end_tick
          && source.sids.has(event.data.attacker) && !source.sids.has(event.data.victim) && weapon(event.data.weapon) === "awp") {
          entry(event.data.attacker).kills++;
        }
      }
      if (roundHasAwp) awpRounds++;
      if (roundHasWeaponData) weaponDataRounds++;
    }
  }
  const summaries: AwperSummary[] = [...players.values()].map(({ roundKeys, demoKeys, ...p }) => ({ ...p, rounds: roundKeys.size, demos: demoKeys.size }))
    .sort((a, b) => b.rounds - a.rounds || b.activeSeconds - a.activeSeconds || b.kills - a.kills || a.name.localeCompare(b.name));
  return { players: summaries, primary: summaries.find(p => p.rounds > 0) ?? null, points, totalRounds, awpRounds, weaponDataRounds };
}
