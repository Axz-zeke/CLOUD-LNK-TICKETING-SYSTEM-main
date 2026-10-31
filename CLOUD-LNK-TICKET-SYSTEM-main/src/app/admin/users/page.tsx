'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users,
  UserPlus,
  ShieldAlert,
  ShieldCheck,
  Check,
  X,
  Lock,
  Mail,
  User,
  Layers,
  Power,
  Edit2,
  RefreshCw,
  LogOut,
  Building2,
  Building,
  Search,
  AlertCircle,
  KeyRound,
  ArrowLeft,
  Plus,
  ExternalLink,
  Crown,
  Database,
  Download,
  Clock,
  Sliders,
  CheckCircle2,
  HardDrive,
  Server,
  Sparkles,
  Trash2,
  ArrowDownUp,
  ArrowRight,
  Loader2,
  Sun,
  Moon,
} from 'lucide-react';
import { useTheme } from '@/components/providers/ThemeProvider';
import { CreateSpaceModal } from '@/components/modals/CreateSpaceModal';
import { ManageDepartmentModal } from '@/components/modals/ManageDepartmentModal';
import { DeleteSpaceConfirmModal } from '@/components/modals/DeleteSpaceConfirmModal';
import { SITE_CONFIG } from '@/lib/constants';
import { ExecutiveReportModal } from '@/components/admin/ExecutiveReportModal';
import { AiSettingsSection } from '@/components/admin/AiSettingsSection';
import { DataPortabilitySection } from '@/components/admin/DataPortabilitySection';
import { SystemHealthBackupCard } from '@/components/admin/SystemHealthBackupCard';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { toast } from '@/components/ui/toast';

interface Space {
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
  lists?: Array<{ id: string; name: string }>;
  statuses?: Array<{ id: string; name: string; color: string }>;
  _count?: {
    tasks: number;
    members: number;
  };
  createdAt?: string;
}

interface SpaceMembership {
  id: string;
  spaceId: string;
  role: string;
  space: Space;
}

interface UserItem {
  id: string;
  username: string;
  email: string;
  name: string;
  globalRole: 'SUPERADMIN' | 'ADMIN' | 'EMPLOYEE';
  isActive: boolean;
  createdAt: string;
  spaceMemberships: SpaceMembership[];
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { resolvedTheme, toggleTheme } = useTheme();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [activeTab, setActiveTab] = useState<'users' | 'spaces' | 'system' | 'portability' | 'sla' | 'ai'>('users');
  const [createSpaceModalOpen, setCreateSpaceModalOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalUser, setEditModalUser] = useState<UserItem | null>(null);
  const [manageDeptSpace, setManageDeptSpace] = useState<Space | null>(null);
  const [spaceToDelete, setSpaceToDelete] = useState<Space | null>(null);
  const [spaceDeleteSuccessMessage, setSpaceDeleteSuccessMessage] = useState<string | null>(null);
  const [executiveReportModalOpen, setExecutiveReportModalOpen] = useState(false);

  // User Deletion state
  const [userToDelete, setUserToDelete] = useState<UserItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Role promotion / demotion confirmation dialog state
  const [roleSuccessMessage, setRoleSuccessMessage] = useState<string | null>(null);
  const [confirmRoleDialog, setConfirmRoleDialog] = useState<{
    isOpen: boolean;
    user: UserItem | null;
    targetRole: 'SUPERADMIN' | 'ADMIN' | 'EMPLOYEE' | null;
    loading: boolean;
    error: string | null;
  }>({
    isOpen: false,
    user: null,
    targetRole: null,
    loading: false,
    error: null,
  });

  // Create form state
  const [createForm, setCreateForm] = useState({
    name: '',
    username: '',
    email: '',
    password: '',
    globalRole: 'ADMIN' as 'SUPERADMIN' | 'ADMIN' | 'EMPLOYEE',
    spaceIds: [] as string[],
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit form state
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    globalRole: 'ADMIN' as 'SUPERADMIN' | 'ADMIN' | 'EMPLOYEE',
    isActive: true,
    newPassword: '',
    spaceIds: [] as string[],
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Tab 3: System & Backups state
  const [systemStats, setSystemStats] = useState<{
    dbPath: string;
    diskUsage: {
      totalBytes: number;
      dbBytes: number;
      walBytes: number;
      shmBytes: number;
      formatted: string;
    };
    counts: {
      tickets: number;
      users: number;
      auditLogs: number;
      spaces: number;
    };
    sqlite: {
      journalMode: string;
      walActive: boolean;
      busyTimeout: number;
      foreignKeys: boolean;
    };
    lastBackup: string | null;
    lastBackupDetails: string | null;
  } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupSuccessMessage, setBackupSuccessMessage] = useState<string | null>(null);

  // Tab 4: Department SLA state
  const [selectedSlaSpaceId, setSelectedSlaSpaceId] = useState<string>('');
  const [slaForm, setSlaForm] = useState({
    urgentHours: 4,
    highHours: 24,
    normalHours: 72,
    lowHours: 120,
  });
  const [slaLoading, setSlaLoading] = useState(false);
  const [slaSaving, setSlaSaving] = useState(false);
  const [slaSuccessMessage, setSlaSuccessMessage] = useState<string | null>(null);
  const [slaError, setSlaError] = useState<string | null>(null);

  const loadSystemStats = async () => {
    setStatsLoading(true);
    try {
      const res = await fetch('/api/admin/system/stats');
      if (res.ok) {
        const data = await res.json();
        setSystemStats(data);
      }
    } catch (err) {
      console.error('Failed to load system stats:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  const handleDownloadBackup = async () => {
    setBackupLoading(true);
    setBackupSuccessMessage(null);
    try {
      const res = await fetch('/api/admin/system/backup');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to download SQLite backup');
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('content-disposition');
      let filename = 'ticket-system-backup.sqlite';
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

      setBackupSuccessMessage(
        `Successfully checkpointed WAL and exported snapshot: ${filename} (${(blob.size / 1024).toFixed(1)} KB)`
      );
      await loadSystemStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Database backup failed');
    } finally {
      setBackupLoading(false);
    }
  };

  const loadSlaPolicy = async (spaceId: string) => {
    if (!spaceId) return;
    setSlaLoading(true);
    setSlaError(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/sla`);
      if (res.ok) {
        const data = await res.json();
        if (data.policy) {
          setSlaForm({
            urgentHours: data.policy.urgentHours,
            highHours: data.policy.highHours,
            normalHours: data.policy.normalHours,
            lowHours: data.policy.lowHours,
          });
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setSlaError(data.error || 'Failed to load SLA policy');
      }
    } catch {
      setSlaError('Network error loading SLA policy');
    } finally {
      setSlaLoading(false);
    }
  };

  const handleSaveSla = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlaSpaceId) return;
    setSlaSaving(true);
    setSlaError(null);
    setSlaSuccessMessage(null);
    try {
      const res = await fetch(`/api/spaces/${selectedSlaSpaceId}/sla`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slaForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setSlaError(data.error || 'Failed to update SLA policy');
      } else {
        const spaceName = spaces.find((s) => s.id === selectedSlaSpaceId)?.name || 'Department';
        setSlaSuccessMessage(`SLA policy for "${spaceName}" saved successfully.`);
      }
    } catch {
      setSlaError('Network error while saving SLA policy');
    } finally {
      setSlaSaving(false);
    }
  };

  // Fetch users, spaces, and active session
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, spacesRes, meRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/spaces'),
        fetch('/api/auth/me'),
      ]);

      if (usersRes.status === 403) {
        setError('403 Forbidden: You do not possess SUPERADMIN clearance to view this panel.');
        setLoading(false);
        return;
      }
      if (usersRes.status === 401) {
        router.push('/login');
        return;
      }
      if (!usersRes.ok) {
        throw new Error('Failed to load user management directory.');
      }
      const data = await usersRes.json();
      setUsers(data.users || []);

      if (spacesRes.ok) {
        const spData = await spacesRes.json();
        setSpaces(spData.spaces || []);
      } else {
        setSpaces(data.spaces || []);
      }

      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData.user) {
          setCurrentUser(meData.user);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error loading data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  // Open Edit Modal with selected user details
  const handleOpenEdit = (u: UserItem) => {
    setEditModalUser(u);
    setEditForm({
      name: u.name,
      email: u.email,
      globalRole: u.globalRole,
      isActive: u.isActive,
      newPassword: '',
      spaceIds: u.spaceMemberships.map((m) => m.spaceId),
    });
    setEditError(null);
  };

  // Check if a user is the sole remaining active Superadmin
  const isSoleSuperadmin = (u: UserItem) => {
    if (u.globalRole !== 'SUPERADMIN' || !u.isActive) return false;
    const activeSuperadmins = users.filter(
      (x) => x.globalRole === 'SUPERADMIN' && x.isActive
    );
    return activeSuperadmins.length <= 1;
  };

  // Initiate dynamic role change dialog
  const handleInitiateRoleChange = (
    u: UserItem,
    targetRole: 'SUPERADMIN' | 'ADMIN' | 'EMPLOYEE'
  ) => {
    if (u.globalRole === targetRole) return;

    if (isSoleSuperadmin(u) && targetRole !== 'SUPERADMIN') {
      setError(
        'Cannot demote the sole remaining active Superadmin in the system. Another user must be designated as Superadmin first.'
      );
      return;
    }

    setConfirmRoleDialog({
      isOpen: true,
      user: u,
      targetRole,
      loading: false,
      error: null,
    });
  };

  // Commit dynamic role change
  const handleConfirmRoleChange = async () => {
    if (!confirmRoleDialog.user || !confirmRoleDialog.targetRole) return;

    const targetUser = confirmRoleDialog.user;
    const newRole = confirmRoleDialog.targetRole;

    setConfirmRoleDialog((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const res = await fetch(`/api/admin/users/${targetUser.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update user role.');
      }

      // Update local state without full page refresh
      setUsers((prev) =>
        prev.map((item) =>
          item.id === targetUser.id ? { ...item, globalRole: newRole } : item
        )
      );

      setRoleSuccessMessage(
        `Successfully changed role of ${targetUser.name} to ${newRole}.`
      );
      setTimeout(() => setRoleSuccessMessage(null), 5000);

      setConfirmRoleDialog({
        isOpen: false,
        user: null,
        targetRole: null,
        loading: false,
        error: null,
      });
    } catch (err: any) {
      setConfirmRoleDialog((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'An error occurred while updating role.',
      }));
    }
  };

  // Quick space toggle helper for Create modal
  const toggleCreateSpace = (spaceId: string) => {
    setCreateForm((prev) => ({
      ...prev,
      spaceIds: prev.spaceIds.includes(spaceId)
        ? prev.spaceIds.filter((id) => id !== spaceId)
        : [...prev.spaceIds, spaceId],
    }));
  };

  // Quick space toggle helper for Edit modal
  const toggleEditSpace = (spaceId: string) => {
    setEditForm((prev) => ({
      ...prev,
      spaceIds: prev.spaceIds.includes(spaceId)
        ? prev.spaceIds.filter((id) => id !== spaceId)
        : [...prev.spaceIds, spaceId],
    }));
  };

  // Select all spaces ("The Boss" executive mode)
  const selectAllSpacesForCreate = () => {
    setCreateForm((prev) => ({
      ...prev,
      spaceIds: spaces.map((s) => s.id),
    }));
  };

  const selectAllSpacesForEdit = () => {
    setEditForm((prev) => ({
      ...prev,
      spaceIds: spaces.map((s) => s.id),
    }));
  };

  // Submit Create User
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    setCreateError(null);

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });

      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || 'Failed to create user');
        setCreateLoading(false);
        return;
      }

      setCreateModalOpen(false);
      setCreateForm({
        name: '',
        username: '',
        email: '',
        password: '',
        globalRole: 'ADMIN',
        spaceIds: [],
      });
      await loadData();
    } catch {
      setCreateError('Network error while creating user account.');
    } finally {
      setCreateLoading(false);
    }
  };

  // Submit Edit User
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalUser) return;
    setEditLoading(true);
    setEditError(null);

    try {
      const payload: Record<string, any> = {
        name: editForm.name,
        email: editForm.email,
        globalRole: editForm.globalRole,
        isActive: editForm.isActive,
        spaceIds: editForm.spaceIds,
      };

      if (editForm.newPassword) {
        payload.password = editForm.newPassword;
      }

      const res = await fetch(`/api/admin/users/${editModalUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || 'Failed to update user');
        setEditLoading(false);
        return;
      }

      setEditModalUser(null);
      await loadData();
    } catch {
      setEditError('Network error while updating user account.');
    } finally {
      setEditLoading(false);
    }
  };

  // Direct toggle of isActive status
  const handleToggleStatus = async (user: UserItem) => {
    if (currentUser?.id === user.id && user.isActive) {
      toast.error('You cannot deactivate your own active Superadmin account.');
      return;
    }
    const updatedStatus = !user.isActive;
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: updatedStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(`User status changed to ${updatedStatus ? 'Active' : 'Deactivated'}.`);
        await loadData();
      } else {
        toast.error(data.error || 'Failed to update user status');
      }
    } catch (err) {
      console.error('Error toggling status:', err);
      toast.error('Network error while toggling user status');
    }
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/users/${userToDelete.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete user');
      }

      const deletedName = userToDelete.name;
      const targetId = userToDelete.id;
      setUserToDelete(null);
      // Optimistic removal from table
      setUsers((prev) => prev.filter((u) => u.id !== targetId));
      toast.success(`User '${deletedName}' successfully deleted.`);
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete user';
      setDeleteError(msg);
      toast.error(msg);
    } finally {
      setDeleteLoading(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.globalRole.toLowerCase().includes(q)
    );
  });

  const filteredSpaces = spaces.filter((sp) => {
    const q = searchQuery.toLowerCase();
    return (
      sp.name.toLowerCase().includes(q) ||
      sp.key.toLowerCase().includes(q) ||
      (sp.description && sp.description.toLowerCase().includes(q))
    );
  });

  return (
    <div className="min-h-screen bg-[#E2E8F2] dark:bg-[#0B0D13] text-[#0F172A] dark:text-zinc-100 transition-colors">
      {/* Top Navbar */}
      <header className="border-b border-[#C8D5E6] dark:border-zinc-800 bg-[#EAF0F8]/95 dark:bg-[#0F1219]/60 sticky top-0 z-20 backdrop-blur transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-100 dark:bg-zinc-800 rounded-lg border border-slate-200 dark:border-zinc-700 text-slate-800 dark:text-zinc-100">
              <ShieldCheck className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight text-slate-900 dark:text-white flex items-center gap-2">
                Superadmin Control Panel
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 font-bold">
                  Restricted
                </span>
              </h1>
              <p className="text-xs text-slate-500 dark:text-zinc-400">
                {SITE_CONFIG.company} • AIO WORK MANAGEMENT • Enterprise Directory & Space Clearance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Theme Toggle Button */}
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-100 bg-white hover:bg-slate-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-slate-200 dark:border-zinc-700 rounded-lg transition-colors cursor-pointer shadow-xs"
              title={resolvedTheme === 'dark' ? 'Switch to Soft Daylight Light Mode' : 'Switch to Dark Mode'}
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-slate-600" />
              )}
            </button>

            <Link
              href="/"
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:text-slate-900 dark:hover:text-white bg-white hover:bg-slate-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-slate-200 dark:border-zinc-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Workspace / Tickets</span>
            </Link>

            <button
              onClick={handleLogout}
              className="px-3 py-1.5 text-xs text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white bg-white hover:bg-slate-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-800 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Error Notification */}
        {error && (
          <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/70 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-200 text-sm flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">{error}</p>
              <p className="text-xs text-red-600 dark:text-red-300 mt-1">
                You must authenticate with an account holding the SUPERADMIN global role.
              </p>
            </div>
          </div>
        )}

        {/* Role Success Notification */}
        {roleSuccessMessage && (
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2.5 animate-in fade-in">
            <Check className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
            <span className="font-medium">{roleSuccessMessage}</span>
          </div>
        )}

        {/* Top Diagnostic Strip: Live Telemetry Badges (Shown only on non-system tabs to avoid duplication) */}
        {activeTab !== 'system' && (
          <div className="bg-white dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 rounded-2xl p-3.5 shadow-xs transition-colors">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-mono font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider shrink-0">
                  System Telemetry:
                </span>
                <SystemHealthBackupCard showOnlyBadges />
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('system')}
                className="px-2.5 py-1 text-xs font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/60 dark:hover:bg-purple-900/60 border border-purple-200 dark:border-purple-800 rounded-lg transition-colors cursor-pointer shrink-0"
              >
                Open Health & Backup Console →
              </button>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-zinc-800 pb-3 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer shrink-0 ${
              activeTab === 'users'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
                : 'text-slate-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-zinc-200 hover:bg-blue-50/60 dark:hover:bg-zinc-900/60'
            }`}
          >
            <Users className={`w-4 h-4 ${activeTab === 'users' ? 'text-white' : 'text-blue-600 dark:text-blue-400'}`} />
            <span>Users & Clearances</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                activeTab === 'users'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border border-slate-200 dark:border-zinc-800'
              }`}
            >
              {users.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('spaces')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer shrink-0 ${
              activeTab === 'spaces'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
                : 'text-slate-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-zinc-200 hover:bg-blue-50/60 dark:hover:bg-zinc-900/60'
            }`}
          >
            <Building2 className={`w-4 h-4 ${activeTab === 'spaces' ? 'text-white' : 'text-emerald-600 dark:text-emerald-400'}`} />
            <span>Spaces & Departments</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                activeTab === 'spaces'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border border-slate-200 dark:border-zinc-800'
              }`}
            >
              {spaces.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('system');
              loadSystemStats();
            }}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer shrink-0 ${
              activeTab === 'system'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
                : 'text-slate-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-zinc-200 hover:bg-blue-50/60 dark:hover:bg-zinc-900/60'
            }`}
          >
            <Database className={`w-4 h-4 ${activeTab === 'system' ? 'text-white' : 'text-purple-600 dark:text-purple-400'}`} />
            <span>System Health & DB Backup</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('portability')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer shrink-0 ${
              activeTab === 'portability'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
                : 'text-slate-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-zinc-200 hover:bg-blue-50/60 dark:hover:bg-zinc-900/60'
            }`}
          >
            <ArrowDownUp className={`w-4 h-4 ${activeTab === 'portability' ? 'text-white' : 'text-purple-600 dark:text-purple-400'}`} />
            <span>Data Portability</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('sla');
              const initialId = selectedSlaSpaceId || spaces[0]?.id;
              if (initialId) {
                setSelectedSlaSpaceId(initialId);
                loadSlaPolicy(initialId);
              }
            }}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer shrink-0 ${
              activeTab === 'sla'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
                : 'text-slate-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-zinc-200 hover:bg-blue-50/60 dark:hover:bg-zinc-900/60'
            }`}
          >
            <Clock className={`w-4 h-4 ${activeTab === 'sla' ? 'text-white' : 'text-amber-500 dark:text-amber-400'}`} />
            <span>Department SLA Policies</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('ai')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer shrink-0 ${
              activeTab === 'ai'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
                : 'text-slate-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-zinc-200 hover:bg-blue-50/60 dark:hover:bg-zinc-900/60'
            }`}
          >
            <Sparkles className={`w-4 h-4 ${activeTab === 'ai' ? 'text-white' : 'text-emerald-600 dark:text-emerald-400'}`} />
            <span>AI & Inference Engine</span>
          </button>
        </div>

        {/* TAB 1: USERS & CLEARANCES */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            {/* Action Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
            <input
              type="text"
              placeholder="Search by name, email, or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg text-sm text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadData}
              title="Refresh Directory"
              className="p-2 bg-white hover:bg-slate-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-800 rounded-lg text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setExecutiveReportModalOpen(true)}
              className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/70 dark:text-indigo-200 dark:border-indigo-700/60 text-sm font-medium rounded-lg shadow-2xs flex items-center gap-2 transition-all cursor-pointer"
              title="Generate Executive Operations Report via OpenCode CLI"
            >
              <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span className="hidden sm:inline">Executive AI Report</span>
            </button>
            <button
              onClick={() => setCreateModalOpen(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm shadow-blue-600/20 flex items-center gap-2 transition-all cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>Provision User</span>
            </button>
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-white dark:bg-zinc-900/80 border border-slate-200/90 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm shadow-blue-950/5">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-zinc-950/60 text-slate-600 dark:text-zinc-400 text-xs font-semibold border-b border-slate-200 dark:border-zinc-800 uppercase tracking-wider">
                <tr>
                  <th className="py-3.5 px-4">User</th>
                  <th className="py-3.5 px-4">Global Role</th>
                  <th className="py-3.5 px-4">Assigned Spaces (Clearance)</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-zinc-800/60">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 dark:text-zinc-500">
                      Loading user accounts...
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 dark:text-zinc-500">
                      No accounts found matching your query.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const isSuperadmin = u.globalRole === 'SUPERADMIN';
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/80 dark:hover:bg-zinc-800/30 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-200 dark:bg-zinc-800 dark:border-zinc-700 flex items-center justify-center text-xs font-bold text-blue-700 dark:text-zinc-300">
                              {u.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                                {u.name}
                                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono font-normal">
                                  (@{u.username})
                                </span>
                              </div>
                              <div className="text-xs text-slate-600 dark:text-slate-400">{u.email}</div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <select
                              value={u.globalRole}
                              onChange={(e) =>
                                handleInitiateRoleChange(
                                  u,
                                  e.target.value as 'SUPERADMIN' | 'ADMIN' | 'EMPLOYEE'
                                )
                              }
                              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold border focus:outline-none focus:ring-1 cursor-pointer transition-all ${
                                u.globalRole === 'SUPERADMIN'
                                  ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/80 dark:text-red-300 dark:border-red-800 focus:ring-red-500'
                                  : u.globalRole === 'ADMIN'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/80 dark:text-blue-300 dark:border-blue-800 focus:ring-blue-500'
                                  : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700 focus:ring-blue-500'
                              }`}
                            >
                              <option value="SUPERADMIN" className="bg-white dark:bg-zinc-900 text-red-700 dark:text-red-300">
                                Superadmin
                              </option>
                              <option
                                value="ADMIN"
                                className="bg-white dark:bg-zinc-900 text-blue-700 dark:text-blue-300"
                                disabled={isSoleSuperadmin(u)}
                              >
                                Admin {isSoleSuperadmin(u) ? '(Sole Superadmin)' : ''}
                              </option>
                              <option
                                value="EMPLOYEE"
                                className="bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300"
                                disabled={isSoleSuperadmin(u)}
                              >
                                Employee {isSoleSuperadmin(u) ? '(Sole Superadmin)' : ''}
                              </option>
                            </select>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          {isSuperadmin ? (
                            <span className="text-xs text-slate-500 dark:text-zinc-400 italic">
                              Global Company-Wide Clearance
                            </span>
                          ) : u.spaceMemberships.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {u.spaceMemberships.map((m) => (
                                <span
                                  key={m.id}
                                  className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200 text-xs font-mono font-medium"
                                  title={m.space.name}
                                >
                                  {m.space.key}
                                </span>
                              ))}
                              {u.spaceMemberships.length === spaces.length && spaces.length > 1 && (
                                <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/80 dark:text-purple-300 dark:border-purple-800 text-[10px] font-mono">
                                  Executive / All Spaces
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 dark:text-zinc-500 italic">
                              No Assigned Spaces
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(u)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                              u.isActive
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/60'
                                : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200 dark:bg-zinc-800/80 dark:text-zinc-400 dark:border-zinc-700 dark:hover:bg-zinc-700/60'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                u.isActive ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-slate-400 dark:bg-zinc-500'
                              }`}
                            />
                            {u.isActive ? 'Active' : 'Deactivated'}
                          </button>
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleOpenEdit(u)}
                              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                              title="Edit Permissions & Password"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            {currentUser?.id === u.id ? (
                              <button
                                disabled
                                className="p-1.5 text-slate-300 dark:text-zinc-600 cursor-not-allowed rounded-lg opacity-40"
                                title="You cannot delete your own active Superadmin account"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setDeleteError(null);
                                  setUserToDelete(u);
                                }}
                                className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:text-rose-200 dark:hover:bg-rose-950/60 rounded-lg transition-colors cursor-pointer"
                                title="Delete User Account"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )}

    {/* TAB 2: SPACES & DEPARTMENTS */}
    {activeTab === 'spaces' && (
      <div className="space-y-6">
        {/* Spaces Action Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search spaces by name, key, or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadData}
              title="Refresh Spaces"
              className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setCreateSpaceModalOpen(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg shadow flex items-center gap-2 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Space</span>
            </button>
          </div>
        </div>

        {/* Space Deletion Success Feedback */}
        {spaceDeleteSuccessMessage && (
          <div className="p-3 bg-emerald-950/60 border border-emerald-800 rounded-xl text-xs text-emerald-200 flex items-center justify-between animate-in fade-in">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{spaceDeleteSuccessMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setSpaceDeleteSuccessMessage(null)}
              className="p-1 text-emerald-400 hover:text-emerald-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Spaces Table */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-950/60 text-zinc-400 text-xs font-medium border-b border-zinc-800 uppercase tracking-wider">
                <tr>
                  <th className="py-3.5 px-4">Department Space</th>
                  <th className="py-3.5 px-4">Head of Department</th>
                  <th className="py-3.5 px-4">Description</th>
                  <th className="py-3.5 px-4">Queue Lists</th>
                  <th className="py-3.5 px-4 text-center">Staff & Members</th>
                  <th className="py-3.5 px-4 text-center">Tickets</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-zinc-500">
                      Loading spaces and department queues...
                    </td>
                  </tr>
                ) : filteredSpaces.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-zinc-500">
                      No department spaces found matching your search.
                    </td>
                  </tr>
                ) : (
                  filteredSpaces.map((sp) => (
                    <tr key={sp.id} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <span
                            className="w-9 h-9 rounded-lg text-xs font-mono font-bold flex items-center justify-center shrink-0 border"
                            style={{
                              backgroundColor: sp.color ? `${sp.color}25` : '#27272a',
                              borderColor: sp.color ? `${sp.color}70` : '#3f3f46',
                              color: sp.color || '#e4e4e7',
                            }}
                          >
                            {sp.key}
                          </span>
                          <div>
                            <div className="font-semibold text-zinc-100 flex items-center gap-1.5">
                              {sp.name}
                            </div>
                            <div className="text-[11px] text-zinc-500 font-mono">
                              Prefix: {sp.key}-*
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Head of Department Indicator */}
                      <td className="py-3.5 px-4">
                        {sp.departmentHead ? (
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-amber-950/80 border border-amber-800 text-amber-300 flex items-center justify-center text-xs font-bold shrink-0">
                              {sp.departmentHead.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-xs text-zinc-100 flex items-center gap-1">
                                <Crown className="w-3 h-3 text-amber-400 fill-amber-400/20 shrink-0" />
                                <span className="truncate">{sp.departmentHead.name}</span>
                              </div>
                              <div className="text-[10px] text-zinc-400 font-mono truncate">
                                @{sp.departmentHead.username}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-500 italic flex items-center gap-1">
                            <Crown className="w-3 h-3 text-zinc-600 shrink-0" />
                            Unassigned
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 max-w-xs text-xs text-zinc-400">
                        {sp.description || (
                          <span className="italic text-zinc-600">No description provided</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {sp.lists && sp.lists.length > 0 ? (
                            sp.lists.map((l) => (
                              <span
                                key={l.id}
                                className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[11px]"
                              >
                                {l.name}
                              </span>
                            ))
                          ) : (
                            <span className="text-zinc-500 text-xs italic">Default Queue</span>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
                          <Users className="w-3 h-3 text-zinc-400" />
                          {sp._count?.members ?? (sp.members ? sp.members.length : 0)}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
                          {sp._count?.tasks ?? 0}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setManageDeptSpace(sp)}
                            className="px-2.5 py-1.5 text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white border border-zinc-700 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                            title={`Manage Staff & Head for ${sp.name}`}
                          >
                            <Crown className="w-3.5 h-3.5 text-amber-400" />
                            <span>Manage Staff & Head</span>
                          </button>
                          <Link
                            href="/"
                            className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline px-2 py-1.5 cursor-pointer"
                            title="Go to Tickets"
                          >
                            <span>Open</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                          <button
                            type="button"
                            onClick={() => setSpaceToDelete(sp)}
                            disabled={spaces.length <= 1}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                            title={spaces.length <= 1 ? "Cannot delete the organization's sole remaining space" : `Delete ${sp.name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )}

        {/* ========================================================================= */}
        {/* TAB 3: SYSTEM & DATABASE BACKUPS (SUPERADMIN ONLY) */}
        {/* ========================================================================= */}
        {activeTab === 'system' && (
          <div className="space-y-6">
            {/* Executive AI Briefings Card */}
            <div className="bg-gradient-to-r from-indigo-50 via-purple-50/70 to-white dark:from-indigo-950/40 dark:via-purple-950/30 dark:to-zinc-900 border border-indigo-200 dark:border-indigo-800/40 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-5 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 rounded-xl shrink-0">
                  <Sparkles className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">Executive AI Operations Briefing</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-100 border border-indigo-200 text-indigo-700 dark:bg-indigo-950 dark:border-indigo-800 dark:text-indigo-300 font-bold">
                      OpenCode CLI
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1 max-w-xl leading-relaxed">
                    Synthesize high-density cross-departmental telemetry, SLA breach rates, and tactical action items using our verified headless OpenCode agent. Zero local RAM overhead.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExecutiveReportModalOpen(true)}
                className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-indigo-500/20 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-4 h-4 text-indigo-200" />
                <span>Generate Operations Report</span>
              </button>
            </div>

            {/* System Health, Live Telemetry Badges & Online Hot Backup Console */}
            <SystemHealthBackupCard onRefreshParent={loadData} />

            {/* Embedded Granular Portability Engine in System Tab */}
            <div className="pt-4 border-t border-slate-200 dark:border-zinc-800/80">
              <DataPortabilitySection spaces={spaces} onRefreshData={loadData} />
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: DATA PORTABILITY & MIGRATIONS */}
        {/* ========================================================================= */}
        {activeTab === 'portability' && (
          <div className="space-y-6">
            <DataPortabilitySection spaces={spaces} onRefreshData={loadData} />
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: DEPARTMENT SLA POLICIES */}
        {/* ========================================================================= */}
        {activeTab === 'sla' && (
          <div className="space-y-6">
            {/* Header */}
            <div className="bg-white dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 p-5 rounded-2xl space-y-2 shadow-2xs">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-600 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-400 rounded-xl">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">Department Resolution SLA Thresholds</h2>
                  <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">
                    Configure maximum resolution time targets (in hours) per priority tier. The system will dynamically monitor incoming tickets and display the &ldquo;SLA Watch&rdquo; indicator when elapsed time hits 75% of your target.
                  </p>
                </div>
              </div>
            </div>

            {/* Department Space Selector Bar */}
            <div className="bg-zinc-900/60 border border-zinc-800 p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-xs font-semibold text-zinc-300">Select Department:</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {spaces.map((sp) => {
                  const isSelected = (selectedSlaSpaceId || spaces[0]?.id) === sp.id;
                  return (
                    <button
                      key={sp.id}
                      type="button"
                      onClick={() => {
                        setSelectedSlaSpaceId(sp.id);
                        loadSlaPolicy(sp.id);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer border ${
                        isSelected
                          ? 'bg-amber-950/80 border-amber-700 text-amber-200 shadow-sm'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                      }`}
                    >
                      <span className="font-mono font-bold">{sp.key}</span>
                      <span>{sp.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {slaSuccessMessage && (
              <div className="p-4 rounded-xl bg-emerald-950/70 border border-emerald-800 text-emerald-200 text-xs flex items-center gap-2.5 animate-in fade-in">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-medium">{slaSuccessMessage}</span>
              </div>
            )}

            {slaError && (
              <div className="p-4 rounded-xl bg-red-950/70 border border-red-800 text-red-200 text-xs flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="font-medium">{slaError}</span>
              </div>
            )}

            {/* SLA Configuration Form */}
            <form onSubmit={handleSaveSla} className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Urgent */}
                <div className="p-5 rounded-2xl bg-zinc-900/60 border border-red-950/80 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold bg-red-950 text-red-400 border border-red-800">
                        URGENT
                      </span>
                      <span className="text-[11px] font-mono text-zinc-500">Tier 1</span>
                    </div>
                    <p className="text-xs text-zinc-300 font-medium">Critical Outages & Emergencies</p>
                    <p className="text-[11px] text-zinc-500">Service-affecting blockers needing immediate attention.</p>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-zinc-800/80">
                    <label className="text-xs text-zinc-400 flex items-center justify-between">
                      <span>Target Resolution</span>
                      <span className="font-mono font-bold text-red-400">{slaForm.urgentHours} hrs</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={slaForm.urgentHours}
                      onChange={(e) => setSlaForm({ ...slaForm, urgentHours: Number(e.target.value) || 1 })}
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm font-mono text-zinc-100 focus:outline-none focus:ring-1 focus:ring-red-500"
                    />
                    <div className="text-[10px] text-amber-400/90 font-mono bg-amber-950/30 border border-amber-900/40 px-2 py-1 rounded">
                      ⚠️ 75% Watch at: {Math.max(1, Math.round(slaForm.urgentHours * 0.75))}h
                    </div>
                  </div>
                </div>

                {/* High */}
                <div className="p-5 rounded-2xl bg-zinc-900/60 border border-amber-950/80 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold bg-amber-950 text-amber-400 border border-amber-800">
                        HIGH
                      </span>
                      <span className="text-[11px] font-mono text-zinc-500">Tier 2</span>
                    </div>
                    <p className="text-xs text-zinc-300 font-medium">Major Degradation</p>
                    <p className="text-[11px] text-zinc-500">Significant workflow hindrance without direct workaround.</p>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-zinc-800/80">
                    <label className="text-xs text-zinc-400 flex items-center justify-between">
                      <span>Target Resolution</span>
                      <span className="font-mono font-bold text-amber-400">{slaForm.highHours} hrs</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={slaForm.highHours}
                      onChange={(e) => setSlaForm({ ...slaForm, highHours: Number(e.target.value) || 1 })}
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm font-mono text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                    <div className="text-[10px] text-amber-400/90 font-mono bg-amber-950/30 border border-amber-900/40 px-2 py-1 rounded">
                      ⚠️ 75% Watch at: {Math.max(1, Math.round(slaForm.highHours * 0.75))}h
                    </div>
                  </div>
                </div>

                {/* Normal */}
                <div className="p-5 rounded-2xl bg-zinc-900/60 border border-blue-950/80 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold bg-blue-950 text-blue-400 border border-blue-800">
                        NORMAL
                      </span>
                      <span className="text-[11px] font-mono text-zinc-500">Tier 3</span>
                    </div>
                    <p className="text-xs text-zinc-300 font-medium">Standard Request Queue</p>
                    <p className="text-[11px] text-zinc-500">Routine operational tickets and standard intake tasks.</p>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-zinc-800/80">
                    <label className="text-xs text-zinc-400 flex items-center justify-between">
                      <span>Target Resolution</span>
                      <span className="font-mono font-bold text-blue-400">{slaForm.normalHours} hrs</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={slaForm.normalHours}
                      onChange={(e) => setSlaForm({ ...slaForm, normalHours: Number(e.target.value) || 1 })}
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm font-mono text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="text-[10px] text-amber-400/90 font-mono bg-amber-950/30 border border-amber-900/40 px-2 py-1 rounded">
                      ⚠️ 75% Watch at: {Math.max(1, Math.round(slaForm.normalHours * 0.75))}h
                    </div>
                  </div>
                </div>

                {/* Low */}
                <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold bg-zinc-800 text-zinc-400 border border-zinc-700">
                        LOW
                      </span>
                      <span className="text-[11px] font-mono text-zinc-500">Tier 4</span>
                    </div>
                    <p className="text-xs text-zinc-300 font-medium">Minor Enhancements & Non-Urgent</p>
                    <p className="text-[11px] text-zinc-500">Backlog cleanup, non-pressing inquiries, cosmetic tasks.</p>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-zinc-800/80">
                    <label className="text-xs text-zinc-400 flex items-center justify-between">
                      <span>Target Resolution</span>
                      <span className="font-mono font-bold text-zinc-300">{slaForm.lowHours} hrs</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={slaForm.lowHours}
                      onChange={(e) => setSlaForm({ ...slaForm, lowHours: Number(e.target.value) || 1 })}
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm font-mono text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                    />
                    <div className="text-[10px] text-amber-400/90 font-mono bg-amber-950/30 border border-amber-900/40 px-2 py-1 rounded">
                      ⚠️ 75% Watch at: {Math.max(1, Math.round(slaForm.lowHours * 0.75))}h
                    </div>
                  </div>
                </div>
              </div>

              {/* Explanatory Callout Banner */}
              <div className="p-4 rounded-xl bg-blue-50/80 border border-blue-200 dark:bg-blue-950/30 dark:border-blue-900/50 flex items-start gap-3">
                <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-700 dark:text-blue-200/90 leading-relaxed">
                  <p className="font-semibold text-blue-900 dark:text-blue-100">Dynamic SLA Watch & Breach Evaluation:</p>
                  <p className="mt-0.5">
                    Ticket cards in both List View and Kanban Board View continuously compute their elapsed time since creation. When a ticket reaches <strong className="text-slate-900 dark:text-white">75%</strong> of its priority limit, an amber <strong className="text-amber-700 dark:text-amber-300">SLA Watch</strong> chip is rendered. If elapsed time exceeds <strong className="text-slate-900 dark:text-white">100%</strong> of the threshold, it is automatically flagged with an animated <strong className="text-rose-600 dark:text-red-400">SLA Breached</strong> indicator.
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() =>
                    setSlaForm({
                      urgentHours: 4,
                      highHours: 24,
                      normalHours: 72,
                      lowHours: 120,
                    })
                  }
                  className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  Reset Defaults (4h/24h/72h/120h)
                </button>
                <button
                  type="submit"
                  disabled={slaSaving || slaLoading}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-lg flex items-center gap-2 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>{slaSaving ? 'Saving Policy...' : 'Save SLA Thresholds'}</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 5: AI & INFERENCE SETTINGS */}
        {activeTab === 'ai' && (
          <div className="space-y-6">
            <AiSettingsSection currentUser={currentUser} />
          </div>
        )}
      </main>

      {/* ========================================================================= */}
      {/* MODAL 1: PROVISION NEW USER */}
      {/* ========================================================================= */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-150">
          <form
            onSubmit={handleCreateSubmit}
            className="relative w-full max-w-xl max-h-[90vh] flex flex-col rounded-xl bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
          >
            {/* STICKY / FIXED HEADER */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0 bg-zinc-900/95">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-zinc-800 border border-zinc-700/60 text-zinc-300">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-zinc-100">
                    Provision Local User Account
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Create an authenticated local user on the air-gapped network
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* SCROLLABLE FORM BODY */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
              {createError && (
                <div className="p-3 rounded-lg bg-red-950/80 border border-red-800 text-xs text-red-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-zinc-400">Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. David Miller"
                    value={createForm.name}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, name: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-zinc-400">Username</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. dmiller"
                    value={createForm.username}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, username: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-zinc-400">Corporate Email</label>
                <input
                  type="email"
                  required
                  placeholder="user@enterprise.local"
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, email: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-zinc-400">Initial Password</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={createForm.password}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, password: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400">Global Role Authority</label>
                <select
                  value={createForm.globalRole}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      globalRole: e.target.value as any,
                    })
                  }
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400 cursor-pointer"
                >
                  <option value="ADMIN">ADMIN (Department Specialist / Lead)</option>
                  <option value="SUPERADMIN">SUPERADMIN (Company-Wide Full Clearance)</option>
                  <option value="EMPLOYEE">EMPLOYEE (Standard Employee - Originated Only)</option>
                </select>
              </div>

              {/* Space Delegation Checkboxes */}
              {createForm.globalRole !== 'EMPLOYEE' && (
                <div className="space-y-2 pt-2 border-t border-zinc-800">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-zinc-300">
                      Granular Space Permission Delegation
                    </label>
                    <button
                      type="button"
                      onClick={selectAllSpacesForCreate}
                      className="text-[11px] text-zinc-400 hover:text-white underline cursor-pointer"
                    >
                      Select All Spaces (Executive Access)
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Single-department agent: check 1 Space. Multi-department executive (&quot;The Boss&quot;): check all Spaces.
                  </p>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {spaces.map((sp) => {
                      const isChecked = createForm.spaceIds.includes(sp.id);
                      return (
                        <button
                          key={sp.id}
                          type="button"
                          onClick={() => toggleCreateSpace(sp.id)}
                          className={`flex items-center gap-2 p-2.5 rounded-lg border text-left text-xs transition-colors cursor-pointer ${
                            isChecked
                              ? 'bg-zinc-800 border-zinc-600 text-white'
                              : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                          }`}
                        >
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              isChecked
                                ? 'bg-zinc-100 border-white text-zinc-950'
                                : 'border-zinc-700 bg-zinc-900'
                            }`}
                          >
                            {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                          <div>
                            <div className="font-medium">{sp.name}</div>
                            <div className="text-[10px] text-zinc-500 font-mono">
                              Key: {sp.key}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* STICKY / FIXED FOOTER */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/95 shrink-0">
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-white text-slate-700 border border-slate-300 hover:bg-slate-100 dark:bg-white/5 dark:text-zinc-300 dark:border-white/10 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createLoading}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-600/20 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {createLoading ? 'Provisioning...' : 'Provision User'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: EDIT USER & CLEARANCES */}
      {/* ========================================================================= */}
      {editModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-150">
          <form
            onSubmit={handleEditSubmit}
            className="relative w-full max-w-xl max-h-[90vh] flex flex-col rounded-xl bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
          >
            {/* STICKY / FIXED HEADER */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0 bg-zinc-900/95">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-zinc-800 border border-zinc-700/60 text-zinc-300">
                  <Edit2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-zinc-100">
                    Edit Account: {editModalUser.username}
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Modify profile details, global clearance, and department memberships
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditModalUser(null)}
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* SCROLLABLE FORM BODY */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
              {editError && (
                <div className="p-3 rounded-lg bg-red-950/80 border border-red-800 text-xs text-red-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{editError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-zinc-400">Full Name</label>
                  <input
                    type="text"
                    required
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm({ ...editForm, name: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-zinc-400">Corporate Email</label>
                  <input
                    type="email"
                    required
                    value={editForm.email}
                    onChange={(e) =>
                      setEditForm({ ...editForm, email: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-zinc-400">Global Role</label>
                  <select
                    value={editForm.globalRole}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        globalRole: e.target.value as any,
                      })
                    }
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400 cursor-pointer"
                  >
                    <option value="ADMIN">ADMIN</option>
                    <option value="SUPERADMIN">SUPERADMIN (Promote)</option>
                    <option value="EMPLOYEE">EMPLOYEE</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-zinc-400">Account Status</label>
                  <select
                    value={editForm.isActive ? 'active' : 'inactive'}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        isActive: e.target.value === 'active',
                      })
                    }
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400 cursor-pointer"
                  >
                    <option value="active">Active (Access Allowed)</option>
                    <option value="inactive">Deactivated (Blocked)</option>
                  </select>
                </div>
              </div>

              {/* Password Reset Section */}
              <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-1.5">
                <label className="text-xs text-zinc-300 font-medium flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                  <span>Reset Password (Optional)</span>
                </label>
                <input
                  type="password"
                  placeholder="Leave blank to keep existing password"
                  value={editForm.newPassword}
                  onChange={(e) =>
                    setEditForm({ ...editForm, newPassword: e.target.value })
                  }
                  className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                />
              </div>

              {/* Space Delegation Checkboxes */}
              {editForm.globalRole !== 'EMPLOYEE' && (
                <div className="space-y-2 pt-2 border-t border-zinc-800">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-zinc-300">
                      Space Memberships & Clearance
                    </label>
                    <button
                      type="button"
                      onClick={selectAllSpacesForEdit}
                      className="text-[11px] text-zinc-400 hover:text-white underline cursor-pointer"
                    >
                      Assign All Spaces
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {spaces.map((sp) => {
                      const isChecked = editForm.spaceIds.includes(sp.id);
                      return (
                        <button
                          key={sp.id}
                          type="button"
                          onClick={() => toggleEditSpace(sp.id)}
                          className={`flex items-center gap-2 p-2.5 rounded-lg border text-left text-xs transition-colors cursor-pointer ${
                            isChecked
                              ? 'bg-zinc-800 border-zinc-600 text-white'
                              : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                          }`}
                        >
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              isChecked
                                ? 'bg-zinc-100 border-white text-zinc-950'
                                : 'border-zinc-700 bg-zinc-900'
                            }`}
                          >
                            {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                          <div>
                            <div className="font-medium">{sp.name}</div>
                            <div className="text-[10px] text-zinc-500 font-mono">
                              Key: {sp.key}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* STICKY / FIXED FOOTER */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/95 shrink-0">
              <button
                type="button"
                onClick={() => setEditModalUser(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-white text-slate-700 border border-slate-300 hover:bg-slate-100 dark:bg-white/5 dark:text-zinc-300 dark:border-white/10 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editLoading}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-600/20 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {editLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: CREATE DYNAMIC SPACE */}
      {createSpaceModalOpen && currentUser && (
        <CreateSpaceModal
          isOpen={createSpaceModalOpen}
          onClose={() => setCreateSpaceModalOpen(false)}
          onSpaceCreated={async () => {
            await loadData();
          }}
          currentUser={currentUser}
        />
      )}

      {/* MODAL 4: MANAGE DEPARTMENT STAFFING & HEAD */}
      {manageDeptSpace && (
        <ManageDepartmentModal
          isOpen={manageDeptSpace !== null}
          onClose={() => setManageDeptSpace(null)}
          space={manageDeptSpace}
          users={users}
          onSaved={loadData}
        />
      )}

      {/* MODAL 5: CONFIRM ROLE PROMOTION / DEMOTION */}
      {confirmRoleDialog.isOpen && confirmRoleDialog.user && confirmRoleDialog.targetRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-950/80 border border-amber-800 flex items-center justify-center text-amber-400 shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-100">Confirm Global Role Change</h3>
                <p className="text-xs text-zinc-400">Dynamic User Clearance Delegation</p>
              </div>
            </div>

            <div className="p-3.5 bg-zinc-900/80 rounded-xl border border-zinc-800 text-xs text-zinc-300 leading-relaxed">
              Are you sure you want to promote/demote{' '}
              <strong className="text-white font-semibold">
                {confirmRoleDialog.user.name}
              </strong>{' '}
              <span className="text-zinc-400 font-mono">
                (@{confirmRoleDialog.user.username})
              </span>{' '}
              from{' '}
              <span className="font-mono text-zinc-400 font-bold px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700">
                {confirmRoleDialog.user.globalRole}
              </span>{' '}
              to{' '}
              <span className="font-mono text-amber-300 font-bold px-1 py-0.5 rounded bg-amber-950/80 border border-amber-800">
                {confirmRoleDialog.targetRole}
              </span>
              ?
            </div>

            {confirmRoleDialog.error && (
              <div className="p-3 rounded-lg bg-red-950/80 border border-red-800 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{confirmRoleDialog.error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-800/80">
              <button
                type="button"
                onClick={() =>
                  setConfirmRoleDialog({
                    isOpen: false,
                    user: null,
                    targetRole: null,
                    loading: false,
                    error: null,
                  })
                }
                disabled={confirmRoleDialog.loading}
                className="px-3.5 py-1.5 text-xs text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRoleChange}
                disabled={confirmRoleDialog.loading}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {confirmRoleDialog.loading ? 'Updating Role...' : 'Confirm Role Change'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Executive AI Operations Report Modal */}
      <ExecutiveReportModal
        isOpen={executiveReportModalOpen}
        onClose={() => setExecutiveReportModalOpen(false)}
      />

      {/* Superadmin Department Space Deletion Dialog */}
      <DeleteSpaceConfirmModal
        isOpen={Boolean(spaceToDelete)}
        onClose={() => setSpaceToDelete(null)}
        targetSpace={spaceToDelete}
        space={spaceToDelete}
        onDeleted={async () => {
          const deletedName = spaceToDelete?.name;
          setSpaceToDelete(null);
          if (deletedName) {
            setSpaceDeleteSuccessMessage(`Department space '${deletedName}' was permanently deleted.`);
          }
          await loadData();
        }}
      />

      {/* Delete User Confirmation Modal */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-950/80 border border-rose-800 flex items-center justify-center text-rose-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">
                  Delete User Account
                </h3>
                <p className="text-xs text-zinc-400">
                  Permanent account removal & dependency cleanup
                </p>
              </div>
            </div>

            <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-lg p-3 space-y-1.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-zinc-500 font-medium">Name:</span>
                <span className="text-zinc-200 font-semibold">{userToDelete.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500 font-medium">Username:</span>
                <span className="text-zinc-300 font-mono">@{userToDelete.username}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500 font-medium">Email:</span>
                <span className="text-zinc-300">{userToDelete.email}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500 font-medium">Role:</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border bg-zinc-800 border-zinc-700 text-zinc-300">
                  {userToDelete.globalRole}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-800/60 text-amber-300/90 text-xs leading-relaxed flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-200 mb-0.5">Warning: This action cannot be undone.</p>
                Removing this user will permanently revoke all active sessions, clear department memberships, and unassign any active tickets. Created tickets will be safely preserved.
              </div>
            </div>

            {deleteError && (
              <div className="p-3 rounded-lg bg-red-950/80 border border-red-800 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-800/80">
              <button
                type="button"
                onClick={() => {
                  setUserToDelete(null);
                  setDeleteError(null);
                }}
                disabled={deleteLoading}
                className="px-3.5 py-2 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteLoading}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg shadow transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {deleteLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting User...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete User</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
