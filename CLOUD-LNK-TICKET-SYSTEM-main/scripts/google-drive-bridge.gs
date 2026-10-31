/**
 * Google Workspace Drive Apps Script Bridge Web App
 * 
 * Supports:
 * - GET:
 *     - action=PING -> Status & quota check
 *     - action=GET_AUTH_TOKEN -> Returns { ok: true, accessToken, folderId }
 * - POST:
 *     - action=GET_AUTH_TOKEN -> Returns { ok: true, accessToken, folderId }
 *     - action=INIT_RESUMABLE_UPLOAD -> Direct Google Drive v3 Resumable Upload URL for 50MB-100MB+ files
 *     - action=UPLOAD -> Fast Base64 upload for small files (<= 4MB)
 *     - action=DOWNLOAD -> Base64 download fallback
 *     - action=DELETE_FILE -> Move file to Google Drive trash
 *     - action=LIST_BACKUPS -> Enumerate database backup snapshots
 *
 * Deployment Instructions in Google Apps Script:
 * 1. Open your Apps Script project (https://script.google.com).
 * 2. Paste this entire code into Code.gs.
 * 3. In appsscript.json, ensure oauthScopes includes:
 *      "https://www.googleapis.com/auth/drive",
 *      "https://www.googleapis.com/auth/script.external_request"
 * 4. Click Deploy -> Manage deployments -> Edit (pencil icon) -> Version: New version -> Deploy.
 */

var BRIDGE_SECRET = "lk-drive-bridge-secret-2026";
var ATTACHMENTS_FOLDER_ID = "1ZJK8oCnqWdP7KC8M2YRzc-5l4WEBVy2x";
var BACKUPS_FOLDER_ID = "1q7B4f-vS9SJ14nlQWSMpeu6KQ5DHQ1qX";

function getFolderById(id) {
  var cleanId = id;
  var match = id.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) cleanId = match[1];
  return DriveApp.getFolderById(cleanId);
}

function getOrCreateSubFolder(parentFolder, subFolderName) {
  if (!subFolderName) return parentFolder.getId();
  var parts = subFolderName.split('/').filter(Boolean);
  var current = parentFolder;
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    var it = current.getFoldersByName(part);
    if (it.hasNext()) {
      current = it.next();
    } else {
      current = current.createFolder(part);
    }
  }
  return current.getId();
}

function doGet(e) {
  try {
    var p = e ? e.parameter : {};
    var token = p.token;
    if (token !== BRIDGE_SECRET) {
      return jsonOut({ ok: false, error: "Unauthorized: Invalid bridge token" });
    }

    var action = (p.action || "PING").toUpperCase();

    if (action === "PING") {
      var root = DriveApp.getRootFolder();
      var storageUsed = DriveApp.getStorageUsed();
      var storageLimit = DriveApp.getStorageLimit();
      return jsonOut({
        ok: true,
        status: "GOOGLE_DRIVE_BRIDGE_ONLINE",
        attachmentsFolderName: "GOOGLE_DRIVE_ATTACHMENTS_FOLDER_ID",
        backupsFolderName: "GOOGLE_DRIVE_BACKUPS_FOLDER_ID",
        storageUsedBytes: storageUsed,
        storageLimitBytes: storageLimit
      });
    }

    if (action === "GET_AUTH_TOKEN") {
      var accessToken = ScriptApp.getOAuthToken();
      var target = (p.target || "ATTACHMENTS").toUpperCase();
      var parentId = target === "BACKUPS" ? BACKUPS_FOLDER_ID : ATTACHMENTS_FOLDER_ID;
      var parentFolder = getFolderById(parentId);
      var folderId = parentFolder.getId();
      if (p.subFolder) {
        folderId = getOrCreateSubFolder(parentFolder, p.subFolder);
      }
      return jsonOut({
        ok: true,
        accessToken: accessToken,
        folderId: folderId
      });
    }

    return jsonOut({ ok: false, error: "Unknown GET action: " + action });
  } catch (err) {
    return jsonOut({ ok: false, error: err.toString() });
  }
}

function doPost(e) {
  try {
    var postData = "";
    if (e && e.postData && e.postData.contents) {
      postData = e.postData.contents;
    }
    var data = JSON.parse(postData || "{}");
    if (data.token !== BRIDGE_SECRET) {
      return jsonOut({ ok: false, error: "Unauthorized: Invalid bridge token" });
    }

    var action = (data.action || "").toUpperCase();

    if (action === "GET_AUTH_TOKEN") {
      var accessToken = ScriptApp.getOAuthToken();
      var target = (data.target || "ATTACHMENTS").toUpperCase();
      var parentId = target === "BACKUPS" ? BACKUPS_FOLDER_ID : ATTACHMENTS_FOLDER_ID;
      var parentFolder = getFolderById(parentId);
      var folderId = parentFolder.getId();
      if (data.subFolder) {
        folderId = getOrCreateSubFolder(parentFolder, data.subFolder);
      }
      return jsonOut({
        ok: true,
        accessToken: accessToken,
        folderId: folderId
      });
    }

    if (action === "INIT_RESUMABLE_UPLOAD") {
      var accessToken = ScriptApp.getOAuthToken();
      var target = (data.target || "ATTACHMENTS").toUpperCase();
      var parentId = target === "BACKUPS" ? BACKUPS_FOLDER_ID : ATTACHMENTS_FOLDER_ID;
      var parentFolder = getFolderById(parentId);
      var folderId = parentFolder.getId();
      if (data.subFolder) {
        folderId = getOrCreateSubFolder(parentFolder, data.subFolder);
      }

      var fileName = data.fileName || "unnamed_attachment";
      var mimeType = data.mimeType || "application/octet-stream";
      var origin = data.origin || "*";

      var metadata = {
        name: fileName,
        mimeType: mimeType,
        parents: [folderId]
      };

      var headers = {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType
      };

      var initRes = UrlFetchApp.fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
        {
          method: "post",
          headers: headers,
          payload: JSON.stringify(metadata),
          muteHttpExceptions: true
        }
      );

      var resHeaders = initRes.getHeaders();
      var uploadUrl = resHeaders["Location"] || resHeaders["location"];
      if (!uploadUrl) {
        return jsonOut({
          ok: false,
          error: "Failed to obtain resumable upload URL: " + initRes.getContentText()
        });
      }

      return jsonOut({
        ok: true,
        uploadUrl: uploadUrl,
        accessToken: accessToken,
        folderId: folderId
      });
    }

    // Standard Base64 UPLOAD for small files (<= 4MB)
    if (action === "UPLOAD") {
      var target = (data.target || "ATTACHMENTS").toUpperCase();
      var parentId = target === "BACKUPS" ? BACKUPS_FOLDER_ID : ATTACHMENTS_FOLDER_ID;
      var parentFolder = getFolderById(parentId);
      var targetFolder = parentFolder;
      if (data.subFolder) {
        var subId = getOrCreateSubFolder(parentFolder, data.subFolder);
        targetFolder = DriveApp.getFolderById(subId);
      }

      var bytes = Utilities.base64Decode(data.base64Data);
      var blob = Utilities.newBlob(bytes, data.mimeType || "application/octet-stream", data.fileName || "file");
      var file = targetFolder.createFile(blob);

      return jsonOut({
        ok: true,
        fileId: file.getId(),
        fileName: file.getName(),
        sizeBytes: file.getSize(),
        createdAt: file.getDateCreated().toISOString(),
        viewUrl: file.getUrl(),
        downloadUrl: file.getDownloadUrl()
      });
    }

    // DOWNLOAD
    if (action === "DOWNLOAD") {
      var file = DriveApp.getFileById(data.fileId);
      var blob = file.getBlob();
      var base64Data = Utilities.base64Encode(blob.getBytes());
      return jsonOut({
        ok: true,
        fileName: file.getName(),
        mimeType: blob.getContentType(),
        sizeBytes: file.getSize(),
        base64Data: base64Data
      });
    }

    // DELETE_FILE
    if (action === "DELETE_FILE") {
      var file = DriveApp.getFileById(data.fileId);
      file.setTrashed(true);
      return jsonOut({
        ok: true,
        deletedFileId: data.fileId
      });
    }

    // LIST_BACKUPS
    if (action === "LIST_BACKUPS") {
      var folder = getFolderById(BACKUPS_FOLDER_ID);
      var files = [];
      var it = folder.getFiles();
      while (it.hasNext()) {
        var f = it.next();
        files.push({
          fileId: f.getId(),
          filename: f.getName(),
          sizeBytes: f.getSize(),
          createdAt: f.getDateCreated().toISOString(),
          viewUrl: f.getUrl(),
          downloadUrl: f.getDownloadUrl()
        });
      }
      return jsonOut({
        ok: true,
        files: files
      });
    }

    return jsonOut({ ok: false, error: "Unsupported POST action: " + action });
  } catch (err) {
    return jsonOut({ ok: false, error: err.toString() });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
