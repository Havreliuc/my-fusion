---
"@runfusion/fusion": patch
---

summary: Fix cards parking in Todo forever when Plan Review is disabled or the plan was approved manually.
category: fix
dev: The pre-release Plan Review hold in `isUnplannedForExecution` could only be satisfied by a passed plan-review step result or a durable capacity continuation. A task with the plan-review group disabled (mission/slice creates) can never record that result, and a project using require-all plan approval parks the card before Plan Review runs, so neither path was reachable and the card was releasable only by an operator Promote. Both are now treated as satisfying the gate; an enabled-and-unapproved card still waits.
