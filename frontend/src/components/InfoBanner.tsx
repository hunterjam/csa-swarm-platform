// src/components/InfoBanner.tsx
// Lightweight collapsible tip banner for first-time users.
'use client';

import { useState } from 'react';

interface InfoBannerProps {
  /** Short heading shown beside the icon */
  title: string;
  /** Full body — can contain JSX */
  children: React.ReactNode;
  /** localStorage key used to remember "dismissed" — unique per page */
  storageKey: string;
}

export function InfoBanner({ title, children, storageKey }: InfoBannerProps) {
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(storageKey) !== 'dismissed';
  });

  function dismiss() {
    localStorage.setItem(storageKey, 'dismissed');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => { localStorage.removeItem(storageKey); setOpen(true); }}
        className="text-xs text-brand-600 hover:underline flex items-center gap-1"
      >
        <span>ℹ</span> Show guide
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-brand-500 shrink-0">ℹ</span>
          <div>
            <p className="font-semibold mb-1">{title}</p>
            <div className="text-brand-800 space-y-1">{children}</div>
          </div>
        </div>
        <button
          onClick={dismiss}
          title="Dismiss"
          className="text-brand-400 hover:text-brand-700 shrink-0 text-lg leading-none mt-0.5"
        >
          ×
        </button>
      </div>
    </div>
  );
}
