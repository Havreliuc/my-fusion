import { beforeAll, beforeEach, afterEach, afterAll, expect, it } from "vitest";
import {
  pgDescribe,
  createSharedPgTaskStoreTestHarness,
} from "../__test-utils__/pg-test-harness.js";

/*
FNXC:WorkflowCreation 2026-07-29-15:20:
Regression for "mission tasks never dispatch and sit in Todo until an operator presses Promote".

Root cause: `createTask` persisted a `task_workflow_selection` row only when the caller passed
an explicit `workflowId`, or when it passed NEITHER `workflowId` NOR `enabledWorkflowSteps`. The
mission/slice task-creation path passes `enabledWorkflowSteps` (as `[]`) with no `workflowId`, so
it fell between both branches and the task was created with no workflow selection at all. With no
selection the workflow graph never seeded a work item, so the card had no error, no audit event,
and no dispatch — it simply rested in Todo forever.

Surface enumeration (invariant: EVERY successful create yields a resolvable workflow selection):
 - no workflowId, no enabledWorkflowSteps (the already-working inherit path);
 - no workflowId + empty enabledWorkflowSteps (the mission/slice shape that regressed);
 - no workflowId + non-empty enabledWorkflowSteps (same branch, explicit overrides preserved);
 - an explicit workflowId still wins over the project default.
Both the async/backend and legacy create paths share this block, so one assertion set covers the
surface the store actually exposes.
*/
pgDescribe("createTask always records a resolvable workflow selection", () => {
  const harness = createSharedPgTaskStoreTestHarness({ prefix: "fusion_create_wf_selection" });
  beforeAll(harness.beforeAll);
  beforeEach(harness.beforeEach);
  afterEach(harness.afterEach);
  afterAll(harness.afterAll);

  it("inherits the project default when no workflow is specified", async () => {
    const store = harness.store();
    const task = await store.createTask({ description: "plain create" });
    const selection = await store.getTaskWorkflowSelectionAsync(task.id);
    expect(selection?.workflowId).toBeTruthy();
  });

  it("inherits the project default when only an empty enabledWorkflowSteps is given", async () => {
    // The mission/slice creation shape: step overrides, no workflow id.
    const store = harness.store();
    const task = await store.createTask({ description: "mission-shaped create", enabledWorkflowSteps: [] });
    const selection = await store.getTaskWorkflowSelectionAsync(task.id);
    expect(selection?.workflowId).toBeTruthy();
    expect(selection?.stepIds).toEqual([]);
  });

  it("inherits the project default when non-empty enabledWorkflowSteps are given", async () => {
    const store = harness.store();
    const seeded = await store.createTask({ description: "seed to read real step ids" });
    const seededSteps = (await store.getTaskWorkflowSelectionAsync(seeded.id))?.stepIds ?? [];

    const task = await store.createTask({
      description: "explicit steps, no workflow id",
      enabledWorkflowSteps: seededSteps.slice(0, 1),
    });
    const selection = await store.getTaskWorkflowSelectionAsync(task.id);
    expect(selection?.workflowId).toBeTruthy();
  });

  it("keeps an explicit workflowId in charge", async () => {
    const store = harness.store();
    const task = await store.createTask({ description: "explicit workflow", workflowId: "builtin:quick-fix" });
    const selection = await store.getTaskWorkflowSelectionAsync(task.id);
    expect(selection?.workflowId).toBe("builtin:quick-fix");
  });
});
