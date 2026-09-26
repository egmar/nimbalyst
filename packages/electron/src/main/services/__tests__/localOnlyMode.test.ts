// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const { stored } = vi.hoisted(() => ({ stored: { value: false } }));

vi.mock("../../utils/store", () => ({
  isLocalOnlyModeEnabled: () => stored.value,
}));

import {
  LOCAL_ONLY_ENV_VAR,
  isLocalOnlyMode,
  parseLocalOnlyEnv,
  resetLocalOnlyModeCacheForTests,
  resolveLocalOnlyMode,
} from "../localOnlyMode";

describe("parseLocalOnlyEnv", () => {
  it.each(["1", "true", "TRUE", "yes", "on", " 1 "])(
    "turns the mode on for %j",
    (value) => {
      expect(parseLocalOnlyEnv(value)).toBe(true);
    }
  );

  it.each(["", "0", "false", "no", "off", "enabled"])(
    "leaves the mode off for %j",
    (value) => {
      expect(parseLocalOnlyEnv(value)).toBe(false);
    }
  );

  it("treats an unset variable as off", () => {
    expect(parseLocalOnlyEnv(undefined)).toBe(false);
  });
});

describe("resolveLocalOnlyMode", () => {
  it("is on when only the environment asks for it", () => {
    expect(
      resolveLocalOnlyMode({ envValue: "1", storedValue: false })
    ).toBe(true);
  });

  it("is on when only the stored setting asks for it", () => {
    expect(
      resolveLocalOnlyMode({ envValue: undefined, storedValue: true })
    ).toBe(true);
  });

  it("is off when neither source asks for it", () => {
    expect(
      resolveLocalOnlyMode({ envValue: undefined, storedValue: false })
    ).toBe(false);
  });

  /**
   * An environment variable that could turn the mode OFF would make the stored
   * setting appear to flip itself depending on how the app was launched.
   */
  it("cannot be turned off by the environment", () => {
    expect(
      resolveLocalOnlyMode({ envValue: "0", storedValue: true })
    ).toBe(true);
  });
});

describe("isLocalOnlyMode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    stored.value = false;
    resetLocalOnlyModeCacheForTests();
  });

  it("reads the environment and the stored setting once", () => {
    stored.value = true;
    resetLocalOnlyModeCacheForTests();
    expect(isLocalOnlyMode()).toBe(true);

    // The setting needs a restart to apply, so a later store change must not
    // move the decision out from under a service that already gated on it.
    stored.value = false;
    expect(isLocalOnlyMode()).toBe(true);
  });

  it("honours the environment variable on a fresh resolution", () => {
    vi.stubEnv(LOCAL_ONLY_ENV_VAR, "1");
    resetLocalOnlyModeCacheForTests();
    expect(isLocalOnlyMode()).toBe(true);
  });
});
