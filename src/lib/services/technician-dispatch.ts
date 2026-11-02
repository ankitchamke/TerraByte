/**
 * TerraByte — Phase 10.3: Location-Aware Technician Dispatch & Recommendation Engine
 * Pure domain scoring calculations and types for matching agricultural machinery
 * repair requests with qualified, available, and proximate technicians.
 */

import type { DistanceSource } from "../location.ts";
import type { ServiceType } from "./doorstep-service.ts";

export interface ComputeTechnicianDispatchScoreInput {
  isCriticalStopped: boolean;
  brandMatch: boolean;
  skillMatch: boolean;
  isAvailable: boolean;
  activeJobCount: number;
  distanceKm: number | null;
  isWithinRadius: boolean;
  serviceType: ServiceType;
  isDoorstepCapable: boolean;
}

export interface TechnicianDispatchScoreBreakdown {
  score: number;
  brandScore: number;
  skillScore: number;
  availabilityScore: number;
  proximityScore: number;
  doorstepScore: number;
}

export interface ScoredTechnicianMatch<T = unknown> {
  technician: T;
  score: number;
  brandMatch: boolean;
  skillMatch: boolean;
  reasons: string[];
  // Phase 10.3 Location-Aware Dispatch Fields
  distanceKm: number | null;
  estimatedDriveMinutes: number | null;
  distanceSource: DistanceSource;
  activeJobCount: number;
  doorstepMatch: boolean;
  isUrgencyWeighted: boolean;
  isWithinRadius: boolean;
  // Phase 10.4-D In-Area Circuit Fields
  hasInAreaCircuit?: boolean;
  inAreaTahsil?: string | null;
  inAreaExplanation?: string | null;
  inAreaStopCount?: number;
}

export interface GetEligibleTechniciansOptions {
  skipOsrm?: boolean | undefined;
  osrmTimeoutMs?: number | undefined;
  fetchFn?: typeof fetch | undefined;
}

/**
 * Pure scoring calculation function for technician dispatch recommendations.
 * Implements the approved Phase 10.3 adaptive scoring matrix:
 *
 * 1. Critical Urgency + Stopped Machine:
 *    - Proximity & ETA: 40 points
 *    - Availability & Workload: 25 points
 *    - Brand Specialization: 15 points
 *    - Skill Match: 10 points
 *    - Mobile Field Service Capability: 10 points
 *
 * 2. Routine Requests (High / Standard / Flexible or Machine Operational):
 *    - Brand Specialization: 30 points
 *    - Skill Match: 25 points
 *    - Proximity & Route: 20 points
 *    - Availability & Workload: 15 points
 *    - Service Delivery Mode Match: 10 points
 *
 * Active Workload Scaling on Availability:
 * - 0 active jobs: 100% of availability points (25 or 15)
 * - 1 active job:  70% of availability points (18 or 11)
 * - 2+ active jobs: 30% of availability points (8 or 5)
 *
 * Doorstep Travel Radius:
 * - If service is DOORSTEP and distance exceeds max_travel_radius_km, proximity score is 0.
 */
export function computeTechnicianDispatchScore(
  input: ComputeTechnicianDispatchScoreInput,
): TechnicianDispatchScoreBreakdown {
  let availabilityScore = 0;
  if (input.isAvailable) {
    const maxAvail = input.isCriticalStopped ? 25 : 15;
    if (input.activeJobCount === 0) {
      availabilityScore = maxAvail; // 100%
    } else if (input.activeJobCount === 1) {
      availabilityScore = Math.round(maxAvail * 0.7); // 70% (18 or 11)
    } else {
      availabilityScore = Math.round(maxAvail * 0.3); // 30% (8 or 5)
    }
  }

  let proximityScore = 0;
  if (input.distanceKm !== null) {
    if (input.serviceType === "DOORSTEP" && !input.isWithinRadius) {
      proximityScore = 0;
    } else if (input.isCriticalStopped) {
      // Critical proximity (max 40)
      if (input.distanceKm <= 10) proximityScore = 40;
      else if (input.distanceKm <= 25) proximityScore = 32;
      else if (input.distanceKm <= 40) proximityScore = 20;
      else proximityScore = 8;
    } else {
      // Routine proximity (max 20)
      if (input.distanceKm <= 15) proximityScore = 20;
      else if (input.distanceKm <= 30) proximityScore = 16;
      else if (input.distanceKm <= 50) proximityScore = 10;
      else proximityScore = 4;
    }
  } else {
    // Neutral fallback when distance is unknown
    proximityScore = input.isCriticalStopped ? 15 : 8;
  }

  let brandScore = 0;
  let skillScore = 0;
  if (input.isCriticalStopped) {
    brandScore = input.brandMatch ? 15 : 0;
    skillScore = input.skillMatch ? 10 : 0;
  } else {
    brandScore = input.brandMatch ? 30 : 0;
    skillScore = input.skillMatch ? 25 : 0;
  }

  let doorstepScore = 0;
  if (input.serviceType === "DOORSTEP") {
    doorstepScore = input.isDoorstepCapable ? 10 : 0;
  } else {
    doorstepScore = 10; // Registered workshop facility
  }

  const rawTotal = availabilityScore + proximityScore + brandScore + skillScore + doorstepScore;
  const score = Math.min(100, Math.max(0, rawTotal));

  return {
    score,
    brandScore,
    skillScore,
    availabilityScore,
    proximityScore,
    doorstepScore,
  };
}
