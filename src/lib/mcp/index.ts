import { defineMcp } from "@lovable.dev/mcp-js";
import assessBreakdown from "./tools/assess-breakdown";
import listSymptoms from "./tools/list-symptoms";
import matchTechnicians from "./tools/match-technicians";

export default defineMcp({
  name: "field-fixer-pro",
  title: "Field Fixer Pro",
  version: "0.1.0",
  instructions:
    "TerraByte farm equipment repair tools (demo data only). Use `list_symptoms` for valid symptoms, `assess_breakdown` for an assistive preliminary assessment (never a confirmed diagnosis), and `match_technicians` to rank demo technicians.",
  tools: [listSymptoms, assessBreakdown, matchTechnicians],
});
