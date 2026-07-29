---
"@runfusion/fusion": patch
---

summary: Fix mission tasks never starting because their branch could not be created.
category: fix
dev: `derivePerTaskBranchName` now returns a sibling (`<base>-<segment>`) instead of a child (`<base>/<segment>`). The base is a live branch ref, so a child ref hits git's directory/file conflict and branch creation fails — a mission whose branch group was `main` gave members `main/f-0007`, which could never be created, leaving the task queued in Todo forever.
