import type { Equipment, Repair, Technician } from "./tb-store";

export interface Match { tech: Technician; score: number; brandMatch: boolean; skillMatch: boolean; reasons: string[] }

// Priority: 1) brand experience 2) problem expertise 3) availability 4) distance/ETA
export function matchTechnicians(techs: Technician[], eq: Equipment, repair: Repair): Match[] {
  return techs
    .filter((t) => !repair.declinedBy.includes(t.id))
    .map((t) => {
      const brandMatch = t.brands.includes(eq.make);
      const skillMatch = t.skills.includes(repair.assessment.skill);
      const reasons: string[] = [];
      if (brandMatch) reasons.push(`${eq.make} specialist`);
      if (skillMatch) reasons.push(`${repair.assessment.skill} expert`);
      if (t.available) reasons.push("Available now");
      const score = (brandMatch ? 40 : 0) + (skillMatch ? 30 : 0) + (t.available ? 20 : 0);
      return { tech: t, score: Math.round(score), brandMatch, skillMatch, reasons };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.tech.verified !== a.tech.verified) return b.tech.verified ? 1 : -1;
      const bRating = b.tech.rating ?? -1;
      const aRating = a.tech.rating ?? -1;
      if (bRating !== aRating) return bRating - aRating;
      if (b.tech.jobsDone !== a.tech.jobsDone) return b.tech.jobsDone - a.tech.jobsDone;
      return a.tech.name.localeCompare(b.tech.name);
    });
}
