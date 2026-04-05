// src/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import MsalProvider from '@/components/MsalProvider';
import NavBar from '@/components/NavBar';
import AuthWrapper from '@/components/AuthWrapper';

export const metadata: Metadata = {
  title: 'CSA Swarm Platform',
  description: 'OGE Observability Agentic Swarm — multi-user platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <MsalProvider>
          <AuthWrapper>
            <NavBar />
            <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
          </AuthWrapper>
        </MsalProvider>
      </body>
    </html>
  );
}
