/**
 * Console logging with a scope prefix. No logging library: this runs as a
 * GitHub Actions step, so stdout *is* the log destination and structured
 * output would only make the run page harder to read.
 *
 * Prefixes are greppable -- `[youtube]`, `[mongo]`, `[digest]` -- which is
 * the whole feature.
 */
export function logger(scope: string) {
  const prefix = `[${scope}]`;
  return {
    info: (...args: unknown[]) => console.log(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, 'WARN', ...args),
    error: (...args: unknown[]) => console.error(prefix, 'ERROR', ...args),
  };
}

export type Log = ReturnType<typeof logger>;
