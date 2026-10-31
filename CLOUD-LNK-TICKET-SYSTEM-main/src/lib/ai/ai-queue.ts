/**
 * AI Report Generation Concurrency Lock & Serialized Job Queue Manager
 * 
 * Enforces single-concurrency execution for air-gapped / local inference engines (OpenCode).
 * Prevents system overload by queueing subsequent requests and auto-dispatching jobs
 * as soon as preceding jobs complete or fail.
 */

export type AiJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface QueuedAiJob {
  id: string;
  departmentName: string;
  userId?: string;
  userName?: string;
  queuedAt: number;
  startedAt?: number;
  completedAt?: number;
  status: AiJobStatus;
  execute: (signal?: AbortSignal) => Promise<any>;
  abortController?: AbortController;
  result?: any;
  error?: string;
}

export interface AcquireResult {
  acquired: boolean;
  jobId: string;
  queuePosition?: number;
  totalInQueue?: number;
  activeDepartment?: string;
  activeElapsedSeconds?: number;
}

export interface JobStatusResponse {
  jobId: string;
  status: AiJobStatus | 'NOT_FOUND';
  queuePosition?: number;
  totalInQueue?: number;
  activeDepartment?: string;
  activeElapsedSeconds?: number;
  result?: any;
  error?: string;
}

const MAX_EXECUTION_TIMEOUT_MS = 300000; // 5 minutes safety limit (allows multi-model fallback chain)
const FINISHED_JOB_TTL_MS = 600000; // Keep finished jobs in memory for 10 minutes

export class AiQueueManager {
  private activeJob: QueuedAiJob | null = null;
  private waitingQueue: QueuedAiJob[] = [];
  private finishedJobs = new Map<string, {
    id: string;
    departmentName: string;
    userId?: string;
    userName?: string;
    status: AiJobStatus;
    result?: any;
    error?: string;
    completedAt: number;
  }>();
  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Periodic cleanup of finished jobs older than TTL
    const cleanupInterval = setInterval(() => {
      this.cleanupOldJobs();
    }, 60000);
    if (typeof cleanupInterval.unref === 'function') {
      cleanupInterval.unref();
    }
  }

  /**
   * Acquire execution lock or enqueue the incoming job if engine is currently busy.
   */
  public acquireOrEnqueue(options: {
    id?: string;
    departmentName?: string;
    userId?: string;
    userName?: string;
    execute: (signal?: AbortSignal) => Promise<any>;
  }): AcquireResult {
    // Check if active job has frozen or exceeded the 3-minute threshold
    this.checkAndRecoverStuckJob();

    const jobId = options.id || `ai_job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const departmentName = options.departmentName || 'General Workspace';

    // 1. If engine is free, lock engine immediately and mark as RUNNING
    if (!this.activeJob) {
      const abortController = new AbortController();
      const job: QueuedAiJob = {
        id: jobId,
        departmentName,
        userId: options.userId,
        userName: options.userName,
        queuedAt: Date.now(),
        startedAt: Date.now(),
        status: 'RUNNING',
        execute: options.execute,
        abortController,
      };

      this.activeJob = job;
      this.setupWatchdogTimer(job.id);

      console.log(`[AiQueueManager] Concurrency lock acquired for job ${job.id} (${departmentName}).`);

      return {
        acquired: true,
        jobId: job.id,
      };
    }

    // 2. Engine is busy: Enqueue the request
    const abortController = new AbortController();
    const queuedJob: QueuedAiJob = {
      id: jobId,
      departmentName,
      userId: options.userId,
      userName: options.userName,
      queuedAt: Date.now(),
      status: 'QUEUED',
      execute: options.execute,
      abortController,
    };

    this.waitingQueue.push(queuedJob);
    const queuePosition = this.waitingQueue.length;
    const activeElapsed = this.activeJob.startedAt
      ? Math.floor((Date.now() - this.activeJob.startedAt) / 1000)
      : 0;

    console.log(
      `[AiQueueManager] Engine busy (active: ${this.activeJob.departmentName}). Enqueued job ${jobId} at position #${queuePosition}.`
    );

    return {
      acquired: false,
      jobId,
      queuePosition,
      totalInQueue: this.waitingQueue.length,
      activeDepartment: this.activeJob.departmentName,
      activeElapsedSeconds: activeElapsed,
    };
  }

  /**
   * Check status of a job (queued, running, completed, failed, or cancelled).
   */
  public getJobStatus(jobId: string): JobStatusResponse {
    // 1. Check if currently active
    if (this.activeJob && this.activeJob.id === jobId) {
      const elapsed = this.activeJob.startedAt
        ? Math.floor((Date.now() - this.activeJob.startedAt) / 1000)
        : 0;
      return {
        jobId,
        status: 'RUNNING',
        activeDepartment: this.activeJob.departmentName,
        activeElapsedSeconds: elapsed,
      };
    }

    // 2. Check if waiting in queue
    const queueIndex = this.waitingQueue.findIndex((j) => j.id === jobId);
    if (queueIndex !== -1) {
      const activeElapsed = this.activeJob?.startedAt
        ? Math.floor((Date.now() - this.activeJob.startedAt) / 1000)
        : 0;
      return {
        jobId,
        status: 'QUEUED',
        queuePosition: queueIndex + 1,
        totalInQueue: this.waitingQueue.length,
        activeDepartment: this.activeJob?.departmentName || 'Another department',
        activeElapsedSeconds: activeElapsed,
      };
    }

    // 3. Check finished jobs history
    const finished = this.finishedJobs.get(jobId);
    if (finished) {
      return {
        jobId,
        status: finished.status,
        result: finished.result,
        error: finished.error,
        activeDepartment: finished.departmentName,
      };
    }

    // 4. Job not found
    return {
      jobId,
      status: 'NOT_FOUND',
      error: 'Job ID was not found or has expired.',
    };
  }

  /**
   * Cancel a job (whether queued or currently running).
   * Immediately frees the queue or active lock.
   */
  public cancelJob(jobId: string): { cancelled: boolean; wasQueued: boolean; wasRunning: boolean } {
    // 1. Cancel in waiting queue
    const queueIndex = this.waitingQueue.findIndex((j) => j.id === jobId);
    if (queueIndex !== -1) {
      const [removed] = this.waitingQueue.splice(queueIndex, 1);
      removed.status = 'CANCELLED';
      removed.abortController?.abort();
      this.finishedJobs.set(jobId, {
        id: jobId,
        departmentName: removed.departmentName,
        userId: removed.userId,
        userName: removed.userName,
        status: 'CANCELLED',
        completedAt: Date.now(),
      });

      console.log(`[AiQueueManager] Cancelled waiting job ${jobId}. Removed from queue.`);
      return { cancelled: true, wasQueued: true, wasRunning: false };
    }

    // 2. Cancel active running job
    if (this.activeJob && this.activeJob.id === jobId) {
      const running = this.activeJob;
      running.status = 'CANCELLED';
      running.abortController?.abort();

      this.finishedJobs.set(jobId, {
        id: jobId,
        departmentName: running.departmentName,
        userId: running.userId,
        userName: running.userName,
        status: 'CANCELLED',
        completedAt: Date.now(),
      });

      console.log(`[AiQueueManager] Cancelled active job ${jobId}. Aborting and dispatching next in queue.`);
      this.clearWatchdogTimer();
      this.activeJob = null;
      this.dispatchNext();
      return { cancelled: true, wasQueued: false, wasRunning: true };
    }

    return { cancelled: false, wasQueued: false, wasRunning: false };
  }

  /**
   * Get the owner userId associated with a job ID for authorization verification.
   */
  public getJobOwner(jobId: string): string | undefined {
    if (this.activeJob && this.activeJob.id === jobId) {
      return this.activeJob.userId;
    }
    const queued = this.waitingQueue.find((j) => j.id === jobId);
    if (queued) {
      return queued.userId;
    }
    const finished = this.finishedJobs.get(jobId);
    if (finished) {
      return finished.userId;
    }
    return undefined;
  }

  /**
   * Mark active job as successfully completed with its report result.
   */
  public completeJob(jobId: string, result: any) {
    if (this.activeJob && this.activeJob.id === jobId) {
      const completed = this.activeJob;
      completed.status = 'COMPLETED';
      completed.completedAt = Date.now();
      completed.result = result;

      this.finishedJobs.set(jobId, {
        id: jobId,
        departmentName: completed.departmentName,
        userId: completed.userId,
        userName: completed.userName,
        status: 'COMPLETED',
        result,
        completedAt: Date.now(),
      });

      console.log(`[AiQueueManager] Completed job ${jobId} (${completed.departmentName}).`);
      this.clearWatchdogTimer();
      this.activeJob = null;
      this.dispatchNext();
    }
  }

  /**
   * Mark active job as failed.
   */
  public failJob(jobId: string, error: string) {
    if (this.activeJob && this.activeJob.id === jobId) {
      const failed = this.activeJob;
      failed.status = 'FAILED';
      failed.completedAt = Date.now();
      failed.error = error;

      this.finishedJobs.set(jobId, {
        id: jobId,
        departmentName: failed.departmentName,
        userId: failed.userId,
        userName: failed.userName,
        status: 'FAILED',
        error,
        completedAt: Date.now(),
      });

      console.warn(`[AiQueueManager] Job ${jobId} failed: ${error}`);
      this.clearWatchdogTimer();
      this.activeJob = null;
      this.dispatchNext();
    }
  }

  /**
   * Automatically dispatch the next pending job in the waiting queue.
   */
  private dispatchNext() {
    if (this.activeJob !== null) {
      return;
    }

    while (this.waitingQueue.length > 0) {
      const nextJob = this.waitingQueue.shift()!;

      // Skip jobs that were cancelled while waiting
      if (nextJob.status === 'CANCELLED') {
        continue;
      }

      nextJob.status = 'RUNNING';
      nextJob.startedAt = Date.now();
      this.activeJob = nextJob;
      this.setupWatchdogTimer(nextJob.id);

      console.log(`[AiQueueManager] Auto-dispatching queued job ${nextJob.id} (${nextJob.departmentName}).`);

      // Asynchronously trigger execution
      (async () => {
        try {
          const result = await nextJob.execute(nextJob.abortController?.signal);
          if (this.activeJob && this.activeJob.id === nextJob.id) {
            this.completeJob(nextJob.id, result);
          }
        } catch (err: any) {
          if (this.activeJob && this.activeJob.id === nextJob.id) {
            const isAborted = nextJob.abortController?.signal.aborted;
            if (isAborted) {
              console.log(`[AiQueueManager] Job ${nextJob.id} aborted cleanly.`);
            } else {
              this.failJob(nextJob.id, err.message || 'AI generation failed during execution.');
            }
          }
        }
      })();

      break;
    }
  }

  /**
   * Watchdog timer to prevent permanent locks if an inference execution freezes.
   */
  private setupWatchdogTimer(jobId: string) {
    this.clearWatchdogTimer();
    this.watchdogTimer = setTimeout(() => {
      if (this.activeJob && this.activeJob.id === jobId) {
        console.error(
          `[AiQueueManager] SAFETY TIMEOUT: Job ${jobId} exceeded 5 minutes limit. Forcing lock release.`
        );
        this.activeJob.abortController?.abort();
        this.failJob(jobId, 'AI report generation exceeded 5-minute safety timeout limit.');
      }
    }, MAX_EXECUTION_TIMEOUT_MS);
  }

  private clearWatchdogTimer() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /**
   * Verify and recover from stuck jobs if active job has exceeded 3 minutes.
   */
  private checkAndRecoverStuckJob() {
    if (this.activeJob && this.activeJob.startedAt) {
      const elapsed = Date.now() - this.activeJob.startedAt;
      if (elapsed > MAX_EXECUTION_TIMEOUT_MS) {
        console.warn(
          `[AiQueueManager] Active job ${this.activeJob.id} expired (${Math.round(elapsed / 1000)}s). Forcing recovery.`
        );
        this.activeJob.abortController?.abort();
        this.failJob(this.activeJob.id, 'AI report generation exceeded 3-minute safety limit.');
      }
    }
  }

  /**
   * Cleanup finished jobs older than TTL.
   */
  private cleanupOldJobs() {
    const now = Date.now();
    for (const [id, job] of this.finishedJobs.entries()) {
      if (now - job.completedAt > FINISHED_JOB_TTL_MS) {
        this.finishedJobs.delete(id);
      }
    }
  }

  /**
   * Diagnostic / test helpers
   */
  public getSnapshot() {
    return {
      activeJob: this.activeJob
        ? {
            id: this.activeJob.id,
            departmentName: this.activeJob.departmentName,
            status: this.activeJob.status,
            startedAt: this.activeJob.startedAt,
          }
        : null,
      queueLength: this.waitingQueue.length,
      waitingJobs: this.waitingQueue.map((j, idx) => ({
        id: j.id,
        departmentName: j.departmentName,
        position: idx + 1,
      })),
    };
  }

  public resetForTesting() {
    this.clearWatchdogTimer();
    this.activeJob?.abortController?.abort();
    this.activeJob = null;
    this.waitingQueue = [];
    this.finishedJobs.clear();
  }
}

// Global declaration for singleton pattern in Node/Next.js
declare global {
  // eslint-disable-next-line no-var
  var __aiQueueManager: AiQueueManager | undefined;
}

export const aiQueueManager = global.__aiQueueManager || new AiQueueManager();

if (process.env.NODE_ENV !== 'production') {
  global.__aiQueueManager = aiQueueManager;
}
