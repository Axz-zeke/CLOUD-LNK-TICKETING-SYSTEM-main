'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Building,
  Folder,
  Layers,
  Shield,
  Cpu,
  Wrench,
  Briefcase,
  Scale,
  Terminal,
  HeartHandshake,
  Plus,
  Trash2,
  AlertCircle,
  Loader2,
  Check,
  CheckCircle2,
  Users,
  Palette,
  Workflow,
  Sparkles,
} from 'lucide-react';
import { AuthenticatedUser } from '@/lib/security/rbac';

interface CreateSpaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSpaceCreated?: (space: any) => void;
  currentUser: AuthenticatedUser;
}

interface StaffUserOption {
  id: string;
  name: string;
  username: string;
  email: string;
  globalRole: string;
}

const COLOR_OPTIONS = [
  { label: 'Blue', value: '#3B82F6', ring: 'ring-blue-500', bg: 'bg-blue-500' },
  { label: 'Emerald', value: '#10B981', ring: 'ring-emerald-500', bg: 'bg-emerald-500' },
  { label: 'Amber', value: '#F59E0B', ring: 'ring-amber-500', bg: 'bg-amber-500' },
  { label: 'Purple', value: '#8B5CF6', ring: 'ring-purple-500', bg: 'bg-purple-500' },
  { label: 'Rose', value: '#F43F5E', ring: 'ring-rose-500', bg: 'bg-rose-500' },
  { label: 'Cyan', value: '#06B6D4', ring: 'ring-cyan-500', bg: 'bg-cyan-500' },
  { label: 'Indigo', value: '#6366F1', ring: 'ring-indigo-500', bg: 'bg-indigo-500' },
  { label: 'Orange', value: '#F97316', ring: 'ring-orange-500', bg: 'bg-orange-500' },
];

const ICON_OPTIONS = [
  { name: 'Building', icon: Building, label: 'Department' },
  { name: 'Folder', icon: Folder, label: 'Folder' },
  { name: 'Layers', icon: Layers, label: 'Layers' },
  { name: 'Shield', icon: Shield, label: 'Security' },
  { name: 'Cpu', icon: Cpu, label: 'Tech / Infra' },
  { name: 'Wrench', icon: Wrench, label: 'Operations' },
  { name: 'Briefcase', icon: Briefcase, label: 'Executive' },
  { name: 'Scale', icon: Scale, label: 'Legal / Compliance' },
  { name: 'Terminal', icon: Terminal, label: 'DevOps / Code' },
  { name: 'HeartHandshake', icon: HeartHandshake, label: 'HR / Support' },
];

const STATUS_PRESETS = [
  {
    id: 'standard',
    name: 'Standard 5-Stage',
    description: 'Best for General IT, Helpdesk & Enterprise Ops',
    chips: [
      { name: 'Open', color: '#3B82F6' },
      { name: 'In Progress', color: '#F59E0B' },
      { name: 'Pending User', color: '#8B5CF6' },
      { name: 'Resolved', color: '#10B981' },
      { name: 'Closed', color: '#6B7280' },
    ],
  },
  {
    id: 'simple',
    name: 'Simple 3-Stage',
    description: 'Fast Kanban triage: To Do, In Progress, Done',
    chips: [
      { name: 'To Do', color: '#3B82F6' },
      { name: 'In Progress', color: '#F59E0B' },
      { name: 'Done', color: '#10B981' },
    ],
  },
  {
    id: 'bug',
    name: 'Bug / Incident Tracking',
    description: 'Engineered for defects and software tickets',
    chips: [
      { name: 'Reported', color: '#EF4444' },
      { name: 'Triaged', color: '#8B5CF6' },
      { name: 'In Fix', color: '#F59E0B' },
      { name: 'Verified', color: '#10B981' },
    ],
  },
];

export function CreateSpaceModal({
  isOpen,
  onClose,
  onSpaceCreated,
  currentUser,
}: CreateSpaceModalProps) {
  // Form State
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [isKeyManuallyEdited, setIsKeyManuallyEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [selectedColor, setSelectedColor] = useState('#3B82F6');
  const [selectedIcon, setSelectedIcon] = useState('Building');

  // Lists state
  const [lists, setLists] = useState<string[]>(['General Inquiries', 'Urgent Requests']);
  const [newListName, setNewListName] = useState('');

  // Workflow preset
  const [selectedPreset, setSelectedPreset] = useState<'standard' | 'simple' | 'bug'>('standard');

  // Staff members selection
  const [availableStaff, setAvailableStaff] = useState<StaffUserOption[]>([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);

  // Reset form upon open transition
  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      setName('');
      setKey('');
      setIsKeyManuallyEdited(false);
      setDescription('');
      setSelectedColor('#3B82F6');
      setSelectedIcon('Building');
      setLists(['General Inquiries', 'Urgent Requests']);
      setNewListName('');
      setSelectedPreset('standard');
      setSelectedStaffIds([]);
      setErrorMessage(null);

      // Focus name input
      setTimeout(() => nameInputRef.current?.focus(), 50);

      // Fetch active staff users
      fetchStaffMembers();
    }
  }, [isOpen]);

  const fetchStaffMembers = async () => {
    setLoadingStaff(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        const users: StaffUserOption[] = (data.users || []).filter(
          (u: any) => u.isActive && u.id !== currentUser.id && u.username !== 'boss_user'
        );
        setAvailableStaff(users);
      }
    } catch {
      // Non-blocking in case admin endpoint fails
    } finally {
      setLoadingStaff(false);
    }
  };

  // Auto-generate key abbreviation from name
  const handleNameChange = (val: string) => {
    setName(val);
    if (!isKeyManuallyEdited) {
      const words = val.trim().split(/\s+/);
      let autoKey = '';
      if (words.length >= 2) {
        autoKey = words
          .slice(0, 3)
          .map((w) => w[0])
          .join('')
          .toUpperCase();
      } else if (val.trim().length > 0) {
        autoKey = val
          .trim()
          .substring(0, 3)
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
      }
      setKey(autoKey);
    }
  };

  // Add list queue item
  const handleAddList = () => {
    const trimmed = newListName.trim();
    if (!trimmed) return;
    if (lists.includes(trimmed)) {
      setErrorMessage(`Queue list '${trimmed}' is already in the list.`);
      return;
    }
    setLists((prev) => [...prev, trimmed]);
    setNewListName('');
    setErrorMessage(null);
  };

  // Remove list queue item
  const handleRemoveList = (index: number) => {
    if (lists.length <= 1) {
      setErrorMessage('A space must have at least one queue list.');
      return;
    }
    setLists((prev) => prev.filter((_, idx) => idx !== index));
    setErrorMessage(null);
  };

  // Toggle staff member clearance checkbox
  const handleToggleStaff = (userId: string) => {
    setSelectedStaffIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  // Form submit handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedName = name.trim();
    const trimmedKey = key.trim().toUpperCase();

    if (!trimmedName) {
      setErrorMessage('Please provide a Department Space name.');
      nameInputRef.current?.focus();
      return;
    }

    if (!trimmedKey || trimmedKey.length < 2 || trimmedKey.length > 8) {
      setErrorMessage('Space key prefix must be between 2 and 8 uppercase characters (e.g. FAC, LEG, QA).');
      return;
    }

    // Auto-commit any non-empty text currently typed into the queue list input
    const committedLists = [...lists];
    const uncommittedQueue = newListName.trim();
    if (uncommittedQueue && !committedLists.includes(uncommittedQueue)) {
      committedLists.push(uncommittedQueue);
      setLists(committedLists);
      setNewListName('');
    }

    if (committedLists.length === 0) {
      committedLists.push('General Inquiries');
      setLists(committedLists);
    }

    setIsSubmitting(true);

    try {
      const res = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          key: trimmedKey,
          description: description.trim() || null,
          color: selectedColor,
          icon: selectedIcon,
          lists: committedLists,
          queues: committedLists,
          statusPreset: selectedPreset,
          memberUserIds: selectedStaffIds,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create new Space.');
      }

      onClose();
      onSpaceCreated?.(data.space);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error creating Space.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const ActiveIconComponent =
    ICON_OPTIONS.find((i) => i.name === selectedIcon)?.icon || Building;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg border flex items-center justify-center text-white shadow-sm"
              style={{
                backgroundColor: selectedColor,
                borderColor: `${selectedColor}99`,
              }}
            >
              <ActiveIconComponent className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                Create Department Space
                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
                  Superadmin
                </span>
              </h3>
              <p className="text-[11px] text-zinc-400">
                Provision a dynamic department workspace with isolated ticket queues & statuses
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3 bg-red-950/60 border border-red-800 rounded-lg text-xs text-red-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 1. Space Identity Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5 text-zinc-400" />
                Space Name <span className="text-red-400">*</span>
              </label>
              <input
                ref={nameInputRef}
                type="text"
                placeholder="e.g. Facilities, Quality Assurance, Legal"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                <span>Key Prefix <span className="text-red-400">*</span></span>
                <span className="text-[10px] text-zinc-500 font-mono">e.g. {key || 'FAC'}-101</span>
              </label>
              <input
                type="text"
                placeholder="FAC"
                maxLength={8}
                value={key}
                onChange={(e) => {
                  setIsKeyManuallyEdited(true);
                  setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''));
                }}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono uppercase font-bold text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">
              Department Description <span className="text-zinc-500 font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Physical office repairs, logistics, building maintenance and fleet operations"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* 2. Color & Icon Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1 border-t border-zinc-800/80">
            {/* Color Palette */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-zinc-400" />
                Accent Color
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.label}
                    onClick={() => setSelectedColor(c.value)}
                    className={`w-7 h-7 rounded-lg transition-transform ${c.bg} flex items-center justify-center cursor-pointer ${
                      selectedColor === c.value
                        ? 'ring-2 ring-white scale-110 shadow-md'
                        : 'opacity-80 hover:opacity-100'
                    }`}
                  >
                    {selectedColor === c.value && <Check className="w-3.5 h-3.5 text-white" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Icon Picker */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
                Icon Symbol
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                {ICON_OPTIONS.map((ico) => {
                  const IconComp = ico.icon;
                  const isSelected = selectedIcon === ico.name;
                  return (
                    <button
                      key={ico.name}
                      type="button"
                      title={ico.label}
                      onClick={() => setSelectedIcon(ico.name)}
                      className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-zinc-800 border-zinc-600 text-white'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                      }`}
                    >
                      <IconComp className="w-4 h-4" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 3. Queue Lists Configuration */}
          <div className="space-y-2.5 pt-2 border-t border-zinc-800/80">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-zinc-400" />
                Queue Lists ({lists.length})
              </label>
              <span className="text-[11px] text-zinc-500">Tickets will be categorized into these queues</span>
            </div>

            {/* Existing Lists Chips */}
            <div className="flex flex-wrap gap-2">
              {lists.map((l, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-800 border border-zinc-700 text-xs text-zinc-200"
                >
                  <span className="text-[10px] text-zinc-500 font-mono">#{idx + 1}</span>
                  <span>{l}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveList(idx)}
                    className="text-zinc-400 hover:text-red-400 transition-colors cursor-pointer ml-1"
                    title={`Remove ${l}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add list input */}
            <div className="flex items-center gap-2 max-w-md">
              <input
                type="text"
                placeholder="New queue list name (e.g. Preventive Maintenance)"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddList();
                  }
                }}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={handleAddList}
                className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </div>

          {/* 4. Workflow Status Presets */}
          <div className="space-y-2.5 pt-2 border-t border-zinc-800/80">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Workflow className="w-3.5 h-3.5 text-zinc-400" />
                Workflow Status Lifecycle
              </label>
              <span className="text-[11px] text-zinc-500">Pre-configured Kanban progression</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {STATUS_PRESETS.map((preset) => {
                const isSelected = selectedPreset === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => setSelectedPreset(preset.id as any)}
                    className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-zinc-800/90 border-blue-500/80 ring-1 ring-blue-500/40'
                        : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-zinc-100">{preset.name}</span>
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
                    </div>
                    <p className="text-[10px] text-zinc-400 mb-2 leading-relaxed">
                      {preset.description}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {preset.chips.map((chip, cIdx) => (
                        <span
                          key={cIdx}
                          className="text-[9px] px-1.5 py-0.5 rounded font-mono font-medium"
                          style={{
                            backgroundColor: `${chip.color}25`,
                            color: chip.color,
                            border: `1px solid ${chip.color}50`,
                          }}
                        >
                          {chip.name}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 5. Initial Staff Clearances */}
          <div className="space-y-2.5 pt-2 border-t border-zinc-800/80">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-zinc-400" />
                Initial Department Members
              </label>
              <span className="text-[10px] text-zinc-400 bg-zinc-800/60 px-2 py-0.5 rounded border border-zinc-700/60">
                You ({currentUser.username}) & The Boss are auto-assigned
              </span>
            </div>

            {loadingStaff ? (
              <div className="py-4 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Loading available staff members...</span>
              </div>
            ) : availableStaff.length === 0 ? (
              <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-500 italic">
                No other active staff agents found. You can add users anytime from the Admin Panel.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
                {availableStaff.map((staff) => {
                  const isChecked = selectedStaffIds.includes(staff.id);
                  return (
                    <label
                      key={staff.id}
                      className={`flex items-center gap-2.5 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                        isChecked
                          ? 'bg-zinc-800/80 border-zinc-600 text-zinc-100'
                          : 'bg-zinc-950 border-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleStaff(staff.id)}
                        className="rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{staff.name}</div>
                        <div className="text-[10px] text-zinc-500 font-mono truncate">
                          @{staff.username} • {staff.globalRole}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 bg-zinc-950/60 shrink-0">
          <div className="text-[11px] text-zinc-500 font-mono">
            {key ? `Prefix: ${key}-*` : 'Pending key selection'}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Provisioning Space...</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Space</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
