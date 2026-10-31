'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Compass,
  ChevronLeft,
  ChevronRight,
  X,
  Sparkles,
  Check,
  Layers,
  LayoutGrid,
  Search,
  Plus,
  Clock,
  User,
  Calendar,
  Sun,
  LayoutList,
  Kanban,
  CalendarRange,
  LayoutDashboard,
} from 'lucide-react';

export interface TourStep {
  selector: string;
  fallbackSelector?: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  preferredPlacement?: 'right' | 'bottom' | 'top' | 'left';
}

const TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="sidebar-spaces"]',
    fallbackSelector: 'aside',
    title: 'Department Spaces & Queues',
    description:
      'Navigate isolated department queues (Accounting, Facilities, HR, MIS, Purchasing, QA, Safety) or review cross-department handoffs in "Collaborated" and global overview in "Everything".',
    icon: Layers,
    preferredPlacement: 'right',
  },
  {
    selector: '[data-tour="view-toggle"]',
    fallbackSelector: 'header',
    title: '4-Mode Workspace Views',
    description:
      'Seamlessly switch across List (high-density table), Board (dynamic 5/6-column Kanban), Gantt (single-canvas roadmap timeline), and Dashboard (real-time KPIs & risk analytics).',
    icon: LayoutGrid,
    preferredPlacement: 'bottom',
  },
  {
    selector: '[data-tour="search-filter-bar"]',
    fallbackSelector: 'input[type="text"]',
    title: 'Instant Search (⌘K) & Smart Triage',
    description:
      'Instantly filter tickets by key (e.g. MIS-101), title, priority tier, status lifecycle, or assigned staff member with zero page reloads.',
    icon: Search,
    preferredPlacement: 'bottom',
  },
  {
    selector: '[data-tour="date-filter"]',
    fallbackSelector: '[data-tour="search-filter-bar"]',
    title: 'Historical Date Range Filter',
    description:
      'Access historical tickets with quick presets (Today, Last 7/30/90 Days, This Year) or pick custom From/To ranges in the integrated 2-column calendar.',
    icon: Calendar,
    preferredPlacement: 'bottom',
  },
  {
    selector: '[data-tour="add-ticket-btn"]',
    fallbackSelector: 'button',
    title: 'Create Ticket & Cross-Department Intake',
    description:
      'Submit new requests, incidents, or procurement needs across any department with subtask checklists, LAN disk attachments, and target priority.',
    icon: Plus,
    preferredPlacement: 'bottom',
  },
  {
    selector: '[data-tour="ai-report-btn"]',
    fallbackSelector: 'header',
    title: 'Executive AI Activity Report',
    description:
      'Department Leads and Superadmins can generate synthesized narrative audit summaries with executive print and PDF export capabilities.',
    icon: Sparkles,
    preferredPlacement: 'bottom',
  },
  {
    selector: '[data-tour="theme-toggle"]',
    fallbackSelector: 'header',
    title: 'Dual Theme Engine',
    description:
      'Instantly toggle between high-contrast Dark Mode and the eye-friendly Soft Daylight Light Mode (#E2E6EE shell & #EAEEF4 canvas) with zero white glare.',
    icon: Sun,
    preferredPlacement: 'bottom',
  },
  {
    selector: '[data-tour="user-profile"]',
    fallbackSelector: 'aside footer',
    title: 'User Profile & System Settings',
    description:
      'Inspect your active role badge (Superadmin, Lead, Staff), adjust personal preferences, Kanban board density, or access administrative management panels.',
    icon: User,
    preferredPlacement: 'top',
  },
];

interface WorkspaceTourProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export function WorkspaceTour({
  isOpen,
  onClose,
  onComplete,
}: WorkspaceTourProps) {
  const [mounted, setMounted] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  const [targetFound, setTargetFound] = useState(true);

  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset to first step whenever tour opens
  useEffect(() => {
    if (isOpen) {
      setCurrentStepIndex(0);
    }
  }, [isOpen]);

  const currentStep = TOUR_STEPS[currentStepIndex];

  // Locate active element and calculate spotlight box
  const updateSpotlight = useCallback(() => {
    if (!isOpen || !currentStep) return;

    let target = document.querySelector(currentStep.selector) as HTMLElement | null;
    if (!target && currentStep.fallbackSelector) {
      target = document.querySelector(currentStep.fallbackSelector) as HTMLElement | null;
    }

    if (target) {
      setTargetFound(true);
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

      // Slight delay to allow smooth scrolling to settle
      const rect = target.getBoundingClientRect();
      setSpotlightRect(rect);
    } else {
      setTargetFound(false);
      setSpotlightRect(null);
    }
  }, [isOpen, currentStep]);

  useEffect(() => {
    updateSpotlight();

    const handleResize = () => updateSpotlight();
    const handleScroll = () => updateSpotlight();

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [updateSpotlight]);

  const handleNext = () => {
    if (currentStepIndex < TOUR_STEPS.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      onComplete();
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentStepIndex, handleNext, handlePrev, onClose]);

  const [viewportSize, setViewportSize] = useState({ width: 1920, height: 1080 });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const updateSize = () => {
        setViewportSize({ width: window.innerWidth, height: window.innerHeight });
      };
      updateSize();
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }
  }, []);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (spotlightRect) {
      const pad = 6;
      const x = e.clientX;
      const y = e.clientY;
      const isInsideCutout =
        x >= spotlightRect.left - pad &&
        x <= spotlightRect.right + pad &&
        y >= spotlightRect.top - pad &&
        y <= spotlightRect.bottom + pad;
      if (isInsideCutout) {
        // Click was inside the target spotlight area; do not dismiss tour
        return;
      }
    }
    onClose();
  };

  if (!isOpen || !mounted || typeof document === 'undefined') return null;

  // Calculate tooltip coordinates based on spotlightRect
  const getTooltipStyle = (): React.CSSProperties => {
    const margin = 14;
    const tooltipWidth = 340;
    const tooltipHeight = 220;

    if (!spotlightRect) {
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      };
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = 0;
    let left = 0;

    const placement = currentStep.preferredPlacement || 'bottom';

    if (placement === 'right') {
      left = spotlightRect.right + margin;
      top = Math.max(margin, Math.min(spotlightRect.top, viewportHeight - tooltipHeight - margin));

      // Flip to left if overflowing right edge
      if (left + tooltipWidth > viewportWidth - margin) {
        left = Math.max(margin, spotlightRect.left - tooltipWidth - margin);
      }
    } else if (placement === 'top') {
      top = spotlightRect.top - tooltipHeight - margin;
      left = Math.max(
        margin,
        Math.min(spotlightRect.left + (spotlightRect.width - tooltipWidth) / 2, viewportWidth - tooltipWidth - margin)
      );

      // Flip to bottom if overflowing top edge
      if (top < margin) {
        top = spotlightRect.bottom + margin;
      }
    } else {
      // 'bottom' default
      top = spotlightRect.bottom + margin;
      left = Math.max(
        margin,
        Math.min(spotlightRect.left + (spotlightRect.width - tooltipWidth) / 2, viewportWidth - tooltipWidth - margin)
      );

      // Flip to top if overflowing bottom edge
      if (top + tooltipHeight > viewportHeight - margin) {
        top = Math.max(margin, spotlightRect.top - tooltipHeight - margin);
      }
    }

    return {
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    };
  };

  const StepIcon = currentStep.icon;
  const isLastStep = currentStepIndex === TOUR_STEPS.length - 1;

  const pad = 6;
  const cutout = spotlightRect
    ? {
        top: Math.max(0, spotlightRect.top - pad),
        left: Math.max(0, spotlightRect.left - pad),
        width: spotlightRect.width + pad * 2,
        height: spotlightRect.height + pad * 2,
      }
    : null;

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-hidden pointer-events-none">
      {/* 1. SVG Mask Definition: Punches a clear rectangular hole through blur and dimming */}
      <svg
        className="fixed inset-0 w-full h-full pointer-events-none"
        style={{ width: '100vw', height: '100vh', zIndex: 99 }}
        aria-hidden="true"
      >
        <defs>
          <mask id="spotlight-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
            {/* White base: full-screen mask where blur + dim overlay remains visible */}
            <rect
              x="0"
              y="0"
              width={viewportSize.width || '100%'}
              height={viewportSize.height || '100%'}
              fill="white"
            />
            {/* Black cutout: fully transparent hole where target element remains crisp & unblurred */}
            {cutout && (
              <rect
                x={cutout.left}
                y={cutout.top}
                width={cutout.width}
                height={cutout.height}
                rx={8}
                ry={8}
                fill="black"
                style={{ transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
              />
            )}
          </mask>
        </defs>
      </svg>

      {/* 2. Blurred & Dimmed Backdrop Overlay with SVG Mask Cutout */}
      <div
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-[3px] transition-all duration-300 pointer-events-auto"
        style={{
          mask: 'url(#spotlight-mask)',
          WebkitMask: 'url(#spotlight-mask)',
          maskImage: 'url(#spotlight-mask)',
          WebkitMaskImage: 'url(#spotlight-mask)',
        } as React.CSSProperties}
        onClick={handleBackdropClick}
      />

      {/* 3. Active Spotlight Highlight Ring around Cutout */}
      {cutout && (
        <div
          className="fixed pointer-events-none rounded-xl border-2 border-blue-400 dark:border-blue-400/90 shadow-[0_0_20px_rgba(59,130,246,0.35)] z-[101]"
          style={{
            top: `${cutout.top}px`,
            left: `${cutout.left}px`,
            width: `${cutout.width}px`,
            height: `${cutout.height}px`,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div className="absolute -inset-1 rounded-xl bg-blue-500/10 animate-pulse pointer-events-none" />
        </div>
      )}

      {/* 4. Floating Tooltip Card */}
      <div
        ref={tooltipRef}
        style={getTooltipStyle()}
        className="fixed z-[105] pointer-events-auto w-[340px] max-w-[calc(100vw-32px)] bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-5 text-zinc-900 dark:text-zinc-100 animate-in fade-in zoom-in-95 duration-200 select-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-zinc-800/80">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200 dark:border-blue-800/80">
              Step {currentStepIndex + 1} of {TOUR_STEPS.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Close Tour (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="pt-3.5 pb-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/60 flex items-center justify-center shrink-0">
              <StepIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 leading-snug">
              {currentStep.title}
            </h3>
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed pl-9">
            {currentStep.description}
          </p>
        </div>

        {/* Step Progress Dots */}
        <div className="flex items-center justify-center gap-1.5 pb-3">
          {TOUR_STEPS.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentStepIndex(idx)}
              className={`h-1.5 rounded-full transition-all cursor-pointer ${
                idx === currentStepIndex
                  ? 'w-6 bg-blue-600 dark:bg-blue-500'
                  : 'w-1.5 bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700'
              }`}
              title={`Go to step ${idx + 1}`}
            />
          ))}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-zinc-800/80">
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 font-medium px-2 py-1.5 rounded-md hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            Skip Tour
          </button>

          <div className="flex items-center gap-2">
            {currentStepIndex > 0 && (
              <button
                type="button"
                onClick={handlePrev}
                className="px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleNext}
              className="px-3.5 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>{isLastStep ? 'Finish' : 'Next'}</span>
              {isLastStep ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
