// Shown while the server component awaits GET /progress. The chrome is real so
// only the data area moves when the fetch lands.
export default function ProgressLoading() {
  return (
    <div className="rp-surface flex min-h-dvh flex-col">
      <header className="shrink-0 border-b border-line">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
              RepPilot
            </span>
            <h1 className="truncate text-sm text-muted">Progress</h1>
          </div>
        </div>
      </header>

      <main
        aria-busy="true"
        className="mx-auto w-full max-w-3xl flex-1 px-5 py-8"
      >
        <span className="sr-only" role="status">
          Loading your progress
        </span>

        <div aria-hidden className="flex flex-col gap-6">
          <section>
            <div className="rp-skeleton mb-3 h-6 w-52" />
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="rp-skeleton h-[68px]" />
              ))}
            </div>
          </section>

          <div className="rp-skeleton h-[19rem] rounded-xl" />
          <div className="rp-skeleton h-[19rem] rounded-xl" />

          <section className="flex flex-col gap-2">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="rp-skeleton h-[50px]" />
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}
