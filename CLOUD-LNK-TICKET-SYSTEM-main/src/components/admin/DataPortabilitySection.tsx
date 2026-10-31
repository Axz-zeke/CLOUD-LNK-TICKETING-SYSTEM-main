'use client';

import React, { useState, useRef, useMemo } from 'react';
import {
  Download,
  Upload,
  FileCode,
  FileSpreadsheet,
  Building2,
  Filter,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  Copy,
  FileUp,
  RefreshCw,
  Info,
  Database,
  ArrowRight,
} from 'lucide-react';

interface SpaceItem {
  id: string;
  name: string;
  slug?: string;
  key: string;
  lists?: Array<{ id: string; name: string }>;
  statuses?: Array<{ id: string; name: string; color?: string }>;
  _count?: {
    tasks: number;
    members: number;
  };
}

interface DataPortabilitySectionProps {
  spaces: SpaceItem[];
  onRefreshData?: () => void;
}

export function DataPortabilitySection({ spaces, onRefreshData }: DataPortabilitySectionProps) {
  // ==========================================
  // EXPORT STATE
  // ==========================================
  const [exportScope, setExportScope] = useState<'ALL_SYSTEM' | 'DEPARTMENT'>('ALL_SYSTEM');
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(spaces[0]?.id || '');
  const [selectedListId, setSelectedListId] = useState<string>('ALL');
  const [selectedStatusId, setSelectedStatusId] = useState<string>('ALL');
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');
  const [includeComments, setIncludeComments] = useState(true);
  const [includeHistory, setIncludeHistory] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // Active space object for cascading dropdowns
  const currentExportSpace = useMemo(() => {
    return spaces.find((s) => s.id === selectedSpaceId) || spaces[0];
  }, [spaces, selectedSpaceId]);

  // When changing space, reset list and status filter
  const handleSpaceChange = (newSpaceId: string) => {
    setSelectedSpaceId(newSpaceId);
    setSelectedListId('ALL');
    setSelectedStatusId('ALL');
  };

  // Handle Export Download
  const handleDownloadExport = async () => {
    setExportLoading(true);
    setExportError(null);
    setExportSuccess(null);

    try {
      const payload = {
        scope: exportScope,
        spaceId: exportScope === 'DEPARTMENT' ? selectedSpaceId : undefined,
        listId: exportScope === 'DEPARTMENT' ? selectedListId : undefined,
        statusId: exportScope === 'DEPARTMENT' ? selectedStatusId : undefined,
        format: exportFormat,
        includeHistory,
        includeComments,
      };

      const res = await fetch('/api/admin/data/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || 'Failed to export tickets data');
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('content-disposition');
      let filename = `tickets-export-${exportScope.toLowerCase()}.${exportFormat}`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setExportSuccess(
        `Export successful: Downloaded ${filename} (${(blob.size / 1024).toFixed(1)} KB)`
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExportLoading(false);
    }
  };

  // ==========================================
  // IMPORT STATE
  // ==========================================
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'json' | 'csv' | null>(null);
  const [parsedPreviewTickets, setParsedPreviewTickets] = useState<any[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Import Destination Mapping
  const [importTargetSpaceId, setImportTargetSpaceId] = useState<string>('AUTO');
  const [importTargetListId, setImportTargetListId] = useState<string>('AUTO');
  const [duplicateStrategy, setDuplicateStrategy] = useState<'SKIP' | 'GENERATE_NEW_KEY' | 'OVERWRITE'>('SKIP');

  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{
    importedCount: number;
    skippedCount: number;
    totalProcessed: number;
    errors: string[];
  } | null>(null);

  // Active space object for import target queue selector
  const currentImportSpace = useMemo(() => {
    if (importTargetSpaceId === 'AUTO') return null;
    return spaces.find((s) => s.id === importTargetSpaceId) || null;
  }, [spaces, importTargetSpaceId]);

  // Parse incoming file content for pre-validation preview
  const processUploadedFile = async (file: File) => {
    setSelectedFile(file);
    setImportError(null);
    setImportResult(null);

    const isCsv = file.name.toLowerCase().endsWith('.csv');
    const isJson = file.name.toLowerCase().endsWith('.json');

    if (!isCsv && !isJson) {
      setImportError('Please select a valid .json or .csv export dataset file.');
      setSelectedFile(null);
      setParsedPreviewTickets([]);
      return;
    }

    try {
      const text = await file.text();
      setFileContent(text);
      setFileType(isCsv ? 'csv' : 'json');

      if (isCsv) {
        // Simple preview parse
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length > 1) {
          const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
          const previewRows: any[] = [];
          for (let i = 1; i < Math.min(lines.length, 6); i++) {
            const values = lines[i].split(',').map((v) => v.replace(/^"|"$/g, '').trim());
            const obj: any = {};
            headers.forEach((h, idx) => {
              obj[h] = values[idx] || '';
            });
            previewRows.push({
              taskKey: obj.Key || obj.taskKey || 'Auto',
              title: obj.Title || obj.title || 'Imported Ticket',
              department: obj.Department || obj.department || 'N/A',
              queue: obj.Queue || obj.queue || 'Default',
              status: obj.Status || obj.status || 'OPEN',
              priority: obj.Priority || obj.priority || 'NORMAL',
            });
          }
          setParsedPreviewTickets(previewRows);
        } else {
          setParsedPreviewTickets([]);
        }
      } else {
        // JSON preview parse
        const parsed = JSON.parse(text);
        const dataArr = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.data)
          ? parsed.data
          : Array.isArray(parsed.tasks)
          ? parsed.tasks
          : [];

        const previewRows = dataArr.slice(0, 5).map((t: any) => ({
          taskKey: t.taskKey || t.key || 'Auto',
          title: t.title || 'Imported Ticket',
          department: t.space?.name || t.department || 'N/A',
          queue: t.list?.name || t.queue || 'Default',
          status: t.status?.name || t.status || 'OPEN',
          priority: t.priority || 'NORMAL',
        }));
        setParsedPreviewTickets(previewRows);
      }
    } catch {
      setImportError('Failed to parse or read file. Please ensure it is valid JSON or CSV.');
      setParsedPreviewTickets([]);
    }
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processUploadedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processUploadedFile(e.target.files[0]);
    }
  };

  // Execute Import
  const handleExecuteImport = async () => {
    if (!selectedFile) {
      setImportError('Please select or upload a dataset file first.');
      return;
    }

    setImportLoading(true);
    setImportError(null);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (importTargetSpaceId !== 'AUTO') {
        formData.append('targetSpaceId', importTargetSpaceId);
      }
      if (importTargetListId !== 'AUTO') {
        formData.append('targetListId', importTargetListId);
      }
      formData.append('duplicateStrategy', duplicateStrategy);

      const res = await fetch('/api/admin/data/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Import execution failed');
      }

      setImportResult({
        importedCount: data.importedCount ?? 0,
        skippedCount: data.skippedCount ?? 0,
        totalProcessed: data.totalProcessed ?? 0,
        errors: data.errors || [],
      });

      if (onRefreshData) {
        onRefreshData();
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Top Banner */}
      <div className="bg-zinc-900/60 border border-zinc-800 p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-purple-950/60 border border-purple-800 text-purple-400 rounded-xl shrink-0">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">
              Data Portability & Hierarchical Engine
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Granular export and atomic import tools with collision management for ticket migrations and air-gapped backups.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-md text-[11px] font-mono font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
            Air-Gapped Compatible
          </span>
          <span className="px-2.5 py-1 rounded-md text-[11px] font-mono font-medium bg-purple-950/70 text-purple-300 border border-purple-800">
            Superadmin Only
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* ========================================================================= */}
        {/* 1. EXPORT CONFIGURATION CARD */}
        {/* ========================================================================= */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-950/70 text-blue-400 border border-blue-800/80 rounded-lg">
                <Download className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Hierarchical Export Engine</h3>
                <p className="text-[11px] text-zinc-400">Extract tickets with customizable scope and audit depth.</p>
              </div>
            </div>
          </div>

          {/* Feedback Alerts */}
          {exportError && (
            <div className="p-3.5 rounded-xl bg-red-950/70 border border-red-800 text-red-200 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{exportError}</span>
            </div>
          )}

          {exportSuccess && (
            <div className="p-3.5 rounded-xl bg-emerald-950/70 border border-emerald-800 text-emerald-200 text-xs flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{exportSuccess}</span>
            </div>
          )}

          {/* Scope Level 1: Scope Target */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-blue-400" />
              <span>Scope Level 1: Export Target</span>
            </label>
            <div className="grid grid-cols-2 gap-2 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
              <button
                type="button"
                onClick={() => setExportScope('ALL_SYSTEM')}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  exportScope === 'ALL_SYSTEM'
                    ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Entire System (All Depts)
              </button>
              <button
                type="button"
                onClick={() => setExportScope('DEPARTMENT')}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  exportScope === 'DEPARTMENT'
                    ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Specific Department Space
              </button>
            </div>
          </div>

          {/* Cascading Selectors (when Department Space is selected) */}
          {exportScope === 'DEPARTMENT' && (
            <div className="space-y-4 p-4 rounded-xl bg-zinc-950/80 border border-zinc-800/80 animate-in fade-in">
              {/* Department Dropdown */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Department Space</span>
                </label>
                <select
                  value={selectedSpaceId}
                  onChange={(e) => handleSpaceChange(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                >
                  {spaces.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name} ({sp.key})
                    </option>
                  ))}
                </select>
              </div>

              {/* Scope Level 2: Queue / List Filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300">
                  Scope Level 2: Queue / List Filter
                </label>
                <select
                  value={selectedListId}
                  onChange={(e) => setSelectedListId(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="ALL">All Queues in {currentExportSpace?.name || 'Department'}</option>
                  {currentExportSpace?.lists?.map((list) => (
                    <option key={list.id} value={list.id}>
                      Queue: {list.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Scope Level 3: Status Filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300">
                  Scope Level 3: Status Filter
                </label>
                <select
                  value={selectedStatusId}
                  onChange={(e) => setSelectedStatusId(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="ALL">All Statuses</option>
                  {currentExportSpace?.statuses?.map((st) => (
                    <option key={st.id} value={st.id}>
                      Status: {st.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Export Format Toggle */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-300">Export Format</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setExportFormat('json')}
                className={`p-3 rounded-xl border flex flex-col items-start gap-1 transition-all cursor-pointer ${
                  exportFormat === 'json'
                    ? 'bg-blue-950/30 border-blue-700 text-white shadow-sm ring-1 ring-blue-500/50'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileCode className={`w-4 h-4 ${exportFormat === 'json' ? 'text-blue-400' : 'text-zinc-500'}`} />
                  <span className="text-xs font-semibold">JSON Payload</span>
                </div>
                <span className="text-[10px] text-zinc-400 text-left">
                  Full relational schema, comments, and audit timeline.
                </span>
              </button>

              <button
                type="button"
                onClick={() => setExportFormat('csv')}
                className={`p-3 rounded-xl border flex flex-col items-start gap-1 transition-all cursor-pointer ${
                  exportFormat === 'csv'
                    ? 'bg-emerald-950/30 border-emerald-700 text-white shadow-sm ring-1 ring-emerald-500/50'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className={`w-4 h-4 ${exportFormat === 'csv' ? 'text-emerald-400' : 'text-zinc-500'}`} />
                  <span className="text-xs font-semibold">CSV Spreadsheet</span>
                </div>
                <span className="text-[10px] text-zinc-400 text-left">
                  Flat ticket roster for Excel or reporting analytics.
                </span>
              </button>
            </div>
          </div>

          {/* Deep Audit Checkboxes (for JSON) */}
          {exportFormat === 'json' && (
            <div className="space-y-2 pt-2 border-t border-zinc-800/80">
              <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                Relational Inclusions
              </label>
              <div className="flex flex-col sm:flex-row gap-4">
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeComments}
                    onChange={(e) => setIncludeComments(e.target.checked)}
                    className="rounded bg-zinc-950 border-zinc-800 text-blue-600 focus:ring-0 cursor-pointer"
                  />
                  <span>Include comments & notes</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeHistory}
                    onChange={(e) => setIncludeHistory(e.target.checked)}
                    className="rounded bg-zinc-950 border-zinc-800 text-blue-600 focus:ring-0 cursor-pointer"
                  />
                  <span>Include audit progression history</span>
                </label>
              </div>
            </div>
          )}

          {/* Download Action */}
          <button
            type="button"
            disabled={exportLoading}
            onClick={handleDownloadExport}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer disabled:opacity-50"
          >
            {exportLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Compiling & Streaming Export Payload...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Download {exportFormat.toUpperCase()} Export</span>
              </>
            )}
          </button>
        </div>

        {/* ========================================================================= */}
        {/* 2. IMPORT CONFIGURATION CARD */}
        {/* ========================================================================= */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-purple-950/70 text-purple-400 border border-purple-800/80 rounded-lg">
                <Upload className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Granular Import Engine</h3>
                <p className="text-[11px] text-zinc-400">Ingest JSON or CSV datasets with collision mitigation.</p>
              </div>
            </div>
          </div>

          {/* Feedback Alerts */}
          {importError && (
            <div className="p-3.5 rounded-xl bg-red-950/70 border border-red-800 text-red-200 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{importError}</span>
            </div>
          )}

          {importResult && (
            <div className="p-4 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-200 text-xs space-y-2 animate-in fade-in">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-semibold text-sm">Import Execution Complete</span>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                <div className="bg-emerald-900/40 p-2 rounded border border-emerald-800/60">
                  <span className="text-zinc-400 block text-[10px]">Imported</span>
                  <span className="font-bold text-emerald-300 text-base">{importResult.importedCount}</span>
                </div>
                <div className="bg-emerald-900/40 p-2 rounded border border-emerald-800/60">
                  <span className="text-zinc-400 block text-[10px]">Skipped</span>
                  <span className="font-bold text-amber-300 text-base">{importResult.skippedCount}</span>
                </div>
                <div className="bg-emerald-900/40 p-2 rounded border border-emerald-800/60">
                  <span className="text-zinc-400 block text-[10px]">Total Rows</span>
                  <span className="font-bold text-zinc-100 text-base">{importResult.totalProcessed}</span>
                </div>
              </div>
              {importResult.errors.length > 0 && (
                <div className="mt-2 text-[11px] text-red-300 bg-red-950/60 p-2 rounded border border-red-900/50">
                  <span className="font-semibold block mb-1">Row Warnings ({importResult.errors.length}):</span>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {importResult.errors.slice(0, 3).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                    {importResult.errors.length > 3 && (
                      <li>...and {importResult.errors.length - 3} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Drag and Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center gap-3 transition-colors cursor-pointer text-center ${
              isDragging
                ? 'border-purple-500 bg-purple-950/20'
                : selectedFile
                ? 'border-emerald-700/80 bg-emerald-950/10'
                : 'border-zinc-800 hover:border-zinc-700 bg-zinc-950/50 hover:bg-zinc-950'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.csv"
              onChange={handleFileSelect}
              className="hidden"
            />
            {selectedFile ? (
              <>
                <div className="p-3 bg-emerald-950/60 text-emerald-400 border border-emerald-800 rounded-xl">
                  {fileType === 'csv' ? (
                    <FileSpreadsheet className="w-6 h-6" />
                  ) : (
                    <FileCode className="w-6 h-6" />
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-200">{selectedFile.name}</p>
                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    {(selectedFile.size / 1024).toFixed(1)} KB • Format: {fileType?.toUpperCase()}
                  </p>
                </div>
                <span className="text-[11px] text-emerald-400 font-medium">
                  File loaded • Click or drop another to replace
                </span>
              </>
            ) : (
              <>
                <div className="p-3 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded-xl">
                  <FileUp className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-300">
                    Drop your JSON or CSV file here, or browse
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Compatible with files generated by the Hierarchical Export Engine.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Destination Target Mapping */}
          <div className="space-y-4 p-4 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
            <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block">
              Destination Target Configuration
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Target Space */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">Target Department</label>
                <select
                  value={importTargetSpaceId}
                  onChange={(e) => {
                    setImportTargetSpaceId(e.target.value);
                    setImportTargetListId('AUTO');
                  }}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer"
                >
                  <option value="AUTO">Auto-map from file</option>
                  {spaces.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name} ({sp.key})
                    </option>
                  ))}
                </select>
              </div>

              {/* Target Queue */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">Target Queue / List</label>
                <select
                  value={importTargetListId}
                  onChange={(e) => setImportTargetListId(e.target.value)}
                  disabled={importTargetSpaceId === 'AUTO'}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer disabled:opacity-40"
                >
                  <option value="AUTO">Auto-map from file</option>
                  {currentImportSpace?.lists?.map((list) => (
                    <option key={list.id} value={list.id}>
                      Queue: {list.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Duplicate Handling Selector */}
            <div className="space-y-1.5 pt-2 border-t border-zinc-800/80">
              <label className="text-xs font-medium text-zinc-400">
                Key Collision & Duplicate Strategy
              </label>
              <select
                value={duplicateStrategy}
                onChange={(e) =>
                  setDuplicateStrategy(
                    e.target.value as 'SKIP' | 'GENERATE_NEW_KEY' | 'OVERWRITE'
                  )
                }
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer font-medium"
              >
                <option value="SKIP">Skip duplicate ticket keys (Preserve existing tickets)</option>
                <option value="GENERATE_NEW_KEY">
                  Generate new sequential keys (e.g. ACC-103 -&gt; ACC-104)
                </option>
                <option value="OVERWRITE">
                  Overwrite existing tickets with imported data
                </option>
              </select>
            </div>
          </div>

          {/* Pre-Import Preview Table */}
          {parsedPreviewTickets.length > 0 && (
            <div className="space-y-2 pt-1 animate-in fade-in">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-semibold text-zinc-300">Pre-Import Sample Preview</span>
                <span className="font-mono text-[11px] text-purple-400">
                  Showing top {parsedPreviewTickets.length} rows
                </span>
              </div>
              <div className="overflow-x-auto border border-zinc-800 rounded-lg">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-zinc-950 text-zinc-400 font-mono border-b border-zinc-800">
                    <tr>
                      <th className="px-2.5 py-1.5 font-semibold">Key</th>
                      <th className="px-2.5 py-1.5 font-semibold">Title</th>
                      <th className="px-2.5 py-1.5 font-semibold">Dept</th>
                      <th className="px-2.5 py-1.5 font-semibold">Status</th>
                      <th className="px-2.5 py-1.5 font-semibold">Priority</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 bg-zinc-900/40">
                    {parsedPreviewTickets.map((t, idx) => (
                      <tr key={idx} className="text-zinc-300">
                        <td className="px-2.5 py-1.5 font-mono text-purple-300">{t.taskKey}</td>
                        <td className="px-2.5 py-1.5 truncate max-w-[150px]">{t.title}</td>
                        <td className="px-2.5 py-1.5 text-zinc-400">{t.department}</td>
                        <td className="px-2.5 py-1.5 text-zinc-400">{t.status}</td>
                        <td className="px-2.5 py-1.5 font-mono text-[10px]">{t.priority}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Import Action */}
          <button
            type="button"
            disabled={importLoading || !selectedFile}
            onClick={handleExecuteImport}
            className="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer disabled:opacity-50"
          >
            {importLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Executing Batch Ingestion Transaction...</span>
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                <span>
                  {selectedFile
                    ? `Execute Import (${selectedFile.name})`
                    : 'Select File to Import'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
