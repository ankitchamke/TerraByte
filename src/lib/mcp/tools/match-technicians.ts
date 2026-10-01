import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { assess, SYMPTOMS } from "@/lib/assessment";
import { demoTechnicians } from "@/lib/tb-store";

export default defineTool({
  name: "match_technicians",
  title: "Match technicians",
  description: "Rank the demo technicians for a machine brand and problem (brand experience, problem expertise, availability, then distance).",
  inputSchema: {
    make: z.string().trim().min(1).max(40).describe("Machine manufacturer, e.g. Mahindra, John Deere, Kubota."),
    symptoms: z.array(z.enum(SYMPTOMS)).min(1).max(12).describe("Observed symptoms."),
    description: z.string().max(1000).default(""),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: ({ make, symptoms, description }) => {
    const skill = assess(symptoms, description).skill;
    const ranked = demoTechnicians()
      .map((t) => {
        const brandMatch = t.brands.some((b) => b.toLowerCase() === make.toLowerCase());
        const skillMatch = t.skills.includes(skill);
        const score = Math.round((brandMatch ? 40 : 0) + (skillMatch ? 30 : 0) + (t.available ? 20 : 0) + Math.max(0, 10 - t.etaMin / 10));
        return { name: t.name, workshop: t.workshop, verified: t.verified, available: t.available, distanceKm: t.distanceKm, etaMin: t.etaMin, rating: t.rating, brands: [...t.brands], skills: [...t.skills], brandMatch, skillMatch, score };
      })
      .sort((a, b) => b.score - a.score);
    return {
      content: [{ type: "text", text: `Needed expertise: ${skill}. Demo ranking:\n` + ranked.map((r, i) => `${i + 1}. ${r.name} (${r.workshop}) — score ${r.score}, ${r.distanceKm} km, ${r.available ? "available" : "busy"}`).join("\n") }],
      structuredContent: { skill, technicians: ranked },
    };
  },
});
