# Replay statistics and local estimates

CounterScout uses the principles described in [HLTV’s Rating 3.0 introduction](https://www.hltv.org/news/42485/introducing-rating-30): six performance components, economy-aware kills/damage, and changes in a team’s round-win probability. **Our constants and probability model are independently chosen local approximations, not HLTV’s proprietary calculation.** Values will not exactly match HLTV, FACEIT or Repeek.

## Raw stats

- Only deaths/damage between a played round’s start and end count. Warmup, knife rounds discarded by the parser, between-round suicides and post-match kills are excluded.
- Enemy kills count; suicides/team kills do not award a kill. Valid in-round deaths still count.
- Damage is capped at the victim’s remaining health; friendly/self damage is excluded.
- An assist requires at least 40 damage to an enemy subsequently killed by a teammate, or an explicit flash assist on that kill. KAST is the percentage of match rounds with a kill, assist, survival or a death traded within five seconds.
- Round/match survival never reads a future spawn or reuses a stale disconnected player state. Team membership uses rosters, not the player’s changing T/CT side.
- Match averages (ADR, KAST, rating, swing) divide by **all played match rounds**, including absences. Player hover text separately shows presence/alive-at-anchor or event participation. This makes small participation samples explicit.

## Swing ≈

Equipment strength is `0.35 + sqrt(clamp(equipment / 4000, 0, 4))`; missing equipment uses neutral strength `1`. Sum strengths over living players on each side. Equipment here is the parser’s equipment value (including utility), unlike HLTV’s weapon/armor categories.

`P(T win) = logistic(3 × ln(T strength / CT strength) + (0.8 if planted else 0))`.

Zero living T players gives probability 0 before planting; after planting it retains an explicit explosion prior `1 / (1 + (1 + CT strength)²)`, because killing the last T does not guarantee a successful defuse. Zero living CT players gives probability 1 if the T side survives or the bomb is planted; no survivors and no plant is treated as unknown (50%). Equal teams begin at 50%; all maps/sides use this **neutral prior**, not fitted map/side coefficients. Bomb state, equipment imbalance and alive counts alter the estimate. Time-to-explosion, defuse-kit/timer availability, positions and calibrated map-specific outcomes are not modelled.

For each enemy kill, calculate the before/after probability delta. Half the positive credit goes to the killer and half to the damage contributors; without detailed damage, all credit goes to the killer. Flash assistance receives 10% of the pool. A trade adds a 0.1 killer share, then the shares are normalized. The victim receives the equal negative delta. Damage/flash credit cannot also reward friendly players.

When opponents survive a lost round, remaining winning probability is distributed proportionally among winning contributors, with equal negative credit to surviving opponents. Swing stays zero-sum across the players. Match Swing is `100 × sum(deltas) / match rounds`, in percentage points per round, **not deviation from the team average**.

## Rating ≈

Economy adjustment for kills/damage is `clamp(victim strength / attacker strength, 0.5, 1.5)`. Winning-round survival has credit 1, losing-round survival 0.25. Multi-kill contribution is `max(round kills − 1, 0)`.

Each normalized component is clamped to `[0, 3]`. The weighted sum is:

| Component | Normalization | Weight |
| --- | --- | --- |
| Economy-adjusted kills/round | divide by 0.70 | 25% |
| Economy-adjusted damage/round | divide by 75 | 20% |
| Survival credit/round | divide by 0.20 | 10% |
| KAST fraction | divide by 0.70 | 20% |
| Multi-kill contribution/round | divide by 0.18 | 10% |
| Swing | `1 + swing percentage / 10` | 15% |

These reference values center a typical performance around 1, but **do not guarantee an event/match mean of 1**, reproduce HLTV’s six sub-ratings, or implement their trade-denial/failed-trade adjustments. The labels always say **estimate** or **≈**.

## Cache compatibility

Parser cache version 9 adds weapon-damage and flash-assist events. Existing demos re-parse automatically on the next timeline load. Older cache fixtures use aggregate damage/assists as a fallback, with neutral damage economy weighting; missing damage makes Rating unavailable rather than inventing ADR. Re-parsing does not delete or rename the demo or its reviewed teams.

The cross-demo Players page’s historical profile score is a separate lightweight proxy, not this replay estimate or an official HLTV rating.
