import { useRef } from 'react';
// A retry keeps its key. An edited payload is a new save intent.
export function useSaveIntent() {
  const intent = useRef<{ body: string; key: string } | null>(null);
  return (value: unknown) => {
    const body = JSON.stringify(value);
    if (!intent.current || intent.current.body !== body)
      intent.current = { body, key: crypto.randomUUID() };
    return intent.current.key;
  };
}
