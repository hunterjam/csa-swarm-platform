// src/components/NavBar.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMsal } from '@azure/msal-react';
import { AUTH_ENABLED } from '@/lib/auth';

const NAV_LINKS = [
  { href: '/',               label: 'Sessions'       },
  { href: '/debate',         label: 'Debate'         },
  { href: '/context',        label: 'Context'        },
  { href: '/recommendations',label: 'Deliverables'   },
];

export default function NavBar() {
  const pathname = usePathname();
  const { instance, accounts } = useMsal();

  function handleSignOut() {
    instance.logoutPopup();
  }

  return (
    <nav className="bg-brand-900 text-white px-6 py-3 flex items-center gap-8 shadow-md">
      <span className="font-bold text-lg tracking-tight whitespace-nowrap">
        ⚡ CSA Swarm
      </span>

      <div className="flex gap-6 flex-1">
        {NAV_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`text-sm font-medium hover:text-blue-300 transition-colors ${
              pathname === href ? 'text-blue-300 underline underline-offset-4' : ''
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {AUTH_ENABLED && accounts.length > 0 && (
        <div className="flex items-center gap-4 text-sm">
          <span className="opacity-70 truncate max-w-[200px]">
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
    </nav>
  );
}
