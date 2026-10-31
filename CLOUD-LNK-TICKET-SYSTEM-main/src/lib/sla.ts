export interface SlaPolicyConfig {
  urgentHours: number;
  highHours: number;
  normalHours: number;
  lowHours: number;
}

export const DEFAULT_SLA_POLICY: SlaPolicyConfig = {
  urgentHours: 4,
  highHours: 24,
  normalHours: 72,
  lowHours: 120,
};

export type SlaStatus = 'OK' | 'WATCH' | 'BREACHED';

export interface SlaEvaluation {
  status: SlaStatus;
  elapsedHours: number;
  thresholdHours: number;
  percentElapsed: number;
  label: string;
  isBreached: boolean;
  isWatch: boolean;
}

/**
 * Dynamically evaluate SLA target threshold based on task priority,
 * creation timestamp, and departmental SLA policy.
 * Warning threshold triggers when elapsed time reaches 75% of the target.
 */
export function evaluateTaskSla(
  createdAt: string | Date,
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | string,
  isClosedOrCompleted: boolean,
  policy?: Partial<SlaPolicyConfig> | null
): SlaEvaluation | null {
  if (isClosedOrCompleted) return null;

  const upperPriority = (priority || 'NORMAL').toUpperCase();

  const targetHours =
    upperPriority === 'URGENT'
      ? (policy?.urgentHours ?? DEFAULT_SLA_POLICY.urgentHours)
      : upperPriority === 'HIGH'
      ? (policy?.highHours ?? DEFAULT_SLA_POLICY.highHours)
      : upperPriority === 'NORMAL'
      ? (policy?.normalHours ?? DEFAULT_SLA_POLICY.normalHours)
      : (policy?.lowHours ?? DEFAULT_SLA_POLICY.lowHours);

  const createdTime = new Date(createdAt).getTime();
  if (isNaN(createdTime)) return null;

  const now = Date.now();
  const elapsedHours = Math.max(0, (now - createdTime) / (1000 * 60 * 60));
  const percentElapsed = (elapsedHours / targetHours) * 100;

  if (elapsedHours >= targetHours) {
    return {
      status: 'BREACHED',
      elapsedHours,
      thresholdHours: targetHours,
      percentElapsed,
      label: `SLA Breached (${Math.floor(elapsedHours)}h / ${targetHours}h)`,
      isBreached: true,
      isWatch: false,
    };
  }

  if (percentElapsed >= 75) {
    return {
      status: 'WATCH',
      elapsedHours,
      thresholdHours: targetHours,
      percentElapsed,
      label: `SLA Watch (${Math.round(percentElapsed)}%)`,
      isBreached: false,
      isWatch: true,
    };
  }

  return {
    status: 'OK',
    elapsedHours,
    thresholdHours: targetHours,
    percentElapsed,
    label: `SLA OK`,
    isBreached: false,
    isWatch: false,
  };
}
