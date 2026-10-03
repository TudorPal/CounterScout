import type { MatchTimeline } from "../api/client";

/** Round-relative clock; freeze countdown is separate from live elapsed time. */
export function roundClock(timeline: MatchTimeline, tick: number) {
  const round = [...timeline.rounds].reverse().find(r => r.start_tick <= tick);
  if (!round) return null;
  const rate = timeline.tick_rate > 0 ? timeline.tick_rate : 64;
  const liveStart = round.freeze_end_tick ?? round.start_tick;
  const freezing = tick < liveStart;
  const seconds = freezing
    ? Math.ceil((liveStart - tick) / rate)
    : Math.floor(Math.max(0, Math.min(tick, round.end_tick) - liveStart) / rate);
  return {
    round: round.num,
    phase: freezing ? "Freeze" : tick >= round.end_tick ? "Round ended" : "Elapsed",
    time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
  };
}
