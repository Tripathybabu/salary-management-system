'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from './ui';

/**
 * Navigation link that knows whether it is the current page.
 *
 * `aria-current` is set as well as the visual state, so the active page is
 * announced to a screen reader rather than only shown in colour.
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  // Exact match for the dashboard; prefix match elsewhere, so /employees/:id
  // keeps "Employees" highlighted.
  const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'rounded-lg px-3 py-1.5 text-sm font-medium transition',
        isActive ? 'bg-brand-soft text-brand' : 'text-ink-muted hover:bg-surface hover:text-ink',
      )}
    >
      {children}
    </Link>
  );
}
