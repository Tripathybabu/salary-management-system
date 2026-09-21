'use client';

import { useEffect, useState } from 'react';

/**
 * Debounce a rapidly-changing value.
 *
 * Used for the employee search box. Without it, typing "Johnson" fires seven
 * queries against a 10,000-row table and the results flicker through
 * intermediate states as responses arrive out of order.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    // Clearing on change is what makes this a debounce rather than a delay:
    // each new keystroke cancels the pending update.
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
