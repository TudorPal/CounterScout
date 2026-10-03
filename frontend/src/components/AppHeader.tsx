import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import LogoMark from "./LogoMark";

/**
 * Shared top-of-page navigation. Every page (landing + every sub-page)
 * renders the exact same component so navigation feels invariant as
 * the user moves around the app.
 *
 * Desktop layout uses equal-width side columns, so page actions cannot
 * pull primary navigation off the visual center. Narrow screens use two rows:
 *   LEFT   — logo + wordmark (click: home)
 *   CENTER — nav links (Lineups / Replay / Anti-Strat / Players / Import)
 *   RIGHT  — optional page-specific `actions` slot
 *
 * The "active page" is derived from the current route, not passed in —
 * callers never need to tell the nav which tab to highlight.
 */

const NAV_ITEMS: { label: string; route: string }[] = [
  { label: "Lineups",    route: "/lineups" },
  { label: "Replay",     route: "/replay" },
  { label: "Anti-Strat", route: "/anti-strat" },
  { label: "Players",    route: "/players" },
  { label: "Import",     route: "/import" },
];

export interface AppHeaderProps {
  actions?: ReactNode;
  /** Replace the centered nav-link cluster. Only used by ReplayLayout
   *  which puts a matchup pill in the center. */
  middle?: ReactNode;
}

export default function AppHeader({ actions, middle }: AppHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="app-header sticky top-0 z-30">
      <div className="app-header-grid" data-has-actions={Boolean(actions)}>
        <button
          onClick={() => navigate("/")}
          className="app-header-brand group"
          aria-label="CounterScout home"
        >
          <LogoMark className="w-6 h-6 transition-transform group-hover:scale-110" />
          <span className="text-[15px] font-semibold tracking-tight text-scout-text">Counter<span className="text-scout-accent">Scout</span></span>
        </button>
        <nav aria-label="Primary navigation" className="app-header-nav">
          {middle ?? (
            <div className="app-header-links">
              {NAV_ITEMS.map(item => <NavLink key={item.route} to={item.route}
                className={({isActive}) => `app-nav-link${isActive ? " is-active" : ""}`}>
                {item.label}
              </NavLink>)}
            </div>
          )}
        </nav>
        <div className="app-header-actions">{actions}</div>
      </div>
    </header>
  );
}
