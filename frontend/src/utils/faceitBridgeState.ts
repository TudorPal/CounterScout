import type {FaceitBridgeLibrary} from "../api/client";

/** Imported files are the source of truth, not an earlier download attempt. */
export function bridgeMatchState(jobs:FaceitBridgeLibrary["imports"], command?:FaceitBridgeLibrary["commands"][number]) {
  const demos=[...new Set(jobs.filter(j=>j.state==="done" && j.demo_file).map(j=>j.demo_file!))];
  const importing=jobs.find(j=>["queued","importing"].includes(j.state));
  const waiting=Boolean(command && ["queued","running"].includes(command.state));
  const expected=command?.expected_count || command?.download_count || 1;
  const recovered=Boolean(command?.resolved_by_import || demos.length>=expected);
  const error=recovered?null:command?.error || jobs.find(j=>j.state==="error")?.error || null;
  const stages:Record<string,string>={opening_room:"Opening match room…",reading_demo_links:"Reading demo links…",starting_downloads:"Starting downloads…"};
  const label=importing?`${demos.length?`${demos.length} imported · `:""}Analysing demo…`:
    waiting?`${demos.length?`${demos.length} imported · `:""}${command?.state==="queued"?"Waiting for extension…":stages[command?.stage || ""] || "Starting download…"}`:
    demos.length?`${demos.length} imported${error?" · incomplete":""}`:
    error?"Download / import failed":command?.download_count?`${command.download_count} downloads started`:"Not imported";
  return {demos,waiting,label,error,tone:error?(demos.length?"warning":"error"):demos.length?"success":"muted"};
}
