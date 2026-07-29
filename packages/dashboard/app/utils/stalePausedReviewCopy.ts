import type { StalePausedReviewCode, StalePausedReviewSignal, Task } from "@fusion/core";

export interface StalePausedReviewCopy {
  badgeLabel: string;
  headline: string;
  description: string;
  suggestedAction: string;
  code: StalePausedReviewCode;
}

const BADGE_LABEL = "Paused stall";

export function getStalePausedReviewCopy(signal: StalePausedReviewSignal): StalePausedReviewCopy {
  return {
    badgeLabel: BADGE_LABEL,
    code: signal.code,
    headline: "Paused in review beyond threshold",
    description: "This task has remained paused in in-review beyond the configured stale paused review threshold.",
    suggestedAction: "Disposition options: unpause, retry, archive, or create follow-up task.",
  };
}

export function shouldShowStalePausedReviewBadge(
  task: Pick<Task, "column" | "paused" | "stalePausedReview">,
): boolean {
  return task.column === "in-review" && task.paused === true && task.stalePausedReview != null;
}
