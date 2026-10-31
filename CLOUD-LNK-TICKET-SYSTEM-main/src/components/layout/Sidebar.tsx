'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Layers,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  ListTodo,
  CheckCircle2,
  UserCheck,
  User,
  Shield,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  Building,
  Plus,
  Sparkles,
  Ticket,
  Crown,
  Lock,
  GitPullRequest,
} from 'lucide-react';
import { useWorkspace } from '@/context/workspace-context';
import type { AuthenticatedUser } from '@/lib/security/rbac';
import { userSpaceRole } from '@/lib/security/permissions';
import { DepartmentManagementModal } from '@/components/modals/DepartmentManagementModal';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SITE_CONFIG } from '@/lib/constants';

interface SidebarProps {
  user: AuthenticatedUser;
}

export function Sidebar({ user }: SidebarProps) {
  const router = useRouter();
  const {
    workspace,
    spaces,
    activeScope,
    isSidebarCollapsed,
    expandedSpaceIds,
    selectFastView,
    selectSpace,
    selectList,
    toggleSidebar,
    toggleSpaceExpanded,
    setCreateTicketModalOpen,
    setCreateSpaceModalOpen,
    setIsSettingsModalOpen,
    collaboratedCount,
    listOpenCounts,
    refreshSpaces,
  } = useWorkspace();

  const [deptSettingsSpaceId, setDeptSettingsSpaceId] = useState<string | null>(null);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  const role: string = user?.globalRole || 'EMPLOYEE';
  const isSuperadmin = role === 'SUPERADMIN';
  const isAdmin = role === 'ADMIN';

  const safeSpaces = Array.isArray(spaces) ? spaces : [];
  const activeSpace = safeSpaces.find((s) => s?.id === activeScope?.spaceId);
  const isLeadingActiveSpace = Boolean(
    activeSpace &&
      user?.id &&
      (activeSpace.departmentHeadId === user.id ||
        activeSpace.departmentHead?.id === user.id)
  );

  return (
    <aside
      className={`h-screen bg-[#EAF0F8] dark:bg-[#0F1219] border-r border-[#C8D5E6] dark:border-white/10 flex flex-col justify-between transition-all duration-200 shrink-0 z-30 select-none ${
        isSidebarCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* 1. TOP SECTION: WORKSPACE HEADER */}
      <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
        <div className="h-14 px-3.5 border-b border-[#C8D5E6] dark:border-zinc-800/80 flex items-center justify-between gap-2">
          {!isSidebarCollapsed ? (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[#D8E1EE] dark:bg-zinc-900 border border-[#C4D1E2] dark:border-zinc-700/80 flex items-center justify-center shrink-0 shadow-xs text-[#0F172A] dark:text-zinc-200">
                <Building className="w-4 h-4 text-[#334155] dark:text-zinc-300" />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className="text-xs font-bold text-[#0F172A] dark:text-zinc-100 truncate tracking-tight"
                  title={workspace?.name || SITE_CONFIG.company}
                >
                  {SITE_CONFIG.shortCompany}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap overflow-hidden">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                  <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-[#475569] dark:text-zinc-400 truncate">
                    AIO WORK MANAGEMENT
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full flex justify-center" title={SITE_CONFIG.company}>
              <div className="w-8 h-8 rounded-lg bg-[#D8E1EE] dark:bg-zinc-900 border border-[#C4D1E2] dark:border-zinc-800 flex items-center justify-center text-[#334155] dark:text-zinc-300">
                <Building className="w-4 h-4" />
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={toggleSidebar}
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 text-[#475569] hover:text-[#0F172A] hover:bg-[#DEE8F4] dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900 rounded-md transition-colors cursor-pointer shrink-0"
          >
            {isSidebarCollapsed ? (
              <PanelLeft className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* SUPERADMIN SETTINGS BUTTON */}
        {isSuperadmin && (
          <div className="px-2 pt-2.5 pb-1 border-b border-[#C8D5E6] dark:border-zinc-800/80">
            <Link
              href="/admin/users"
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[#F3E4EB] hover:bg-[#EBD5DF] border border-[#E4C8D5] text-[#881337] dark:bg-red-950/40 dark:hover:bg-red-950/70 dark:border-red-900/60 dark:text-red-300 transition-colors shadow-xs ${
                isSidebarCollapsed ? 'justify-center px-0' : ''
              }`}
              title="Superadmin Settings & User Delegation"
            >
              <Shield className="w-4 h-4 text-[#9F1239] dark:text-red-400 shrink-0" />
              {!isSidebarCollapsed && (
                <div className="flex items-center justify-between flex-1 min-w-0">
                  <span className="truncate">Admin Panel</span>
                  <span className="text-[9px] uppercase font-mono px-1.5 py-0.2 rounded bg-[#E4C8D5] dark:bg-red-900/80 text-[#881337] dark:text-red-200">
                    Panel
                  </span>
                </div>
              )}
            </Link>
          </div>
        )}

        {/* 2. NAVIGATION LIST: SCROLLABLE */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-2 py-3 space-y-4 text-xs font-medium" data-tour="sidebar-spaces">
          {/* GLOBAL / FAST VIEWS */}
          <div className="space-y-0.5">
            {!isSidebarCollapsed && (
              <div className="px-2 pb-1.5 text-[10px] uppercase font-mono tracking-wider text-zinc-500 dark:text-zinc-400">
                Views
              </div>
            )}

            {/* Everything */}
            <button
              type="button"
              onClick={() => selectFastView('everything')}
              title="Everything"
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md transition-colors text-left cursor-pointer border ${
                activeScope.type === 'fastView' &&
                (activeScope.fastViewId === 'everything' || activeScope.fastViewId === 'all')
                  ? 'bg-[#D6E4F7] text-[#1E3A8A] border-[#ADC8EC] font-semibold dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30'
                  : 'border-transparent text-[#334155] hover:text-[#0F172A] hover:bg-[#DEE8F4] dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900/60'
              }`}
            >
              <Sparkles className="w-4 h-4 text-purple-500 dark:text-purple-400 shrink-0" />
              {!isSidebarCollapsed && <span>Everything</span>}
            </button>

            {/* Assigned to Me */}
            <button
              type="button"
              onClick={() => selectFastView('assigned_to_me')}
              title="Assigned to Me"
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md transition-colors text-left cursor-pointer border ${
                activeScope.type === 'fastView' &&
                (activeScope.fastViewId === 'assigned_to_me' || activeScope.fastViewId === 'assigned')
                  ? 'bg-[#D6E4F7] text-[#1E3A8A] border-[#ADC8EC] font-semibold dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30'
                  : 'border-transparent text-[#334155] hover:text-[#0F172A] hover:bg-[#DEE8F4] dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900/60'
              }`}
            >
              <UserCheck className="w-4 h-4 text-blue-500 dark:text-blue-400 shrink-0" />
              {!isSidebarCollapsed && <span>Assigned to Me</span>}
            </button>

            {/* Created by Me */}
            <button
              type="button"
              onClick={() => selectFastView('created_by_me')}
              title="Created by Me"
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md transition-colors text-left cursor-pointer border ${
                activeScope.type === 'fastView' &&
                (activeScope.fastViewId === 'created_by_me' || activeScope.fastViewId === 'created')
                  ? 'bg-[#D6E4F7] text-[#1E3A8A] border-[#ADC8EC] font-semibold dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30'
                  : 'border-transparent text-[#334155] hover:text-[#0F172A] hover:bg-[#DEE8F4] dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900/60'
              }`}
            >
              <Ticket className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
              {!isSidebarCollapsed && <span>Created by Me</span>}
            </button>

            {/* Collaborated */}
            <button
              type="button"
              onClick={() => selectFastView('collaborated')}
              title="Collaborated Tickets"
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors text-left cursor-pointer border ${
                activeScope.type === 'fastView' && activeScope.fastViewId === 'collaborated'
                  ? 'bg-[#D6E4F7] text-[#1E3A8A] border-[#ADC8EC] font-semibold dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30'
                  : 'border-transparent text-[#334155] hover:text-[#0F172A] hover:bg-[#DEE8F4] dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900/60'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <GitPullRequest className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
                {!isSidebarCollapsed && <span className="truncate">Collaborated</span>}
              </div>
              {!isSidebarCollapsed && collaboratedCount > 0 && (
                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.2 rounded-full bg-[#C7D4E6] border border-[#B2C3DA] text-[#0F172A] dark:bg-white/10 dark:text-slate-300 dark:border-white/10">
                  {collaboratedCount}
                </span>
              )}
            </button>
          </div>

          {/* SPACES TREE HIERARCHY - Shared across both Admin and Regular (Employee) users */}
          <div className="space-y-1 pt-1">
            {!isSidebarCollapsed ? (
              <div className="px-2 pb-1.5 flex items-center justify-between text-[10px] uppercase font-mono tracking-wider text-zinc-500 dark:text-zinc-400">
                <span>Spaces ({safeSpaces.length})</span>
                {isSuperadmin && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setCreateSpaceModalOpen(true)}
                      title="Create New Department Space"
                      className="p-1 text-zinc-500 hover:text-blue-600 hover:bg-slate-100 dark:text-zinc-400 dark:hover:text-blue-400 dark:hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <Link
                      href="/admin/users"
                      title="Manage Spaces & Clearance"
                      className="p-1 text-zinc-500 hover:text-zinc-800 hover:bg-slate-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 rounded transition-colors"
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              isSuperadmin && (
                <div className="flex justify-center pb-1">
                  <button
                    type="button"
                    onClick={() => setCreateSpaceModalOpen(true)}
                    title="Create New Department Space"
                    className="p-1.5 text-zinc-400 hover:text-blue-400 hover:bg-zinc-800 rounded-md transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              )
            )}

            {safeSpaces.length === 0 ? (
              !isSidebarCollapsed && (
                <div className="px-2 py-2 text-[11px] text-zinc-500 italic">
                  No spaces assigned to your account.
                </div>
              )
            ) : (
              safeSpaces.map((sp) => {
                const isExpanded = Array.isArray(expandedSpaceIds) ? expandedSpaceIds.includes(sp?.id) : false;
                const isSpaceActive =
                  activeScope?.type === 'space' && activeScope?.spaceId === sp?.id;
                const spLists = Array.isArray(sp?.lists) ? sp.lists : [];
                const isHead = Boolean(user?.id && (sp?.departmentHeadId === user.id || sp?.departmentHead?.id === user.id));
                const spaceRole = userSpaceRole(user, sp.id, safeSpaces);
                const canManageDepartment =
                  isSuperadmin ||
                  isHead ||
                  spaceRole === 'ADMIN' ||
                  Boolean(sp?.members?.some((m) => m.userId === user?.id && m.role === 'ADMIN'));
                const isMemberOfSpace = isSuperadmin || isHead || Boolean(sp?.members?.some((m) => m.userId === user?.id));
                const visibleLists = spLists.filter((lst) => !lst.isPrivate || isMemberOfSpace);

                return (
                  <div key={sp.id} className="space-y-0.5">
                    {/* Space Item */}
                    <div
                      className={`group flex items-center justify-between px-2 py-1.5 rounded-md transition-colors border ${
                        isSpaceActive
                          ? 'bg-[#D6E4F7] text-[#1E3A8A] border-[#ADC8EC] font-semibold dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30'
                          : 'border-transparent text-[#1E293B] hover:text-[#0F172A] hover:bg-[#DEE8F4] dark:text-zinc-300 dark:hover:text-zinc-100 dark:hover:bg-zinc-900/60'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => selectSpace(sp.id)}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                        title={`${sp.name} (${sp.key}) - Head: ${sp.departmentHead?.name ?? 'Unassigned'}`}
                      >
                        <span
                          className="w-4 h-4 rounded text-[10px] font-mono flex items-center justify-center shrink-0 font-bold border"
                          style={{
                            backgroundColor: sp.color ? `${sp.color}20` : '#27272a',
                            borderColor: sp.color ? `${sp.color}60` : '#3f3f46',
                            color: sp.color || '#d4d4d8',
                          }}
                        >
                          {sp.key?.substring(0, 3) || 'SPC'}
                        </span>
                        {!isSidebarCollapsed && (
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span className="truncate">{sp.name}</span>
                            {isHead && (
                              <span title={`You are Department Head (${sp.departmentHead?.name ?? 'Lead'})`}>
                                <Crown className="w-3 h-3 text-amber-500 dark:text-amber-400 shrink-0 fill-amber-400/20" />
                              </span>
                            )}
                          </div>
                        )}
                      </button>

                      {!isSidebarCollapsed && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          {canManageDepartment && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeptSettingsSpaceId(sp.id);
                              }}
                              className="p-1 text-[#64748B] hover:text-[#0F172A] hover:bg-[#B8CADC] dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800 rounded cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              title={`Department Settings for ${sp.name}`}
                            >
                              <Settings className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {visibleLists.length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSpaceExpanded(sp.id);
                              }}
                              className="p-1 text-[#64748B] hover:text-[#0F172A] dark:text-zinc-500 dark:hover:text-zinc-300 rounded cursor-pointer shrink-0"
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Child Lists inside Space */}
                    {!isSidebarCollapsed && isExpanded && visibleLists.length > 0 && (
                      <div className="pl-6 space-y-0.5 border-l border-[#C8D5E6] dark:border-zinc-800/80 ml-4 py-0.5">
                        {visibleLists.map((lst) => {
                          const isListActive =
                            activeScope?.type === 'list' &&
                            activeScope?.spaceId === sp.id &&
                            activeScope?.listId === lst.id;

                          return (
                            <button
                              key={lst.id}
                              type="button"
                              onClick={() => selectList(sp.id, lst.id)}
                              className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-[11px] transition-colors text-left cursor-pointer border ${
                                isListActive
                                  ? 'bg-[#D6E4F7] text-[#1E3A8A] border-[#ADC8EC] font-semibold dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30'
                                  : 'border-transparent text-[#334155] hover:text-[#0F172A] hover:bg-[#DEE8F4] dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900/50'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <ListTodo className="w-3.5 h-3.5 text-[#64748B] dark:text-zinc-500 shrink-0" />
                                <span className="truncate">{lst.name}</span>
                                {lst.isPrivate && (
                                  <span title="Private department queue">
                                    <Lock className="w-2.5 h-2.5 text-amber-500/80 dark:text-amber-400/80 shrink-0" />
                                  </span>
                                )}
                              </div>
                              {(() => {
                                const listCount = listOpenCounts?.[lst.id] ?? lst._count?.tasks ?? 0;
                                return listCount > 0 ? (
                                  <span className="text-[10px] font-mono text-[#0F172A] bg-[#D8E1EE] dark:bg-white/[0.06] dark:text-slate-400 border border-[#C4D1E2] dark:border-white/10 px-1.5 py-0.2 rounded font-medium">
                                    {listCount}
                                  </span>
                                ) : null;
                              })()}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          </div>
        </ScrollArea>
      </div>

      {/* 3. SIDEBAR FOOTER: USER DETAILS & ACTIONS */}
      <div
        data-tour="user-profile"
        className="p-2 border-t border-[#C8D5E6] dark:border-zinc-800/80 bg-[#EAF0F8] dark:bg-zinc-950/90 space-y-1"
      >
        {!isSidebarCollapsed ? (
          <div className="p-2 rounded-lg bg-[#F0F4FA] dark:bg-zinc-900/70 border border-[#C8D5E6] dark:border-zinc-800/80 space-y-2 shadow-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-[#D8E1EE] dark:bg-zinc-800 border border-[#C4D1E2] dark:border-zinc-700 flex items-center justify-center text-xs font-bold text-[#0F172A] dark:text-zinc-200 shrink-0">
                  {(user?.name?.charAt(0) || 'U').toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[#0F172A] dark:text-zinc-200 truncate flex items-center gap-1">
                    <span className="truncate">{user?.name || 'User'}</span>
                    {isLeadingActiveSpace && (
                      <span title={`Official Department Lead of ${activeSpace?.name}`}>
                        <Crown className="w-3 h-3 text-amber-500 dark:text-amber-400 shrink-0 fill-amber-400/20" />
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-[#475569] font-mono truncate">
                    @{user?.username || 'user'}
                  </div>
                </div>
              </div>

              <span
                className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border shrink-0 ${
                  isSuperadmin
                    ? 'bg-[#F3E4EB] text-[#881337] border-[#E4C8D5] dark:bg-red-950/80 dark:text-red-300 dark:border-red-800'
                    : role === 'ADMIN'
                    ? 'bg-[#DFECFA] text-[#1D4ED8] border-[#B9D3F3] dark:bg-blue-950/80 dark:text-blue-300 dark:border-blue-800'
                    : 'bg-[#E5ECF6] text-[#1E293B] border-[#CBD7E8] dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700'
                }`}
              >
                {role}
              </span>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-[#C8D5E6] dark:border-zinc-800/60">
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(true)}
                className="text-[11px] text-[#475569] hover:text-[#0F172A] dark:text-zinc-400 dark:hover:text-zinc-200 flex items-center gap-1 transition-colors cursor-pointer"
                title="Account Settings & Display Preferences"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Settings</span>
              </button>

              {isSuperadmin && (
                <Link
                  href="/admin/users"
                  className="text-[11px] text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 flex items-center gap-1 transition-colors ml-2"
                  title="Superadmin Control Panel"
                >
                  <Shield className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />
                  <span>Admin</span>
                </Link>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="text-[11px] text-zinc-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400 flex items-center gap-1 transition-colors ml-auto cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-1">
            <div className="relative">
              <div
                className="w-8 h-8 rounded-full bg-[#D8E1EE] dark:bg-zinc-800 border border-[#C4D1E2] dark:border-zinc-700 flex items-center justify-center text-xs font-bold text-[#0F172A] dark:text-zinc-200 cursor-pointer"
                onClick={() => setIsSettingsModalOpen(true)}
                title={`${user?.name || 'User'} (${role})${isLeadingActiveSpace ? ' - Department Lead' : ''} - Click for Settings`}
              >
                {(user?.name?.charAt(0) || 'U').toUpperCase()}
              </div>
              {isLeadingActiveSpace && (
                <div className="absolute -top-1 -right-1 bg-[#F0F4FA] dark:bg-zinc-950 rounded-full p-0.5 border border-amber-500/60 dark:border-amber-600/60 shadow-xs">
                  <Crown className="w-2.5 h-2.5 text-amber-500 dark:text-amber-400 fill-amber-400/30" />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsSettingsModalOpen(true)}
              title="Personal Settings & Preferences"
              className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              title="Sign Out"
              className="p-1.5 text-zinc-400 hover:text-red-600 dark:text-zinc-500 dark:hover:text-red-400 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Unified Department Queue Settings Modal */}
      {deptSettingsSpaceId && (
        <DepartmentManagementModal
          isOpen={Boolean(deptSettingsSpaceId)}
          onClose={() => setDeptSettingsSpaceId(null)}
          currentUser={user}
          initialSpaceId={deptSettingsSpaceId}
          onQueuesChanged={refreshSpaces}
        />
      )}
    </aside>
  );
}
