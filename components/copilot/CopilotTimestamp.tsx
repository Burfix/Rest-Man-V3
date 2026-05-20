/**
 * CopilotTimestamp — Shows when the copilot data was generated.
 */

"use client";

export default function CopilotTimestamp({ generatedAt }: { generatedAt: string }) {
  const d = new Date(generatedAt);
  const time = d.toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  });

  return (
    <div className="text-[10px] text-stone-600 text-right px-1">
      Last evaluated: {time} SAST
    </div>
  );
}
