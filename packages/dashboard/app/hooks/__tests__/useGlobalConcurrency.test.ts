import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const legacyMocks = vi.hoisted(() => ({
  fetchGlobalConcurrency: vi.fn(),
  updateGlobalConcurrency: vi.fn(),
}));

vi.mock("../../api/legacy", () => legacyMocks);

type UseGlobalConcurrencyModule = typeof import("../useGlobalConcurrency");
type GlobalConcurrencyApiState = {
  globalMaxConcurrent: number;
  currentlyActive: number;
  queuedCount: number;
  projectsActive: Record<string, number>;
};

async function loadHook(): Promise<UseGlobalConcurrencyModule["useGlobalConcurrency"]> {
  vi.resetModules();
  const module = await import("../useGlobalConcurrency");
  return module.useGlobalConcurrency;
}

function concurrencyState(overrides: Partial<GlobalConcurrencyApiState> = {}): GlobalConcurrencyApiState {
  return {
    globalMaxConcurrent: 6,
    currentlyActive: 3,
    queuedCount: 0,
    projectsActive: { proj_123: 2 },
    ...overrides,
  };
}

describe("useGlobalConcurrency", () => {
  beforeEach(() => {
    vi.useRealTimers();
    legacyMocks.fetchGlobalConcurrency.mockResolvedValue(concurrencyState());
    legacyMocks.updateGlobalConcurrency.mockResolvedValue(concurrencyState({ globalMaxConcurrent: 8 }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("populates running counts after fetch and returns zero for absent projects", async () => {
    const useGlobalConcurrency = await loadHook();

    const { result } = renderHook(() => useGlobalConcurrency());

    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(result.current.value).toBe(6);
    expect(result.current.currentlyActive).toBe(3);
    expect(result.current.projectActiveCount("proj_123")).toBe(2);
    expect(result.current.projectActiveCount("missing-project")).toBe(0);
    expect(result.current.projectActiveCount()).toBe(0);
  });

  it("keeps last-known running counts after a successful PUT", async () => {
    const useGlobalConcurrency = await loadHook();
    const { result } = renderHook(() => useGlobalConcurrency());
    await waitFor(() => expect(result.current.status).toBe("loaded"));

    vi.useFakeTimers();
    act(() => result.current.setValue("8"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await Promise.resolve();
    });
    vi.useRealTimers();

    await waitFor(() => expect(result.current.saveState).toBe("saved"));
    expect(legacyMocks.updateGlobalConcurrency).toHaveBeenCalledWith({ globalMaxConcurrent: 8 });
    expect(result.current.value).toBe(8);
    expect(result.current.currentlyActive).toBe(3);
    expect(result.current.projectActiveCount("proj_123")).toBe(2);
  });

  it("does not surface stale truthy counts while loading or in error", async () => {
    const useGlobalConcurrency = await loadHook();
    const { result, rerender } = renderHook(({ activeWhen }) => useGlobalConcurrency({ activeWhen }), {
      initialProps: { activeWhen: true },
    });
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(result.current.currentlyActive).toBe(3);

    legacyMocks.fetchGlobalConcurrency.mockRejectedValueOnce(new Error("offline"));
    rerender({ activeWhen: false });
    rerender({ activeWhen: true });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.currentlyActive).toBe(0);
    expect(result.current.projectActiveCount("proj_123")).toBe(0);
  });
});
