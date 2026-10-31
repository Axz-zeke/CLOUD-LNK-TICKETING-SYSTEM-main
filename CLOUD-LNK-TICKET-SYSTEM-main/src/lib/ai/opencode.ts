import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { prisma } from '@/lib/db';
import { DEFAULT_AI_MODEL } from './models';

function resolveOpenCodeBinary(): { command: string; isDirectExe: boolean } {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || 'C:\\Users\\MIS\\AppData\\Roaming';
    const directExe = path.join(appData, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
    if (fs.existsSync(directExe)) {
      return { command: directExe, isDirectExe: true };
    }

    const cmdFile = path.join(appData, 'npm', 'opencode.cmd');
    if (fs.existsSync(cmdFile)) {
      return { command: cmdFile, isDirectExe: false };
    }
  }

  return { command: process.platform === 'win32' ? 'opencode.cmd' : 'opencode', isDirectExe: false };
}

export async function getActiveAiModel(): Promise<string> {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'GLOBAL_AI_MODEL' },
    });
    return setting?.value || DEFAULT_AI_MODEL;
  } catch {
    return DEFAULT_AI_MODEL;
  }
}

export async function runOpenCode(
  prompt: string,
  overrideModel?: string,
  signal?: AbortSignal
): Promise<string> {
  const model = overrideModel || (await getActiveAiModel());

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('AI generation cancelled.'));
      return;
    }

    const { command, isDirectExe } = resolveOpenCodeBinary();
    const args = model ? ['run', '-m', model, prompt] : ['run', prompt];

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: (process.env.PATH || '') + ';C:\\Users\\MIS\\AppData\\Roaming\\npm',
    };

    // If OPENCODE_API_KEY is just the placeholder, strip it so OpenCode uses public free tier
    if (
      childEnv.OPENCODE_API_KEY === 'your-api-key-here' ||
      childEnv.OPENCODE_API_KEY === ''
    ) {
      delete childEnv.OPENCODE_API_KEY;
    }

    const child: ChildProcess = spawn(command, args, {
      windowsHide: true,
      shell: !isDirectExe && process.platform === 'win32',
      env: childEnv,
    });

    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | null = null;

    const onAbort = () => {
      if (timer) clearTimeout(timer);
      try {
        child.kill();
      } catch {}
      const reason = signal?.reason;
      if (reason === 'MODEL_TIMEOUT_EXCEEDED' || String(reason).includes('MODEL_TIMEOUT_EXCEEDED')) {
        reject(new Error('MODEL_TIMEOUT_EXCEEDED: Model invocation exceeded timeout limit.'));
      } else if (reason === 'USER_CANCELLED' || String(reason).includes('USER_CANCELLED')) {
        reject(new Error('USER_CANCELLED: AI report generation cancelled by user.'));
      } else if (reason) {
        reject(new Error(String(reason)));
      } else {
        reject(new Error('AI generation cancelled by user.'));
      }
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new Error('AI report generation timed out after 90 seconds.'));
    }, 90000);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (err: Error) => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new Error(`OpenCode CLI execution failed: ${err.message}`));
    });

    child.on('close', (code: number | null) => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);

      // Strip out the OpenCode banner line (e.g., "> build · ...")
      const cleanOutput = stdout
        .split('\n')
        .filter((line) => !line.trim().startsWith('> build'))
        .join('\n')
        .trim();

      const cleanStderr = stderr
        .split('\n')
        .filter((line) => !line.trim().startsWith('> build'))
        .join('\n')
        .trim();

      if (code === 0 && cleanOutput) {
        resolve(cleanOutput);
      } else if (!cleanOutput && cleanStderr) {
        reject(new Error(`OpenCode execution error: ${cleanStderr}`));
      } else if (code !== 0) {
        reject(new Error(`OpenCode exited with code ${code}: ${cleanStderr || cleanOutput || 'Unknown error'}`));
      } else {
        resolve(cleanOutput);
      }
    });

    child.stdin?.end();
  });
}
