---
"@runfusion/fusion": patch
---

summary: Fix tasks silently never starting when the project has no default workflow.
category: fix
dev: `createTask` only persisted a `task_workflow_selection` row when given an explicit `workflowId`, or when given neither `workflowId` nor `enabledWorkflowSteps`. Mission/slice creates pass `enabledWorkflowSteps` with no `workflowId`, and a freshly registered project has no default workflow, so those tasks were created with no resolvable workflow: the graph never seeded a work item and the card rested in Todo with no error, no audit event, and no dispatch until an operator pressed Promote. Creation now inherits the project default and, failing that, falls back to the built-in default workflow id. Explicit `workflowId: null` ("No workflow") is still honored.
