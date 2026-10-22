export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#1d1b18" />
        <path d="M8 11.5 11 21h1.2l2.4-7 2.4 7h1.2l3-9.5" fill="none" stroke="#e9c79f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="24" cy="11.5" r="1.4" fill="#e9c79f" />
      </svg>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-ink">Warose</div>
        <div className="text-[11px] text-muted">Operations Hub</div>
      </div>
    </div>
  );
}
