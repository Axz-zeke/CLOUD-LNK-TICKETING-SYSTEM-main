import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import {
  uploadToGoogleDrive,
  downloadFromGoogleDrive,
  extractDriveFileId,
  pingGoogleDriveBridge,
} from '../src/lib/google-drive-bridge';

async function main() {
  const isPull = process.argv.includes('--pull');

  console.log('================================================================');
  console.log(`   GOOGLE DRIVE ATTACHMENTS SYNC ENGINE: ${isPull ? 'REVERSE PULL (DRIVE -> LOCAL)' : 'FORWARD PUSH (LOCAL -> DRIVE)'}   `);
  console.log('================================================================\n');

  console.log('[1/3] Checking Google Drive bridge connectivity...');
  const ping = await pingGoogleDriveBridge();
  if (!ping.ok) {
    throw new Error(`Google Drive bridge is unreachable: ${ping.error || ping.status}`);
  }
  console.log(`  -> Connected to Google Drive (${ping.status}). Vault storage used: ${((ping.storageUsedBytes || 0) / (1024 * 1024 * 1024)).toFixed(2)} GB\n`);

  if (isPull) {
    // -------------------------------------------------------------------------
    // PULL MODE: Reverse-sync from Google Drive to local public/uploads
    // -------------------------------------------------------------------------
    console.log('[2/3] Querying attachments with Google Drive references from database...');
    const taskAttachments = await prisma.taskAttachment.findMany();
    let pulledCount = 0;

    for (const att of taskAttachments) {
      const driveFileId = extractDriveFileId(att.fileUrl);
      if (!driveFileId) {
        console.log(`  - [SKIP] ${att.fileName}: Already stored locally (${att.fileUrl})`);
        continue;
      }

      console.log(`  - [PULL] Downloading ${att.fileName} (fileId: ${driveFileId})...`);
      const driveFile = await downloadFromGoogleDrive(driveFileId);

      const targetDir = path.join(process.cwd(), 'public', 'uploads', 'tasks', att.taskId);
      fs.mkdirSync(targetDir, { recursive: true });

      const localFileName = `${Date.now()}-${att.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const localFilePath = path.join(targetDir, localFileName);
      fs.writeFileSync(localFilePath, driveFile.buffer);

      const localUrl = `/uploads/tasks/${att.taskId}/${localFileName}`;
      await prisma.taskAttachment.update({
        where: { id: att.id },
        data: { fileUrl: localUrl },
      });

      console.log(`    -> Saved to ${localUrl} and updated database.`);
      pulledCount++;
    }

    console.log(`\n[3/3] Pull complete. Reverse-synced ${pulledCount} files to local storage.`);
    return;
  }

  // ---------------------------------------------------------------------------
  // PUSH MODE: Upload local public/uploads files to Google Drive
  // ---------------------------------------------------------------------------
  console.log('[2/3] Querying local task attachments to migrate into Google Drive...');
  const taskAttachments = await prisma.taskAttachment.findMany();
  let uploadedCount = 0;

  for (const att of taskAttachments) {
    const existingDriveId = extractDriveFileId(att.fileUrl);
    if (existingDriveId) {
      console.log(`  - [SKIP] ${att.fileName}: Already stored in Google Drive (fileId: ${existingDriveId})`);
      continue;
    }

    // Resolve local disk file
    let candidatePath = '';
    const cleanUrl = att.fileUrl.startsWith('/') ? att.fileUrl.slice(1) : att.fileUrl;
    const pathsToTry = [
      path.join(process.cwd(), 'public', cleanUrl),
      path.join(process.cwd(), cleanUrl),
      path.join(process.cwd(), 'public', 'uploads', 'tasks', att.taskId, path.basename(att.fileUrl)),
      path.join(process.cwd(), 'uploads', path.basename(att.fileUrl)),
    ];

    for (const p of pathsToTry) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        candidatePath = p;
        break;
      }
    }

    if (!candidatePath) {
      console.warn(`  - [WARN] ${att.fileName}: Local file not found on disk at paths: ${pathsToTry.join(', ')}`);
      continue;
    }

    console.log(`  - [UPLOAD] Uploading ${att.fileName} from ${candidatePath} to Google Drive...`);
    const buffer = fs.readFileSync(candidatePath);

    const d = new Date();
    const subFolder = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    const driveResult = await uploadToGoogleDrive({
      target: 'ATTACHMENTS',
      fileName: att.fileName,
      mimeType: att.fileType || 'application/octet-stream',
      buffer,
      subFolder,
    });

    const newUrl = `/api/attachments/drive/${driveResult.fileId}?name=${encodeURIComponent(att.fileName)}`;
    await prisma.taskAttachment.update({
      where: { id: att.id },
      data: { fileUrl: newUrl },
    });

    console.log(`    -> Uploaded to Drive: ${driveResult.fileId}`);
    console.log(`    -> Database fileUrl updated to: ${newUrl}`);
    uploadedCount++;
  }

  // Also check legacy Attachment table if any records exist
  const legacyAttachments = await prisma.attachment.findMany();
  for (const leg of legacyAttachments) {
    const existingDriveId = extractDriveFileId(leg.filepath);
    if (existingDriveId) continue;

    const diskPath = path.resolve(process.cwd(), 'uploads', leg.filepath);
    if (fs.existsSync(diskPath)) {
      const buffer = fs.readFileSync(diskPath);
      const driveResult = await uploadToGoogleDrive({
        target: 'ATTACHMENTS',
        fileName: leg.filename,
        mimeType: leg.mimeType,
        buffer,
      });

      const newUrl = `/api/attachments/drive/${driveResult.fileId}?name=${encodeURIComponent(leg.filename)}`;
      await prisma.attachment.update({
        where: { id: leg.id },
        data: { filepath: newUrl },
      });
      uploadedCount++;
    }
  }

  console.log(`\n[3/3] Push complete. Uploaded and linked ${uploadedCount} attachments in Google Drive.`);
}

main()
  .catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
