import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { AVAILABLE_AI_MODELS, DEFAULT_AI_MODEL, DEFAULT_FALLBACK_MODELS } from '@/lib/ai/models';

async function getAuthenticatedSuperadmin(request: NextRequest) {
  let token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authHeader = request.headers.get('authorization');
  if (!token && authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  if (!token) {
    return { error: 'Unauthorized: Authentication required.', status: 401 };
  }

  const sessionData = await validateSession(token);
  if (!sessionData) {
    return { error: 'Unauthorized: Session is expired or invalid.', status: 401 };
  }

  if (sessionData.user.globalRole !== 'SUPERADMIN') {
    return {
      error: 'Forbidden: Superadmin clearance required to configure AI system settings.',
      status: 403,
    };
  }

  return { user: sessionData.user };
}

// GET /api/admin/settings/ai
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedSuperadmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const [modelSetting, gifSetting, fallbackSetting] = await Promise.all([
      prisma.systemSetting.findUnique({
        where: { key: 'GLOBAL_AI_MODEL' },
      }),
      prisma.systemSetting.findUnique({
        where: { key: 'AI_LOADING_GIF_URL' },
      }),
      prisma.systemSetting.findUnique({
        where: { key: 'AI_FALLBACK_MODELS' },
      }),
    ]);

    const currentModel = modelSetting?.value || DEFAULT_AI_MODEL;
    const customGifUrl = gifSetting?.value || null;

    let fallbackModels = DEFAULT_FALLBACK_MODELS.filter((id) => id !== currentModel);
    if (fallbackSetting?.value) {
      try {
        const parsed = JSON.parse(fallbackSetting.value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          fallbackModels = parsed.filter((id: string) => id !== currentModel);
        }
      } catch {}
    }

    return NextResponse.json({
      currentModel,
      availableModels: AVAILABLE_AI_MODELS,
      fallbackModels,
      customGifUrl,
    });
  } catch (error: any) {
    console.error('[API /api/admin/settings/ai GET Error]:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to retrieve AI system settings.' },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/settings/ai
export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthenticatedSuperadmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let body: { modelId?: string; customGifUrl?: string | null; fallbackModels?: string[] } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Bad Request: Invalid JSON body.' },
        { status: 400 }
      );
    }

    const { modelId, customGifUrl, fallbackModels } = body;

    if (modelId === undefined && customGifUrl === undefined && fallbackModels === undefined) {
      return NextResponse.json(
        { error: 'Bad Request: At least one of modelId, customGifUrl, or fallbackModels must be provided.' },
        { status: 400 }
      );
    }

    let resolvedModel: string | undefined = undefined;

    // 1. Handle Model Selection Update
    if (modelId !== undefined) {
      if (!modelId || typeof modelId !== 'string') {
        return NextResponse.json(
          { error: 'Bad Request: modelId must be a valid string identifier.' },
          { status: 400 }
        );
      }

      const isValidModel = AVAILABLE_AI_MODELS.some((m) => m.id === modelId);
      if (!isValidModel) {
        return NextResponse.json(
          {
            error: `Bad Request: '${modelId}' is not an authorized AI model identifier.`,
            allowedModels: AVAILABLE_AI_MODELS.map((m) => m.id),
          },
          { status: 400 }
        );
      }

      await prisma.systemSetting.upsert({
        where: { key: 'GLOBAL_AI_MODEL' },
        update: {
          value: modelId,
          updatedBy: auth.user.username || auth.user.id,
        },
        create: {
          key: 'GLOBAL_AI_MODEL',
          value: modelId,
          updatedBy: auth.user.username || auth.user.id,
        },
      });

      resolvedModel = modelId;
    } else {
      const current = await prisma.systemSetting.findUnique({
        where: { key: 'GLOBAL_AI_MODEL' },
      });
      resolvedModel = current?.value || DEFAULT_AI_MODEL;
    }

    // 2. Handle Custom Loading GIF Update or Removal
    let resolvedGifUrl: string | null = null;
    if (customGifUrl !== undefined) {
      if (customGifUrl && typeof customGifUrl === 'string' && customGifUrl.trim().length > 0) {
        const trimmed = customGifUrl.trim();
        await prisma.systemSetting.upsert({
          where: { key: 'AI_LOADING_GIF_URL' },
          update: {
            value: trimmed,
            updatedBy: auth.user.username || auth.user.id,
          },
          create: {
            key: 'AI_LOADING_GIF_URL',
            value: trimmed,
            updatedBy: auth.user.username || auth.user.id,
          },
        });
        resolvedGifUrl = trimmed;
      } else {
        // Reset/remove custom GIF to revert to default animation
        await prisma.systemSetting.deleteMany({
          where: { key: 'AI_LOADING_GIF_URL' },
        });
        resolvedGifUrl = null;
      }
    } else {
      const currentGif = await prisma.systemSetting.findUnique({
        where: { key: 'AI_LOADING_GIF_URL' },
      });
      resolvedGifUrl = currentGif?.value || null;
    }

    // 3. Handle Fallback Models Sequence Update
    let resolvedFallbackModels: string[] | undefined = undefined;
    if (fallbackModels !== undefined) {
      if (!Array.isArray(fallbackModels)) {
        return NextResponse.json(
          { error: 'Bad Request: fallbackModels must be an array of model identifiers.' },
          { status: 400 }
        );
      }

      // Filter to only valid models
      const validFallbacks = fallbackModels.filter((id) =>
        AVAILABLE_AI_MODELS.some((m) => m.id === id)
      );

      await prisma.systemSetting.upsert({
        where: { key: 'AI_FALLBACK_MODELS' },
        update: {
          value: JSON.stringify(validFallbacks),
          updatedBy: auth.user.username || auth.user.id,
        },
        create: {
          key: 'AI_FALLBACK_MODELS',
          value: JSON.stringify(validFallbacks),
          updatedBy: auth.user.username || auth.user.id,
        },
      });

      resolvedFallbackModels = validFallbacks;
    } else {
      const currentFallbacks = await prisma.systemSetting.findUnique({
        where: { key: 'AI_FALLBACK_MODELS' },
      });
      if (currentFallbacks?.value) {
        try {
          resolvedFallbackModels = JSON.parse(currentFallbacks.value);
        } catch {}
      }
    }

    return NextResponse.json({
      success: true,
      activeModel: resolvedModel,
      customGifUrl: resolvedGifUrl,
      fallbackModels: resolvedFallbackModels,
    });
  } catch (error: any) {
    console.error('[API /api/admin/settings/ai PATCH Error]:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update global AI model setting.' },
      { status: 500 }
    );
  }
}
