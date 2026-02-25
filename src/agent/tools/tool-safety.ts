import {
  assessCommandRisk as assessCommandRiskV2,
  assessPathRisk as assessPathRiskV2,
  isWithinSessionRoot,
  resolveSessionPath,
  type ActionRiskAssessment
} from "#agent/tools/action-risk-policy";

export interface ToolRisk {
  destructive: boolean;
  outOfZone: boolean;
  requiresConfirmation: boolean;
}

export function resolveToolPath(path: string, workingZone: string): string {
  return resolveSessionPath(path, workingZone);
}

export function isWithinWorkingZone(path: string, workingZone: string): boolean {
  return isWithinSessionRoot(path, workingZone);
}

export function assessCommandRisk(command: string, cwd: string, workingZone: string): ToolRisk {
  const risk = assessCommandRiskV2(command, cwd, workingZone);
  return toLegacyRisk(risk);
}

export function assessPathRisk(path: string, workingZone: string): ToolRisk {
  const risk = assessPathRiskV2(path, workingZone);
  return toLegacyRisk(risk);
}

function toLegacyRisk(risk: ActionRiskAssessment): ToolRisk {
  return {
    destructive: risk.destructive,
    outOfZone: risk.outOfZone,
    requiresConfirmation: risk.requiresConfirmation || risk.riskLevel === "deny"
  };
}
