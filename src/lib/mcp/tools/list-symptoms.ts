import { defineTool } from "@lovable.dev/mcp-js";
import { SYMPTOMS } from "@/lib/assessment";

export default defineTool({
  name: "list_symptoms",
  title: "List breakdown symptoms",
  description: "List the symptom options a farmer can choose when reporting a breakdown.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => ({
    content: [{ type: "text", text: SYMPTOMS.join(", ") }],
    structuredContent: { symptoms: [...SYMPTOMS] },
  }),
});
