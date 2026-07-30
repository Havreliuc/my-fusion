// @vitest-environment node

import { describe, expect, it } from "vitest";
import { parseMissionAgentResponse } from "../mission-interview.js";

/*
FNXC:MissionInterview 2026-07-30-19:00:
gemini-2.5-flash was observed returning mission-completion payloads without
the {"type","data"} envelope this prompt instructs, causing mission creation
to fail outright ("AI returned an invalid response structure") even though
the underlying plan was valid. These cases guard the fallback that accepts
the unwrapped shape, and that the fallback stays narrow enough not to accept
genuinely malformed responses.
*/
describe("parseMissionAgentResponse", () => {
  it("accepts a properly-wrapped question response", () => {
    const text = JSON.stringify({
      type: "question",
      data: { id: "q-1", type: "text", question: "What should this mission accomplish?" },
    });

    const result = parseMissionAgentResponse(text);

    expect(result.type).toBe("question");
  });

  it("accepts a properly-wrapped complete response", () => {
    const text = JSON.stringify({
      type: "complete",
      data: { missionTitle: "Greet CLI Demo", missionDescription: "...", milestones: [{ title: "Build", slices: [] }] },
    });

    const result = parseMissionAgentResponse(text);

    expect(result.type).toBe("complete");
    if (result.type === "complete") {
      expect(result.data.missionTitle).toBe("Greet CLI Demo");
      expect(result.data.milestones).toHaveLength(1);
    }
  });

  it("accepts an unwrapped complete payload (gemini-2.5-flash shape) and wraps it", () => {
    const text = JSON.stringify({
      missionTitle: "Minimal Greeting CLI End-to-End Demo",
      missionDescription: "Build a minimal, working greeting CLI end-to-end.",
      milestones: [{ title: "Build", slices: [{ title: "Greeting Function", features: [] }] }],
    });

    const result = parseMissionAgentResponse(text);

    expect(result.type).toBe("complete");
    if (result.type === "complete") {
      expect(result.data.missionTitle).toBe("Minimal Greeting CLI End-to-End Demo");
      expect(result.data.milestones).toHaveLength(1);
    }
  });

  it("still rejects a response with no milestones array and no envelope", () => {
    const text = JSON.stringify({ missionTitle: "Incomplete", missionDescription: "..." });

    expect(() => parseMissionAgentResponse(text)).toThrow("AI returned an invalid response structure");
  });

  it("still rejects non-JSON text", () => {
    expect(() => parseMissionAgentResponse("not json at all")).toThrow();
  });
});
