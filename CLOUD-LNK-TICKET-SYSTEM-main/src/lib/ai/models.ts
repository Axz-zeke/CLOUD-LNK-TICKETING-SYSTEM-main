export interface AiModelItem {
  id: string;
  name: string;
  tag: string;
  description: string;
}

export const AVAILABLE_AI_MODELS: AiModelItem[] = [
  {
    id: 'opencode/space-bunny-free',
    name: 'Space Bunny Free',
    tag: 'Default • Free Tier',
    description: 'High-speed, zero-cost conversational and analysis model for operational reports.',
  },
  {
    id: 'opencode/mimo-v2.6-flash-free',
    name: 'Mimo v2.6 Flash Free',
    tag: 'Fast • Free Tier',
    description: 'Ultra-low latency model for rapid summaries and ticket triage.',
  },
  {
    id: 'opencode/nemotron-3.5-lightning-free',
    name: 'Nemotron 3.5 Lightning Free',
    tag: 'Lightning • Free Tier',
    description: 'High-throughput agentic inference model for real-time telemetry processing.',
  },
  {
    id: 'opencode/big-pickle',
    name: 'Big Pickle',
    tag: 'Stable • Verified',
    description: 'Verified stable cloud inference model for general ticketing telemetry.',
  },
];

export const DEFAULT_AI_MODEL = 'opencode/space-bunny-free';

export const DEFAULT_FALLBACK_MODELS: string[] = [
  'opencode/mimo-v2.6-flash-free',
  'opencode/nemotron-3.5-lightning-free',
  'opencode/big-pickle',
];

export function getModelDisplayName(modelId: string): string {
  const found = AVAILABLE_AI_MODELS.find((m) => m.id === modelId);
  return found ? found.name : modelId;
}

export function getEffectiveFallbackSequence(
  primaryModel: string,
  configuredFallbacks?: string[]
): string[] {
  const candidateList =
    configuredFallbacks && configuredFallbacks.length > 0
      ? configuredFallbacks
      : DEFAULT_FALLBACK_MODELS;

  // Filter out primary model to avoid redundant immediate re-invocation
  const filtered = candidateList.filter(
    (id) => id !== primaryModel && AVAILABLE_AI_MODELS.some((m) => m.id === id)
  );

  // If filtered is empty or only had primary, pick other available models
  if (filtered.length === 0) {
    return AVAILABLE_AI_MODELS.filter((m) => m.id !== primaryModel).map((m) => m.id);
  }

  return filtered;
}
