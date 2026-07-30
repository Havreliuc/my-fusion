import { describe, expect, it } from "vitest";
import type { TaskDetail } from "@fusion/core";
import "./executor-test-helpers.js";
import { TaskExecutor } from "../executor.js";
import { createMockStore, resetExecutorMocks } from "./executor-test-helpers.js";

const now = "2026-07-30T00:00:00.000Z";

function task(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: "FN-PLAN-REVIEW-RETRY",
    title: "Plan review provider failure retry",
    description: "Coverage for the Plan Review provider-failure retry-in-place budget",
    column: "in-progress",
    dependencies: [],
    steps: [{ name: "Implement", status: "pending" }],
    currentStep: 0,
    log: [],
    branch: "fusion/fn-plan-review-retry",
    baseBranch: "main",
    worktree: "/tmp/fusion-fn-plan-review-retry",
    status: null,
    error: null,
    paused: false,
    userPaused: false,
    autoMerge: true,
    mergeRetries: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as TaskDetail;
}

/*
FNXC:PlanReviewProviderFailureRetry 2026-07-30-09:00:
Regression for a live-observed deadlock: two mission-dispatched tasks (KB-020, KB-021)
both fell back to running Plan Review from the shared repo root because neither had a
worktree yet, and the second genuinely had to wait for the first task's real AI session
to release that shared path. The shared MAX_TRANSIENT_GRAPH_RESUME_RETRIES budget (2
attempts) — tuned for fast engine-internal pause/resume races — exhausted in about 2
seconds, nowhere near enough wall-clock time for a sibling task's session to finish.
Once exhausted, graphResumeRetryCount never resets short of the whole graph completing,
so the task was stuck holding a "queued" status the dashboard's manual Retry route does
not even recognize as retryable, until an operator noticed and restarted the engine.
Plan Review's provider-failure hold now gets its own, larger, dedicated budget.
*/
describe("executor Plan Review provider-failure retry-in-place budget", () => {
  it("keeps retrying past the old shared transient-retry ceiling of 2", async () => {
    resetExecutorMocks();
    const store = createMockStore();
    // 3 prior retries already exceeds the OLD shared MAX_TRANSIENT_GRAPH_RESUME_RETRIES (2) —
    // proves this branch no longer checks against that shared, too-small budget.
    const live = task({ graphResumeRetryCount: 3 });
    store.getTask.mockResolvedValue(live);
    const executor = new TaskExecutor(store, "/tmp/test");

    await (executor as any).handleGraphFailure(live, {
      disposition: "failed",
      outcome: "failure",
      visitedNodeIds: ["plan-review"],
      context: { "node:plan-review:value": "plan-review-provider-failure-hold" },
    });

    expect(store.updateTask).toHaveBeenCalledWith(
      live.id,
      { graphResumeRetryCount: 4 },
      undefined,
    );
    expect(store.logEntry).toHaveBeenCalledWith(
      live.id,
      expect.stringContaining("Plan Review provider failure — retrying in place (4/"),
      undefined,
      undefined,
    );
    expect(store.logEntry).not.toHaveBeenCalledWith(
      live.id,
      expect.stringContaining("budget exhausted"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("still exhausts and holds once the raised Plan Review budget itself is spent", async () => {
    resetExecutorMocks();
    const store = createMockStore();
    // At the new, raised ceiling — must stop retrying and hold in place rather than loop forever.
    const live = task({ graphResumeRetryCount: 6 });
    store.getTask.mockResolvedValue(live);
    const executor = new TaskExecutor(store, "/tmp/test");

    await (executor as any).handleGraphFailure(live, {
      disposition: "failed",
      outcome: "failure",
      visitedNodeIds: ["plan-review"],
      context: { "node:plan-review:value": "plan-review-provider-failure-hold" },
    });

    expect(store.logEntry).toHaveBeenCalledWith(
      live.id,
      "Plan Review provider retry budget exhausted — task remains held in its current state",
      undefined,
      undefined,
    );
    expect(store.updateTask).not.toHaveBeenCalledWith(
      live.id,
      expect.objectContaining({ graphResumeRetryCount: 7 }),
      expect.anything(),
    );
  });
});
