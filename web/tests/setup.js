// Registers the jest-dom matchers (toBeInTheDocument, toHaveTextContent etc.)
// on Vitest's `expect`. Run once per test file (setupFiles).
import '@testing-library/jest-dom/vitest'

// jsdom ships no ResizeObserver. Recharts' <ResponsiveContainer> (the Billed
// history chart, M8 stage 15) constructs one on mount and throws without it.
// A no-op stub is enough for the fast band — layout is never asserted in
// jsdom; the chart is checked for real in a browser.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
