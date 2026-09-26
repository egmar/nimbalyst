// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  localOnly: false,
  analyticsEnabled: true,
  clients: 0,
  captured: [] as Array<{ event: string }>,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  setAnalyticsEnabled: vi.fn(),
}));

vi.mock("electron", () => ({ app: { getVersion: () => "0.0.0-test" } }));
vi.mock("posthog-node", () => ({
  PostHog: class {
    constructor() {
      h.clients += 1;
    }
    capture(message: { event: string }) {
      h.captured.push(message);
    }
    captureImmediate(message: { event: string }) {
      h.captured.push(message);
    }
    async optIn() {}
    async optOut() {}
    async shutdown() {}
    async getFeatureFlag() {
      return undefined;
    }
    async getFeatureFlagPayload() {
      return null;
    }
  },
}));
vi.mock("../../../utils/privateSettingsStore", () => ({
  default: class {
    get(_key: string, fallback?: unknown) {
      return fallback ?? "nimbalyst_test";
    }
    set() {}
  },
}));
vi.mock("../../../utils/store", () => ({
  getReleaseChannel: () => "stable",
  isAnalyticsEnabled: () => h.analyticsEnabled,
  setAnalyticsEnabled: h.setAnalyticsEnabled,
}));
vi.mock("../../../utils/gitUtils", () => ({ isGitAvailable: () => false }));
vi.mock("../../../utils/logger", () => ({
  logger: {
    analytics: {
      info: h.info,
      warn: h.warn,
      error: h.error,
      debug: vi.fn(),
    },
  },
}));
vi.mock("../../localOnlyMode", () => ({ isLocalOnlyMode: () => h.localOnly }));

/**
 * The service builds itself at module load (`private static instance = new
 * AnalyticsService()`), so the mode has to be set before the import, not after.
 */
async function loadService() {
  vi.resetModules();
  const mod = await import("../AnalyticsService");
  return mod.AnalyticsService.getInstance();
}

describe("AnalyticsService local-only gate", () => {
  beforeEach(() => {
    h.localOnly = false;
    h.analyticsEnabled = true;
    h.clients = 0;
    h.captured = [];
    vi.clearAllMocks();
  });

  it("creates no PostHog client and sends nothing in local-only mode", async () => {
    h.localOnly = true;
    const service = await loadService();

    expect(h.clients).toBe(0);

    service.sendEvent("workspace_opened", { count: 1 });

    expect(h.captured).toEqual([]);
    // The ordering trap: `sendEvent` checks the missing client BEFORE it checks
    // whether analytics is allowed, so a gate placed only in `init()` would log
    // "PostHog client not initialized" on every single event.
    expect(h.error).not.toHaveBeenCalled();
    expect(service.allowedToSendAnalytics()).toBe(false);
  });

  it("still creates clients and sends events when local-only is off", async () => {
    const service = await loadService();

    // One for events, one for the session tracker.
    expect(h.clients).toBe(2);

    service.sendEvent("workspace_opened");

    expect(h.captured.map((message) => message.event)).toEqual([
      "workspace_opened",
    ]);
  });

  it("does not resurrect a client from an analytics opt-in", async () => {
    h.localOnly = true;
    const service = await loadService();

    await service.optIn();

    expect(h.clients).toBe(0);
    // The stored preference is the user's; local-only mode must not overwrite it.
    expect(h.setAnalyticsEnabled).not.toHaveBeenCalled();
  });
});
