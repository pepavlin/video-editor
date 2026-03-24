import { useState, useCallback, useRef } from 'react';

export interface ErrorEntry {
  id: string;
  timestamp: Date;
  title: string;
  message: string;
  details?: string[];
  source: 'aiStyle' | 'cutout' | 'headStab' | 'export' | 'beats' | 'lyrics' | 'sync' | 'import' | 'network' | 'unknown';
}

let nextId = 1;

export function useErrorLog() {
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const errorsRef = useRef(errors);
  errorsRef.current = errors;

  const addError = useCallback((
    title: string,
    message: string,
    source: ErrorEntry['source'] = 'unknown',
    details?: string[],
  ) => {
    const entry: ErrorEntry = {
      id: `err-${nextId++}`,
      timestamp: new Date(),
      title,
      message,
      details,
      source,
    };
    setErrors((prev) => [...prev, entry].slice(-50)); // keep last 50
    setHasUnread(true);
    return entry;
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
    setHasUnread(false);
  }, []);

  const removeError = useCallback((id: string) => {
    setErrors((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const open = useCallback(() => {
    setIsOpen(true);
    setHasUnread(false);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      if (!prev) setHasUnread(false);
      return !prev;
    });
  }, []);

  return { errors, isOpen, hasUnread, addError, clearErrors, removeError, open, close, toggle };
}

export type ErrorLog = ReturnType<typeof useErrorLog>;
