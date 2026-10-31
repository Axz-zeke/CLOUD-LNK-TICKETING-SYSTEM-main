import { PrismaClient, GlobalRole, Priority, SpaceRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { initializeDatabasePragmas } from '../src/lib/db.js';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

async function main() {
  console.log('--- Initializing SQLite WAL and pragmas ---');
  await initializeDatabasePragmas();

  console.log('--- Clearing existing records for clean seed ---');
  await prisma.session.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.taskComment.deleteMany();
  await prisma.task.deleteMany();
  await prisma.taskStatus.deleteMany();
  await prisma.list.deleteMany();
  await prisma.spaceMember.deleteMany();
  await prisma.space.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();

  console.log('--- Creating Workspace ---');
  const workspace = await prisma.workspace.create({
    data: {
      name: 'L&K Industries Philippine, Inc.',
      slug: 'lk-industries',
    },
  });

  console.log('--- Creating Spaces (Departments) ---');
  const misSpace = await prisma.space.create({
    data: {
      workspaceId: workspace.id,
      name: 'MIS',
      slug: 'mis',
      key: 'MIS',
      description: 'Management Information Systems & IT Infrastructure',
    },
  });

  const accSpace = await prisma.space.create({
    data: {
      workspaceId: workspace.id,
      name: 'Accounting',
      slug: 'accounting',
      key: 'ACC',
      description: 'Finance, Auditing, and Payroll Operations',
    },
  });

  const hrSpace = await prisma.space.create({
    data: {
      workspaceId: workspace.id,
      name: 'HR',
      slug: 'hr',
      key: 'HR',
      description: 'Human Resources and Talent Management',
    },
  });

  console.log('--- Creating Statuses for Spaces ---');
  const createDefaultStatuses = async (spaceId: string) => {
    const open = await prisma.taskStatus.create({
      data: { spaceId, name: 'Open', color: '#3B82F6', order: 0 },
    });
    const inProgress = await prisma.taskStatus.create({
      data: { spaceId, name: 'In Progress', color: '#F59E0B', order: 1 },
    });
    const pendingUser = await prisma.taskStatus.create({
      data: { spaceId, name: 'Pending User', color: '#8B5CF6', order: 2 },
    });
    const resolved = await prisma.taskStatus.create({
      data: { spaceId, name: 'Resolved', color: '#10B981', order: 3, isCompleted: true },
    });
    const closed = await prisma.taskStatus.create({
      data: { spaceId, name: 'Closed', color: '#6B7280', order: 4, isCompleted: true, isClosed: true },
    });
    return { open, inProgress, pendingUser, resolved, closed };
  };

  const misStatuses = await createDefaultStatuses(misSpace.id);
  const accStatuses = await createDefaultStatuses(accSpace.id);
  await createDefaultStatuses(hrSpace.id);

  console.log('--- Creating Lists (Queues) ---');
  const misNetworkList = await prisma.list.create({
    data: {
      spaceId: misSpace.id,
      name: 'Network Incidents',
      description: 'Firewall, VPN, and routing issues',
      order: 1,
    },
  });

  await prisma.list.create({
    data: {
      spaceId: misSpace.id,
      name: 'Hardware Requests',
      description: 'Laptops, monitors, and peripherals',
      order: 2,
    },
  });

  const accAuditList = await prisma.list.create({
    data: {
      spaceId: accSpace.id,
      name: 'Quarterly Audits',
      description: 'Financial reconciliations and audit items',
      order: 1,
    },
  });

  await prisma.list.create({
    data: {
      spaceId: accSpace.id,
      name: 'Invoice Processing',
      description: 'Accounts payable and vendor bills',
      order: 2,
    },
  });

  console.log('--- Creating Users ---');
  const defaultPasswordHash = hashPassword('P@ssword123!');

  // 1. SUPERADMIN
  const adminUser = await prisma.user.create({
    data: {
      username: 'admin_user',
      email: 'admin@enterprise.local',
      name: 'System Superadmin',
      passwordHash: defaultPasswordHash,
      globalRole: GlobalRole.SUPERADMIN,
    },
  });

  // 2. ADMIN with multi-space executive clearance ("The Boss")
  const bossUser = await prisma.user.create({
    data: {
      username: 'boss_user',
      email: 'boss@enterprise.local',
      name: 'Arthur Executive (The Boss)',
      passwordHash: defaultPasswordHash,
      globalRole: GlobalRole.ADMIN,
    },
  });

  // 3. ADMIN restricted strictly to MIS
  const misAgent = await prisma.user.create({
    data: {
      username: 'mis_agent',
      email: 'mis_agent@enterprise.local',
      name: 'Mike MIS Specialist',
      passwordHash: defaultPasswordHash,
      globalRole: GlobalRole.ADMIN,
    },
  });

  // 4. ADMIN restricted strictly to Accounting
  const accountingAgent = await prisma.user.create({
    data: {
      username: 'accounting_agent',
      email: 'acc_agent@enterprise.local',
      name: 'Alice Accounting Agent',
      passwordHash: defaultPasswordHash,
      globalRole: GlobalRole.ADMIN,
    },
  });

  // 5. EMPLOYEE (Regular employee)
  const employeeUser = await prisma.user.create({
    data: {
      username: 'employee_user',
      email: 'employee@enterprise.local',
      name: 'Jane Requester',
      passwordHash: defaultPasswordHash,
      globalRole: GlobalRole.EMPLOYEE,
    },
  });

  console.log('--- Assigning Space Memberships ---');
  // Boss assigned to ALL spaces: MIS, Accounting, HR
  await prisma.spaceMember.createMany({
    data: [
      { spaceId: misSpace.id, userId: bossUser.id, role: SpaceRole.ADMIN },
      { spaceId: accSpace.id, userId: bossUser.id, role: SpaceRole.ADMIN },
      { spaceId: hrSpace.id, userId: bossUser.id, role: SpaceRole.ADMIN },
    ],
  });

  // MIS agent assigned ONLY to MIS
  await prisma.spaceMember.create({
    data: {
      spaceId: misSpace.id,
      userId: misAgent.id,
      role: SpaceRole.MEMBER,
    },
  });

  // Accounting agent assigned ONLY to Accounting
  await prisma.spaceMember.create({
    data: {
      spaceId: accSpace.id,
      userId: accountingAgent.id,
      role: SpaceRole.MEMBER,
    },
  });

  console.log('--- Creating Sample Tasks & Comments ---');
  // Task 1: MIS Ticket created by employeeUser
  const misTask = await prisma.task.create({
    data: {
      taskKey: 'MIS-101',
      title: 'VPN Access Failure for Remote Station',
      description: 'Unable to establish IPsec tunnel from corporate laptop at branch office.',
      priority: Priority.HIGH,
      statusId: misStatuses.inProgress.id,
      listId: misNetworkList.id,
      spaceId: misSpace.id,
      assigneeId: misAgent.id,
      createdById: employeeUser.id,
      customFields: JSON.stringify({
        deviceModel: 'ThinkPad T14',
        osVersion: 'Windows 11 Enterprise',
        remoteSubnet: '192.168.10.0/24',
      }),
    },
  });

  // Comments on MIS Task
  await prisma.taskComment.createMany({
    data: [
      {
        taskId: misTask.id,
        authorId: misAgent.id,
        content: 'Acknowledged. Please verify if your local gateway certificate is up to date.',
        isInternal: false, // Public note
      },
      {
        taskId: misTask.id,
        authorId: misAgent.id,
        content: '[INTERNAL STAFF NOTE] RADIUS server dropped packet due to expired user certificate. Regenerating cert.',
        isInternal: true, // INTERNAL NOTE (Staff only, Requesters must NOT see)
      },
      {
        taskId: misTask.id,
        authorId: employeeUser.id,
        content: 'I verified the certificate store, still timing out after handshake.',
        isInternal: false, // Public note
      },
    ],
  });

  // Task 2: Accounting Ticket created by accountingAgent
  const accTask = await prisma.task.create({
    data: {
      taskKey: 'ACC-201',
      title: 'Q3 Vendor Invoice Audit Reconciliation',
      description: 'Discrepancy identified between Dell Hardware invoice and purchase order PO-9981.',
      priority: Priority.URGENT,
      statusId: accStatuses.open.id,
      listId: accAuditList.id,
      spaceId: accSpace.id,
      assigneeId: accountingAgent.id,
      createdById: accountingAgent.id,
      customFields: JSON.stringify({
        auditPeriod: '2026-Q3',
        vendor: 'Dell Enterprise Supplies',
        discrepancyAmount: 14250.75,
      }),
    },
  });

  // Internal comment on Accounting Task
  await prisma.taskComment.create({
    data: {
      taskId: accTask.id,
      authorId: accountingAgent.id,
      content: '[INTERNAL STAFF NOTE] Finance Director approval required before releasing payment hold.',
      isInternal: true,
    },
  });

  // Seed Default System Settings
  await prisma.systemSetting.upsert({
    where: { key: 'GLOBAL_AI_MODEL' },
    update: {},
    create: {
      key: 'GLOBAL_AI_MODEL',
      value: 'opencode/space-bunny-free',
      updatedBy: 'SYSTEM_SEED',
    },
  });

  console.log(' Seed completed successfully!');
  console.log(`- Workspace: ${workspace.name}`);
  console.log(`- Spaces: MIS (${misSpace.id}), Accounting (${accSpace.id}), HR (${hrSpace.id})`);
  console.log(`- Tasks: ${misTask.taskKey} (${misTask.id}), ${accTask.taskKey} (${accTask.id})`);
  console.log('- Users: admin_user, boss_user, mis_agent, accounting_agent, employee_user');
}

main()
  .catch((e) => {
    console.error('Seed execution error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
