import { prisma } from '@/lib/db';
import {
  DEFAULT_AI_MODEL,
  DEFAULT_FALLBACK_MODELS,
  getEffectiveFallbackSequence,
  getModelDisplayName,
} from './models';
import { runOpenCode } from './opencode';

export { DEFAULT_FALLBACK_MODELS };

export interface FallbackAttempt {
  model: string;
  modelName: string;
  error?: string;
  reason?: 'RATE_LIMIT' | 'TOKEN_LIMIT' | 'TIMEOUT' | 'TIMEOUT_HANG' | 'UPSTREAM_ERROR' | 'USER_CANCELLED' | 'UNKNOWN';
  durationMs: number;
}

export interface FallbackExecutionResult {
  result: string;
  usedModel: string;
  usedModelName: string;
  isFallback: boolean;
  fallbackChain: string[];
  attempts: FallbackAttempt[];
}

/**
 * Retrieve the active execution sequence: Primary model followed by fallback models.
 */
export async function getModelExecutionSequence(): Promise<{
  primaryModel: string;
  fallbackModels: string[];
  fullSequence: string[];
}> {
  try {
    const [modelSetting, fallbackSetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'GLOBAL_AI_MODEL' } }),
      prisma.systemSetting.findUnique({ where: { key: 'AI_FALLBACK_MODELS' } }),
    ]);

    const primaryModel = modelSetting?.value || DEFAULT_AI_MODEL;

    let configuredFallbacks: string[] = DEFAULT_FALLBACK_MODELS;
    if (fallbackSetting?.value) {
      try {
        const parsed = JSON.parse(fallbackSetting.value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          configuredFallbacks = parsed;
        }
      } catch {
        configuredFallbacks = fallbackSetting.value.split(',').map((s) => s.trim());
      }
    }

    const fallbackModels = getEffectiveFallbackSequence(primaryModel, configuredFallbacks);
    const fullSequence = [primaryModel, ...fallbackModels];

    return {
      primaryModel,
      fallbackModels,
      fullSequence,
    };
  } catch (err) {
    console.warn('[AI Fallback] Failed to read model sequence from database, using defaults.', err);
    return {
      primaryModel: DEFAULT_AI_MODEL,
      fallbackModels: DEFAULT_FALLBACK_MODELS,
      fullSequence: [DEFAULT_AI_MODEL, ...DEFAULT_FALLBACK_MODELS],
    };
  }
}

/**
 * Check if an error triggers automatic model failover.
 * Differentiates internal per-model timeouts (TIMEOUT_HANG) from manual user cancellations (USER_CANCELLED).
 */
export function classifyFailoverTrigger(
  err: any,
  userAbortSignal?: AbortSignal
): {
  isTrigger: boolean;
  isUserCancelled: boolean;
  reason: 'RATE_LIMIT' | 'TOKEN_LIMIT' | 'TIMEOUT' | 'TIMEOUT_HANG' | 'UPSTREAM_ERROR' | 'USER_CANCELLED' | 'UNKNOWN';
  description: string;
} {
  const msg = (err?.message || String(err)).toLowerCase();

  // Check if failure is an internal timeout limit
  const isInternalTimeout =
    msg.includes('model_timeout_exceeded') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('etimedout') ||
    msg.includes('esockettimedout');

  // 1. User Cancellation Check:
  // Only classify as user cancellation if userAbortSignal is explicitly aborted
  // or error specifically matches USER_CANCELLED (and is NOT an internal timeout abort)
  if (
    !isInternalTimeout &&
    (userAbortSignal?.aborted || msg.includes('user_cancelled'))
  ) {
    return {
      isTrigger: false,
      isUserCancelled: true,
      reason: 'USER_CANCELLED',
      description: 'AI report generation cancelled by user',
    };
  }

  // 2. Internal Per-Model Timeouts or subprocess execution hangs (MODEL_TIMEOUT_EXCEEDED / timeout)
  // Classify strictly as TIMEOUT_HANG as per implementation requirements
  if (
    isInternalTimeout ||
    (msg.includes('aborted') && !msg.includes('user_cancelled'))
  ) {
    return {
      isTrigger: true,
      isUserCancelled: false,
      reason: 'TIMEOUT_HANG',
      description: 'Per-model timeout exceeded / subprocess execution hang (MODEL_TIMEOUT_EXCEEDED)',
    };
  }

  // 3. HTTP 429 Rate / Token limit or quota exhaustion
  if (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('ratelimit') ||
    msg.includes('quota exceeded') ||
    msg.includes('too many requests') ||
    msg.includes('resource exhausted')
  ) {
    return {
      isTrigger: true,
      isUserCancelled: false,
      reason: 'RATE_LIMIT',
      description: 'Rate limit / quota exhaustion (HTTP 429)',
    };
  }

  // 4. Token limit or context window exceeded (HTTP 400/413/422)
  if (
    (msg.includes('token') && (msg.includes('limit') || msg.includes('maximum') || msg.includes('exceeded'))) ||
    msg.includes('context length') ||
    msg.includes('context window') ||
    msg.includes('maximum context') ||
    msg.includes('prompt too long') ||
    msg.includes('too large') ||
    msg.includes('413')
  ) {
    return {
      isTrigger: true,
      isUserCancelled: false,
      reason: 'TOKEN_LIMIT',
      description: 'Context window / token length ceiling exceeded',
    };
  }

  // 5. Upstream 5xx Provider Errors / Overloaded
  if (
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('bad gateway') ||
    msg.includes('service unavailable') ||
    msg.includes('gateway timeout') ||
    msg.includes('overloaded') ||
    msg.includes('temporarily unavailable')
  ) {
    return {
      isTrigger: true,
      isUserCancelled: false,
      reason: 'UPSTREAM_ERROR',
      description: 'Upstream model service 5xx error or temporary outage',
    };
  }

  return {
    isTrigger: true,
    isUserCancelled: false,
    reason: 'UNKNOWN',
    description: 'General model execution failure',
  };
}

/**
 * Compress / optimize prompt context when context window limits are reached.
 * Truncates raw descriptions, verbose comments, or large arrays while keeping key metrics.
 */
export function compressPromptContext(prompt: string): string {
  console.log('[AI Fallback] Optimizing & compressing prompt context window...');

  let compressed = prompt;

  // 1. If prompt has embedded JSON telemetry (object or array), compress it
  const jsonMatch = compressed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);

      if (typeof parsed === 'object' && parsed !== null) {
        if (Array.isArray(parsed)) {
          // If array, keep top 10 items and strip long descriptions
          const sliced = parsed.slice(0, 10).map((item: any) => {
            if (typeof item === 'object' && item !== null) {
              const copy = { ...item };
              if (typeof copy.description === 'string' && copy.description.length > 100) {
                copy.description = copy.description.substring(0, 100) + '...';
              }
              if (Array.isArray(copy.comments)) {
                copy.comments = copy.comments.slice(0, 2);
              }
              return copy;
            }
            return item;
          });
          compressed = compressed.replace(jsonMatch[1], JSON.stringify(sliced));
        } else {
          // If criticalEscalations array exists, slice down to top 3 and strip description
          if (Array.isArray(parsed.criticalEscalations)) {
            parsed.criticalEscalations = parsed.criticalEscalations.slice(0, 3).map((item: any) => ({
              key: item.key || item.taskKey,
              title: item.title,
              priority: item.priority,
              slaBreached: item.slaBreached,
            }));
          }

          // If memberActivityBreakdown exists, truncate ticket sample lists
          if (Array.isArray(parsed.memberActivityBreakdown)) {
            parsed.memberActivityBreakdown = parsed.memberActivityBreakdown.map((m: any) => ({
              name: m.name,
              username: m.username,
              totalAssigned: m.totalAssigned,
              resolvedCount: m.resolvedCount,
              inProgressCount: m.inProgressCount,
              urgentHandled: m.urgentHandled,
              ticketsSample: Array.isArray(m.ticketsSample) ? m.ticketsSample.slice(0, 3) : [],
            }));
          }

          // Re-serialize compact JSON
          const compactJson = JSON.stringify(parsed);
          compressed = compressed.replace(jsonMatch[1], compactJson);
        }
      }
    } catch {
      // Fallback text trimming if JSON parsing fails
    }
  }

  // 2. Truncate any long notable incident lines
  compressed = compressed.replace(
    /(- Notable Incidents:\s*)([^\n]+)/g,
    (_, prefix, content) => {
      if (content.length > 250) {
        return prefix + content.substring(0, 240) + '... (truncated for context limit)';
      }
      return prefix + content;
    }
  );

  // 3. Append optimization notice
  if (!compressed.includes('[Context Compressed')) {
    compressed = compressed.trim() + '\n\n[Context Compressed: Ticket telemetry trimmed for compact context window]';
  }

  return compressed;
}

/**
 * Execute OpenCode synthesis with sequential multi-model fallback and rate-limit recovery.
 */
export async function runOpenCodeWithFallback(
  initialPrompt: string,
  options?: {
    signal?: AbortSignal;
    perModelTimeoutMs?: number;
    sequenceOverride?: string[];
    runner?: (prompt: string, model: string, signal?: AbortSignal) => Promise<string>;
  }
): Promise<FallbackExecutionResult> {
  const { fullSequence, primaryModel } = await getModelExecutionSequence();
  const sequence = options?.sequenceOverride && options.sequenceOverride.length > 0
    ? options.sequenceOverride
    : fullSequence;

  const perModelTimeout = options?.perModelTimeoutMs || 50000; // 50 seconds per model attempt
  const executeModel = options?.runner || runOpenCode;
  const userAbortSignal = options?.signal;
  let currentPrompt = initialPrompt;
  const attempts: FallbackAttempt[] = [];
  const fallbackChain: string[] = [];

  for (let i = 0; i < sequence.length; i++) {
    const model = sequence[i];
    const isPrimary = i === 0;
    const modelName = getModelDisplayName(model);
    const startTime = Date.now();

    // 1. Check if user already cancelled prior to this attempt
    if (userAbortSignal?.aborted) {
      console.log(`[AI Failover Loop] 🛑 User cancelled prior to attempt ${i + 1}. Halting loop.`);
      throw new Error('USER_CANCELLED: AI report generation cancelled by user.');
    }

    console.log(
      `[AI Failover Loop] Attempt ${i + 1}/${sequence.length}: Invoking model "${modelName}" (${model})...`
    );

    // 2. For each model attempt, instantiate a fresh, dedicated timeout AbortController
    // This strictly guarantees no aborted signal is ever reused across iterations
    const modelAbortController = new AbortController();

    // 3. Forward client's manual cancellation with explicit reason "USER_CANCELLED"
    const onUserAbort = () => {
      modelAbortController.abort('USER_CANCELLED');
    };

    if (userAbortSignal) {
      userAbortSignal.addEventListener('abort', onUserAbort, { once: true });
    }

    // 4. Per-model timeout aborts strictly with reason "MODEL_TIMEOUT_EXCEEDED"
    const timeoutHandle = setTimeout(() => {
      modelAbortController.abort('MODEL_TIMEOUT_EXCEEDED');
    }, perModelTimeout);

    try {
      const output = await executeModel(currentPrompt, model, modelAbortController.signal);
      clearTimeout(timeoutHandle);
      if (userAbortSignal) userAbortSignal.removeEventListener('abort', onUserAbort);

      const durationMs = Date.now() - startTime;
      attempts.push({
        model,
        modelName,
        durationMs,
      });

      const isFallback = !isPrimary;
      if (isFallback) {
        fallbackChain.push(`Recovered via fallback model: ${modelName} (${model})`);
      }

      console.log(
        `[AI Failover Loop] ✅ Successfully synthesized report with ${modelName} in ${Math.round(durationMs / 1000)}s${
          isFallback ? ' (FALLBACK SUCCESS)' : ''
        }.`
      );

      return {
        result: output,
        usedModel: model,
        usedModelName: modelName,
        isFallback,
        fallbackChain,
        attempts,
      };
    } catch (err: any) {
      clearTimeout(timeoutHandle);
      if (userAbortSignal) userAbortSignal.removeEventListener('abort', onUserAbort);

      const durationMs = Date.now() - startTime;
      const classification = classifyFailoverTrigger(err, userAbortSignal);

      // 5. If user explicitly cancelled, do not fallback; halt immediately
      if (classification.isUserCancelled || userAbortSignal?.aborted) {
        console.log(`[AI Failover Loop] 🛑 User explicitly cancelled execution. Terminating fallback chain.`);
        throw new Error('USER_CANCELLED: AI report generation cancelled by user.');
      }

      // 6. When classified as TIMEOUT_HANG, log:
      // "[AI Failover Loop] ⚠️ Model "[Model Name]" timed out after 50s. Switching to next fallback model..."
      if (classification.reason === 'TIMEOUT_HANG') {
        const timeoutSeconds = Math.round(perModelTimeout / 1000);
        console.warn(
          `[AI Failover Loop] ⚠️ Model "${modelName}" timed out after ${timeoutSeconds}s. Switching to next fallback model...`
        );
      } else {
        console.warn(
          `[AI Failover Loop] ⚠️ Model "${modelName}" (${model}) failed after ${Math.round(durationMs / 1000)}s: ${classification.description} (${err.message || err}).`
        );
      }

      attempts.push({
        model,
        modelName,
        error: err.message || String(err),
        reason: classification.reason,
        durationMs,
      });

      fallbackChain.push(
        classification.reason === 'TIMEOUT_HANG'
          ? `${modelName} timed out (${Math.round(perModelTimeout / 1000)}s)`
          : `${modelName} failed (${classification.description})`
      );

      // Context Window optimization: If token limit error, compress prompt for next attempt
      if (classification.reason === 'TOKEN_LIMIT') {
        currentPrompt = compressPromptContext(currentPrompt);
      }

      // AbortSignal Check: If job was cancelled by user, break immediately without trying fallbacks!
      if (options?.signal?.aborted || (err as any)?.name === 'AbortError') {
        console.warn(`[AI Failover Loop] ⏹️ Job was cancelled or aborted. Breaking fallback chain immediately.`);
        throw new Error('AI generation job was cancelled by user.');
      }

      // If there are more models in sequence, proceed to next fallback
      if (i < sequence.length - 1) {
        const nextModel = sequence[i + 1];
        console.log(
          `[AI Failover Loop] 🔄 Failing over to next fallback model: "${getModelDisplayName(nextModel)}" (${nextModel})...`
        );
        continue;
      }

      // All models exhausted!
      console.error(
        `[AI Failover Loop] ❌ All ${sequence.length} models in fallback sequence exhausted.`
      );
      throw new Error(
        `AI report synthesis failed across all configured models (${sequence.map(getModelDisplayName).join(' -> ')}). Last error: ${err.message || err}`
      );
    }
  }

  throw new Error('No models available for report generation.');
}
