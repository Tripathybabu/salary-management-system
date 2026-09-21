import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Unmount between tests so a component never sees state from the previous one.
afterEach(cleanup);
