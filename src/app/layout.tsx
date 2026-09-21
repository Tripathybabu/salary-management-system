import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Providers } from './providers';
import { NavLink } from '@/components/nav-link';

export const metadata: Metadata = {
  title: 'ACME Salary Management',
  description: 'Compensation management and pay analytics for 10,000 employees',
};

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/employees', label: 'Employees' },
  { href: '/analytics', label: 'Pay analysis' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="min-h-screen">
            <header className="sticky top-0 z-20 border-b border-border bg-surface-raised/85 backdrop-blur">
              <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
                <Link href="/" className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-brand text-xs font-bold text-white">
                    A
                  </span>
                  <span className="text-sm font-semibold text-ink">ACME People</span>
                </Link>

                <nav className="flex items-center gap-1" aria-label="Main">
                  {NAV.map((item) => (
                    <NavLink key={item.href} href={item.href}>
                      {item.label}
                    </NavLink>
                  ))}
                </nav>

                {/* Stands in for the signed-in user until auth lands. */}
                <div className="ml-auto hidden items-center gap-2 sm:flex">
                  <div className="text-right">
                    <p className="text-xs font-medium leading-tight text-ink">HR Manager</p>
                    <p className="text-[11px] leading-tight text-ink-muted">ACME Corp</p>
                  </div>
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                    HR
                  </span>
                </div>
              </div>
            </header>

            <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
