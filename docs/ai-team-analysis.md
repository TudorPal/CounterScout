# Free AI team analysis

CounterScout builds tactical facts locally, then optionally asks an LLM to explain them. A key is **not** needed for the evidence view. Nobody needs to upload raw demo files to an AI service.

## Recommended: Groq Free plan

1. Sign in or create your account at [Groq Console](https://console.groq.com/keys), accept the provider's terms yourself, and create an API key. Stay on **Free**; do not upgrade or add billing for this setup.
2. Open **Settings → AI analysis**, choose **Groq**, paste the key and select **Save AI settings**. It applies immediately without restarting. Existing keys are hidden; leave the input empty to keep one, enter a new key to replace it, or select **Remove key** to disable that provider. Saving does not contact the provider or validate the key: generate a report to test it.

   Alternatively, in the project root, edit `.env` (copy `.env.example` if it doesn't exist). Add your key locally:

   ```dotenv
   TEAM_AI_PROVIDER=groq
   GROQ_API_KEY=your_private_key_here
   GROQ_MODEL=openai/gpt-oss-120b
   ```

   For a portable release, use `user-data/.env` instead. Never put keys in frontend code, Chrome extension files, Git, screenshots, a shared ZIP, or chat.
3. If you edited `.env` manually, restart the backend / portable app. Browser settings do not require a restart. Open **Replay → AI Recap**, choose a team, or use **Anti-Strat**, choose a team/map, analyze, and select the demos to include.
4. **Build team evidence** is local. To request an interpretation, tick the data-sharing checkbox and click **Generate AI report**. Opening a tab or changing a filter never submits a provider request.
5. Reports separate T/CT and only show buy categories present. Each category has short **Setup**, **Timing / rotations**, **Utility support**, and **Roles / possible lurks** fields for distinct observed plans, followed by **Watch for** and clearly labelled **Counterplay · coaching hypotheses**. Expand **Check round evidence** to see routes and timed utility. Round links open the corresponding Insights round. The separate **Match snapshot** uses five brief bullet-point sections, not a narrative essay.

The published GPT-OSS 120B Free limits checked on October 11, 2026 were 30 requests/minute, 1,000 requests/day, 8,000 tokens/minute and 200,000 tokens/day. These are organization-wide, subject to change; [your account limits](https://console.groq.com/dashboard/limits) are authoritative. Token limits can be reached before request limits. The default prompt is bounded to approximately 9,500 evidence characters plus instructions and a 3,800-token output cap. Character budgets are not exact token counts.

No paid provider is used as a fallback, and no automatic quota retries are made. **Groq's account plan determines billing**: CounterScout cannot guarantee free inference if you independently upgrade the account. [Groq's billing guide](https://console.groq.com/docs/billing-faqs) explains the Free-to-Developer transition; [rate limits](https://console.groq.com/docs/rate-limits) cover model quotas, and [structured outputs](https://console.groq.com/docs/structured-outputs) documents the default model's JSON support.

## Alternative: OpenRouter free models

Create a key at [OpenRouter](https://openrouter.ai/keys) and configure:

```dotenv
TEAM_AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_private_key_here
OPENROUTER_MODEL=openrouter/free
```

Only `openrouter/free` or model IDs ending in `:free` are accepted by tactical reports; paid models are rejected. Free availability/provider quality varies. The [published free limits](https://openrouter.ai/docs/api/reference/limits) are 20 requests/minute and 50 requests/day for accounts without the qualifying credit purchase. Purchasing credits is not required for this setup. Check OpenRouter's and the routed provider's data policies before sending private team data.

## What the model receives

- Selected team name/player handles, map, aggregate side/buy counts, observed planted sites, common smoke/flash landing clusters, and a bounded selection of timed routes/throws.
- No raw `.dem`, full timeline, local filesystem paths, API keys, opponent roster/position data or Steam IDs.
- Groq documents that inference inputs/outputs are not retained by default, but reliability/abuse exceptions exist. Review [Your Data](https://console.groq.com/docs/your-data) and the Console data controls; do not treat Free as a confidentiality guarantee.
- Reports are cached in the local SQLite database. The same selected demos/team/parser revision/model reuse the saved report. Replacing/reparsing a demo, editing its roster, changing provider/model, or updating the prompt/evidence format invalidates the relevant cache. Previous essay/brief-format reports are not reused by this release.
- Browser key settings are only writable from the local app; keys are never returned by the API or saved in browser storage. `.env` is still a private **plaintext** file, not a credentials vault. Do not share it or the portable `user-data` folder. The release ZIP contains no configured key.

## Evidence and limitations

The AI explains evidence, not hidden game intent. It must return the exact present side/buy categories and cite supplied example rounds, including citations for each plan variation. Invalid categories/citations, truncated responses, and provider errors are rejected and not saved. Text can still be wrong; verify the cited rounds. Totals cover every eligible round; route examples sent to the model are sampled to fit free quotas, not every player's every tick. Example selection reserves space across side/buy categories and prefers differing openings/site outcomes to repeated identical plans. Some examples retain only first/last positions or opening positions; the model is told not to invent the missing movements.

User-written scouting notes guide **style**, not match facts. Distinct observed plans remain separate rather than being merged into a fictional default. Timing is elapsed seconds after freeze, not a guessed countdown. Counterplay is explicitly a coaching hypothesis, not a proven tactic. **Anti-eco cannot be classified from selected-team evidence alone**, since opponent economy is not supplied. Boosts, sightlines, anti-flash posture and reasons for rotations are not inferred from map lore.

- **Stable team:** explicit roster Steam IDs (or names if no IDs) define membership; fresh post-buy snapshots identify T/CT in each round. Stale disconnected slots cannot change the team's side. Only present, alive teammates count toward economy.
- **Pistol:** regulation rounds 1 and 13 under CS2 MR12. Overtime rounds are not pistols. Different match formats would need a different classifier.
- **Full-buy estimate:** at least 80% of present players have a rifle/AWP and 50+ armor, with average equipment of $3,500+. Galil/FAMAS count as rifles; human-readable inventory names and engine IDs are normalized.
- **Eco estimate:** average equipment below $1,500 with at most 25% holding a primary.
- **Force-buy estimate:** average equipment $1,500–$3,499, average remaining cash below $1,000 and average new round spending $600+. This is an observed depleted-cash buy, not proof of strategic intent.
- Other partial/mixed/saved loadouts, missing fields or unclear buys stay **mixed/unknown** rather than being forced into a misleading category.
- Routes sample 5/10/20/35/50/75/95 seconds after freeze ends until plant/round end, plus plant +0/10/20 seconds for post-plant holds/retake observations. Missing/dead players are excluded. This is still sampled movement, not a complete path or proof of why a player rotated.
- Utility includes every recorded throw by this team, with throw timing, approximate origin/landing and pre/post-plant phase. Common smoke/flash areas cluster landings within 300 world units; the denominator is rounds, not throws.
- **Site tendencies are observed plants**, not guessed site attacks. A failed site hit with no plant cannot be classified reliably from the bomb event alone. CT plant-site counts describe retake scenarios, not the CT team's attack decisions.
- **Possible lurks:** a T player at least 1,200 world units from a group of 3+ teammates clustered within 600 units, in at least two sampled frames spanning 10+ seconds, with at least 4 alive players observed. This may instead be delayed utility or a rotate. CT splits are defensive setups, not labelled lurks.
- Nearest callouts within 600 units are approximate. Missing callouts use an 8×8 radar grid: A–H left to right, 1–8 top to bottom. No room/site names are invented. The 2D evidence does not distinguish Nuke floors or establish line of sight.

## Developer verification

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_team_tactics tests.test_tactical_ai -v
.\.venv\Scripts\python.exe scripts/test_team_ai.py --demo your_match.dem --team "Your team" --map de_anubis
# After adding your own key, add --live to make one real request:
.\.venv\Scripts\python.exe scripts/test_team_ai.py --demo your_match.dem --team "Your team" --map de_anubis --live
```

The script prints group counts and a validated-report status, never keys or provider error bodies. Use `--demo` repeatedly for up to 12 demos on the same map. A successful cached result is distinguished from a new provider call.

HTTP 429 means quota/rate limit: wait for the provider's reset, do not create accounts/keys to bypass it. Invalid keys return an actionable setup error; timeouts leave local evidence intact. A live test requires your own configured key.
