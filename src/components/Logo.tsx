export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#1d1b18" />
        <path d="M11 9.5h6a3.25 3.25 0 0 1 0 6.5h-6Zm0 6.5h7a3.25 3.25 0 0 1 0 6.5h-7Z" fill="none" stroke="#e9c79f" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="24.5" cy="9.5" r="1.4" fill="#e9c79f" />
      </svg>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-ink">BakeryOps</div>
        <div className="text-[11px] text-muted">Operations Hub</div>
      </div>
    </div>
  );
}
