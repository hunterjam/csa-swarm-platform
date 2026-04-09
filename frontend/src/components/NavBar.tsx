// src/components/NavBar.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMsal } from '@azure/msal-react';
import { AUTH_ENABLED } from '@/lib/auth';
import { useSession } from '@/lib/session-context';

const STEPS = [
  { href: '/',                label: 'Sessions',     sessionParam: false },
  { href: '/context',         label: 'Context',      sessionParam: true  },
  { href: '/setup',           label: 'Setup',        sessionParam: true  },
  { href: '/debate',          label: 'Debate',       sessionParam: true  },
  { href: '/recommendations', label: 'Deliverables', sessionParam: true  },
  { href: '/history',         label: 'History',      sessionParam: true  },
];

export default function NavBar() {
  const pathname = usePathname();
  const { instance, accounts } = useMsal();
  const { activeSessionId } = useSession();

  const currentIdx = STEPS.findIndex(s => s.href === pathname);

  function handleSignOut() {
    instance.logoutPopup();
  }

  return (
    <nav className="bg-brand-900 text-white shadow-md">
      {/* Top bar: brand + sign-out */}
      <div className="px-6 pt-3 pb-0 flex items-center justify-between">
        <span className="font-bold text-base tracking-tight whitespace-nowrap">
          ⚡ CSA Swarm
        </span>
        {AUTH_ENABLED && accounts.length > 0 && (
          <div className="flex items-center gap-4 text-sm">
            <span className="opacity-60 truncate max-w-[200px]">
              {accounts[0].name ?? accounts[0].username}
            </span>
            <button
              onClick={handleSignOut}
              className="bg-white/10 hover:bg-white/20 px-3 py-1 rounded transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      {/* Wizard step rail */}
      <div className="px-6 pb-3 pt-2 overflow-x-auto">
        <div className="flex items-center min-w-max mx-auto">
          {STEPS.map(({ href, label, sessionParam }, idx) => {
            const isCompleted = idx < currentIdx;
            const isCurrent   = idx === currentIdx;
            const dest = sessionParam && activeSessionId
              ? `${href}?session=${activeSessionId}`
              : href;
            const isClickable = !sessionParam || !!activeSessionId;

            return (
              <div key={href} className="flex items-center">
                {/* Step node */}
                {isClickable ? (
                  <Link href={dest} className="flex flex-col items-center gap-1 group">
                    <span className={`
                      w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors
                      ${isCompleted
                        ? 'bg-blue-400 border-blue-400 text-white'
                        : isCurrent
                          ? 'bg-white border-white text-brand-900'
                          : 'bg-transparent border-white/30 text-white/40 group-hover:border-white/60 group-hover:text-white/60'}
                    `}>
                      {isCompleted ? '✓' : idx + 1}
                    </span>
                    <span className={`text-[11px] font-medium whitespace-nowrap transition-colors
                      ${isCurrent
                        ? 'text-white'
                        : isCompleted
                          ? 'text-blue-300'
                          : 'text-white/40 group-hover:text-white/60'}
                    `}>
                      {label}
                    </span>
                  </Link>
                ) : (
                  <div className="flex flex-col items-center gap-1 cursor-not-allowed">
                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 border-white/20 text-white/25">
                      {idx + 1}
                    </span>
                    <span className="text-[11px] font-medium whitespace-nowrap text-white/25">
                      {label}
                    </span>
                  </div>
                )}

                {/* Connector */}
                {idx < STEPS.length - 1 && (
                  <div className={`w-10 h-0.5 mx-2 mb-4 transition-colors ${idx < currentIdx ? 'bg-blue-400' : 'bg-white/20'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
