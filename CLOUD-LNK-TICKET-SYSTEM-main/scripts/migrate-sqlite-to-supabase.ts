import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function resolveSqlitePath(): string {
  const envPath = process.env.LOCAL_SQLITE_PATH;
  const candidates: string[] = [];

  if (envPath) {
    // If envPath is a file directly
    candidates.push(envPath);
    // If envPath is a directory
    candidates.push(path.join(envPath, 'tickets.db'));
    candidates.push(path.join(envPath, 'tickets'));
  }

  candidates.push(
    path.resolve(process.cwd(), 'data', 'tickets.db'),
    path.resolve(process.cwd(), 'data', 'tickets'),
    'C:\\Users\\MIS\\Documents\\GitHub\\CLOUD-LNK-TICKET-SYSTEM\\data\\tickets.db',
    'C:\\Users\\MIS\\Documents\\GitHub\\CLOUD-LNK-TICKET-SYSTEM\\data\\tickets'
  );

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  throw new Error(`Unable to locate local SQLite database in: ${candidates.join(', ')}`);
}

function toDate(val: any): Date {
  if (val instanceof Date) return val;
  if (typeof val === 'number') return new Date(val);
  if (typeof val === 'string') {
    const num = Number(val);
    if (!isNaN(num) && /^\d+$/.test(val.trim())) {
      return new Date(num);
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

function toNullableDate(val: any): Date | null {
  if (val === null || val === undefined) return null;
  return toDate(val);
}

function toBool(val: any): boolean {
  return val === 1 || val === '1' || val === true || val === 'true';
}

async function migrate() {
  console.log('================================================================');
  console.log('   L&K TICKET SYSTEM: SQLITE -> SUPABASE POSTGRESQL MIGRATION   ');
  console.log('================================================================\n');

  const sqlitePath = resolveSqlitePath();
  console.log(`[1/4] Found local SQLite database at: ${sqlitePath}`);
  console.log(`[1/4] SQLite file size: ${(fs.statSync(sqlitePath).size / (1024 * 1024)).toFixed(2)} MB`);

  const sqlite = new DatabaseSync(sqlitePath);

  // Helper to safely select all rows from SQLite table
  function getAll(tableName: string): any[] {
    try {
      return sqlite.prepare(`SELECT * FROM "${tableName}"`).all() as any[];
    } catch (err: any) {
      console.warn(`[WARN] Could not select from ${tableName}:`, err.message);
      return [];
    }
  }

  console.log('\n[2/4] Testing Supabase PostgreSQL connectivity...');
  await prisma.$queryRawUnsafe('SELECT 1;');
  console.log('  -> Connected successfully to Supabase PostgreSQL.\n');

  console.log('[3/4] Migrating tables in strict foreign-key dependency order...\n');

  // Track valid IDs for relations to avoid any orphaned FK errors
  const validUserIds = new Set<string>();
  const validSpaceIds = new Set<string>();
  const validTaskIds = new Set<string>();
  const validListIds = new Set<string>();

  // 1. Workspace
  const workspaces = getAll('Workspace');
  process.stdout.write(`  - Migrating Workspace (${workspaces.length} records)... `);
  for (const w of workspaces) {
    await prisma.workspace.upsert({
      where: { id: w.id },
      create: {
        id: w.id,
        name: w.name,
        slug: w.slug,
        createdAt: toDate(w.createdAt),
        updatedAt: toDate(w.updatedAt),
      },
      update: {
        name: w.name,
        slug: w.slug,
        updatedAt: toDate(w.updatedAt),
      },
    });
  }
  console.log('Done.');

  // 2. User
  const users = getAll('User');
  process.stdout.write(`  - Migrating User (${users.length} records)... `);
  for (const u of users) {
    validUserIds.add(u.id);
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        username: u.username,
        email: u.email,
        name: u.name,
        passwordHash: u.passwordHash,
        globalRole: u.globalRole as any,
        isActive: toBool(u.isActive),
        createdAt: toDate(u.createdAt),
        updatedAt: toDate(u.updatedAt),
      },
      update: {
        username: u.username,
        email: u.email,
        name: u.name,
        passwordHash: u.passwordHash,
        globalRole: u.globalRole as any,
        isActive: toBool(u.isActive),
        updatedAt: toDate(u.updatedAt),
      },
    });
  }
  console.log('Done.');

  // 3. Space
  const spaces = getAll('Space');
  process.stdout.write(`  - Migrating Space (${spaces.length} records)... `);
  for (const s of spaces) {
    validSpaceIds.add(s.id);
    const departmentHeadId = s.departmentHeadId && validUserIds.has(s.departmentHeadId) ? s.departmentHeadId : null;
    await prisma.space.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        workspaceId: s.workspaceId,
        name: s.name,
        slug: s.slug,
        key: s.key,
        description: s.description || null,
        departmentHeadId,
        createdAt: toDate(s.createdAt),
        updatedAt: toDate(s.updatedAt),
      },
      update: {
        workspaceId: s.workspaceId,
        name: s.name,
        slug: s.slug,
        key: s.key,
        description: s.description || null,
        departmentHeadId,
        updatedAt: toDate(s.updatedAt),
      },
    });
  }
  console.log('Done.');

  // 4. SpaceMember
  const spaceMembers = getAll('SpaceMember');
  process.stdout.write(`  - Migrating SpaceMember (${spaceMembers.length} records)... `);
  for (const sm of spaceMembers) {
    await prisma.spaceMember.upsert({
      where: { id: sm.id },
      create: {
        id: sm.id,
        spaceId: sm.spaceId,
        userId: sm.userId,
        role: sm.role as any,
        createdAt: toDate(sm.createdAt),
        updatedAt: toDate(sm.updatedAt),
      },
      update: {
        role: sm.role as any,
        updatedAt: toDate(sm.updatedAt),
      },
    });
  }
  console.log('Done.');

  // 5. List
  const lists = getAll('List');
  process.stdout.write(`  - Migrating List (${lists.length} records)... `);
  for (const l of lists) {
    validListIds.add(l.id);
    await prisma.list.upsert({
      where: { id: l.id },
      create: {
        id: l.id,
        spaceId: l.spaceId,
        name: l.name,
        description: l.description || null,
        color: l.color || null,
        order: Number(l.order ?? 0),
        isPrivate: toBool(l.isPrivate),
        createdAt: toDate(l.createdAt),
        updatedAt: toDate(l.updatedAt),
      },
      update: {
        name: l.name,
        description: l.description || null,
        color: l.color || null,
        order: Number(l.order ?? 0),
        isPrivate: toBool(l.isPrivate),
        updatedAt: toDate(l.updatedAt),
      },
    });
  }
  console.log('Done.');

  // 6. TaskStatus
  const statuses = getAll('TaskStatus');
  process.stdout.write(`  - Migrating TaskStatus (${statuses.length} records)... `);
  for (const ts of statuses) {
    await prisma.taskStatus.upsert({
      where: { id: ts.id },
      create: {
        id: ts.id,
        spaceId: ts.spaceId,
        name: ts.name,
        color: ts.color || '#6B7280',
        order: Number(ts.order ?? 0),
        isCompleted: toBool(ts.isCompleted),
        isClosed: toBool(ts.isClosed),
        createdAt: toDate(ts.createdAt),
        updatedAt: toDate(ts.updatedAt),
      },
      update: {
        name: ts.name,
        color: ts.color || '#6B7280',
        order: Number(ts.order ?? 0),
        isCompleted: toBool(ts.isCompleted),
        isClosed: toBool(ts.isClosed),
        updatedAt: toDate(ts.updatedAt),
      },
    });
  }
  console.log('Done.');

  // 7. CustomFieldDefinition
  const customFieldDefs = getAll('CustomFieldDefinition');
  process.stdout.write(`  - Migrating CustomFieldDefinition (${customFieldDefs.length} records)... `);
  for (const cfd of customFieldDefs) {
    const listId = cfd.listId && validListIds.has(cfd.listId) ? cfd.listId : null;
    await prisma.customFieldDefinition.upsert({
      where: { id: cfd.id },
      create: {
        id: cfd.id,
        spaceId: cfd.spaceId,
        listId,
        name: cfd.name,
        fieldType: cfd.fieldType,
        options: cfd.options || null,
        isRequired: toBool(cfd.isRequired),
        order: Number(cfd.order ?? 0),
        createdAt: toDate(cfd.createdAt),
      },
      update: {
        listId,
        name: cfd.name,
        fieldType: cfd.fieldType,
        options: cfd.options || null,
        isRequired: toBool(cfd.isRequired),
        order: Number(cfd.order ?? 0),
      },
    });
  }
  console.log('Done.');

  // 8. TicketTemplate
  const templates = getAll('TicketTemplate');
  process.stdout.write(`  - Migrating TicketTemplate (${templates.length} records)... `);
  for (const tt of templates) {
    await prisma.ticketTemplate.upsert({
      where: { id: tt.id },
      create: {
        id: tt.id,
        spaceId: tt.spaceId,
        name: tt.name,
        titlePrefix: tt.titlePrefix || null,
        defaultPriority: tt.defaultPriority || 'NORMAL',
        descriptionTemplate: tt.descriptionTemplate || '',
        defaultChecklist: tt.defaultChecklist || null,
        createdAt: toDate(tt.createdAt),
        updatedAt: toDate(tt.updatedAt),
      },
      update: {
        name: tt.name,
        titlePrefix: tt.titlePrefix || null,
        defaultPriority: tt.defaultPriority || 'NORMAL',
        descriptionTemplate: tt.descriptionTemplate || '',
        defaultChecklist: tt.defaultChecklist || null,
        updatedAt: toDate(tt.updatedAt),
      },
    });
  }
  console.log('Done.');

  // 9. SlaPolicy
  const slaPolicies = getAll('SlaPolicy');
  process.stdout.write(`  - Migrating SlaPolicy (${slaPolicies.length} records)... `);
  for (const sp of slaPolicies) {
    await prisma.slaPolicy.upsert({
      where: { id: sp.id },
      create: {
        id: sp.id,
        spaceId: sp.spaceId,
        urgentHours: Number(sp.urgentHours ?? 4),
        highHours: Number(sp.highHours ?? 24),
        normalHours: Number(sp.normalHours ?? 72),
        lowHours: Number(sp.lowHours ?? 120),
        createdAt: toDate(sp.createdAt),
        updatedAt: toDate(sp.updatedAt),
      },
      update: {
        urgentHours: Number(sp.urgentHours ?? 4),
        highHours: Number(sp.highHours ?? 24),
        normalHours: Number(sp.normalHours ?? 72),
        lowHours: Number(sp.lowHours ?? 120),
        updatedAt: toDate(sp.updatedAt),
      },
    });
  }
  console.log('Done.');

  // 10. UserPreference
  const userPreferences = getAll('UserPreference');
  process.stdout.write(`  - Migrating UserPreference (${userPreferences.length} records)... `);
  for (const up of userPreferences) {
    await prisma.userPreference.upsert({
      where: { id: up.id },
      create: {
        id: up.id,
        userId: up.userId,
        theme: up.theme || 'dark',
        boardDensity: Number(up.boardDensity ?? 5),
        compactCards: toBool(up.compactCards),
        enableSound: toBool(up.enableSound),
        notifyOnAssign: toBool(up.notifyOnAssign),
        notifyOnStatus: toBool(up.notifyOnStatus),
        hasCompletedTour: toBool(up.hasCompletedTour),
        createdAt: toDate(up.createdAt),
        updatedAt: toDate(up.updatedAt),
      },
      update: {
        theme: up.theme || 'dark',
        boardDensity: Number(up.boardDensity ?? 5),
        compactCards: toBool(up.compactCards),
        enableSound: toBool(up.enableSound),
        notifyOnAssign: toBool(up.notifyOnAssign),
        notifyOnStatus: toBool(up.notifyOnStatus),
        hasCompletedTour: toBool(up.hasCompletedTour),
        updatedAt: toDate(up.updatedAt),
      },
    });
  }
  console.log('Done.');

  // 11. Task
  const tasks = getAll('Task');
  process.stdout.write(`  - Migrating Task (${tasks.length} records)... `);
  for (const t of tasks) {
    validTaskIds.add(t.id);
    const originSpaceId = t.originSpaceId && validSpaceIds.has(t.originSpaceId) ? t.originSpaceId : null;
    const assigneeId = t.assigneeId && validUserIds.has(t.assigneeId) ? t.assigneeId : null;
    await prisma.task.upsert({
      where: { id: t.id },
      create: {
        id: t.id,
        taskKey: t.taskKey,
        title: t.title,
        description: t.description || null,
        priority: t.priority as any,
        statusId: t.statusId,
        listId: t.listId,
        spaceId: t.spaceId,
        originSpaceId,
        assigneeId,
        createdById: t.createdById,
        customFields: t.customFields || '{}',
        startDate: toNullableDate(t.startDate),
        dueDate: toNullableDate(t.dueDate),
        isMilestone: toBool(t.isMilestone),
        dependsOnIds: t.dependsOnIds || null,
        progress: Number(t.progress ?? 0),
        createdAt: toDate(t.createdAt),
        updatedAt: toDate(t.updatedAt),
      },
      update: {
        taskKey: t.taskKey,
        title: t.title,
        description: t.description || null,
        priority: t.priority as any,
        statusId: t.statusId,
        listId: t.listId,
        spaceId: t.spaceId,
        originSpaceId,
        assigneeId,
        createdById: t.createdById,
        customFields: t.customFields || '{}',
        startDate: toNullableDate(t.startDate),
        dueDate: toNullableDate(t.dueDate),
        isMilestone: toBool(t.isMilestone),
        dependsOnIds: t.dependsOnIds || null,
        progress: Number(t.progress ?? 0),
        updatedAt: toDate(t.updatedAt),
      },
    });
  }
  console.log('Done.');

  // 12. _TaskContributors
  const contributors = getAll('_TaskContributors');
  process.stdout.write(`  - Migrating _TaskContributors (${contributors.length} records)... `);
  for (const c of contributors) {
    if (validTaskIds.has(c.A) && validUserIds.has(c.B)) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "_TaskContributors" ("A", "B") VALUES ($1, $2) ON CONFLICT DO NOTHING;`,
        c.A,
        c.B
      );
    }
  }
  console.log('Done.');

  // 13. TaskChecklistItem
  const checklistItems = getAll('TaskChecklistItem');
  process.stdout.write(`  - Migrating TaskChecklistItem (${checklistItems.length} records)... `);
  for (const ci of checklistItems) {
    await prisma.taskChecklistItem.upsert({
      where: { id: ci.id },
      create: {
        id: ci.id,
        taskId: ci.taskId,
        title: ci.title,
        isCompleted: toBool(ci.isCompleted),
        completedById: ci.completedById && validUserIds.has(ci.completedById) ? ci.completedById : null,
        completedAt: toNullableDate(ci.completedAt),
        order: Number(ci.order ?? 0),
        createdAt: toDate(ci.createdAt),
        updatedAt: toDate(ci.updatedAt),
      },
      update: {
        title: ci.title,
        isCompleted: toBool(ci.isCompleted),
        completedById: ci.completedById && validUserIds.has(ci.completedById) ? ci.completedById : null,
        completedAt: toNullableDate(ci.completedAt),
        order: Number(ci.order ?? 0),
        updatedAt: toDate(ci.updatedAt),
      },
    });
  }
  console.log('Done.');

  // 14. TaskCustomFieldValue
  const customFieldValues = getAll('TaskCustomFieldValue');
  process.stdout.write(`  - Migrating TaskCustomFieldValue (${customFieldValues.length} records)... `);
  for (const cfv of customFieldValues) {
    await prisma.taskCustomFieldValue.upsert({
      where: { id: cfv.id },
      create: {
        id: cfv.id,
        taskId: cfv.taskId,
        fieldId: cfv.fieldId,
        value: cfv.value,
        updatedAt: toDate(cfv.updatedAt),
      },
      update: {
        value: cfv.value,
        updatedAt: toDate(cfv.updatedAt),
      },
    });
  }
  console.log('Done.');

  // 15. TaskComment
  const comments = getAll('TaskComment');
  process.stdout.write(`  - Migrating TaskComment (${comments.length} records)... `);
  for (const tc of comments) {
    await prisma.taskComment.upsert({
      where: { id: tc.id },
      create: {
        id: tc.id,
        taskId: tc.taskId,
        authorId: tc.authorId,
        content: tc.content,
        isInternal: toBool(tc.isInternal),
        attachmentsJson: tc.attachmentsJson || null,
        createdAt: toDate(tc.createdAt),
        updatedAt: toDate(tc.updatedAt),
      },
      update: {
        content: tc.content,
        isInternal: toBool(tc.isInternal),
        attachmentsJson: tc.attachmentsJson || null,
        updatedAt: toDate(tc.updatedAt),
      },
    });
  }
  console.log('Done.');

  // 16. Attachment (Legacy)
  const legacyAttachments = getAll('Attachment');
  process.stdout.write(`  - Migrating Attachment (${legacyAttachments.length} records)... `);
  for (const a of legacyAttachments) {
    await prisma.attachment.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        taskId: a.taskId,
        uploaderId: a.uploaderId,
        filename: a.filename,
        filepath: a.filepath,
        size: Number(a.size ?? 0),
        mimeType: a.mimeType,
        createdAt: toDate(a.createdAt),
      },
      update: {
        filename: a.filename,
        filepath: a.filepath,
        size: Number(a.size ?? 0),
        mimeType: a.mimeType,
      },
    });
  }
  console.log('Done.');

  // 17. TaskAttachment
  const taskAttachments = getAll('TaskAttachment');
  process.stdout.write(`  - Migrating TaskAttachment (${taskAttachments.length} records)... `);
  for (const ta of taskAttachments) {
    await prisma.taskAttachment.upsert({
      where: { id: ta.id },
      create: {
        id: ta.id,
        taskId: ta.taskId,
        fileName: ta.fileName,
        fileUrl: ta.fileUrl,
        fileType: ta.fileType,
        fileSize: Number(ta.fileSize ?? 0),
        uploadedById: ta.uploadedById,
        createdAt: toDate(ta.createdAt),
      },
      update: {
        fileName: ta.fileName,
        fileUrl: ta.fileUrl,
        fileType: ta.fileType,
        fileSize: Number(ta.fileSize ?? 0),
      },
    });
  }
  console.log('Done.');

  // 18. TaskHistory
  const histories = getAll('TaskHistory');
  process.stdout.write(`  - Migrating TaskHistory (${histories.length} records)... `);
  for (const th of histories) {
    const actorId = th.actorId && validUserIds.has(th.actorId) ? th.actorId : null;
    const fromSpaceId = th.fromSpaceId && validSpaceIds.has(th.fromSpaceId) ? th.fromSpaceId : null;
    const toSpaceId = th.toSpaceId && validSpaceIds.has(th.toSpaceId) ? th.toSpaceId : null;
    await prisma.taskHistory.upsert({
      where: { id: th.id },
      create: {
        id: th.id,
        taskId: th.taskId,
        actorId,
        actionType: th.actionType,
        fromSpaceId,
        toSpaceId,
        fromQueueName: th.fromQueueName || null,
        toQueueName: th.toQueueName || null,
        notes: th.notes || null,
        createdAt: toDate(th.createdAt),
      },
      update: {
        actorId,
        actionType: th.actionType,
        fromSpaceId,
        toSpaceId,
        fromQueueName: th.fromQueueName || null,
        toQueueName: th.toQueueName || null,
        notes: th.notes || null,
      },
    });
  }
  console.log('Done.');

  // 19. Notification
  const notifications = getAll('Notification');
  process.stdout.write(`  - Migrating Notification (${notifications.length} records)... `);
  for (const n of notifications) {
    const taskId = n.taskId && validTaskIds.has(n.taskId) ? n.taskId : null;
    await prisma.notification.upsert({
      where: { id: n.id },
      create: {
        id: n.id,
        userId: n.userId,
        taskId,
        title: n.title,
        message: n.message,
        isRead: toBool(n.isRead),
        createdAt: toDate(n.createdAt),
      },
      update: {
        title: n.title,
        message: n.message,
        isRead: toBool(n.isRead),
      },
    });
  }
  console.log('Done.');

  // 20. AuditLog
  const auditLogs = getAll('AuditLog');
  process.stdout.write(`  - Migrating AuditLog (${auditLogs.length} records)... `);
  for (const al of auditLogs) {
    const userId = al.userId && validUserIds.has(al.userId) ? al.userId : null;
    await prisma.auditLog.upsert({
      where: { id: al.id },
      create: {
        id: al.id,
        event: al.event,
        userId,
        resourceType: al.resourceType,
        resourceId: al.resourceId || null,
        ipAddress: al.ipAddress || null,
        details: al.details || null,
        createdAt: toDate(al.createdAt),
      },
      update: {
        event: al.event,
        userId,
        resourceType: al.resourceType,
        resourceId: al.resourceId || null,
        ipAddress: al.ipAddress || null,
        details: al.details || null,
      },
    });
  }
  console.log('Done.');

  // 21. Session
  const sessions = getAll('Session');
  process.stdout.write(`  - Migrating Session (${sessions.length} records)... `);
  for (const s of sessions) {
    await prisma.session.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        token: s.token,
        userId: s.userId,
        expiresAt: toDate(s.expiresAt),
        createdAt: toDate(s.createdAt),
      },
      update: {
        expiresAt: toDate(s.expiresAt),
      },
    });
  }
  console.log('Done.');

  // 22. SystemSetting
  const systemSettings = getAll('SystemSetting');
  process.stdout.write(`  - Migrating SystemSetting (${systemSettings.length} records)... `);
  for (const ss of systemSettings) {
    await prisma.systemSetting.upsert({
      where: { id: ss.id },
      create: {
        id: ss.id,
        key: ss.key,
        value: ss.value,
        updatedAt: toDate(ss.updatedAt),
        updatedBy: ss.updatedBy || null,
      },
      update: {
        value: ss.value,
        updatedAt: toDate(ss.updatedAt),
        updatedBy: ss.updatedBy || null,
      },
    });
  }
  console.log('Done.\n');

  // =========================================================================
  // [4/4] COMPREHENSIVE VERIFICATION REPORT
  // =========================================================================
  console.log('================================================================');
  console.log('       TABLE-BY-TABLE DATA VERIFICATION REPORT                  ');
  console.log('================================================================');
  console.log('Table Name               SQLite Rows   Supabase Rows   Status   ');
  console.log('----------------------------------------------------------------');

  const verificationSpecs = [
    { name: 'Workspace', countSqlite: workspaces.length, countPg: () => prisma.workspace.count() },
    { name: 'User', countSqlite: users.length, countPg: () => prisma.user.count() },
    { name: 'Space', countSqlite: spaces.length, countPg: () => prisma.space.count() },
    { name: 'SpaceMember', countSqlite: spaceMembers.length, countPg: () => prisma.spaceMember.count() },
    { name: 'List', countSqlite: lists.length, countPg: () => prisma.list.count() },
    { name: 'TaskStatus', countSqlite: statuses.length, countPg: () => prisma.taskStatus.count() },
    { name: 'CustomFieldDefinition', countSqlite: customFieldDefs.length, countPg: () => prisma.customFieldDefinition.count() },
    { name: 'TicketTemplate', countSqlite: templates.length, countPg: () => prisma.ticketTemplate.count() },
    { name: 'SlaPolicy', countSqlite: slaPolicies.length, countPg: () => prisma.slaPolicy.count() },
    { name: 'UserPreference', countSqlite: userPreferences.length, countPg: () => prisma.userPreference.count() },
    { name: 'Task', countSqlite: tasks.length, countPg: () => prisma.task.count() },
    {
      name: '_TaskContributors',
      countSqlite: contributors.length,
      countPg: async () => {
        const res = await prisma.$queryRawUnsafe<Array<{ count: string | number | bigint }>>(
          'SELECT count(*)::bigint as count FROM "_TaskContributors";'
        );
        return Number(res[0]?.count ?? 0);
      },
    },
    { name: 'TaskChecklistItem', countSqlite: checklistItems.length, countPg: () => prisma.taskChecklistItem.count() },
    { name: 'TaskCustomFieldValue', countSqlite: customFieldValues.length, countPg: () => prisma.taskCustomFieldValue.count() },
    { name: 'TaskComment', countSqlite: comments.length, countPg: () => prisma.taskComment.count() },
    { name: 'Attachment', countSqlite: legacyAttachments.length, countPg: () => prisma.attachment.count() },
    { name: 'TaskAttachment', countSqlite: taskAttachments.length, countPg: () => prisma.taskAttachment.count() },
    { name: 'TaskHistory', countSqlite: histories.length, countPg: () => prisma.taskHistory.count() },
    { name: 'Notification', countSqlite: notifications.length, countPg: () => prisma.notification.count() },
    { name: 'AuditLog', countSqlite: auditLogs.length, countPg: () => prisma.auditLog.count() },
    { name: 'Session', countSqlite: sessions.length, countPg: () => prisma.session.count() },
    { name: 'SystemSetting', countSqlite: systemSettings.length, countPg: () => prisma.systemSetting.count() },
  ];

  let totalSqlite = 0;
  let totalPg = 0;
  let allMatched = true;

  for (const item of verificationSpecs) {
    const pgCount = await item.countPg();
    totalSqlite += item.countSqlite;
    totalPg += pgCount;
    const match = item.countSqlite === pgCount;
    if (!match) allMatched = false;

    const nameCol = item.name.padEnd(25, ' ');
    const sqliteCol = String(item.countSqlite).padStart(11, ' ');
    const pgCol = String(pgCount).padStart(15, ' ');
    const statusCol = match ? '   MATCH ✔' : '   DIFF ✘';

    console.log(`${nameCol}${sqliteCol}${pgCol}${statusCol}`);
  }

  console.log('----------------------------------------------------------------');
  console.log(
    `TOTAL RECORDS            ${String(totalSqlite).padStart(11, ' ')}${String(totalPg).padStart(15, ' ')}   ${allMatched ? 'MATCH ✔' : 'DIFF ✘'
    }`
  );
  console.log('================================================================\n');

  if (allMatched) {
    console.log('SUCCESS: All SQLite tables migrated with 100% record parity into Supabase PostgreSQL!\n');
  } else {
    console.warn('NOTICE: Some tables have slight count differences. Please check logs above.\n');
  }
}

migrate()
  .catch((e) => {
    console.error('Migration failed with fatal error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
