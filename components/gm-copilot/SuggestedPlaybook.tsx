/**
 * SuggestedPlaybook — Short operational playbook for the shift.
 *
 * Max 5 bullets. Plain English, consequence-aware.
 * Example: "Before 6pm: fix blender, complete prep, confirm FOH coverage"
 */

"use client";

type Props = {
  playbook: string[];
};

export default function SuggestedPlaybook({ playbook }: Props) {
  if (playbook.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Suggested Playbook
      </h2>
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 px-4 py-3">
        <ol className="space-y-2">
          {playbook.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <span className="text-stone-600 font-mono text-xs mt-0.5 shrink-0">
                {i + 1}.
              </span>
              <span className="text-stone-200 leading-snug">{item}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
