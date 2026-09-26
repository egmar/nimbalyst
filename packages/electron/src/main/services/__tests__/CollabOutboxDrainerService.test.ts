// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OutboxUpgradeRejectedError,
  retryOutboxConnectAfterAuthRejection,
} from "../OutboxTransportAuthRetry";

const { errorSpy, personalUserId, networkOnline, localOnly, listPendingOutboxes, listPendingAssetUploads } =
  vi.hoisted(() => ({
    errorSpy: vi.fn(),
    personalUserId: { value: null as string | null },
    networkOnline: { value: true },
    localOnly: { value: false },
    listPendingOutboxes: vi.fn(async () => []),
    listPendingAssetUploads: vi.fn(async () => []),
  }));

vi.mock("electron", () => ({ net: { isOnline: () => networkOnline.value } }));
vi.mock("../../utils/logger", () => ({
  logger: {
    main: { error: errorSpy, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  },
}));
vi.mock("../StytchAuthService", () => ({
  getPersonalUserId: () => personalUserId.value,
  onAuthStateChange: () => () => {},
}));
vi.mock("../TeamService", () => ({ getOrgScopedJwt: vi.fn() }));
vi.mock("../NetworkAvailability", () => ({
  onNetworkAvailable: () => () => {},
}));
vi.mock("../CollabDocumentReplicaStore", () => ({
  getCollabDocumentReplicaStore: () => ({
    listPendingOutboxes,
  }),
}));
vi.mock("../CollabAssetStore", () => ({
  getCollabAssetStore: () => ({ listPendingUploads: listPendingAssetUploads }),
}));
vi.mock("../CollabAssetUploader", () => ({ uploadCollabAsset: vi.fn() }));
vi.mock("../localOnlyMode", () => ({
  isLocalOnlyMode: () => localOnly.value,
}));

import { CollabOutboxDrainCoordinator } from "../CollabOutboxDrainerService";
import { CollabAssetOutboxDrainCoordinator } from "../CollabAssetOutboxDrainCoordinator";

describe("Collab outbox transport authentication", () => {
  it("retries one connect-time 403 with a forced fresh JWT", async () => {
    const forceRefreshCalls: boolean[] = [];

    const result = await retryOutboxConnectAfterAuthRejection(
      async (forceRefresh) => {
        forceRefreshCalls.push(forceRefresh);
        if (!forceRefresh) throw new OutboxUpgradeRejectedError(403);
        return "connected";
      }
    );

    expect(result).toBe("connected");
    expect(forceRefreshCalls).toEqual([false, true]);
  });

  it("does not retry non-auth upgrade failures", async () => {
    const connect = vi.fn(async () => {
      throw new OutboxUpgradeRejectedError(503);
    });

    await expect(retryOutboxConnectAfterAuthRejection(connect)).rejects.toThrow(
      "HTTP 503"
    );
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe("Collab outbox drainer identity gating", () => {
  let coordinator: CollabOutboxDrainCoordinator;

  beforeEach(() => {
    vi.useFakeTimers();
    errorSpy.mockClear();
    personalUserId.value = null;
    networkOnline.value = true;
    coordinator = new CollabOutboxDrainCoordinator();
  });

  afterEach(() => {
    coordinator.stop();
    vi.useRealTimers();
  });

  it("reports a missing personal identity once, not once per 30s tick", () => {
    coordinator.start();
    vi.advanceTimersByTime(30_000 * 10);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][1]).toEqual({ source: "startup" });
  });

  it("reports again when the identity returns and is lost a second time", async () => {
    coordinator.start();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    personalUserId.value = "member-personal-1";
    await vi.advanceTimersByTimeAsync(30_000);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    personalUserId.value = null;
    vi.advanceTimersByTime(30_000);
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });
});

/**
 * Local-only mode keeps the app off the account and collab endpoints. The
 * drainers are the one collab path that starts unconditionally at boot, so the
 * gate has to be inside `start()` — gating the call site in `index.ts` would
 * leave both of these untestable.
 */
describe("Collab outbox drainers in local-only mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    errorSpy.mockClear();
    listPendingOutboxes.mockClear();
    listPendingAssetUploads.mockClear();
    personalUserId.value = "member-personal-1";
    networkOnline.value = true;
    localOnly.value = true;
  });

  afterEach(() => {
    localOnly.value = false;
    vi.useRealTimers();
  });

  it("never starts the document drainer", () => {
    const coordinator = new CollabOutboxDrainCoordinator();
    coordinator.start();
    vi.advanceTimersByTime(30_000 * 10);

    expect(listPendingOutboxes).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    coordinator.stop();
  });

  it("never starts the asset drainer", () => {
    const coordinator = new CollabAssetOutboxDrainCoordinator();
    coordinator.start();
    vi.advanceTimersByTime(30_000 * 10);

    expect(listPendingAssetUploads).not.toHaveBeenCalled();
    coordinator.stop();
  });

  it("still starts the document drainer when local-only is off", () => {
    localOnly.value = false;
    const coordinator = new CollabOutboxDrainCoordinator();
    coordinator.start();
    vi.advanceTimersByTime(30_000);

    expect(listPendingOutboxes).toHaveBeenCalled();
    coordinator.stop();
  });
});
