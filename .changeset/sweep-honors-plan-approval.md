---
"@runfusion/fusion": patch
---

summary: Fix manual plan approval being bypassed — cards left Planning before you could approve them.
category: fix
dev: `runHoldReleaseSweep` never consulted `isTaskBlockedOnApproval`, so a card parked at `awaiting-approval` by `planApprovalMode: "require-all"` was released out of its hold column a poll later. Because the approve-plan route requires the card to still be in `triage`, clicking Approve Plan then failed with "Task must be in 'triage' column", no approval fingerprint was ever recorded, and Promote (which waives the gate rather than satisfying it) was the only way to move the card.
