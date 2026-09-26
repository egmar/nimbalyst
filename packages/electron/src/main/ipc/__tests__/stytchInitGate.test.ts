// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
    createStytchInitGate,
    STYTCH_LAZY_INIT_NOTICE,
    STYTCH_LOCAL_ONLY_NOTICE,
} from '../stytchInitGate';

function makeGate(isLocalOnly: boolean) {
    const initialize = vi.fn();
    const log = vi.fn();
    return {
        initialize,
        log,
        gate: createStytchInitGate({ isLocalOnly: () => isLocalOnly, initialize, log }),
    };
}

it('settles a local-only decline, so later stytch calls initialize nothing and log nothing new', () => {
    const { gate, initialize, log } = makeGate(true);

    for (let call = 0; call < 15; call++) gate.ensure();

    expect(initialize).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(STYTCH_LOCAL_ONLY_NOTICE);
});

it('initializes once, and an environment switch keeps the next call from re-initializing against live', () => {
    const { gate, initialize, log } = makeGate(false);

    gate.ensure();
    gate.ensure();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(STYTCH_LAZY_INIT_NOTICE);

    // The switch initializes against the requested environment; leaving the
    // question open would let the next `stytch:*` call re-initialize against live.
    gate.reopen();
    gate.markInitialized();
    gate.ensure();

    expect(initialize).toHaveBeenCalledTimes(1);
});
