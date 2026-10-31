'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  Copy,
  Check,
  Printer,
  RefreshCw,
  AlertTriangle,
  X,
  FileText,
  Clock,
  ShieldCheck,
  Bot,
  Hourglass,
  XCircle,
  Download,
  Loader2,
} from 'lucide-react';

interface ExecutiveReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Inline formatting parser (bold, italic, inline code)
function renderInlineFormatting(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={match.index} className="font-semibold text-zinc-100">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(
        <em key={match.index} className="italic text-zinc-200">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={match.index}
          className="px-1.5 py-0.5 mx-0.5 bg-zinc-900 border border-zinc-800 rounded font-mono text-[11px] text-emerald-300"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

// Markdown Renderer for executive briefing
function MarkdownRenderer({ content }: { content: string }) {
  const renderedElements = useMemo(() => {
    if (!content) return null;

    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeBlockContent: string[] = [];
    let inTable = false;
    let tableRows: string[][] = [];

    const flushTable = (key: string) => {
      if (tableRows.length === 0) return;
      const headers = tableRows[0];
      const rows = tableRows.slice(1).filter((r) => !r.every((c) => c.trim().match(/^:?-+:?$/)));

      elements.push(
        <div key={key} className="my-4 overflow-x-auto rounded-xl border border-zinc-800/80 shadow-inner bg-zinc-950/60 print:bg-white print:border print:border-neutral-300 print:rounded-none print:shadow-none print:break-inside-avoid print:my-4 report-section report-table-wrapper">
          <table className="w-full text-left text-xs border-collapse print:text-neutral-900 print:border-collapse">
            <thead className="bg-zinc-900/90 text-zinc-200 font-semibold border-b border-zinc-800 print:bg-neutral-100 print:text-neutral-900 print:border-b print:border-neutral-300">
              <tr>
                {headers.map((h, i) => (
                  <th key={i} className="px-3.5 py-2.5 border-r last:border-r-0 border-zinc-800 font-medium print:border-r print:border-neutral-300 print:px-3 print:py-2 print:font-bold">
                    {renderInlineFormatting(h.trim())}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
              {rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-zinc-900/30 transition-colors">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3.5 py-2.5 border-r last:border-r-0 border-zinc-800/50">
                      {renderInlineFormatting(cell.trim())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
      inTable = false;
    };

    lines.forEach((line, index) => {
      // Code blocks
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          elements.push(
            <pre
              key={`code-${index}`}
              className="my-3 p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-300 overflow-x-auto shadow-inner"
            >
              <code>{codeBlockContent.join('\n')}</code>
            </pre>
          );
          codeBlockContent = [];
          inCodeBlock = false;
        } else {
          if (inTable) flushTable(`table-${index}`);
          inCodeBlock = true;
        }
        return;
      }

      if (inCodeBlock) {
        codeBlockContent.push(line);
        return;
      }

      // Markdown Tables
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const cells = line
          .trim()
          .slice(1, -1)
          .split('|');
        tableRows.push(cells);
        inTable = true;
        return;
      } else if (inTable) {
        flushTable(`table-${index}`);
      }

      // Headings
      if (line.startsWith('# ')) {
        elements.push(
          <h1 key={index} className="text-lg font-bold text-zinc-100 mt-6 mb-2 border-b border-zinc-800/80 pb-2 flex items-center gap-2">
            {line.replace('# ', '')}
          </h1>
        );
      } else if (line.startsWith('## ')) {
        elements.push(
          <h2 key={index} className="text-sm font-semibold text-indigo-400 mt-5 mb-2.5 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-sm shadow-indigo-500/50"></span>
            {line.replace('## ', '')}
          </h2>
        );
      } else if (line.startsWith('### ')) {
        elements.push(
          <h3 key={index} className="text-xs font-semibold text-zinc-200 mt-4 mb-1.5 tracking-wide uppercase">
            {line.replace('### ', '')}
          </h3>
        );
      } else if (line.startsWith('#### ')) {
        elements.push(
          <h4 key={index} className="text-xs font-semibold text-zinc-300 mt-3 mb-1">
            {line.replace('#### ', '')}
          </h4>
        );
      }
      // Horizontal Rule
      else if (line.trim() === '---' || line.trim() === '***') {
        elements.push(<hr key={index} className="my-4 border-zinc-800/80" />);
      }
      // Blockquote
      else if (line.startsWith('> ')) {
        elements.push(
          <blockquote
            key={index}
            className="my-3 pl-3.5 py-2 border-l-2 border-indigo-500 bg-indigo-950/20 text-xs italic text-zinc-300 rounded-r-lg"
          >
            {renderInlineFormatting(line.replace('> ', ''))}
          </blockquote>
        );
      }
      // Bullet items
      else if (line.trim().match(/^[-*]\s+/)) {
        const bulletText = line.trim().replace(/^[-*]\s+/, '');
        elements.push(
          <li key={index} className="ml-4 list-disc text-xs text-zinc-300 py-0.5 leading-relaxed">
            {renderInlineFormatting(bulletText)}
          </li>
        );
      }
      // Numbered items
      else if (line.trim().match(/^\d+\.\s+/)) {
        const numText = line.trim().replace(/^\d+\.\s+/, '');
        elements.push(
          <li key={index} className="ml-4 list-decimal text-xs text-zinc-300 py-0.5 leading-relaxed">
            {renderInlineFormatting(numText)}
          </li>
        );
      }
      // Regular paragraph or empty line
      else if (line.trim().length > 0) {
        elements.push(
          <p key={index} className="text-xs text-zinc-300 my-2 leading-relaxed">
            {renderInlineFormatting(line)}
          </p>
        );
      }
    });

    if (inTable) flushTable('table-end');

    return elements;
  }, [content]);

  return <div className="space-y-1 text-zinc-300 text-xs leading-relaxed">{renderedElements}</div>;
}

function formatWaitTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function ExecutiveReportModal({ isOpen, onClose }: ExecutiveReportModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // Serialized AI Job Queue & Concurrency Lock State
  const [isQueued, setIsQueued] = useState(false);
  const [queueJobId, setQueueJobId] = useState<string | null>(null);
  const [queuePosition, setQueuePosition] = useState<number>(1);
  const [activeBusyDepartment, setActiveBusyDepartment] = useState<string>('');
  const [queueWaitSeconds, setQueueWaitSeconds] = useState(0);

  // Cancellation handler for queued or running AI generation
  const handleCancelQueuedJob = async () => {
    const currentId = queueJobId;
    setIsQueued(false);
    setLoading(false);
    setQueueJobId(null);
    setQueueWaitSeconds(0);

    if (currentId) {
      try {
        await fetch(`/api/ai/queue/${currentId}/cancel`, { method: 'POST' });
      } catch (e) {
        console.warn('Failed to cancel job on server:', e);
      }
    }
  };

  const handleCloseModal = () => {
    if (isQueued || loading || queueJobId) {
      handleCancelQueuedJob();
    }
    onClose();
  };

  // Waiting timer for queued requests
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isQueued) {
      setQueueWaitSeconds(0);
      timer = setInterval(() => {
        setQueueWaitSeconds((s) => s + 1);
      }, 1000);
    } else {
      setQueueWaitSeconds(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isQueued]);

  // Polling loop for queued and auto-executing jobs
  useEffect(() => {
    if (!isOpen || !queueJobId) return;

    let active = true;
    let pollTimer: NodeJS.Timeout | null = null;

    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/ai/queue/${queueJobId}/status`);
        if (!res.ok) throw new Error('Failed to fetch status');
        const data = await res.json();
        if (!active) return;

        if (data.status === 'QUEUED') {
          setIsQueued(true);
          setLoading(false);
          setQueuePosition(data.queuePosition || 1);
          if (data.activeDepartment) setActiveBusyDepartment(data.activeDepartment);
          pollTimer = setTimeout(pollStatus, 1500);
        } else if (data.status === 'RUNNING' || data.status === 'PROCESSING') {
          // It's the user's turn! Auto-transition to Generating state
          setIsQueued(false);
          setLoading(true);
          pollTimer = setTimeout(pollStatus, 1500);
        } else if (data.status === 'COMPLETED' && data.result) {
          setIsQueued(false);
          setLoading(false);
          setQueueJobId(null);
          setReport(data.result.report);
          setGeneratedAt(data.result.generatedAt || new Date().toISOString());
        } else if (data.status === 'FAILED') {
          setIsQueued(false);
          setLoading(false);
          setQueueJobId(null);
          setError(data.error || 'Report generation failed.');
        } else if (data.status === 'CANCELLED') {
          setIsQueued(false);
          setLoading(false);
          setQueueJobId(null);
        } else {
          pollTimer = setTimeout(pollStatus, 2000);
        }
      } catch (err: any) {
        if (!active) return;
        pollTimer = setTimeout(pollStatus, 2000);
      }
    };

    pollTimer = setTimeout(pollStatus, 1500);

    return () => {
      active = false;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [isOpen, queueJobId]);

  // Trigger report generation
  const handleGenerate = async () => {
    const myJobId = `ai_job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    setQueueJobId(myJobId);
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: myJobId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate operational report.');
      }

      if (data.busy) {
        setIsQueued(true);
        setLoading(false);
        setQueueJobId(data.jobId || myJobId);
        setQueuePosition(data.queuePosition || 1);
        setActiveBusyDepartment(data.activeDepartment || 'Another department');
        return;
      }

      setReport(data.report);
      setGeneratedAt(data.generatedAt || new Date().toISOString());
      setQueueJobId(null);
    } catch (err: any) {
      console.error('[ExecutiveReportModal] Generation failed:', err);
      setError(err.message || 'An unexpected error occurred while communicating with OpenCode CLI.');
      setQueueJobId(null);
    } finally {
      setLoading(false);
    }
  };

  // Generate when modal opens if empty
  useEffect(() => {
    if (isOpen && !report && !loading && !error && !isQueued) {
      handleGenerate();
    }
  }, [isOpen]);

  // Copy Markdown
  const handleCopyMarkdown = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  // Dedicated PDF Export Handler
  const handleDownloadPdf = async () => {
    if (!report || loading) return;

    const element = document.getElementById('report-printable-content');
    if (!element) {
      console.error('Printable report content container (#report-printable-content) not found.');
      return;
    }

    setIsDownloadingPdf(true);

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const filename = `Department-Performance-Report-organization-wide-${dateStr}.pdf`;

    try {
      element.classList.add('report-pdf-export-mode');

      const html2pdfModule = await import('html2pdf.js');
      const html2pdf = html2pdfModule.default;

      const opt = {
        margin: [12, 12, 12, 12] as [number, number, number, number],
        filename,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          letterRendering: true,
          backgroundColor: '#ffffff',
          scrollY: 0,
        },
        jsPDF: {
          unit: 'mm' as const,
          format: 'a4' as const,
          orientation: 'portrait' as const,
        },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      };

      await html2pdf().set(opt).from(element).save();
    } catch (err) {
      console.error('[ExecutiveReportModal] PDF export failed:', err);
      window.print();
    } finally {
      element.classList.remove('report-pdf-export-mode');
      setIsDownloadingPdf(false);
    }
  };

  // Print Handler
  const handlePrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div className="print-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 print:p-0 print:bg-white print:static">
      <div
        className="print-modal-container relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden print:max-w-none print:max-h-none print:border-none print:shadow-none print:bg-white print:rounded-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-title"
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="report-modal-title" className="text-sm font-semibold text-white">
                  Executive AI Operations Briefing
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-950/80 border border-indigo-800/80 text-indigo-300 font-bold">
                  AI Operations Briefing
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                On-demand algorithmic synthesis of cross-departmental throughput & SLA risk posture
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {(isQueued || loading) && (
              <button
                type="button"
                onClick={handleCancelQueuedJob}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:text-white bg-rose-950/60 hover:bg-rose-900 border border-rose-800/80 rounded-lg transition-colors cursor-pointer shadow-sm"
                title="Cancel AI report generation request"
              >
                <XCircle className="w-3.5 h-3.5 text-rose-400" />
                <span>Cancel Request</span>
              </button>
            )}

            <button
              onClick={handleCloseModal}
              className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Action Bar (Visible when report is loaded) */}
        {report && !loading && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 bg-zinc-900/40 border-b border-zinc-800/60 text-xs shrink-0">
            <div className="flex items-center gap-2 text-zinc-400">
              <Clock className="w-3.5 h-3.5 text-zinc-500" />
              <span>
                Generated:{' '}
                <span className="text-zinc-300 font-mono">
                  {generatedAt ? new Date(generatedAt).toLocaleTimeString() : 'Just now'}
                </span>
              </span>
              <span className="text-zinc-600">•</span>
              <span className="flex items-center gap-1 text-emerald-400 font-medium">
                <ShieldCheck className="w-3.5 h-3.5" />
                Air-Gapped Telemetry
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyMarkdown}
                className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded-lg text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-300">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Copy Markdown</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={loading || isDownloadingPdf}
                className="px-3 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-800/60 rounded-lg text-emerald-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
                title="Download formatted executive PDF"
              >
                {isDownloadingPdf ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                    <span>Exporting PDF...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Download PDF</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handlePrint}
                disabled={loading || isDownloadingPdf}
                className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded-lg text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                title="Open print preview"
              >
                <Printer className="w-3.5 h-3.5 text-zinc-400" />
                <span>Print</span>
              </button>

              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading || isDownloadingPdf}
                className="px-3 py-1.5 bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 rounded-lg text-indigo-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Regenerate</span>
              </button>
            </div>
          </div>
        )}

        {/* Scrollable Modal Content */}
        <div className="print-modal-scroll flex-1 overflow-y-auto p-6 space-y-4">
          {/* Waiting Dialog UI: System Busy - Queued State */}
          {isQueued && (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-4 animate-in fade-in">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500/20 via-orange-500/20 to-amber-400/10 border border-amber-500/40 flex items-center justify-center shadow-lg shadow-amber-950/40">
                  <Hourglass className="w-8 h-8 text-amber-400 animate-pulse" />
                </div>
                <div className="absolute -inset-1 rounded-2xl bg-amber-500/20 blur-md -z-10 animate-pulse"></div>
              </div>

              <div className="space-y-2 max-w-md">
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-950/90 border border-amber-800 text-amber-300 flex items-center gap-1.5 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                    System Busy • Queued
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-950 border border-indigo-800 text-indigo-300">
                    Queue Position: {queuePosition} in line
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-zinc-900 border border-zinc-800 text-zinc-400 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-zinc-400" />
                    {formatWaitTime(queueWaitSeconds)} elapsed
                  </span>
                </div>

                <h3 className="text-sm font-semibold text-zinc-200">
                  {activeBusyDepartment
                    ? `Another department (${activeBusyDepartment}) is generating a report.`
                    : 'Another department is currently generating an AI report.'}
                </h3>
                <p className="text-xs text-zinc-400 max-w-sm mx-auto leading-relaxed">
                  Single-concurrency lock active. Your executive briefing request is queued and will execute automatically once the active job concludes.
                </p>
              </div>

              {/* Serialized Execution Track */}
              <div className="w-full max-w-sm space-y-2">
                <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden border border-zinc-800 relative">
                  <div className="bg-gradient-to-r from-amber-500 via-orange-400 to-amber-300 h-1.5 rounded-full w-full animate-pulse"></div>
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 px-1">
                  <span>1. Model Lock</span>
                  <span className="text-amber-400 font-semibold">2. Auto-Dispatch</span>
                  <span>3. Briefing</span>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleCancelQueuedJob}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-rose-300 hover:text-white bg-rose-950/50 hover:bg-rose-900/80 border border-rose-800/60 hover:border-rose-700 rounded-lg transition-all cursor-pointer shadow-sm"
                >
                  <XCircle className="w-3.5 h-3.5 text-rose-400" />
                  <span>Cancel Request & Leave Queue</span>
                </button>
              </div>
            </div>
          )}

          {/* Loading State */}
          {loading && !isQueued && (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 animate-in fade-in">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center animate-pulse">
                  <Bot className="w-8 h-8 text-indigo-400 animate-bounce" />
                </div>
                <div className="absolute -inset-1 rounded-2xl bg-indigo-500/10 blur-md -z-10"></div>
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-zinc-200">
                  Synthesizing Operations Briefing...
                </h3>
                <p className="text-xs text-zinc-400 max-w-sm">
                  Aggregating space telemetry & synthesizing report via OpenCode CLI. Zero local RAM overhead.
                </p>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-mono mt-4">
                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping"></span>
                <span>Executing headless subagent...</span>
              </div>
            </div>
          )}

          {/* Error State */}
          {error && !loading && (
            <div className="p-6 rounded-2xl bg-red-950/40 border border-red-800/80 text-center space-y-4 my-8">
              <div className="w-12 h-12 rounded-full bg-red-900/40 border border-red-700/60 flex items-center justify-center mx-auto text-red-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-red-200">
                  Report Generation Failed
                </h3>
                <p className="text-xs text-red-300/80 max-w-md mx-auto leading-relaxed">
                  {error}
                </p>
              </div>
              <button
                type="button"
                onClick={handleGenerate}
                className="px-4 py-2 bg-red-900 hover:bg-red-800 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Synthesis</span>
              </button>
            </div>
          )}

          {/* Rendered Markdown Briefing */}
          {report && !loading && (
            <div
              id="report-printable-content"
              className="bg-zinc-900/30 border border-zinc-800/60 rounded-2xl p-6 shadow-inner print:bg-white print:text-black print:border-none print:shadow-none print:p-0"
            >
              {/* Executive Printable Header */}
              <div className="executive-print-header mb-6 pb-4 border-b-2 border-zinc-700/80 print:border-slate-900">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider font-bold text-indigo-400 print:text-slate-600 font-mono flex items-center gap-1.5">
                      <span>L&amp;K INDUSTRIES PHIL, INC.</span>
                      <span>•</span>
                      <span>EXECUTIVE OPERATIONS BRIEFING</span>
                    </div>
                    <h1 className="text-xl font-bold text-zinc-100 print:text-slate-950 mt-1">
                      Organization-Wide Operations Briefing
                    </h1>
                    <div className="text-xs text-zinc-400 print:text-slate-700 mt-1 flex items-center gap-2 flex-wrap">
                      <span>
                        Scope:{' '}
                        <strong className="text-zinc-200 print:text-slate-900 font-semibold">
                          Organization-Wide
                        </strong>
                      </span>
                      <span className="text-zinc-600 print:text-slate-400">•</span>
                      <span>
                        Audience:{' '}
                        <strong className="text-zinc-200 print:text-slate-900 font-semibold">
                          Executive Leadership
                        </strong>
                      </span>
                    </div>
                  </div>
                  <div className="text-left sm:text-right text-[11px] text-zinc-400 print:text-slate-600 shrink-0">
                    <div>
                      Generated:{' '}
                      <span className="font-medium text-zinc-200 print:text-slate-900 font-mono">
                        {generatedAt ? new Date(generatedAt).toLocaleString() : new Date().toLocaleString()}
                      </span>
                    </div>
                    <div className="font-mono text-zinc-300 print:text-slate-800 mt-0.5 font-semibold">
                      Engine: AI Analytics Engine
                    </div>
                    <div className="text-[9px] uppercase tracking-wider text-zinc-500 print:text-slate-500 mt-1 font-semibold">
                      CONFIDENTIAL • INTERNAL LEADERSHIP ONLY
                    </div>
                  </div>
                </div>
              </div>

              <MarkdownRenderer content={report} />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur shrink-0 print:hidden flex-wrap md:flex-nowrap">
          {/* Left Zone — Dismissal */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>

          {/* Center Zone — Export & Utility Group */}
          {report ? (
            <div className="flex items-center gap-1.5 p-1 bg-zinc-900/80 border border-zinc-800/80 rounded-lg">
              {/* Copy Markdown */}
              <button
                type="button"
                onClick={handleCopyMarkdown}
                className="flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white px-3 py-1.5 rounded-md hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Copy markdown to clipboard"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-300">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Copy Markdown</span>
                  </>
                )}
              </button>

              {/* Print */}
              <button
                type="button"
                onClick={handlePrint}
                disabled={loading || isDownloadingPdf}
                className="flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white px-3 py-1.5 rounded-md hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50"
                title="Open print preview"
              >
                <Printer className="w-3.5 h-3.5 text-zinc-400" />
                <span>Print</span>
              </button>

              {/* Download PDF */}
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={loading || isDownloadingPdf}
                className="text-xs font-medium text-emerald-400 bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-800/60 px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Download formatted executive PDF"
              >
                {isDownloadingPdf ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                    <span>Exporting PDF...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Download PDF</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="hidden md:block" />
          )}

          {/* Right Zone — Actions */}
          <div className="flex items-center gap-2">
            {report && (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading || isDownloadingPdf}
                className="p-2 text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center"
                title="Regenerate Analysis"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-zinc-400 hover:text-white transition-colors ${loading ? 'animate-spin' : ''}`} />
              </button>
            )}

            {/* AI Narrative Indicator Badge */}
            <div className="bg-emerald-600 text-white font-medium text-xs px-3.5 py-2 rounded-lg shadow-sm flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
              <span>Executive Briefing</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
