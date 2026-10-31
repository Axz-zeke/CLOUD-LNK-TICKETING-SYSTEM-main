'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Sparkles,
  FileText,
  Loader2,
  AlertCircle,
  Building2,
  Copy,
  Check,
  Printer,
  Calendar,
  Bot,
  RefreshCw,
  Hourglass,
  Clock,
  XCircle,
  Download,
} from 'lucide-react';
import { AuthenticatedUser } from '@/lib/security/rbac';

function formatWaitTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

interface DepartmentReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  spaceId?: string;
  spaceName?: string;
  spaceKey?: string;
  currentUser?: AuthenticatedUser;
  availableSpaces?: Array<{ id: string; name: string; key: string }>;
}

// Format Date to YYYY-MM-DD in local time
function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Preset range helpers
function getPresetDates(preset: '7days' | '30days' | 'thisMonth') {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  let start: Date;

  if (preset === '7days') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0);
  } else if (preset === '30days') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0, 0);
  } else {
    // This month (from the 1st until today)
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }

  return {
    startDateStr: formatLocalDate(start),
    endDateStr: formatLocalDate(end),
  };
}

// Inline formatting parser (bold, italic, inline code) with print support
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
        <strong key={match.index} className="font-semibold text-zinc-100 print:text-black">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(
        <em key={match.index} className="italic text-zinc-200 print:text-neutral-800">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={match.index}
          className="px-1.5 py-0.5 mx-0.5 bg-zinc-900 border border-zinc-800 rounded font-mono text-[11px] text-emerald-300 print:bg-neutral-100 print:border-neutral-200 print:text-black"
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

// Custom Offline-First Markdown Renderer with Print Support
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
        <div
          key={key}
          className="my-3 overflow-x-auto rounded-lg border border-zinc-800 shadow-sm bg-zinc-950/60 print:bg-white print:border print:border-neutral-300 print:rounded-none print:shadow-none print:break-inside-avoid print:my-4 report-section report-table-wrapper"
        >
          <table className="w-full text-left text-xs border-collapse print:text-neutral-900 print:border-collapse">
            <thead className="bg-zinc-900/90 text-zinc-200 font-semibold border-b border-zinc-800 print:bg-neutral-100 print:text-neutral-900 print:border-b print:border-neutral-300">
              <tr>
                {headers.map((h, i) => (
                  <th
                    key={i}
                    className="px-3.5 py-2.5 border-r last:border-r-0 border-zinc-800 print:border-r print:border-neutral-300 print:px-3 print:py-2 print:font-bold"
                  >
                    {renderInlineFormatting(h.trim())}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-zinc-300 print:divide-neutral-200 print:text-neutral-800">
              {rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-zinc-900/40 transition-colors print:bg-white print:break-inside-avoid">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-3.5 py-2 border-r last:border-r-0 border-zinc-800/60 print:border-r print:border-neutral-200 print:px-3 print:py-1.5"
                    >
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
              className="my-3 p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-300 overflow-x-auto print:bg-neutral-50 print:border-neutral-300 print:text-neutral-900 print:break-inside-avoid"
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
      const trimmedLine = line.trim();
      const isTableRow =
        trimmedLine.startsWith('|') ||
        (trimmedLine.includes('|') && (trimmedLine.match(/\|/g) || []).length >= 2);

      if (isTableRow) {
        let clean = trimmedLine;
        if (clean.startsWith('|')) clean = clean.slice(1);
        if (clean.endsWith('|')) clean = clean.slice(0, -1);
        const cells = clean.split('|');
        tableRows.push(cells);
        inTable = true;
        return;
      } else if (inTable) {
        flushTable(`table-${index}`);
      }

      // Headings
      if (line.startsWith('# ')) {
        elements.push(
          <h1
            key={index}
            className="text-base font-bold text-zinc-100 mt-4 mb-2 border-b border-zinc-800 pb-1.5 print:text-neutral-950 print:border-neutral-300 print:break-after-avoid report-section"
          >
            {renderInlineFormatting(line.replace('# ', ''))}
          </h1>
        );
      } else if (line.startsWith('## ')) {
        elements.push(
          <h2
            key={index}
            className="text-sm font-semibold text-indigo-400 mt-4 mb-2 flex items-center gap-2 print:text-neutral-900 print:break-after-avoid report-section"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 print:hidden"></span>
            {renderInlineFormatting(line.replace('## ', ''))}
          </h2>
        );
      } else if (line.startsWith('### ')) {
        elements.push(
          <h3
            key={index}
            className="text-xs font-semibold text-zinc-200 mt-3 mb-1 print:text-neutral-900 print:break-after-avoid"
          >
            {line.replace('### ', '')}
          </h3>
        );
      } else if (line.startsWith('#### ')) {
        elements.push(
          <h4
            key={index}
            className="text-xs font-semibold text-zinc-300 mt-2 mb-1 print:text-neutral-800 print:break-after-avoid"
          >
            {line.replace('#### ', '')}
          </h4>
        );
      }
      // Horizontal Rule
      else if (line.trim() === '---' || line.trim() === '***') {
        elements.push(<hr key={index} className="my-3 border-zinc-800 print:border-neutral-300" />);
      }
      // Blockquote
      else if (line.startsWith('> ')) {
        elements.push(
          <blockquote
            key={index}
            className="my-2 pl-3 py-1.5 border-l-2 border-indigo-500 bg-zinc-900/40 text-xs italic text-zinc-300 rounded-r print:border-neutral-400 print:bg-neutral-50 print:text-neutral-800 print:break-inside-avoid"
          >
            {renderInlineFormatting(line.replace('> ', ''))}
          </blockquote>
        );
      }
      // Bullet items
      else if (line.trim().match(/^[-*]\s+/)) {
        const bulletText = line.trim().replace(/^[-*]\s+/, '');
        elements.push(
          <li key={index} className="ml-4 list-disc text-xs text-zinc-300 py-0.5 leading-relaxed print:text-neutral-800">
            {renderInlineFormatting(bulletText)}
          </li>
        );
      }
      // Numbered items
      else if (line.trim().match(/^\d+\.\s+/)) {
        const numText = line.trim().replace(/^\d+\.\s+/, '');
        elements.push(
          <li key={index} className="ml-4 list-decimal text-xs text-zinc-300 py-0.5 leading-relaxed print:text-neutral-800">
            {renderInlineFormatting(numText)}
          </li>
        );
      }
      // Regular paragraph or empty line
      else if (line.trim().length > 0) {
        elements.push(
          <p key={index} className="text-xs text-zinc-300 my-1.5 leading-relaxed print:text-neutral-800 print:my-1.5">
            {renderInlineFormatting(line)}
          </p>
        );
      }
    });

    if (inTable) flushTable('table-end');

    return elements;
  }, [content]);

  return <div className="space-y-1 text-zinc-300 text-xs leading-relaxed print:text-neutral-900">{renderedElements}</div>;
}

export function DepartmentReportModal({
  isOpen,
  onClose,
  spaceId: initialSpaceId,
  spaceName: initialSpaceName,
  spaceKey: initialSpaceKey,
  currentUser,
  availableSpaces: propSpaces,
}: DepartmentReportModalProps) {
  const [mounted, setMounted] = useState(false);
  const defaultDates = useMemo(() => getPresetDates('30days'), []);
  const [startDate, setStartDate] = useState(defaultDates.startDateStr);
  const [endDate, setEndDate] = useState(defaultDates.endDateStr);
  const [activePreset, setActivePreset] = useState<string>('Last 30 Days');

  // Space selection for Superadmin
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(initialSpaceId || 'all');
  const [fetchedSpaces, setFetchedSpaces] = useState<Array<{ id: string; name: string; key: string }>>([]);

  // Report and generation state
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [isLoadingStandard, setIsLoadingStandard] = useState(false);
  const [reportContent, setReportContent] = useState<string | null>(null);
  const [reportType, setReportType] = useState<'standard' | 'ai' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [generationTimestamp, setGenerationTimestamp] = useState<string>('');

  // In-Memory Report Caching: key -> { content: string; generatedAt: string; type: 'standard' | 'ai' }
  const [reportsCache, setReportsCache] = useState<
    Record<string, { content: string; generatedAt: string; type: 'standard' | 'ai' }>
  >({});

  // Multi-stage timer for AI Generation
  const [aiElapsedSeconds, setAiElapsedSeconds] = useState(0);

  // Custom Loading GIF from System Settings
  const [customGifUrl, setCustomGifUrl] = useState<string | null>(null);

  const isSuperadmin = currentUser?.globalRole === 'SUPERADMIN';

  // Mount tracking
  useEffect(() => {
    setMounted(true);
  }, []);

  // Update selectedSpaceId if prop changes
  useEffect(() => {
    if (initialSpaceId) {
      setSelectedSpaceId(initialSpaceId);
    }
  }, [initialSpaceId]);

  // Fetch spaces list for Superadmin if not provided
  useEffect(() => {
    if (isOpen && isSuperadmin && (!propSpaces || propSpaces.length === 0)) {
      fetch('/api/spaces')
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          if (Array.isArray(data)) {
            setFetchedSpaces(data);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, isSuperadmin, propSpaces]);

  const spacesList = useMemo(() => {
    if (propSpaces && propSpaces.length > 0) return propSpaces;
    return fetchedSpaces;
  }, [propSpaces, fetchedSpaces]);

  // Serialized AI Job Queue & Concurrency Lock State
  const [isQueued, setIsQueued] = useState(false);
  const [queueJobId, setQueueJobId] = useState<string | null>(null);
  const [queuePosition, setQueuePosition] = useState<number>(1);
  const [activeBusyDepartment, setActiveBusyDepartment] = useState<string>('');
  const [queueWaitSeconds, setQueueWaitSeconds] = useState(0);

  // Cancellation handler for queued or running AI generation
  const handleCancelQueuedJob = useCallback(async () => {
    const currentId = queueJobId;
    setIsQueued(false);
    setIsGeneratingAi(false);
    setQueueJobId(null);
    setQueueWaitSeconds(0);

    if (currentId) {
      try {
        await fetch(`/api/ai/queue/${currentId}/cancel`, {
          method: 'POST',
        });
      } catch (e) {
        console.warn('Failed to notify server of cancellation:', e);
      }
    }
  }, [queueJobId]);

  // Modal close handler with cancellation cleanup
  const handleCloseModal = useCallback(() => {
    if (isQueued || isGeneratingAi || queueJobId) {
      handleCancelQueuedJob();
    }
    onClose();
  }, [isQueued, isGeneratingAi, queueJobId, handleCancelQueuedJob, onClose]);

  // Live waiting timer for queued requests
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

  // Close on ESC
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleCloseModal();
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleCloseModal]);

  // Multi-stage progress timer for AI Generation
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isGeneratingAi && !isQueued) {
      setAiElapsedSeconds(0);
      interval = setInterval(() => {
        setAiElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setAiElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isGeneratingAi, isQueued]);

  // Dynamic phase resolution (0–12s, 12–35s, 35s+)
  const aiProgressStage = useMemo(() => {
    if (aiElapsedSeconds < 12) {
      return {
        stage: 1,
        title: 'Phase 1 of 3: Telemetry Ingestion',
        label: 'Extracting ticket volume & SLA telemetry...',
        pct: Math.min(30, Math.round((aiElapsedSeconds / 12) * 30)),
      };
    }
    if (aiElapsedSeconds < 35) {
      return {
        stage: 2,
        title: 'Phase 2 of 3: Root Cause Analysis',
        label: 'Synthesizing bottlenecks & root causes via AI engine...',
        pct: 30 + Math.min(45, Math.round(((aiElapsedSeconds - 12) / 23) * 45)),
      };
    }
    return {
      stage: 3,
      title: 'Phase 3 of 3: Executive Reporting',
      label: 'Finalizing leadership action items & markdown tables...',
      pct: 75 + Math.min(20, Math.round(((aiElapsedSeconds - 35) / 20) * 20)),
    };
  }, [aiElapsedSeconds]);

  // Cache key generator
  const getCacheKey = useCallback(
    (type: 'standard' | 'ai', spaceId: string, start: string, end: string) => {
      return `${type}::${spaceId || 'all'}::${start}::${end}`;
    },
    []
  );

  // Check in-memory cache when filters change
  useEffect(() => {
    if (reportType) {
      const key = getCacheKey(reportType, selectedSpaceId, startDate, endDate);
      if (reportsCache[key]) {
        setReportContent(reportsCache[key].content);
        setErrorMessage(null);
      } else {
        setReportContent(null);
      }
    }
  }, [selectedSpaceId, startDate, endDate, reportType, reportsCache, getCacheKey]);

  // Handle Preset Selection
  const applyPreset = (preset: 'Last 7 Days' | 'Last 30 Days' | 'This Month') => {
    setActivePreset(preset);
    const mapped = preset === 'Last 7 Days' ? '7days' : preset === 'Last 30 Days' ? '30days' : 'thisMonth';
    const { startDateStr, endDateStr } = getPresetDates(mapped);
    setStartDate(startDateStr);
    setEndDate(endDateStr);
  };

  // Determine current active space metadata
  const currentSpaceMeta = useMemo(() => {
    if (selectedSpaceId === 'all') {
      return { name: 'Organization-Wide', key: 'ALL' };
    }
    const found = spacesList.find((s) => s.id === selectedSpaceId);
    if (found) return { name: found.name, key: found.key };
    return { name: initialSpaceName || 'Department', key: initialSpaceKey || 'DEP' };
  }, [selectedSpaceId, spacesList, initialSpaceName, initialSpaceKey]);

  // Status Polling Loop for Queued and Auto-Executing Jobs
  useEffect(() => {
    if (!isOpen || !queueJobId) return;

    let active = true;
    let pollTimer: NodeJS.Timeout | null = null;

    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/ai/queue/${queueJobId}/status`);
        if (!res.ok) {
          throw new Error('Failed to fetch job status');
        }
        const data = await res.json();
        if (!active) return;

        if (data.status === 'QUEUED') {
          setIsQueued(true);
          setIsGeneratingAi(false);
          setQueuePosition(data.queuePosition || 1);
          if (data.activeDepartment) {
            setActiveBusyDepartment(data.activeDepartment);
          }
          pollTimer = setTimeout(pollStatus, 1500);
        } else if (data.status === 'RUNNING' || data.status === 'PROCESSING') {
          // Seamless transition: It is now the user's turn!
          setIsQueued(false);
          setIsGeneratingAi(true);
          pollTimer = setTimeout(pollStatus, 1500);
        } else if (data.status === 'COMPLETED' && data.result) {
          setIsQueued(false);
          setIsGeneratingAi(false);
          setQueueJobId(null);
          const narrative = data.result.narrative;

          setReportContent(narrative);
          setReportType('ai');
          const cacheKey = getCacheKey('ai', selectedSpaceId, startDate, endDate);
          setReportsCache((prev) => ({
            ...prev,
            [cacheKey]: {
              content: narrative,
              generatedAt: data.result.generatedAt || new Date().toISOString(),
              type: 'ai',
            },
          }));
        } else if (data.status === 'FAILED') {
          setIsQueued(false);
          setIsGeneratingAi(false);
          setQueueJobId(null);
          setErrorMessage(data.error || 'AI report generation encountered an error.');
        } else if (data.status === 'CANCELLED') {
          setIsQueued(false);
          setIsGeneratingAi(false);
          setQueueJobId(null);
        } else {
          pollTimer = setTimeout(pollStatus, 2000);
        }
      } catch (err: any) {
        if (!active) return;
        console.warn('Queue status check error:', err);
        pollTimer = setTimeout(pollStatus, 2000);
      }
    };

    pollTimer = setTimeout(pollStatus, 1500);

    return () => {
      active = false;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [isOpen, queueJobId, selectedSpaceId, startDate, endDate, getCacheKey]);

  // Action: Generate AI Narrative Report via OpenCode CLI (with Cache Check & Force Option)
  const handleGenerateAiNarrative = async (force: boolean = false) => {
    const cacheKey = getCacheKey('ai', selectedSpaceId, startDate, endDate);

    // 1. In-Memory Cache Hit: Display instantaneously if already generated for these exact filters
    if (!force && reportsCache[cacheKey]) {
      setReportContent(reportsCache[cacheKey].content);
      setReportType('ai');
      setErrorMessage(null);
      return;
    }

    const myJobId = `ai_job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    setQueueJobId(myJobId);
    setIsGeneratingAi(true);
    setErrorMessage(null);

    try {
      const payload: { spaceId?: string; startDate: string; endDate: string; jobId: string } = {
        startDate,
        endDate,
        jobId: myJobId,
      };

      if (selectedSpaceId && selectedSpaceId !== 'all') {
        payload.spaceId = selectedSpaceId;
      }

      const res = await fetch('/api/admin/reports/ai-narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to synthesize AI narrative report.');
      }

      // If engine is busy and request was queued:
      if (data.busy) {
        setIsQueued(true);
        setIsGeneratingAi(false);
        setQueueJobId(data.jobId || myJobId);
        setQueuePosition(data.queuePosition || 1);
        setActiveBusyDepartment(data.activeDepartment || 'Another department');
        return;
      }

      // Completed generation synchronously
      setReportContent(data.narrative);
      setReportType('ai');
      setQueueJobId(null);

      // Store in memory cache
      setReportsCache((prev) => ({
        ...prev,
        [cacheKey]: {
          content: data.narrative,
          generatedAt: data.generatedAt || new Date().toISOString(),
          type: 'ai',
        },
      }));
    } catch (err: any) {
      console.error('AI report generation error:', err);
      setErrorMessage(err.message || 'An unexpected error occurred during OpenCode execution.');
      setQueueJobId(null);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  // Action: Generate Standard Local Deterministic Report (with Cache Check & Force Option)
  const handleGenerateStandard = async (force: boolean = false) => {
    const cacheKey = getCacheKey('standard', selectedSpaceId, startDate, endDate);

    // In-Memory Cache Hit
    if (!force && reportsCache[cacheKey]) {
      setReportContent(reportsCache[cacheKey].content);
      setReportType('standard');
      setErrorMessage(null);
      return;
    }

    setIsLoadingStandard(true);
    setErrorMessage(null);

    try {
      const targetSpace = selectedSpaceId !== 'all' ? selectedSpaceId : initialSpaceId || spacesList[0]?.id;
      if (!targetSpace) {
        throw new Error('Please select a specific space to compile standard table logs.');
      }

      const res = await fetch(`/api/spaces/${targetSpace}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate,
          mode: 'standard',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate standard department report.');
      }

      setReportContent(data.reportMarkdown);
      setReportType('standard');

      // Store in memory cache
      setReportsCache((prev) => ({
        ...prev,
        [cacheKey]: {
          content: data.reportMarkdown,
          generatedAt: new Date().toISOString(),
          type: 'standard',
        },
      }));
    } catch (err: any) {
      console.error('Standard report error:', err);
      setErrorMessage(err.message || 'Failed to generate standard report.');
    } finally {
      setIsLoadingStandard(false);
    }
  };

  // Copy Markdown to Clipboard
  const handleCopyMarkdown = async () => {
    if (!reportContent) return;
    try {
      await navigator.clipboard.writeText(reportContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  };

  // Dedicated PDF Export Handler
  const handleDownloadPdf = async () => {
    if (!reportContent || isBusy) return;

    const element = document.getElementById('report-printable-content');
    if (!element) {
      console.error('Printable report content container (#report-printable-content) not found.');
      return;
    }

    setIsDownloadingPdf(true);

    const departmentSlug =
      selectedSpaceId === 'all'
        ? 'organization-wide'
        : (currentSpaceMeta.key || currentSpaceMeta.name || 'department')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-');

    const filename = `AIO-Work-Management-Report-${departmentSlug}-${startDate}-to-${endDate}.pdf`;

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
      console.error('[DepartmentReportModal] PDF export failed:', err);
      handlePrint();
    } finally {
      element.classList.remove('report-pdf-export-mode');
      setIsDownloadingPdf(false);
    }
  };

  // Print Handler
  const handlePrint = () => {
    const originalTitle = document.title;
    try {
      document.title = `AIO Work Management System | L&K Industries — ${
        selectedSpaceId === 'all' ? 'Organization-Wide' : currentSpaceMeta.name
      } Report`;
      window.print();
    } finally {
      document.title = originalTitle;
    }
  };

  if (!isOpen || !mounted || typeof document === 'undefined') return null;

  const isBusy = isGeneratingAi || isLoadingStandard || isQueued;

  // Check if active view is loaded from memory cache
  const activeCacheKey = reportType ? getCacheKey(reportType, selectedSpaceId, startDate, endDate) : null;
  const isViewingCached = Boolean(activeCacheKey && reportsCache[activeCacheKey]?.content === reportContent);

  return createPortal(
    <div
      className="print-modal-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 sm:p-6 animate-in fade-in duration-150 print:p-0 print:bg-white print:static"
    >
      {/* Executive Print Stylesheet */}
      <style jsx global>{`
        @media print {
          /* Prevent modal containers from clipping multi-page printouts */
          html, body {
            background: #ffffff !important;
            height: auto !important;
            overflow: visible !important;
          }

          .print-modal-overlay,
          .print-modal-container,
          .print-modal-scroll {
            position: static !important;
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
            width: 100% !important;
          }

          /* Hide everything except the report content */
          body * {
            visibility: hidden;
          }
          #report-printable-content, #report-printable-content * {
            visibility: visible;
          }
          #report-printable-content {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: #ffffff !important;
            color: #111827 !important; /* Rich slate black */
            padding: 24px;
            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }
          /* Ensure headers, tables, and borders are crisp */
          h1, h2, h3, h4 {
            color: #0f172a !important;
            page-break-after: avoid;
          }
          table {
            width: 100% !important;
            border-collapse: collapse !important;
            margin: 16px 0 !important;
            page-break-inside: avoid;
          }
          th, td {
            border: 1px solid #e2e8f0 !important;
            padding: 8px 12px !important;
            color: #1e293b !important;
            background: transparent !important;
          }
          th {
            background-color: #f8fafc !important;
            font-weight: 600;
          }
          /* Prevent bad page splits */
          .report-section {
            page-break-inside: avoid;
            margin-bottom: 20px;
          }
          .executive-print-header {
            display: block !important;
            border-bottom: 2px solid #0f172a !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* DIALOG BOX */}
      <div
        className="print-modal-container relative flex flex-col w-full max-w-4xl max-h-[85vh] bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 text-zinc-100 print:max-w-none print:max-h-none print:border-none print:shadow-none print:bg-white print:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER (Hidden on Print) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-zinc-800 bg-zinc-900/60 shrink-0 print:hidden">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-100">
                  {isSuperadmin
                    ? 'Department Performance Report'
                    : `Department Performance Report • ${currentSpaceMeta.name}`}
                </h2>
                {reportType === 'ai' && (
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-950 border border-emerald-800 text-emerald-400 font-bold">
                      AI Narrative
                    </span>
                    {isViewingCached && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-zinc-800 border border-zinc-700 text-zinc-400">
                        Cached
                      </span>
                    )}
                  </div>
                )}
                {reportType === 'standard' && (
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-950 border border-indigo-800 text-indigo-400 font-bold">
                      Standard Log
                    </span>
                    {isViewingCached && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-zinc-800 border border-zinc-700 text-zinc-400">
                        Cached
                      </span>
                    )}
                  </div>
                )}
              </div>
              <p className="text-xs text-zinc-400">
                Performance metrics, SLA failure telemetry, and executive operational intelligence
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Superadmin Space Switcher */}
            {isSuperadmin && (
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-zinc-400 shrink-0" />
                <select
                  value={selectedSpaceId}
                  onChange={(e) => {
                    setSelectedSpaceId(e.target.value);
                  }}
                  disabled={isBusy}
                  className="bg-zinc-900 border border-zinc-700/80 rounded-lg px-2.5 py-1 text-xs text-zinc-200 font-medium focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-50"
                  aria-label="Department scope selection"
                >
                  <option value="all">Organization-Wide (All Departments)</option>
                  {spacesList.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name} ({sp.key})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(isQueued || isGeneratingAi) && (
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
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
              title="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* DATE CONTROLS TOOLBAR (Hidden on Print) */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-zinc-800/80 bg-zinc-900/40 shrink-0 print:hidden">
          <div className="flex items-center gap-1.5">
            {(['Last 7 Days', 'Last 30 Days', 'This Month'] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyPreset(preset)}
                disabled={isBusy}
                className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                  activePreset === preset
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Calendar className="w-3.5 h-3.5 text-zinc-500" />
            <label className="flex items-center gap-1.5">
              <span>From:</span>
              <input
                type="date"
                value={startDate}
                disabled={isBusy}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setActivePreset('custom');
                }}
                className="bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-1 text-zinc-200 text-xs [color-scheme:dark] focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span>To:</span>
              <input
                type="date"
                value={endDate}
                disabled={isBusy}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setActivePreset('custom');
                }}
                className="bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-1 text-zinc-200 text-xs [color-scheme:dark] focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
            </label>
          </div>
        </div>

        {/* SCROLLABLE REPORT BODY */}
        <div className="print-modal-scroll flex-1 overflow-y-auto p-6 min-h-[320px] text-xs leading-relaxed text-zinc-300 print:overflow-visible print:p-0">
          {errorMessage && (
            <div className="p-4 mb-4 rounded-xl bg-red-950/40 border border-red-800/80 text-red-200 text-xs flex items-start gap-2.5 print:hidden">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 flex-1">
                <div className="font-semibold text-red-300">Report Synthesis Error</div>
                <div className="leading-relaxed text-red-200/90">{errorMessage}</div>
              </div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="p-1 text-red-400 hover:text-red-200 rounded cursor-pointer"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* AI Executive Narrative Coming Soon State */}
          {(isGeneratingAi || isQueued || reportType === 'ai') && !reportContent && (
            <div className="h-72 flex flex-col items-center justify-center gap-3 text-center px-6 py-8 rounded-2xl bg-slate-50/80 border border-slate-200 dark:bg-zinc-900/40 dark:border-zinc-800/80 my-4 animate-in fade-in print:hidden">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-400">
                COMING SOON
              </span>
              <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 flex items-center justify-center text-blue-600 dark:text-blue-400 shadow-sm">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                AI Executive Narrative — Coming Soon
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-md leading-relaxed">
                Automated root-cause synthesis and AI-driven operational narratives are currently disabled. Use Generate Standard Report below to view and export full Department Telemetry &amp; SLA compliance metrics immediately.
              </p>
            </div>
          )}

          {/* Standard Report Loading Indicator */}
          {isLoadingStandard && (
            <div className="h-64 flex flex-col items-center justify-center gap-3 text-zinc-400 text-center animate-in fade-in print:hidden">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
              <p className="text-xs font-medium text-zinc-200">
                Compiling deterministic departmental audit for {startDate} – {endDate}...
              </p>
            </div>
          )}

          {/* Rendered Markdown Report & Printable Area */}
          {!isBusy && reportContent && (
            <div
              id="report-printable-content"
              className="bg-zinc-900/30 border border-zinc-800/60 rounded-xl p-6 shadow-inner print:bg-white print:border-none print:shadow-none print:p-0"
            >
              {/* Executive Printable Header */}
              <div className="executive-print-header mb-6 pb-4 border-b-2 border-zinc-700/80 print:border-slate-900">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider font-bold text-indigo-400 print:text-slate-600 font-mono flex items-center gap-1.5 flex-wrap">
                      <span>AIO WORK MANAGEMENT SYSTEM</span>
                      <span>•</span>
                      <span>L&amp;K INDUSTRIES PHIL, INC.</span>
                      <span>•</span>
                      <span>OPERATIONS AUDIT REPORT</span>
                    </div>
                    <h1 className="text-xl font-bold text-zinc-100 print:text-slate-950 mt-1">
                      {selectedSpaceId === 'all'
                        ? 'Organization-Wide Performance Narrative'
                        : `${currentSpaceMeta.name} (${currentSpaceMeta.key}) — Department Audit`}
                    </h1>
                    <div className="text-xs text-zinc-400 print:text-slate-700 mt-1 flex items-center gap-2 flex-wrap">
                      <span>
                        Scope:{' '}
                        <strong className="text-zinc-200 print:text-slate-900 font-semibold">
                          {selectedSpaceId === 'all' ? 'Organization-Wide' : currentSpaceMeta.name}
                        </strong>
                      </span>
                      <span className="text-zinc-600 print:text-slate-400">•</span>
                      <span>
                        Reporting Window:{' '}
                        <strong className="text-zinc-200 print:text-slate-900 font-semibold">
                          {startDate} to {endDate}
                        </strong>
                      </span>
                    </div>
                  </div>
                  <div className="text-left sm:text-right text-[11px] text-zinc-400 print:text-slate-600 shrink-0">
                    <div>
                      Generated:{' '}
                      <span className="font-medium text-zinc-200 print:text-slate-900 font-mono">
                        {generationTimestamp || new Date().toLocaleString()}
                      </span>
                    </div>
                    <div className="font-mono text-zinc-300 print:text-slate-800 mt-0.5 font-semibold">
                      {reportType === 'ai' ? 'Engine: AI Analytics Engine' : 'Engine: Deterministic Audit Log'}
                    </div>
                    <div className="text-[9px] uppercase tracking-wider text-zinc-500 print:text-slate-500 mt-1 font-semibold">
                      CONFIDENTIAL • INTERNAL LEADERSHIP ONLY
                    </div>
                  </div>
                </div>
              </div>

              <MarkdownRenderer content={reportContent} />
            </div>
          )}

          {/* Empty State */}
          {!isBusy && !reportContent && !errorMessage && (
            <div className="h-64 flex flex-col items-center justify-center text-center text-zinc-500 print:hidden">
              <FileText className="w-10 h-10 mb-2 opacity-30" />
              <p className="font-medium text-zinc-400">No report generated yet</p>
              <p className="text-xs text-zinc-500 mt-1">
                Select your desired date interval above and click &quot;AI Narrative&quot; or &quot;Generate Standard Report&quot;.
              </p>
            </div>
          )}
        </div>

        {/* PINNED FOOTER (Hidden on Print) */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur shrink-0 print:hidden flex-wrap md:flex-nowrap">
          {/* Left Zone — Dismissal */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              Close
            </button>
          </div>

          {/* Center Zone — Export & Utility Group */}
          {reportContent ? (
            <div className="flex items-center gap-1.5 p-1 bg-zinc-900/80 border border-zinc-800/80 rounded-lg">
              {/* Copy Markdown */}
              <button
                type="button"
                onClick={handleCopyMarkdown}
                disabled={isBusy}
                className="flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white px-3 py-1.5 rounded-md hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50"
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
                disabled={isBusy || isDownloadingPdf}
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
                disabled={isBusy || isDownloadingPdf}
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

          {/* Right Zone — Report Actions & Switching */}
          <div className="flex items-center gap-2">
            {/* Regenerate Button */}
            {reportContent && (
              <button
                type="button"
                onClick={() => {
                  if (reportType === 'ai') handleGenerateAiNarrative(true);
                  else handleGenerateStandard(true);
                }}
                disabled={isBusy}
                className="p-2 text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center"
                title="Regenerate Analysis"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-zinc-400 hover:text-white transition-colors ${isBusy ? 'animate-spin' : ''}`} />
              </button>
            )}

            {/* AI Narrative (Disabled / Coming Soon) */}
            <button
              type="button"
              disabled={true}
              className="font-medium text-xs px-3.5 py-2 rounded-lg bg-slate-100 text-slate-400 border border-slate-200 dark:bg-zinc-900/60 dark:text-zinc-500 dark:border-zinc-800 cursor-not-allowed flex items-center gap-1.5 opacity-60"
              title="AI Executive Narrative Engine is coming soon"
            >
              <Sparkles className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500" />
              <span>AI Narrative (Coming Soon)</span>
            </button>

            {/* Standard Report Trigger (Primary Active Blue Button) */}
            <button
              type="button"
              onClick={() => handleGenerateStandard(false)}
              disabled={isBusy}
              className="font-semibold text-xs px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-600/20 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              title="Generate full department telemetry and SLA report"
            >
              {isLoadingStandard ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-white" />
              )}
              <span>Generate Standard Report</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
