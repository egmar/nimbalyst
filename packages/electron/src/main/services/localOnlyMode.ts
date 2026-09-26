/**
 * Local-only mode: one decision, consulted at every chokepoint that would
 * otherwise reach Nimbalyst's account, collab or telemetry endpoints.
 *
 * The user asked for a way to keep the app off those destinations without
 * deleting anything. Two sources can turn the mode on:
 *
 *   - `NIMBALYST_LOCAL_ONLY=1` in the environment (a dev/testing escape hatch),
 *   - the persisted Settings > Advanced toggle.
 *
 * The environment can only force the mode ON. It cannot force it off: an env
 * var that overrode a user's stored choice would make the setting appear to
 * flip itself depending on how the app was launched.
 *
 * This is a mode flag, not a credential. The repo's "never read API keys from
 * `process.env`" rule (past incident: a stray `ANTHROPIC_API_KEY` billed a
 * user's personal account) is about secrets that authorize billed traffic;
 * reading a boolean here cannot spend anyone's money.
 *
 * Gated by this module: Stytch auth, collab sync, the collab outbox drainers,
 * the team directory fetch (through `isAuthenticated`), and PostHog in both
 * processes. Not gated: marketplace/extension and update checks, and AI
 * provider calls, including a locally configured custom Claude endpoint.
 */

import { isLocalOnlyModeEnabled } from '../utils/store';

/** Values that turn the mode on. Anything else — including `0`, `''`, `no` — is off. */
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/** The environment variable that forces local-only mode on. */
export const LOCAL_ONLY_ENV_VAR = 'NIMBALYST_LOCAL_ONLY';

export interface LocalOnlySources {
  /** Raw value of `NIMBALYST_LOCAL_ONLY`, if set. */
  envValue?: string;
  /** The persisted Settings toggle. */
  storedValue: boolean;
}

/** True when the raw environment value asks for local-only mode. */
export function parseLocalOnlyEnv(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  return TRUTHY.has(value.trim().toLowerCase());
}

/**
 * The whole decision, as a pure function of its two facts.
 *
 * Kept separate from the I/O that reads them so the plan can be tested without
 * an environment or a settings store — the same reason
 * `database/pgliteInitRecovery` exists.
 */
export function resolveLocalOnlyMode({
  envValue,
  storedValue,
}: LocalOnlySources): boolean {
  if (parseLocalOnlyEnv(envValue)) return true;
  return storedValue === true;
}

// Resolved once per process. Both sources are read-only after launch (the
// environment cannot change, and the setting needs a restart to apply), so
// re-reading per call would only add store hits to hot paths like `sendEvent`.
let cached: boolean | null = null;

/**
 * The persisted preference, or `false` when it cannot be read.
 *
 * This is consulted during module initialization of services that are
 * constructed at import time (`AnalyticsService`), and in tests that is often
 * under a partial settings-store mock, where reading the preference throws.
 * A store that cannot be read must not take the whole boot path down with it.
 * It reads as off on an error: this mode disables features, and an unreadable
 * preference is not evidence that the user asked for them to be disabled.
 */
function readStoredLocalOnlyMode(): boolean {
  try {
    return isLocalOnlyModeEnabled();
  } catch (error) {
    console.error('[localOnlyMode] Could not read the stored preference; treating local-only as off', error);
    return false;
  }
}

/** True when the app is running in local-only mode. */
export function isLocalOnlyMode(): boolean {
  cached ??= resolveLocalOnlyMode({
    envValue: process.env[LOCAL_ONLY_ENV_VAR],
    storedValue: readStoredLocalOnlyMode(),
  });
  return cached;
}

/** Test seam: set the effective value directly. */
export function setLocalOnlyMode(value: boolean): void {
  cached = value;
}

/** Test seam: forget the resolved value so the next call re-reads its sources. */
export function resetLocalOnlyModeCacheForTests(): void {
  cached = null;
}
