'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Building,
  Crown,
  Users,
  Search,
  Check,
  AlertCircle,
  Loader2,
  Shield,
  Layers,
  User as UserIcon,
  CheckSquare,
  Square,
  Clock,
} from 'lucide-react';

interface SpaceData {
  id: string;
  name: string;
  key: string;
  description?: string | null;
  color?: string;
  icon?: string;
  departmentHeadId?: string | null;
  departmentHead?: {
    id: string;
    name: string;
    username: string;
    email: string;
  } | null;
  members?: Array<{
    id?: string;
    userId: string;
    role?: string;
  }>;
}

interface UserData {
  id: string;
  username: string;
  name: string;
  email: string;
  globalRole: 'SUPERADMIN' | 'ADMIN' | 'EMPLOYEE';
  isActive: boolean;
  spaceMemberships?: Array<{
    spaceId: string;
  }>;
}

interface ManageDepartmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  space: SpaceData | null;
  users: UserData[];
  onSaved: () => void;
}

export function ManageDepartmentModal({
  isOpen,
  onClose,
  space,
  users,
  onSaved,
}: ManageDepartmentModalProps) {
  const [selectedHeadId, setSelectedHeadId] = useState<string>('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [slaForm, setSlaForm] = useState({
    urgentHours: 4,
    highHours: 24,
    normalHours: 72,
    lowHours: 120,
  });

  // Eligible department heads: active users with ADMIN or SUPERADMIN role
  const eligibleHeads = useMemo(() => {
    return users.filter(
      (u) => u.isActive && (u.globalRole === 'ADMIN' || u.globalRole === 'SUPERADMIN')
    );
  }, [users]);

  // Initialize form state when space opens
  useEffect(() => {
    if (!isOpen || !space) return;

    setError(null);
    setSelectedHeadId(space.departmentHeadId || space.departmentHead?.id || '');

    // Existing space member IDs
    const initialMemberIds = new Set<string>();
    if (space.members && space.members.length > 0) {
      space.members.forEach((m) => initialMemberIds.add(m.userId));
    } else {
      // Fallback: check users who hold space membership
      users.forEach((u) => {
        if (u.spaceMemberships?.some((sm) => sm.spaceId === space.id)) {
          initialMemberIds.add(u.id);
        }
      });
    }

    // Ensure current head is in members
    if (space.departmentHeadId) {
      initialMemberIds.add(space.departmentHeadId);
    } else if (space.departmentHead?.id) {
      initialMemberIds.add(space.departmentHead.id);
    }

    setSelectedMemberIds(initialMemberIds);
    setMemberSearchQuery('');

    // Fetch existing SLA policy for this space
    fetch(`/api/spaces/${space.id}/sla`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.policy) {
          setSlaForm({
            urgentHours: data.policy.urgentHours,
            highHours: data.policy.highHours,
            normalHours: data.policy.normalHours,
            lowHours: data.policy.lowHours,
          });
        }
      })
      .catch(() => {});
  }, [isOpen, space, users]);

  // When selectedHeadId changes, ensure that user is added to selectedMemberIds
  useEffect(() => {
    if (selectedHeadId) {
      setSelectedMemberIds((prev) => {
        const next = new Set(prev);
        next.add(selectedHeadId);
        return next;
      });
    }
  }, [selectedHeadId]);

  if (!isOpen || !space) return null;

  const currentHeadUser = users.find(
    (u) => u.id === (space.departmentHeadId || space.departmentHead?.id)
  );

  const toggleMember = (userId: string) => {
    // If this user is currently designated as the head, they cannot be unselected
    if (userId === selectedHeadId) return;

    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const handleSelectAllFiltered = (filteredList: UserData[]) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      filteredList.forEach((u) => next.add(u.id));
      if (selectedHeadId) next.add(selectedHeadId);
      return next;
    });
  };

  const handleDeselectAllFiltered = (filteredList: UserData[]) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      filteredList.forEach((u) => {
        // Keep head checked
        if (u.id !== selectedHeadId) {
          next.delete(u.id);
        }
      });
      return next;
    });
  };

  const filteredUsers = users.filter((u) => {
    if (!memberSearchQuery) return true;
    const q = memberSearchQuery.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.globalRole.toLowerCase().includes(q)
    );
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const payload = {
        departmentHeadId: selectedHeadId ? selectedHeadId : null,
        memberUserIds: Array.from(selectedMemberIds),
      };

      const res = await fetch(`/api/spaces/${space.id}/management`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update department management.');
      }

      // Save SLA thresholds concurrently
      await fetch(`/api/spaces/${space.id}/sla`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slaForm),
      }).catch(() => {});

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred while saving.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <span
              className="w-10 h-10 rounded-xl text-sm font-mono font-bold flex items-center justify-center shrink-0 border"
              style={{
                backgroundColor: space.color ? `${space.color}25` : '#27272a',
                borderColor: space.color ? `${space.color}70` : '#3f3f46',
                color: space.color || '#e4e4e7',
              }}
            >
              {space.key}
            </span>
            <div>
              <h2 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                <span>Manage Staff & Department Head</span>
              </h2>
              <p className="text-xs text-zinc-400">
                Configure queue operators and leadership for <strong className="text-zinc-200">{space.name}</strong> ({space.key})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3.5 rounded-xl bg-red-950/70 border border-red-800 text-red-200 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* SECTION 1: DEPARTMENT HEAD DESIGNATION */}
          <div className="space-y-3 bg-zinc-900/60 p-4 rounded-xl border border-zinc-800">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                <Crown className="w-4 h-4 text-amber-400" />
                <span>Department Head (Lead)</span>
              </label>
              {currentHeadUser ? (
                <span className="text-[11px] text-zinc-400 font-mono">
                  Current: <span className="text-amber-300 font-semibold">{currentHeadUser.name}</span> (@{currentHeadUser.username})
                </span>
              ) : (
                <span className="text-[11px] text-zinc-500 italic">No head currently designated</span>
              )}
            </div>

            <p className="text-[11px] text-zinc-400">
              Select an Admin or Superadmin to lead this department space. The designated head oversees department queues and receives priority visibility.
            </p>

            <select
              value={selectedHeadId}
              onChange={(e) => setSelectedHeadId(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
            >
              <option value="">-- No Department Head (Unassigned) --</option>
              {eligibleHeads.map((u) => {
                const isCurrent = u.id === (space.departmentHeadId || space.departmentHead?.id);
                return (
                  <option key={u.id} value={u.id}>
                    {u.name} (@{u.username}) — [{u.globalRole}] {isCurrent ? '★ Current Head' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {/* SECTION 2: DEPARTMENT STAFF & MEMBERS CHECKLIST */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <label className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-blue-400" />
                  <span>Department Members & Clearance Checklist</span>
                </label>
                <p className="text-[11px] text-zinc-400">
                  Assign staff and employees who can access and triage this department queue.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectAllFiltered(filteredUsers)}
                  className="px-2 py-1 text-[11px] bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded transition-colors cursor-pointer"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => handleDeselectAllFiltered(filteredUsers)}
                  className="px-2 py-1 text-[11px] bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded transition-colors cursor-pointer"
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Filter Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Filter members by name, handle, or role..."
                value={memberSearchQuery}
                onChange={(e) => setMemberSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-zinc-900/80 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Members Scrollable List */}
            <div className="max-h-64 overflow-y-auto border border-zinc-800 rounded-xl divide-y divide-zinc-800/60 bg-zinc-950/40">
              {filteredUsers.length === 0 ? (
                <div className="p-4 text-center text-xs text-zinc-500 italic">
                  No users found matching "{memberSearchQuery}".
                </div>
              ) : (
                filteredUsers.map((u) => {
                  const isChecked = selectedMemberIds.has(u.id);
                  const isDesignatedHead = selectedHeadId === u.id;

                  return (
                    <div
                      key={u.id}
                      onClick={() => toggleMember(u.id)}
                      className={`p-3 flex items-center justify-between gap-3 text-xs transition-colors cursor-pointer select-none ${
                        isChecked ? 'bg-zinc-900/60 hover:bg-zinc-900' : 'hover:bg-zinc-900/30'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                            isChecked
                              ? 'bg-blue-600 border-blue-500 text-white'
                              : 'border-zinc-700 bg-zinc-900'
                          }`}
                        >
                          {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>

                        <div className="min-w-0">
                          <div className="font-medium text-zinc-200 flex items-center gap-1.5 truncate">
                            <span>{u.name}</span>
                            <span className="text-[11px] text-zinc-500 font-mono">
                              (@{u.username})
                            </span>
                            {isDesignatedHead && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] bg-amber-950/80 text-amber-300 border border-amber-800 font-medium">
                                <Crown className="w-2.5 h-2.5" />
                                Head of Dept
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-400 truncate">{u.email}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {u.globalRole === 'SUPERADMIN' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-red-950/80 text-red-300 border border-red-800">
                            <Shield className="w-2.5 h-2.5" />
                            SUPERADMIN
                          </span>
                        )}
                        {u.globalRole === 'ADMIN' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-blue-950/80 text-blue-300 border border-blue-800">
                            <Layers className="w-2.5 h-2.5" />
                            ADMIN
                          </span>
                        )}
                        {u.globalRole === 'EMPLOYEE' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
                            <UserIcon className="w-2.5 h-2.5" />
                            EMPLOYEE
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="text-[11px] text-zinc-500 flex items-center justify-between">
              <span>{selectedMemberIds.size} user(s) assigned to this department</span>
              {selectedHeadId && (
                <span className="text-amber-400 font-medium">Department Head is auto-included</span>
              )}
            </div>
          </div>

          {/* Section 3: SLA Targets */}
          <div className="space-y-3 pt-3 border-t border-zinc-800/80">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Department SLA Target Thresholds</span>
              </label>
              <span className="text-[11px] text-zinc-500">Max hours to resolution</span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                <span className="text-[10px] font-mono font-bold text-red-400">URGENT</span>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={slaForm.urgentHours}
                  onChange={(e) => setSlaForm({ ...slaForm, urgentHours: Number(e.target.value) || 1 })}
                  className="w-full px-2 py-1 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-100"
                />
                <span className="text-[9px] text-zinc-500 block">75%: {Math.max(1, Math.round(slaForm.urgentHours * 0.75))}h</span>
              </div>

              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                <span className="text-[10px] font-mono font-bold text-amber-400">HIGH</span>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={slaForm.highHours}
                  onChange={(e) => setSlaForm({ ...slaForm, highHours: Number(e.target.value) || 1 })}
                  className="w-full px-2 py-1 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-100"
                />
                <span className="text-[9px] text-zinc-500 block">75%: {Math.max(1, Math.round(slaForm.highHours * 0.75))}h</span>
              </div>

              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                <span className="text-[10px] font-mono font-bold text-blue-400">NORMAL</span>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={slaForm.normalHours}
                  onChange={(e) => setSlaForm({ ...slaForm, normalHours: Number(e.target.value) || 1 })}
                  className="w-full px-2 py-1 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-100"
                />
                <span className="text-[9px] text-zinc-500 block">75%: {Math.max(1, Math.round(slaForm.normalHours * 0.75))}h</span>
              </div>

              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                <span className="text-[10px] font-mono font-bold text-zinc-400">LOW</span>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={slaForm.lowHours}
                  onChange={(e) => setSlaForm({ ...slaForm, lowHours: Number(e.target.value) || 1 })}
                  className="w-full px-2 py-1 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-100"
                />
                <span className="text-[9px] text-zinc-500 block">75%: {Math.max(1, Math.round(slaForm.lowHours * 0.75))}h</span>
              </div>
            </div>
          </div>

          {/* Modal Footer Actions */}
          <div className="pt-4 border-t border-zinc-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Changes...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Save Department Staffing</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
