import PlayerAvatar from "./PlayerAvatar";
import { MatchIdentity, money, sideColor } from "../utils/replayState";
import { replayRosterGroups } from "../utils/replayRoster";

interface ReplayPlayer {
  steamid: string;
  name: string;
  team: number;
  alive: boolean;
  hp: number;
  cash?: number;
  equipment?: number;
  armor: number;
  helmet: boolean;
  hasBomb: boolean;
  weapon: string;
  inventory: string[];
}

interface Props {
  players: ReplayPlayer[];
  identity: MatchIdentity;
  weaponIconPath: (weapon: string) => string;
  hltvIds: Record<string, number>;
  photoCacheVersion: number;
}

export default function ReplayTeamPanels({ players, identity, weaponIconPath, hltvIds, photoCacheVersion }: Props) {
  return (
    <div aria-label="Live team rosters" className="replay-team-panels">
      {replayRosterGroups(players, identity).map(group => {
        const color = sideColor(group.side);
        return (
          <section key={group.team} aria-label={`${group.label} roster`} className="replay-team-panel rounded-xl border border-white/10 bg-scout-bg/95 p-2.5 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-bold truncate flex-1" style={{color}} title={group.label}>{group.label}</h2>
              <span className="text-[11px] font-bold rounded px-1.5" style={{background: color, color: '#0b1118'}}>{group.side === 2 ? 'T' : 'CT'}</span>
            </div>
            <p className="text-[10px] text-scout-muted font-mono mt-1 mb-1.5 truncate">Cash {money(group.players.some(p => p.cash != null) ? group.players.reduce((sum, p) => sum + (p.cash ?? 0), 0) : null)} · equip {money(group.players.some(p => p.equipment != null) ? group.players.reduce((sum, p) => sum + (p.equipment ?? 0), 0) : null)}</p>
            <div className="flex flex-col gap-1">
              {group.players.map(p => {
                const hp = Math.max(0, Math.min(100, p.hp));
                const healthColor = hp > 50 ? '#4ade80' : hp > 25 ? '#fbbf24' : '#f87171';
                const inventory = p.inventory.length ? p.inventory : [p.weapon];
                return (
                  <div key={p.steamid} data-player-id={p.steamid} className="rounded px-2 py-1.5 min-w-0" style={{background: `${color}14`, opacity: p.alive ? 1 : 0.4}}>
                    <div className="flex items-center gap-1 min-w-0">
                      <span aria-label={p.alive ? `${hp} health` : 'Dead'} className="text-xs font-mono font-bold w-6 text-right shrink-0" style={{color: p.alive ? healthColor : '#9aaabd'}}>{p.alive ? hp : '×'}</span>
                      <PlayerAvatar name={p.name} size={24} accent={color} hltvId={hltvIds[p.name.trim().toLowerCase()] ?? null} cacheBust={photoCacheVersion || undefined} />
                      <span className="text-xs font-semibold text-white truncate min-w-0 flex-1" title={p.name}>{p.name}</span>
                      <span className="replay-player-cash text-[11px] text-scout-green font-mono shrink-0" title={`Cash · equipment ${money(p.equipment)}`}>{money(p.cash)}</span>
                    </div>
                    {/* A shared fixed rail fits armour, two weapons, four grenades
                        and the bomb. Cash/name widths cannot stretch the bar. */}
                    <div className="ml-7" style={{width: 238, maxWidth: 'calc(100% - 1.75rem)'}}>
                    <div role="meter" aria-label={`${p.name} health`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.alive ? hp : 0} className="replay-player-health ml-7 mt-1 mb-1 h-0.5 rounded bg-white/10 overflow-hidden" style={{visibility: p.alive ? 'visible' : 'hidden'}}>
                      <div className="h-full rounded" style={{width: `${hp}%`, background: healthColor}} />
                    </div>
                    <div className="replay-player-loadout flex flex-wrap items-center gap-1 min-h-[18px]" style={{visibility: p.alive ? 'visible' : 'hidden'}} title={inventory.join(', ')}>
                      {p.armor > 0 && <span className="flex items-center gap-0.5 w-9 shrink-0 text-[10px] font-mono text-scout-muted">
                        <img src={p.helmet ? '/icons/helmet.svg' : '/icons/kevlar.svg'} alt={p.helmet ? 'Helmet and kevlar' : 'Kevlar'} className="w-4 h-4" style={{filter: 'brightness(0) invert(0.85)'}} />{p.armor}
                      </span>}
                      {inventory.map((weapon, index) => {
                        const icon = weaponIconPath(weapon);
                        if (!icon || icon === '/icons/knife.svg' || icon === '/icons/c4.svg') return null;
                        const utility = /\/(smokegrenade|flashbang|hegrenade|molotov|incgrenade|decoy)\.svg$/.test(icon);
                        return <img key={`${weapon}-${index}`} src={icon} alt={weapon} title={weapon} className={`h-[18px] ${utility ? 'w-[18px]' : 'w-[42px]'} object-contain shrink-0`} style={{filter: 'brightness(0) invert(0.9)', opacity: weapon.toLowerCase() === p.weapon.toLowerCase() ? 1 : 0.5}} />;
                      })}
                      {(p.hasBomb || inventory.some(weapon => weaponIconPath(weapon) === '/icons/c4.svg')) && <img src="/icons/c4.svg" alt="Bomb carrier" title="Bomb carrier" className="w-[18px] h-[18px] shrink-0" />}
                    </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
