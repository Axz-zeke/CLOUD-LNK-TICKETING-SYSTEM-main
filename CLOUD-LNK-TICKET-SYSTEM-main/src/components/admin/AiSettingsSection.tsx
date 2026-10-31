'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Bot,
  Check,
  AlertCircle,
  Loader2,
  Cpu,
  Info,
  Upload,
  Image as ImageIcon,
  Trash2,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import { AuthenticatedUser } from '@/lib/security/rbac';
import {
  AiModelItem,
  DEFAULT_AI_MODEL,
  DEFAULT_FALLBACK_MODELS,
  getModelDisplayName,
} from '@/lib/ai/models';

export type { AiModelItem };

interface AiSettingsSectionProps {
  currentUser?: AuthenticatedUser | null;
  onModelUpdated?: (newModelId: string) => void;
}

export function AiSettingsSection({ currentUser, onModelUpdated }: AiSettingsSectionProps) {
  const [currentModel, setCurrentModel] = useState<string>(DEFAULT_AI_MODEL);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_AI_MODEL);
  const [availableModels, setAvailableModels] = useState<AiModelItem[]>([]);
  const [fallbackSequence, setFallbackSequence] = useState<string[]>(DEFAULT_FALLBACK_MODELS);
  const [currentFallbackSequence, setCurrentFallbackSequence] = useState<string[]>(DEFAULT_FALLBACK_MODELS);
  const [customGifUrl, setCustomGifUrl] = useState<string | null>(null);
  const [selectedGifUrl, setSelectedGifUrl] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [gifError, setGifError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSuperadmin = currentUser?.globalRole === 'SUPERADMIN';

  // Load current settings from API
  const fetchSettings = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/admin/settings/ai');
      if (res.status === 403) {
        setErrorMessage('Superadmin clearance required to configure AI system settings.');
        setIsLoading(false);
        return;
      }
      if (!res.ok) {
        throw new Error('Failed to retrieve AI model settings.');
      }
      const data = await res.json();
      const model = data.currentModel || DEFAULT_AI_MODEL;
      setCurrentModel(model);
      setSelectedModel(model);
      if (Array.isArray(data.availableModels)) {
        setAvailableModels(data.availableModels);
      }
      if (Array.isArray(data.fallbackModels)) {
        setFallbackSequence(data.fallbackModels);
        setCurrentFallbackSequence(data.fallbackModels);
      }
      setCustomGifUrl(data.customGifUrl || null);
      setSelectedGifUrl(data.customGifUrl || null);
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred loading AI settings.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperadmin) {
      fetchSettings();
    }
  }, [isSuperadmin]);

  // Handle local GIF file upload and conversion to Data URL
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 3.5 * 1024 * 1024) {
      setGifError('File size exceeds 3.5MB limit. Please upload a smaller GIF.');
      return;
    }

    setGifError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setSelectedGifUrl(result);
    };
    reader.onerror = () => {
      setGifError('Failed to read image file.');
    };
    reader.readAsDataURL(file);
  };

  // Remove custom GIF action
  const handleRemoveGif = async () => {
    setSelectedGifUrl(null);
    setGifError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    // If currently saved on server, sync immediately
    if (customGifUrl) {
      setIsSaving(true);
      try {
        const res = await fetch('/api/admin/settings/ai', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customGifUrl: null }),
        });
        if (res.ok) {
          setCustomGifUrl(null);
          setSuccessMessage('Custom progress GIF removed. Reverted to default animation.');
          setTimeout(() => setSuccessMessage(null), 5000);
        }
      } catch (err: any) {
        setErrorMessage(err.message || 'Failed to remove custom GIF from server.');
      } finally {
        setIsSaving(false);
      }
    }
  };

  const effectiveFallbacks = fallbackSequence.filter((id) => id !== selectedModel);
  const hasFallbacksChanged =
    JSON.stringify(effectiveFallbacks) !== JSON.stringify(currentFallbackSequence);

  const moveFallback = (index: number, direction: 'up' | 'down') => {
    const list = [...effectiveFallbacks];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const temp = list[index];
    list[index] = list[targetIdx];
    list[targetIdx] = temp;
    setFallbackSequence(list);
  };

  // Save changes
  const handleSave = async () => {
    const hasModelChanged = selectedModel !== currentModel;
    const hasGifChanged = selectedGifUrl !== customGifUrl;

    if (!hasModelChanged && !hasGifChanged && !hasFallbacksChanged) return;

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const payload: { modelId?: string; customGifUrl?: string | null; fallbackModels?: string[] } = {};
      if (hasModelChanged) payload.modelId = selectedModel;
      if (hasGifChanged) payload.customGifUrl = selectedGifUrl;
      if (hasFallbacksChanged) payload.fallbackModels = effectiveFallbacks;

      const res = await fetch('/api/admin/settings/ai', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update global AI model setting.');
      }

      if (data.activeModel) {
        setCurrentModel(data.activeModel);
      }
      if (Array.isArray(data.fallbackModels)) {
        setFallbackSequence(data.fallbackModels);
        setCurrentFallbackSequence(data.fallbackModels);
      }
      setCustomGifUrl(data.customGifUrl || null);
      setSelectedGifUrl(data.customGifUrl || null);

      setSuccessMessage('AI configuration, model fallback sequence, and loading animation updated successfully.');
      setTimeout(() => setSuccessMessage(null), 6000);

      if (hasModelChanged && onModelUpdated && data.activeModel) {
        onModelUpdated(data.activeModel);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Network error updating AI settings.');
    } finally {
      setIsSaving(false);
    }
  };

  // 1. Visibility Guard: Render only if SUPERADMIN
  if (!isSuperadmin) {
    return null;
  }

  const isDirty =
    selectedModel !== currentModel ||
    selectedGifUrl !== customGifUrl ||
    hasFallbacksChanged;

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl shadow-xl overflow-hidden text-zinc-100">
      {/* Header Banner */}
      <div className="p-6 border-b border-zinc-800/80 bg-zinc-900/40">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 text-emerald-400 shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-base font-semibold text-zinc-100">
                  AI Engine & Global Model Selection
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-950/80 border border-emerald-800 text-emerald-400 font-bold">
                  OpenCode CLI Cloud
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Configure the AI inference model and progress visuals used across automated triage, diagnostics, and executive narrative reports.
              </p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs">
            <Cpu className="w-3.5 h-3.5 text-zinc-500" />
            <span>Host Overhead:</span>
            <span className="font-semibold text-emerald-400">0 MB Local RAM</span>
          </div>
        </div>
      </div>

      {/* Body Content */}
      <div className="p-6 space-y-6">
        {/* Error Feedback */}
        {errorMessage && (
          <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-800/80 text-red-200 text-xs flex items-center gap-2.5 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="font-medium">{errorMessage}</span>
          </div>
        )}

        {/* Success Feedback */}
        {successMessage && (
          <div className="p-3.5 rounded-xl bg-emerald-950/70 border border-emerald-800 text-emerald-200 text-xs flex items-center gap-2.5 animate-in fade-in">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-medium">{successMessage}</span>
          </div>
        )}

        {/* Loading State */}
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-zinc-400">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
            <span className="text-xs">Loading available AI inference settings...</span>
          </div>
        ) : (
          <>
            {/* 1. MODEL SELECTION */}
            <div className="space-y-4">
              <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
                Active Global Inference Model
              </label>

              {/* Radio Card Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {availableModels.map((model) => {
                  const isSelected = selectedModel === model.id;
                  const isCurrentlyActive = currentModel === model.id;

                  return (
                    <div
                      key={model.id}
                      onClick={() => setSelectedModel(model.id)}
                      className={`relative p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-emerald-950/20 border-emerald-500/80 shadow-md shadow-emerald-950/20 ring-1 ring-emerald-500/50'
                          : 'bg-zinc-900/50 hover:bg-zinc-900 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div>
                        {/* Top Row: Name and Badges */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                                isSelected
                                  ? 'border-emerald-500 bg-emerald-500 text-zinc-950'
                                  : 'border-zinc-700 bg-zinc-900'
                              }`}
                            >
                              {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                            </div>
                            <span className="font-semibold text-xs text-zinc-100">{model.name}</span>
                          </div>

                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              model.tag.includes('Default')
                                ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60'
                                : model.tag.includes('Fast')
                                ? 'bg-blue-900/60 text-blue-300 border border-blue-700/60'
                                : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                            }`}
                          >
                            {model.tag}
                          </span>
                        </div>

                        {/* Model Identifier Code */}
                        <div className="font-mono text-[11px] text-zinc-400 bg-zinc-950/80 px-2 py-1 rounded border border-zinc-800/80 mb-2.5 inline-block">
                          {model.id}
                        </div>

                        {/* Description */}
                        <p className="text-xs text-zinc-400 leading-relaxed">{model.description}</p>
                      </div>

                      {/* Active State Tag */}
                      <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between">
                        {isCurrentlyActive ? (
                          <span className="text-[11px] font-medium text-emerald-400 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            Active System-Wide
                          </span>
                        ) : (
                          <span className="text-[11px] text-zinc-500">Available</span>
                        )}

                        {isSelected && !isCurrentlyActive && (
                          <span className="text-[11px] font-medium text-amber-400">
                            Pending Save
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. AUTOMATIC MULTI-MODEL FAILOVER & FALLBACK SEQUENCE */}
            <div className="pt-5 border-t border-zinc-800/80 space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
                      Automatic Multi-Model Failover & Fallback Sequence
                    </label>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-950/80 border border-indigo-800 text-indigo-300 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-indigo-400" />
                      Active Protection
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    If the primary model times out (45–60s), encounters rate limits (HTTP 429), or exceeds token context ceilings, the engine automatically fails over through this prioritized sequence before failing.
                  </p>
                </div>
              </div>

              {/* Sequence Track */}
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 space-y-3">
                {/* 1. Primary Model */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-950/30 border border-emerald-800/60 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-xs font-mono font-bold flex items-center justify-center">
                      1
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-100">
                          {getModelDisplayName(selectedModel)}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold">
                          Primary Default
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 mt-0.5">{selectedModel}</div>
                    </div>
                  </div>

                  <span className="text-[11px] text-emerald-400 font-mono font-medium hidden sm:inline">
                    Initial Inference Target
                  </span>
                </div>

                {/* Transition Indicator */}
                <div className="flex items-center gap-2 pl-3 text-zinc-500 text-[11px] font-mono">
                  <span>↓ Automatic failover on HTTP 429 / Token Limit / Timeout / 5xx</span>
                </div>

                {/* Fallback items */}
                {effectiveFallbacks.map((modelId, idx) => {
                  const fallbackItem = availableModels.find((m) => m.id === modelId);
                  const isFirst = idx === 0;
                  const isLast = idx === effectiveFallbacks.length - 1;

                  return (
                    <div
                      key={modelId}
                      className="flex items-center justify-between p-3 rounded-lg bg-zinc-950/80 border border-zinc-800 hover:border-zinc-700 transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs font-mono font-bold flex items-center justify-center">
                          {idx + 2}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-zinc-200">
                              {fallbackItem?.name || getModelDisplayName(modelId)}
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-800/60 font-semibold">
                              {idx === 0
                                ? '1st Fallback'
                                : idx === 1
                                ? '2nd Fallback'
                                : `${idx + 1}th Fallback`}
                            </span>
                            {fallbackItem?.tag && (
                              <span className="text-[10px] text-zinc-500 hidden sm:inline">
                                • {fallbackItem.tag}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-zinc-500 mt-0.5">{modelId}</div>
                        </div>
                      </div>

                      {/* Reorder Buttons */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => moveFallback(idx, 'up')}
                          disabled={isFirst}
                          className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed border border-zinc-800 transition-colors cursor-pointer"
                          title="Move up in fallback priority"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveFallback(idx, 'down')}
                          disabled={isLast}
                          className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed border border-zinc-800 transition-colors cursor-pointer"
                          title="Move down in fallback priority"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. CUSTOM PROGRESS GIF UPLOAD & MANAGEMENT */}
            <div className="pt-5 border-t border-zinc-800/80 space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
                  AI Report Loading Animation (Custom GIF)
                </label>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Upload a custom animated GIF to display in the progress modal during AI operational report synthesis, or leave blank to use the default bouncing bot animation.
                </p>
              </div>

              {gifError && (
                <div className="p-3 rounded-lg bg-red-950/50 border border-red-800/80 text-xs text-red-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{gifError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center bg-zinc-900/40 border border-zinc-800 rounded-xl p-4">
                {/* Left: Live Preview */}
                <div className="flex flex-col items-center justify-center p-3 bg-zinc-950/80 rounded-xl border border-zinc-800/80 min-h-[140px]">
                  {selectedGifUrl ? (
                    <div className="flex flex-col items-center gap-2">
                      <img
                        src={selectedGifUrl}
                        alt="Custom Loading Animation Preview"
                        className="w-24 h-24 object-contain rounded-lg border border-zinc-800 shadow-md bg-zinc-900/50"
                      />
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/60">
                        Custom GIF Active
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500/20 via-teal-500/20 to-emerald-400/10 border border-emerald-500/40 flex items-center justify-center shadow-lg shadow-emerald-950/40">
                        <Bot className="w-7 h-7 text-emerald-400 animate-bounce" />
                      </div>
                      <span className="text-[10px] font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                        Default Bouncing Bot
                      </span>
                    </div>
                  )}
                </div>

                {/* Right: Actions & File Controls */}
                <div className="md:col-span-2 space-y-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/gif,image/png,image/webp,image/jpeg"
                      onChange={handleFileUpload}
                      className="hidden"
                    />

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-zinc-100 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg shadow-sm transition-colors cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{selectedGifUrl ? 'Replace Custom GIF' : 'Upload Custom GIF'}</span>
                    </button>

                    {selectedGifUrl && (
                      <button
                        type="button"
                        onClick={handleRemoveGif}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-300 hover:text-red-200 bg-red-950/40 hover:bg-red-950/70 border border-red-800/80 rounded-lg transition-colors cursor-pointer"
                        title="Remove custom GIF and revert to default bouncing bot"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove Custom GIF</span>
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[11px] text-zinc-400">
                      Or paste an external/local Image or GIF URL:
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="https://... or /assets/loading.gif or data:image/..."
                        value={selectedGifUrl || ''}
                        onChange={(e) => {
                          setSelectedGifUrl(e.target.value.trim() ? e.target.value.trim() : null);
                          setGifError(null);
                        }}
                        className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-indigo-500"
                      />
                      {selectedGifUrl && (
                        <button
                          type="button"
                          onClick={() => setSelectedGifUrl(null)}
                          className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg cursor-pointer"
                          title="Clear URL"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-[11px] text-zinc-500">
                    Recommended: Animated GIF with dark or transparent background. Max 3.5MB. Stored directly in system settings.
                  </p>
                </div>
              </div>
            </div>

            {/* Informational Notice */}
            <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-semibold text-zinc-300">System-Wide Impact: </span>
                <span>
                  Changes apply immediately system-wide to all department heads and automated report workflows.
                  AI Narrative reports will invoke OpenCode CLI with the selected model flag and display the active progress animation.
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer / Save Action */}
      <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
        <div className="text-xs text-zinc-500 font-mono flex items-center gap-3">
          <div>
            <span>Model: </span>
            <span className="text-zinc-300 font-semibold">{currentModel}</span>
          </div>
          <div>•</div>
          <div>
            <span>Animation: </span>
            <span className="text-zinc-300 font-semibold">
              {customGifUrl ? 'Custom GIF' : 'Default'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={isLoading || isSaving || !isDirty}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 rounded-lg shadow-sm transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Saving Configuration...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
              <span>Save AI Configuration</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
