---
"@runfusion/fusion": patch
---

summary: Fix plan approval leaving tasks stuck at awaiting-approval so approved plans never dispatched.
category: fix
dev: The approve-plan and reject-plan routes passed `status: undefined` to `updateTask`, which treats undefined as "field not provided" (null is the clear sentinel, task-update.ts). Approved tasks kept `awaiting-approval` in Todo and the scheduler refused to dispatch them; require-all plan approval could never release a card.
