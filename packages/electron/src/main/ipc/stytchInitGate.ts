/**
 * Whether the lazy Stytch init has been decided yet for this process.
 *
 * A decline settles the question as firmly as a success does: local-only mode
 * cannot change without a relaunch, so a later `stytch:*` call that re-runs the
 * branch only re-logs the same line (~15 per launch) for an answer that was
 * already final.
 *
 * Dependencies are injected because the decision is otherwise only reachable
 * from inside Electron's IPC layer, where the interesting branch — the decline —
 * cannot be exercised.
 */

export const STYTCH_LOCAL_ONLY_NOTICE = '[SettingsHandlers] Local-only mode: not initializing Stytch';
export const STYTCH_LAZY_INIT_NOTICE = '[SettingsHandlers] Lazy-initializing Stytch';

export interface StytchInitGateDeps {
    isLocalOnly: () => boolean;
    initialize: () => void;
    log: (message: string) => void;
}

export interface StytchInitGate {
    /** Decide at most once; later calls do nothing. */
    ensure(): void;
    /** Record the question as settled without deciding it, for a path that already initialized Stytch. */
    markInitialized(): void;
    /** Reopen the question, for a path that changes which environment Stytch initializes against. */
    reopen(): void;
}

export function createStytchInitGate(deps: StytchInitGateDeps): StytchInitGate {
    let decided = false;

    return {
        ensure(): void {
            if (decided) return;
            decided = true;

            // Local-only mode never talks to Stytch. Settling the question here keeps
            // this lazy path from undoing the boot-time gate the first time a
            // `stytch:*` handler is invoked.
            if (deps.isLocalOnly()) {
                deps.log(STYTCH_LOCAL_ONLY_NOTICE);
                return;
            }

            deps.log(STYTCH_LAZY_INIT_NOTICE);
            deps.initialize();
        },
        markInitialized(): void {
            decided = true;
        },
        reopen(): void {
            decided = false;
        },
    };
}
