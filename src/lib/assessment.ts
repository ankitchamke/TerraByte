// Assistive, deterministic DEMO assessment engine.
// Replace `assess` with a call to a real AI service later; keep the same return shape.

export const SYMPTOMS = [
  "Engine won't start", "Engine stalls", "Overheating", "White smoke", "Black smoke",
  "Loss of power", "Hydraulic lift failure", "Strange grinding sound", "Steering failure",
  "Brake failure", "Electrical/battery issue", "Other",
] as const;

export interface Assessment {
  system: string; possibleIssue: string; severity: "Low" | "Moderate" | "Moderate to High" | "High";
  advice: string; partsCategory: string[]; skill: string; confidence: number; maintenanceAdvice: string; source: "demo-rules";
}

interface Rule { match: string[]; kw?: string[]; a: Omit<Assessment, "confidence" | "source"> }
const RULES: Rule[] = [
  { match: ["Black smoke", "Loss of power"], kw: ["smoke", "sputter", "power"], a: { system: "Fuel injection / filtration", possibleIssue: "Fuel injector clog or air filter blockage", severity: "Moderate to High", advice: "Avoid operating the machine under heavy load until inspected.", partsCategory: ["Fuel filter", "Injector / nozzle components", "Air filter element"], skill: "Fuel system", maintenanceAdvice: "Replace fuel & air filters every 250 hrs; use filtered diesel." } },
  { match: ["White smoke", "Overheating"], kw: ["coolant", "hot", "steam"], a: { system: "Cooling system / head gasket", possibleIssue: "Coolant leak, radiator blockage or head gasket wear", severity: "High", advice: "Stop the engine and let it cool. Do not open the radiator cap while hot.", partsCategory: ["Radiator / hoses", "Thermostat", "Head gasket"], skill: "Cooling system", maintenanceAdvice: "Clean radiator fins weekly in harvest season; check coolant daily." } },
  { match: ["Hydraulic lift failure"], kw: ["hydraulic", "lift", "arm", "dropping"], a: { system: "Hydraulics", possibleIssue: "Worn lift cylinder seals or low hydraulic oil / pump pressure", severity: "Moderate", advice: "Do not carry raised implements; lower them fully before moving.", partsCategory: ["Seal kit", "Hydraulic oil", "Control valve parts"], skill: "Hydraulics", maintenanceAdvice: "Check hydraulic oil level every 50 hrs; change every 750 hrs." } },
  { match: ["Engine won't start", "Electrical/battery issue"], kw: ["battery", "click", "crank", "starter"], a: { system: "Electrical / starting circuit", possibleIssue: "Weak battery, corroded terminals or starter motor fault", severity: "Moderate", advice: "Check terminals are tight; avoid repeated cranking to protect the starter.", partsCategory: ["Battery", "Starter solenoid", "Cables & terminals"], skill: "Electrical", maintenanceAdvice: "Clean battery terminals monthly; check charging voltage every season." } },
  { match: ["Engine stalls"], kw: ["stall", "dies"], a: { system: "Fuel supply", possibleIssue: "Air in fuel line or clogged fuel filter", severity: "Moderate", advice: "Avoid long runs until fuel line is bled and filter checked.", partsCategory: ["Fuel filter", "Fuel lines"], skill: "Fuel system", maintenanceAdvice: "Keep tank above 1/4 to avoid sediment pickup." } },
  { match: ["Strange grinding sound"], kw: ["grind", "gear", "noise"], a: { system: "Transmission / clutch", possibleIssue: "Clutch release bearing or gear wear", severity: "Moderate to High", advice: "Avoid shifting under load; stop if noise increases.", partsCategory: ["Clutch bearing", "Gear oil", "Clutch plate"], skill: "Transmission", maintenanceAdvice: "Adjust clutch free play every 250 hrs." } },
  { match: ["Steering failure", "Brake failure"], kw: ["steer", "brake"], a: { system: "Steering & brakes", possibleIssue: "Brake lining wear, fluid leak or steering linkage fault", severity: "High", advice: "Do NOT drive the machine on roads until inspected. Safety risk.", partsCategory: ["Brake linings", "Steering linkage", "Brake fluid"], skill: "Steering & brakes", maintenanceAdvice: "Inspect brakes and steering before every season." } },
];

export function assess(symptoms: string[], description: string): Assessment {
  const d = description.toLowerCase();
  let best = RULES[0]!, score = -1;
  for (const r of RULES) {
    const s = r.match.filter((m) => symptoms.includes(m)).length * 3 + (r.kw ?? []).filter((k) => d.includes(k)).length;
    if (s > score) { score = s; best = r; }
  }
  if (score <= 0) {
    return { system: "General engine / mechanical", possibleIssue: "Needs on-site inspection to narrow down", severity: "Moderate", advice: "Avoid heavy use until a technician inspects the machine.", partsCategory: ["To be determined on inspection"], skill: "Engine", confidence: 0.35, maintenanceAdvice: "Follow the manufacturer's service schedule.", source: "demo-rules" };
  }
  return { ...best.a, confidence: Math.min(0.85, 0.4 + score * 0.08), source: "demo-rules" };
}
