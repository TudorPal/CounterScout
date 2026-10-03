/**
 * Subtle gradient-orb backdrop for interior app pages. Sits behind the
 * page content at low opacity so information-dense UIs (Dashboard,
 * Anti-Strat, etc.) don't get drowned by hero-strength color.
 *
 * Orbs are fixed-positioned and pointer-events: none, so they never
 * affect scroll or interaction. They inherit the same `orb-*` drift
 * animations defined in index.css.
 */
export default function AppBackdrop({ tone = "teal" }: { tone?: "teal" | "green" | "violet" | "amber" }) {
  const palettes: Record<string, [string, string]> = {
    teal:   ["#5ee0c2", "#8cb5dc"],
    green:  ["#91b6a1", "#5ee0c2"],
    violet: ["#afa5df", "#5ee0c2"],
    amber:  ["#e7b86a", "#5ee0c2"],
  };
  const [c1, c2] = palettes[tone] ?? palettes.teal;

  return (
    <div className="fixed inset-0 pointer-events-none z-0" aria-hidden>
      <div
        className="orb orb-1"
        style={{
          top: "-20%",
          left: "-10%",
          width: "560px",
          height: "560px",
          background: `radial-gradient(circle, ${c1} 0%, transparent 70%)`,
          opacity: 0.10,
        }}
      />
      <div
        className="orb orb-2"
        style={{
          top: "30%",
          right: "-15%",
          width: "620px",
          height: "620px",
          background: `radial-gradient(circle, ${c2} 0%, transparent 70%)`,
          opacity: 0.07,
        }}
      />
    </div>
  );
}
