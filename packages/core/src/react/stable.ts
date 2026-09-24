import { useRef } from 'react';

/** Structural equality for plain props objects; functions and components compare by identity. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Keep the previous value while it is structurally equal, so inline props such as
 * `classNames={{ card: 'rounded' }}` do not re-render the whole board on every host render.
 */
export function useStableValue<T>(value: T): T {
  const ref = useRef(value);
  if (!deepEqual(ref.current, value)) ref.current = value;
  return ref.current;
}
