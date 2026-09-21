'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * React Query provider.
 *
 * The client is created inside `useState` rather than at module scope: a
 * module-level client would be shared across requests on the server, leaking one
 * user's cached data into another's response.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Salary data changes rarely. A short stale window keeps navigation
            // instant without serving figures that are meaningfully out of date.
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
