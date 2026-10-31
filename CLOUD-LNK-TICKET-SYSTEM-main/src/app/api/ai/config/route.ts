import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { DEFAULT_AI_MODEL, DEFAULT_FALLBACK_MODELS } from '@/lib/ai/models';

export async function GET(request: NextRequest) {
  // Hard Short-Circuit: Return static coming soon status in < 1ms
  return NextResponse.json({
    enabled: false,
    status: 'COMING_SOON',
    activeModel: 'DISABLED',
    customGifUrl: null,
    models: [],
    fallbackModels: [],
  });
}

// Retained for future activation once local LLM engine is provisioned
async function _disabled_GET(request: NextRequest) {
  try {
    let token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const authHeader = request.headers.get('authorization');
    if (!token && authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized: Authentication required.' }, { status: 401 });
    }

    const sessionData = await validateSession(token);
    if (!sessionData) {
      return NextResponse.json({ error: 'Unauthorized: Session invalid or expired.' }, { status: 401 });
    }

    const [modelSetting, gifSetting, fallbackSetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'GLOBAL_AI_MODEL' } }),
      prisma.systemSetting.findUnique({ where: { key: 'AI_LOADING_GIF_URL' } }),
      prisma.systemSetting.findUnique({ where: { key: 'AI_FALLBACK_MODELS' } }),
    ]);

    const activeModel = modelSetting?.value || DEFAULT_AI_MODEL;
    let fallbackModels = DEFAULT_FALLBACK_MODELS.filter((id) => id !== activeModel);
    if (fallbackSetting?.value) {
      try {
        const parsed = JSON.parse(fallbackSetting.value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          fallbackModels = parsed.filter((id: string) => id !== activeModel);
        }
      } catch {}
    }

    return NextResponse.json({
      activeModel,
      customGifUrl: gifSetting?.value || null,
      fallbackModels,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch AI configuration.' },
      { status: 500 }
    );
  }
}
