import { useState } from "react";
import { useNavigate } from "react-router-dom";
import HltvImportPanel from "./HltvImportPanel";
import FaceitImportPanel from "./FaceitImportPanel";
import FaceitBridgePanel from "./FaceitBridgePanel";
import AppHeader from "./AppHeader";
import AppBackdrop from "./AppBackdrop";
import ImportStatusBanner from "./ImportStatusBanner";
import { useReveal } from "../hooks/useReveal";

type Tab = "hltv" | "faceit";

export default function ImportPage() {
  const navigate = useNavigate();
  const hero = useReveal<HTMLDivElement>();
  const body = useReveal<HTMLDivElement>();
  const [tab, setTab] = useState<Tab>("hltv");

  return (
    <div className="relative h-screen flex flex-col overflow-hidden bg-[#0b1118]">
      <AppBackdrop tone="amber" />
      <AppHeader />

      <div className="relative flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pt-8 pb-12" style={{ scrollbarWidth: "thin" }}>
        <div className="max-w-5xl mx-auto space-y-10">
          {/* ── Hero — same scale as other sub-pages (DISCOVER / REWATCH / SCOUT / PROFILE) ── */}
          <div
            ref={hero.ref}
            className={`reveal ${hero.shown ? "in" : ""} text-center`}
          >
            <span className="section-eyebrow">IMPORT</span>
            <h1 className="page-title mt-3">
              Build your <span className="accent">match library</span>
            </h1>
            <p className="mt-4 text-sm md:text-base text-scout-muted leading-relaxed max-w-xl mx-auto">
              Bring in demos from HLTV or FACEIT. CounterScout analyses them
              locally for replay, lineups, and opponent scouting.
            </p>
          </div>

          {/* ── Live pipeline status — always visible, independent of the
              active tab. Renders nothing when no pipeline is running, so
              it doesn't steal space from the forms below. */}
          <ImportStatusBanner />

          {/* ── Source tabs ── */}
          <div
            ref={body.ref}
            className={`reveal reveal-delay-1 ${body.shown ? "in" : ""} space-y-6`}
          >
            <div className="flex gap-1.5 justify-center">
              <button
                className={`hud-tab ${tab === "hltv" ? "hud-tab-active" : "hud-tab-idle"} flex items-center gap-2`}
                onClick={() => setTab("hltv")}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
                HLTV
              </button>
              <button
                className={`hud-tab ${tab === "faceit" ? "hud-tab-active" : "hud-tab-idle"} flex items-center gap-2`}
                onClick={() => setTab("faceit")}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
                FACEIT
              </button>
            </div>

            {tab === "hltv" ? (
              <HltvImportPanel onComplete={() => navigate("/lineups")} />
            ) : (
              <div className="space-y-6"><FaceitBridgePanel /><details className="hud-panel p-4"><summary className="cursor-pointer text-sm text-scout-muted">Advanced: official FACEIT Data API (requires your API key)</summary><div className="mt-4"><FaceitImportPanel onComplete={() => navigate("/lineups")} /></div></details></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
