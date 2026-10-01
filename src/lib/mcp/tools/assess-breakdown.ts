import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { assess, SYMPTOMS } from "@/lib/assessment";

export default defineTool({
  name: "assess_breakdown",
  title: "Assess equipment breakdown",
  description: "Give an assistive, preliminary (demo, not a diagnosis) assessment of a farm machine problem from symptoms and a description.",
  inputSchema: {
    symptoms: z.array(z.enum(SYMPTOMS)).min(1).max(12).describe("Observed symptoms, from the TerraByte symptom list."),
    description: z.string().max(1000).default("").describe("Farmer's description in plain words."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: ({ symptoms, description }) => {
    const a = assess(symptoms, description);
    const assessment = { system: a.system, possibleIssue: a.possibleIssue, severity: a.severity, advice: a.advice, partsCategory: a.partsCategory, skill: a.skill, confidence: a.confidence };
    return {
      content: [{ type: "text", text: `Preliminary (assistive, demo) — likely system: ${a.system}. Possible issue: ${a.possibleIssue}. Severity: ${a.severity}. Advice: ${a.advice}` }],
      structuredContent: { assessment },
    };
  },
});
