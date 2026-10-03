/**
 * CounterScout radar mark used in the top nav and footer. Pulled into
 * its own file so LandingPage + AppHeader share a single source of truth.
 */
export default function LogoMark({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} text-scout-accent`} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.3" opacity=".6" />
      <path d="M12 1v4m11 7h-4M12 23v-4M1 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="m12 12 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}
