import type { Browser } from "playwright";
import { describe, expect, it, vi } from "vitest";

import { BrowserUnavailableError, launchSession, type BrowserLauncher } from "./session";

/** Minimal stand-in for the parts of Browser this module touches. */
function fakeBrowser(overrides: Partial<Browser> = {}): Browser {
  return {
    version: () => "0.0.0-fake",
    close: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as Browser;
}

describe("launchSession", () => {
  it("passes headless and hardening flags to the launcher", async () => {
    const launcher = vi.fn<BrowserLauncher>(async () => fakeBrowser());

    const session = await launchSession({ launcher });
    await session.close();

    const options = launcher.mock.calls[0]?.[0];
    expect(options?.headless).toBe(true);
    expect(options?.args).toContain("--disable-dev-shm-usage");
  });

  it("never disables the Chromium sandbox", async () => {
    // --no-sandbox is the usual container workaround and removes the strongest
    // boundary between a hostile page and the host.
    const launcher = vi.fn<BrowserLauncher>(async () => fakeBrowser());

    const session = await launchSession({ launcher });
    await session.close();

    expect(launcher.mock.calls[0]?.[0]?.args).not.toContain("--no-sandbox");
    expect(launcher.mock.calls[0]?.[0]?.args).not.toContain("--disable-setuid-sandbox");
  });

  it("applies a launch timeout", async () => {
    const launcher = vi.fn<BrowserLauncher>(async () => fakeBrowser());

    const session = await launchSession({ launcher, launchTimeoutMs: 1234 });
    await session.close();

    expect(launcher.mock.calls[0]?.[0]?.timeout).toBe(1234);
  });

  it("closes the browser", async () => {
    const close = vi.fn(async () => undefined);
    const session = await launchSession({ launcher: async () => fakeBrowser({ close }) });

    await session.close();

    expect(close).toHaveBeenCalledOnce();
  });

  it("does not throw when closing fails", async () => {
    // Cleanup failure must never mask the analysis result.
    const session = await launchSession({
      launcher: async () =>
        fakeBrowser({
          close: vi.fn(async () => {
            throw new Error("already gone");
          }),
        }),
    });

    await expect(session.close()).resolves.toBeUndefined();
  });

  it("exposes a DevTools endpoint when the browser has one", async () => {
    // ADR-033: Phase 8 attaches Lighthouse here rather than launching a second
    // Chromium.
    const session = await launchSession({
      launcher: async () =>
        fakeBrowser({
          wsEndpoint: () => "ws://127.0.0.1:9222/devtools/browser/abc",
        } as Partial<Browser>),
    });

    expect(session.endpoint).toBe("ws://127.0.0.1:9222/devtools/browser/abc");
    await session.close();
  });

  it("reports a null endpoint rather than guessing when there is none", async () => {
    const session = await launchSession({ launcher: async () => fakeBrowser() });

    expect(session.endpoint).toBeNull();
    await session.close();
  });

  it("raises BrowserUnavailableError when the browser will not start", async () => {
    const launcher: BrowserLauncher = async () => {
      throw new Error("Executable doesn't exist");
    };

    await expect(launchSession({ launcher })).rejects.toBeInstanceOf(
      BrowserUnavailableError,
    );
  });

  it("explains how to install the browser", async () => {
    const launcher: BrowserLauncher = async () => {
      throw new Error("Executable doesn't exist");
    };

    await expect(launchSession({ launcher })).rejects.toThrow(/playwright install/);
  });
});
