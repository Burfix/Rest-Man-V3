"use client";

import { useState, useTransition, useEffect, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

interface GmbLocation { name: string; title: string; address?: string; }

interface Props {
  siteId: string;
  siteName?: string;
  currentPlaceId: string | null;
  gmbConnected: boolean;
  gmbLocationSet: boolean;
}

function Inner({ siteId, siteName, currentPlaceId, gmbConnected: initGmb, gmbLocationSet: initLocSet }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [placeId, setPlaceId] = useState(currentPlaceId ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [gmbConnected, setGmbConnected] = useState(initGmb);
  const [gmbLocationSet, setGmbLocationSet] = useState(initLocSet);
  const [gmbMsg, setGmbMsg] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [locations, setLocations] = useState<GmbLocation[]>([]);
  const [loadingLocs, setLoadingLocs] = useState(false);
  const [selectedLoc, setSelectedLoc] = useState("");
  const [savingLoc, setSavingLoc] = useState(false);

  useEffect(() => {
    const gmb = searchParams.get("gmb");
    if (!gmb) return;
    if (gmb === "connected") { setGmbConnected(true); setGmbLocationSet(true); setGmbMsg("Google My Business connected successfully."); }
    else if (gmb === "denied") { setGmbMsg("Google OAuth was cancelled."); }
    else if (gmb === "pick_location") { setGmbConnected(true); setGmbLocationSet(false); setShowPicker(true); loadLocations(); }
    else if (gmb === "error") { setError(`OAuth error: ${(searchParams.get("reason") ?? "unknown").replace(/_/g, " ")}`); }
    const p = new URLSearchParams(searchParams.toString());
    p.delete("gmb"); p.delete("reason"); p.delete("account");
    router.replace(`${pathname}${p.size ? `?${p}` : ""}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadLocations() {
    setLoadingLocs(true); setError(null);
    try {
      const res = await fetch(`/api/auth/google/locations?siteId=${siteId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Failed to load locations."); }
      else { setLocations(data.locations ?? []); if (data.locations?.length === 1) setSelectedLoc(data.locations[0].name); }
    } catch { setError("Failed to load locations."); }
    finally { setLoadingLocs(false); }
  }

  async function handleSaveLocation() {
    if (!selectedLoc) return;
    setSavingLoc(true); setError(null);
    try {
      const res = await fetch("/api/auth/google/locations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId, locationId: selectedLoc }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Failed to save location."); }
      else { setGmbLocationSet(true); setShowPicker(false); setGmbMsg("Business location selected successfully."); setTimeout(() => setGmbMsg(null), 4000); }
    } catch { setError("Network error."); }
    finally { setSavingLoc(false); }
  }

  async function handleSave() {
    setError(null); setSaved(false);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/sites/${siteId}/google-place-id`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ google_place_id: placeId.trim() }) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "Failed to save."); return; }
        setSaved(true); setTimeout(() => setSaved(false), 3000); window.location.reload();
      } catch { setError("Network error."); }
    });
  }

  async function handleSync() {
    setSyncing(true); setSyncMsg(null); setError(null);
    try {
      const res = await fetch(`/api/reviews/google-sync?siteId=${siteId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Sync failed."); }
      else { const c = data.synced ?? data.reviews?.length ?? 0; setSyncMsg(`Synced ${c} review${c !== 1 ? "s" : ""} successfully.`); setTimeout(() => setSyncMsg(null), 5000); }
    } catch { setError("Sync failed."); }
    finally { setSyncing(false); }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Google My Business?")) return;
    setDisconnecting(true); setError(null);
    try {
      const res = await fetch(`/api/auth/google/disconnect?siteId=${siteId}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "Failed to disconnect."); }
      else { setGmbConnected(false); setGmbLocationSet(false); setShowPicker(false); setGmbMsg("Disconnected."); setTimeout(() => setGmbMsg(null), 4000); }
    } catch { setError("Network error."); }
    finally { setDisconnecting(false); }
  }

  const isConnected = Boolean(currentPlaceId);
  const isDirty = placeId.trim() !== (currentPlaceId ?? "");

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-700 dark:bg-stone-900">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 bg-white dark:border-stone-700">
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Google Reviews</h3>
              {siteName && <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500 dark:bg-stone-800 dark:text-stone-400">{siteName}</span>}
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400">Live review sync · Sentiment analysis · Guest intelligence</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${isConnected ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? "bg-emerald-500" : "bg-amber-500"}`} />
          {isConnected ? "Connected" : "Not connected"}
        </span>
      </div>

      <div className="my-5 border-t border-stone-100 dark:border-stone-800" />

      {/* Place ID */}
      <div className="space-y-2">
        <label htmlFor={`place-id-${siteId}`} className="block text-xs font-medium text-stone-700 dark:text-stone-300">Google Place ID</label>
        <div className="flex gap-2">
          <input id={`place-id-${siteId}`} type="text" value={placeId} onChange={(e) => { setPlaceId(e.target.value); setSaved(false); setError(null); }} placeholder="ChIJ55SFcllnzB0RaIHBvQkNTxs" spellCheck={false} className="flex-1 rounded-md border border-stone-200 bg-white px-3 py-2 font-mono text-xs text-stone-900 placeholder-stone-400 outline-none transition focus:border-stone-400 focus:ring-2 focus:ring-stone-200 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:border-stone-500 dark:focus:ring-stone-700"/>
          <button onClick={handleSave} disabled={isPending || !isDirty} className="rounded-md bg-stone-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300">{isPending ? "Saving…" : "Save"}</button>
        </div>
        <p className="text-xs text-stone-400 dark:text-stone-500">Find your Place ID at{" "}<a href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-stone-600 dark:hover:text-stone-300">Google Place ID Finder</a>.</p>
      </div>

      {saved && <p className="mt-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">✓ Place ID saved successfully.</p>}
      {error && <p className="mt-3 text-xs font-medium text-red-600 dark:text-red-400">✗ {error}</p>}

      {/* Manual sync */}
      {isConnected && (
        <>
          <div className="my-5 border-t border-stone-100 dark:border-stone-800" />
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-stone-700 dark:text-stone-300">Manual sync</p>
              <p className="text-xs text-stone-400 dark:text-stone-500">Pull latest reviews now. Auto-sync runs every hour via cron.</p>
            </div>
            <button onClick={handleSync} disabled={syncing} className="flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700">
              {syncing ? <><svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>Syncing…</> : <><svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/></svg>Sync now</>}
            </button>
          </div>
          {syncMsg && <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">✓ {syncMsg}</p>}
        </>
      )}

      {/* GMB OAuth */}
      <div className="my-5 border-t border-stone-100 dark:border-stone-800" />
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-stone-700 dark:text-stone-300">Review reply (Business Profile API)</p>
          <p className="text-xs text-stone-400 dark:text-stone-500">
            {gmbConnected && gmbLocationSet ? "OAuth connected — GM can approve and post replies via ForgeStack." : gmbConnected ? "Connected — select your business location below." : "Connect to enable one-tap reply approvals via WhatsApp."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${gmbConnected && gmbLocationSet ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : gmbConnected ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${gmbConnected && gmbLocationSet ? "bg-emerald-500" : gmbConnected ? "bg-amber-500" : "bg-stone-400"}`} />
            {gmbConnected && gmbLocationSet ? "Connected" : gmbConnected ? "Needs location" : "Not connected"}
          </span>
          {gmbConnected ? (
            <div className="flex items-center gap-2">
              {!gmbLocationSet && <button onClick={() => { setShowPicker(true); loadLocations(); }} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-100 dark:border-amber-800 dark:bg-transparent dark:text-amber-400">Select location</button>}
              <button onClick={handleDisconnect} disabled={disconnecting} className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-transparent dark:text-red-400">{disconnecting ? "Disconnecting…" : "Disconnect"}</button>
            </div>
          ) : (
            <button onClick={() => { window.location.href = `/api/auth/google/connect?siteId=${siteId}`; }} className="flex items-center gap-1.5 rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300">Connect Google</button>
          )}
        </div>
      </div>

      {/* Location picker */}
      {showPicker && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/10">
          <p className="mb-3 text-xs font-medium text-amber-800 dark:text-amber-300">Multiple locations found. Select the one that matches this site.</p>
          {loadingLocs ? <p className="text-xs text-stone-400">Loading locations…</p> : locations.length === 0 ? <p className="text-xs text-red-600">No locations found. Please try reconnecting.</p> : (
            <div className="space-y-2">
              {locations.map((loc) => (
                <label key={loc.name} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition ${selectedLoc === loc.name ? "border-stone-400 bg-white dark:border-stone-500 dark:bg-stone-800" : "border-stone-200 bg-white hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900"}`}>
                  <input type="radio" name={`loc-${siteId}`} value={loc.name} checked={selectedLoc === loc.name} onChange={() => setSelectedLoc(loc.name)} className="mt-0.5 h-3.5 w-3.5"/>
                  <div><p className="text-xs font-medium text-stone-900 dark:text-stone-100">{loc.title}</p>{loc.address && <p className="text-xs text-stone-400">{loc.address}</p>}</div>
                </label>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={handleSaveLocation} disabled={!selectedLoc || savingLoc} className="rounded-md bg-stone-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">{savingLoc ? "Saving…" : "Confirm location"}</button>
                <button onClick={() => setShowPicker(false)} className="text-xs text-stone-400 hover:text-stone-600">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {gmbMsg && <p className={`mt-2 text-xs font-medium ${gmbMsg.includes("cancel") || gmbMsg.includes("error") || gmbMsg.includes("OAuth") ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{gmbMsg.includes("cancel") || gmbMsg.includes("error") || gmbMsg.includes("OAuth") ? "⚠ " : "✓ "}{gmbMsg}</p>}
    </div>
  );
}

export default function GoogleReviewsSettingsCard(props: Props) {
  return <Suspense fallback={null}><Inner {...props} /></Suspense>;
}
