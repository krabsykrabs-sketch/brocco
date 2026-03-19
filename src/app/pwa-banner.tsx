"use client";

import { useState, useEffect } from "react";

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/.test(navigator.userAgent);
}

function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/CriOS|FxiOS|Chrome/.test(ua);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches
    || ("standalone" in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true);
}

export function PWAInstallBanner() {
  const [show, setShow] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (typeof window === "undefined") return;
    const dismissed = localStorage.getItem("brocco_pwa_dismissed");
    if (dismissed) return;
    // Show after a short delay so it doesn't appear during initial load
    const t = setTimeout(() => setShow(true), 2000);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    setShow(false);
    setShowModal(false);
    localStorage.setItem("brocco_pwa_dismissed", "1");
  }

  if (!show) return null;

  const ios = isIOS();
  const android = isAndroid();
  const safari = isSafari();

  return (
    <>
      {/* Banner */}
      {!showModal && (
        <div className="md:hidden fixed bottom-16 left-0 right-0 z-40 px-4 pb-2" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-3 flex items-center gap-3 shadow-lg">
            <span className="text-xl flex-shrink-0">&#x1F4F1;</span>
            <p className="text-xs text-gray-300 flex-1">Add brocco.run to your home screen for the best experience</p>
            <button onClick={() => setShowModal(true)} className="text-xs text-green-400 font-medium flex-shrink-0 hover:text-green-300">Show me</button>
            <button onClick={dismiss} className="text-xs text-gray-500 flex-shrink-0 hover:text-gray-400">&times;</button>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={dismiss}>
          <div className="bg-gray-900 border-t border-gray-700 rounded-t-2xl w-full max-w-lg p-5 pb-8" onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2rem)" }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white">Install brocco.run</h3>
              <button onClick={dismiss} className="text-gray-400 hover:text-white text-lg">&times;</button>
            </div>

            {ios && !safari && (
              <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg p-3 mb-4">
                <p className="text-sm text-yellow-300 font-medium">Switch to Safari first</p>
                <p className="text-xs text-yellow-400/80 mt-1">Only Safari can install web apps on iPhone. Open brocco.run in Safari, then follow these steps.</p>
              </div>
            )}

            {ios && (
              <ol className="space-y-3 text-sm text-gray-300">
                <li className="flex gap-3"><span className="text-green-400 font-bold flex-shrink-0">1.</span>Tap the <span className="inline-flex items-center gap-1 bg-gray-800 px-1.5 py-0.5 rounded text-xs font-medium">Share <svg className="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg></span> button at the bottom of Safari</li>
                <li className="flex gap-3"><span className="text-green-400 font-bold flex-shrink-0">2.</span>Scroll down and tap <span className="bg-gray-800 px-1.5 py-0.5 rounded text-xs font-medium">Add to Home Screen</span></li>
                <li className="flex gap-3"><span className="text-green-400 font-bold flex-shrink-0">3.</span>Tap <span className="bg-gray-800 px-1.5 py-0.5 rounded text-xs font-medium">Add</span> in the top right</li>
                <li className="flex gap-3"><span className="text-green-400 font-bold flex-shrink-0">4.</span>Open brocco.run from your home screen — it works like a regular app!</li>
              </ol>
            )}

            {android && (
              <ol className="space-y-3 text-sm text-gray-300">
                <li className="flex gap-3"><span className="text-green-400 font-bold flex-shrink-0">1.</span>Tap the <span className="bg-gray-800 px-1.5 py-0.5 rounded text-xs font-medium">&#8942; menu</span> in the top right of Chrome</li>
                <li className="flex gap-3"><span className="text-green-400 font-bold flex-shrink-0">2.</span>Tap <span className="bg-gray-800 px-1.5 py-0.5 rounded text-xs font-medium">Add to Home Screen</span> or <span className="bg-gray-800 px-1.5 py-0.5 rounded text-xs font-medium">Install App</span></li>
                <li className="flex gap-3"><span className="text-green-400 font-bold flex-shrink-0">3.</span>Tap <span className="bg-gray-800 px-1.5 py-0.5 rounded text-xs font-medium">Install</span></li>
                <li className="flex gap-3"><span className="text-green-400 font-bold flex-shrink-0">4.</span>Open brocco.run from your home screen — it works like a regular app!</li>
              </ol>
            )}

            {!ios && !android && (
              <p className="text-sm text-gray-400">On mobile, use your browser menu to add this site to your home screen for the best experience.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Reusable install instructions for the Settings page */
export function InstallInstructions() {
  const ios = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const android = typeof navigator !== "undefined" && /Android/.test(navigator.userAgent);

  return (
    <div className="space-y-3">
      {ios && (
        <ol className="space-y-2 text-sm text-gray-300">
          <li>1. Open brocco.run in <span className="font-medium text-white">Safari</span> (not Chrome)</li>
          <li>2. Tap the Share button at the bottom</li>
          <li>3. Tap "Add to Home Screen"</li>
          <li>4. Tap "Add" — done!</li>
        </ol>
      )}
      {android && (
        <ol className="space-y-2 text-sm text-gray-300">
          <li>1. Open brocco.run in <span className="font-medium text-white">Chrome</span></li>
          <li>2. Tap the three-dot menu (top right)</li>
          <li>3. Tap "Add to Home Screen" or "Install App"</li>
          <li>4. Tap "Install" — done!</li>
        </ol>
      )}
      {!ios && !android && (
        <p className="text-sm text-gray-400">Use your mobile browser menu to add this site to your home screen.</p>
      )}
    </div>
  );
}
