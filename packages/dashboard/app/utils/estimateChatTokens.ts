export interface ChatTokenEstimateMessage {
  content?: string | null;
}

/*
FNXC:ChatContextWindow 2026-06-27-00:00:
Direct chat does not persist provider token usage on ChatMessageInfo, so the header budget gauge must remain an explicit client-side estimate. Use the conservative four-characters-per-token heuristic and include live streaming text so long responses update without backend changes.
*/
export function estimateChatTokens(messages: ChatTokenEstimateMessage[], streamingText?: string | null): number {
  const totalChars = messages.reduce((sum, message) => sum + (message.content?.length ?? 0), 0) + (streamingText?.length ?? 0);
  return Math.ceil(totalChars / 4);
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) {
    return "0";
  }

  if (n < 1000) {
    return String(Math.round(n));
  }

  const thousands = n / 1000;
  if (thousands < 10) {
    return `~${Number(thousands.toFixed(1))}k`;
  }

  return `${Math.round(thousands)}k`;
}
