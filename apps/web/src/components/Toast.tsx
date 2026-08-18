import { useEffect } from 'react';

/**
 * Says what happened *and its consequence*.
 *
 * "Attendance saved" on its own leaves a teacher wondering whether the parents
 * of the three absentees now know. The second line is the point of the
 * component, per the design system, so the detail is a required prop rather
 * than an optional flourish.
 *
 * `aria-live="polite"` because a save is worth announcing but must not
 * interrupt someone mid-sentence.
 */
export function Toast({
  kicker,
  detail,
  onDismiss,
  tone = 'ink',
}: {
  kicker: string;
  detail: string;
  onDismiss: () => void;
  tone?: 'ink' | 'stamp';
}) {
  useEffect(() => {
    // Long enough to read two lines without hunting for a close button.
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-20 left-1/2 z-30 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 rounded-[3px] border px-4 py-3 shadow-[3px_3px_0_rgb(20_36_60_/_0.25)] lg:bottom-6 lg:left-auto lg:right-6 lg:translate-x-0 ${
        tone === 'stamp' ? 'border-stamp bg-stamp text-white' : 'border-ink bg-ink text-paper'
      }`}
    >
      <div
        className={`font-mono text-[10px] tracking-[0.14em] uppercase ${
          tone === 'stamp' ? 'text-white/80' : 'text-marigold'
        }`}
      >
        {kicker}
      </div>
      <div className="mt-0.5 text-[14px]">{detail}</div>
    </div>
  );
}

/**
 * The unsaved stamp — mono, uppercase, stamp-red outline, rotated a degree and
 * a half. The one piece of whimsy in the product, and it earns its place by
 * being the thing that stops a teacher losing a period of work.
 */
export function UnsavedStamp({ label }: { label: string }) {
  return (
    <span className="inline-block -rotate-[1.5deg] rounded-[2px] border-[1.5px] border-stamp px-1.5 py-px font-mono text-[10px] font-medium tracking-[0.14em] text-stamp uppercase">
      {label}
    </span>
  );
}
