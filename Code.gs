
/**
 * LSU MEMBERSHIP BACKEND
 * Google Apps Script Web App
 * Database: Google Sheets
 * Files: Google Drive
 */

const CONFIG = {
  SHEET_NAME: "Members",
  OTP_SHEET_NAME: "OTP",
  ADMIN_SHEET_NAME: "Administrators",
  DOC_UPDATES_SHEET_NAME: "DocumentUpdates",
  ROOT_DRIVE_FOLDER_ID: "1wIX_Hnr3T3lX1xpYzDm9G3kBlDm8FRk3",

  EMAIL_OTP_PREFIX: "LSU",
  EMAIL_OTP_EXPIRY_MINUTES: 5,
  ADMIN_OTP_EXPIRY_MINUTES: 5,
  MAX_OTP_ATTEMPTS: 3,

  DOC_UPDATE_EXPIRY_HOURS: 24,
  VERIFICATION_EXPIRY_HOURS: 24,

  MAX_SINGLE_FILE_BYTES: 5 * 1024 * 1024,
  MAX_TOTAL_UPLOAD_BYTES: 15 * 1024 * 1024,

  FRONTEND_UPDATE_URL:
    "https://lsu-odisha.vercel.app/update-portal/index.html",

  ADMIN_SESSION_TTL_SECONDS: 900,
  ADMIN_SESSION_PREFIX: "LSU_ADMIN_SESSION_"
};

const CHIEF_ADMIN_EMAIL = "solojackson2022@gmail.com";

const MEMBERS_HEADERS = [
  "Timestamp","Email","Membership Type","First Name","Middle Name",
  "Last Name","Gender","Date of Birth","Position / Role",
  "WhatsApp Number","Mobile Number","Passport Number",
  "College Registration Number","University","Degree Type",
  "Study From","Study To","Field of Studies","Mother Name",
  "Father Name","Parents Contact","Graduation Date","EFRO File",
  "Passport Document","Identification Photo","Privacy Consent",
  "Application ID","Application Status","Submission Date",
  "Review Date","Reviewed By","Verification Code",
  "Verification Sent Date","Verification Reply Date","Membership ID",
  "Membership Confirmed Date","Rejection Reason"
];

const OTP_HEADERS = [
  "Email","OTP","OTP Type","Created Date","Expiry Date",
  "Attempts","Verified","Verified Date"
];

const ADMIN_HEADERS = [
  "Email","Name","Role","Status","Added Date","Added By",
  "Admin OTP","OTP Expiry","OTP Verified","OTP Attempts"
];

const DOC_UPDATE_HEADERS = [
  "Update ID","Application ID","Applicant Email","Document Type",
  "Previous File ID","Previous File URL","New File ID","New File URL",
  "Requested By","Request Date","Reason","Applicant Upload Date",
  "Update Status","Reviewed Date","Reviewed By"
];

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function extractEmail(value) {
  const s = String(value || "").trim().toLowerCase();
  const m = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : "";
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extractEmail(email));
}

function now() {
  return new Date();
}

function formatExactDateTime(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone() || "GMT+05:30",
    "MMMM dd, yyyy 'at' hh:mm a z"
  );
}

function findColumn(headers, name) {
  const wanted = String(name || "").trim().toLowerCase();
  return headers.findIndex(h =>
    String(h || "").trim().toLowerCase() === wanted
  );
}

function ensureHeaders(sheet, expectedHeaders) {
  const current = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    : [];

  const matches =
    current.length === expectedHeaders.length &&
    expectedHeaders.every((h, i) =>
      String(current[i] || "").trim() === h
    );

  if (!matches) {
    if (sheet.getLastRow() > 1) {
      throw new Error(
        sheet.getName() +
        " headers do not match the required structure. Correct the sheet headers before using the system."
      );
    }
    sheet.getRange(1, 1, 1, expectedHeaders.length)
      .setValues([expectedHeaders]);
  }
}

function getSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  ensureHeaders(sheet, headers);
  return sheet;
}

function getMembersSheet() {
  return getSheet(CONFIG.SHEET_NAME, MEMBERS_HEADERS);
}

function getOTPSheet() {
  return getSheet(CONFIG.OTP_SHEET_NAME, OTP_HEADERS);
}

function getAdminSheet() {
  const sheet = getSheet(CONFIG.ADMIN_SHEET_NAME, ADMIN_HEADERS);

  const data = sheet.getDataRange().getValues();
  const chief = extractEmail(CHIEF_ADMIN_EMAIL);

  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (extractEmail(data[i][0]) === chief) {
      found = true;
      break;
    }
  }

  if (!found) {
    sheet.appendRow([
      chief,
      "Chief Administrator",
      "CHIEF_ADMINISTRATOR",
      "ACTIVE",
      now(),
      "SYSTEM",
      "",
      "",
      "No",
      0
    ]);
  }

  return sheet;
}

function getDocumentUpdatesSheet() {
  return getSheet(
    CONFIG.DOC_UPDATES_SHEET_NAME,
    DOC_UPDATE_HEADERS
  );
}

function sendEmail(to, subject, body) {
  const email = extractEmail(to);
  if (!email) throw new Error("Invalid email recipient.");

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: body
  });
}

function generateEmailOTP() {
  return CONFIG.EMAIL_OTP_PREFIX +
    Math.floor(1000 + Math.random() * 9000);
}

function generateAdminOTP() {
  return "ADM" +
    Math.floor(100 + Math.random() * 900) +
    "LSU";
}

function sendOTP(email) {
  email = extractEmail(email);
  if (!validateEmail(email)) {
    return { success: false, message: "Please enter a valid email address." };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getOTPSheet();
    const code = generateEmailOTP();
    const created = now();
    const expiry = new Date(
      created.getTime() +
      CONFIG.EMAIL_OTP_EXPIRY_MINUTES * 60000
    );

    // Invalidate older active codes for this email.
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (
        extractEmail(values[i][0]) === email &&
        String(values[i][6] || "").toUpperCase() !== "YES"
      ) {
        sheet.getRange(i + 1, 6).setValue(CONFIG.MAX_OTP_ATTEMPTS);
      }
    }

    sheet.appendRow([
      email,
      code,
      "EMAIL_VERIFICATION",
      created,
      expiry,
      0,
      "No",
      ""
    ]);

    sendEmail(
      email,
      "LSU Email Verification Code",
      "Your LSU email verification code is:\n\n" +
      code +
      "\n\nThis code expires in " +
      CONFIG.EMAIL_OTP_EXPIRY_MINUTES +
      " minutes.\n\n" +
      "If you did not request this code, ignore this email.\n\n" +
      "Liberian Students Union in Odisha"
    );

    return {
      success: true,
      message: "Verification code sent successfully."
    };
  } finally {
    lock.releaseLock();
  }
}

function verifyOTP(email, enteredOTP) {
  email = extractEmail(email);
  enteredOTP = String(enteredOTP || "").trim().toUpperCase();

  if (!validateEmail(email) || !enteredOTP) {
    return {
      success: false,
      message: "Email and verification code are required."
    };
  }

  const sheet = getOTPSheet();
  const values = sheet.getDataRange().getValues();

  for (let i = values.length - 1; i >= 1; i--) {
    if (extractEmail(values[i][0]) !== email) continue;

    const code = String(values[i][1] || "").trim().toUpperCase();
    const expiry = new Date(values[i][4]);
    let attempts = Number(values[i][5] || 0);
    const verified = String(values[i][6] || "").toUpperCase();

    if (verified === "YES") {
      return { success: false, message: "This code has already been used." };
    }

    if (attempts >= CONFIG.MAX_OTP_ATTEMPTS) {
      return {
        success: false,
        message: "Maximum attempts reached. Please request a new code."
      };
    }

    if (isNaN(expiry.getTime()) || now() > expiry) {
      return {
        success: false,
        message: "This verification code has expired. Please request a new code."
      };
    }

    if (code === enteredOTP) {
      sheet.getRange(i + 1, 7, 1, 2)
        .setValues([["Yes", now()]]);
      return {
        success: true,
        message: "Email successfully verified."
      };
    }

    attempts++;
    sheet.getRange(i + 1, 6).setValue(attempts);

    return {
      success: false,
      message:
        "Incorrect verification code. Attempt " +
        attempts + "/" + CONFIG.MAX_OTP_ATTEMPTS + "."
    };
  }

  return {
    success: false,
    message: "No active verification code found. Please request a new code."
  };
}

function validateFile(file, label, type) {
  if (!file || !file.content || !file.name) {
    throw new Error(label + " is required.");
  }

  const bytes = Utilities.base64Decode(file.content);
  if (bytes.length > CONFIG.MAX_SINGLE_FILE_BYTES) {
    throw new Error(
      "File size exceeds the 5 MB limit. Please upload a smaller file."
    );
  }

  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();

  if (type === "PDF") {
    if (!(mime === "application/pdf" || name.endsWith(".pdf"))) {
      throw new Error(label + " must be a PDF file.");
    }
  }

  if (type === "IMAGE") {
    if (
      !(
        mime === "image/jpeg" ||
        mime === "image/jpg" ||
        name.endsWith(".jpg") ||
        name.endsWith(".jpeg")
      )
    ) {
      throw new Error(label + " must be a JPG/JPEG file.");
    }
  }

  return {
    bytes: bytes,
    size: bytes.length
  };
}

function saveFile(file, folder) {
  const bytes = Utilities.base64Decode(file.content);
  const blob = Utilities.newBlob(
    bytes,
    file.type || "application/octet-stream",
    file.name
  );
  return folder.createFile(blob);
}

function getOrCreateFolder(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext()
    ? folders.next()
    : parent.createFolder(name);
}

function findApplication(appId) {
  const sheet = getMembersSheet();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][26] || "").trim().toUpperCase() === appId.toUpperCase()) {
      return {
        sheet: sheet,
        rowNumber: i + 1,
        row: values[i]
      };
    }
  }

  throw new Error("Application '" + appId + "' was not found.");
}

function getApplicantName(row) {
  return (
    String(row[3] || "").trim() +
    " " +
    String(row[5] || "").trim()
  ).trim() || "Applicant";
}

function getApplicantEmail(row) {
  return extractEmail(row[1]);
}

function getApplicationFolder(appId, membershipType) {
  const root = DriveApp.getFolderById(CONFIG.ROOT_DRIVE_FOLDER_ID);
  const year = getOrCreateFolder(root, String(now().getFullYear()));
  const category = getOrCreateFolder(
    year,
    String(membershipType || "").toUpperCase().includes("ALUMNI")
      ? "Alumni"
      : "Current Students"
  );
  return getOrCreateFolder(category, appId);
}

function submitApplication(payload) {
  const data = payload.data || {};
  const email = extractEmail(payload.email || data["Email"]);

  if (!validateEmail(email)) {
    throw new Error("A valid email address is required.");
  }

  const typeRaw = String(data["Membership Type"] || "").trim();
  const membershipType =
    typeRaw.toUpperCase().includes("ALUMNI")
      ? "Alumni"
      : typeRaw.toUpperCase().includes("STUDENT")
        ? "Current Student"
        : "";

  if (!membershipType) {
    throw new Error("Invalid membership type.");
  }

  const idPhoto =
    payload.identificationPhoto ||
    payload.passportPhoto;

  const passportDocument =
    payload.passportDocument ||
    payload.passportFile;

  const efro = payload.efroFile || payload.efro;

  const idPhotoValid = validateFile(
    idPhoto,
    "Identification Photo",
    "IMAGE"
  );

  const passportValid = validateFile(
    passportDocument,
    "Passport Document",
    "PDF"
  );

  let total = idPhotoValid.size + passportValid.size;
  let efroValid = null;

  if (membershipType === "Current Student") {
    efroValid = validateFile(efro, "EFRO File", "PDF");
    total += efroValid.size;
  }

  if (total > CONFIG.MAX_TOTAL_UPLOAD_BYTES) {
    throw new Error(
      "Total document/image size exceeds the 15 MB limit. Please reduce the file sizes."
    );
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getMembersSheet();
    const appId =
      "APP-" +
      now().getFullYear() +
      "-" +
      Utilities.getUuid().split("-")[0].toUpperCase();

    const folder = getApplicationFolder(appId, membershipType);

    const efroFile = membershipType === "Current Student"
      ? saveFile(efro, folder)
      : null;

    const passportFile = saveFile(passportDocument, folder);
    const photoFile = saveFile(idPhoto, folder);

    const row = new Array(37).fill("");

    row[0] = now();
    row[1] = email;
    row[2] = membershipType;
    row[3] = data["First Name"] || "";
    row[4] = data["Middle Name"] || "";
    row[5] = data["Last Name"] || "";
    row[6] = data["Gender"] || "";
    row[7] = data["Date of Birth"] || "";
    row[8] =
      data["Position / Role"] ||
      data["Membership Status/Role"] ||
      data["Alumni Position Role"] ||
      "";
    row[9] = data["WhatsApp Number"] || "";
    row[10] = data["Mobile Number"] || "";
    row[11] = data["Passport Number"] || "";
    row[12] = data["College Registration Number"] || "";
    row[13] = data["University"] || "";
    row[14] = data["Degree Type"] || "";
    row[15] = data["Study From"] || "";
    row[16] = data["Study To"] || "";
    row[17] = data["Field of Studies"] || "";
    row[18] = data["Mother Name"] || "";
    row[19] = data["Father Name"] || "";
    row[20] = data["Parents Contact"] || "";
    row[21] = data["Graduation Date"] || "";
    row[22] = efroFile ? efroFile.getUrl() : "";
    row[23] = passportFile.getUrl();
    row[24] = photoFile.getUrl();
    row[25] = data["Privacy Consent"] || "";
    row[26] = appId;
    row[27] = "UNDER_REVIEW";
    row[28] = now();

    sheet.appendRow(row);

    sendEmail(
      email,
      "LSU Membership Application Received - " + appId,
      "Dear " + getApplicantName(row) + ",\n\n" +
      "Your LSU membership application has been received.\n\n" +
      "Application ID: " + appId + "\n" +
      "Status: UNDER_REVIEW\n\n" +
      "Please monitor your email for further updates.\n\n" +
      "Liberian Students Union in Odisha"
    );

    return {
      success: true,
      applicationId: appId,
      message: "Application submitted successfully."
    };
  } finally {
    lock.releaseLock();
  }
}

function isChiefAdministrator(email) {
  return extractEmail(email) === extractEmail(CHIEF_ADMIN_EMAIL);
}

function checkAdministratorAccess(email) {
  email = extractEmail(email);

  if (!validateEmail(email)) {
    return {
      success: false,
      authorized: false,
      message: "Administrator email is required."
    };
  }

  if (isChiefAdministrator(email)) {
    return {
      success: true,
      authorized: true,
      email: email,
      name: "Chief Administrator",
      role: "CHIEF_ADMINISTRATOR"
    };
  }

  const sheet = getAdminSheet();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (
      extractEmail(values[i][0]) === email &&
      String(values[i][3]).toUpperCase() === "ACTIVE"
    ) {
      return {
        success: true,
        authorized: true,
        email: email,
        name: String(values[i][1] || "Administrator"),
        role: String(values[i][2] || "CO_ADMINISTRATOR")
      };
    }
  }

  return {
    success: true,
    authorized: false,
    message: "This email is not authorized to access the Administrator Portal."
  };
}

function sendAdministratorOTP(email) {
  email = extractEmail(email);
  const access = checkAdministratorAccess(email);

  if (!access.authorized) {
    return {
      success: false,
      message: "This email is not authorized to access the Administrator Portal."
    };
  }

  const sheet = getAdminSheet();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (extractEmail(values[i][0]) !== email) continue;

    const code = generateAdminOTP();
    const expiry = new Date(
      now().getTime() + CONFIG.ADMIN_OTP_EXPIRY_MINUTES * 60000
    );

    sheet.getRange(i + 1, 7, 1, 4).setValues([[
      code,
      expiry,
      "No",
      0
    ]]);

    sendEmail(
      email,
      "LSU Administrator Verification Code",
      "Dear " + String(values[i][1] || "Administrator") + ",\n\n" +
      "Your administrator verification code is:\n\n" +
      code + "\n\n" +
      "This code expires in " +
      CONFIG.ADMIN_OTP_EXPIRY_MINUTES +
      " minutes.\n\n" +
      "Liberian Students Union in Odisha"
    );

    return {
      success: true,
      message: "Administrator verification code sent."
    };
  }

  return {
    success: false,
    message: "Administrator account not found."
  };
}

function verifyAdministratorOTP(email, enteredOTP) {
  email = extractEmail(email);
  enteredOTP = String(enteredOTP || "").trim().toUpperCase();

  const access = checkAdministratorAccess(email);
  if (!access.authorized) {
    return { success: false, message: "Unauthorized administrator." };
  }

  const sheet = getAdminSheet();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (extractEmail(values[i][0]) !== email) continue;

    const stored = String(values[i][6] || "").toUpperCase();
    const expiry = new Date(values[i][7]);
    const verified = String(values[i][8] || "").toUpperCase();
    let attempts = Number(values[i][9] || 0);

    if (verified === "YES") {
      return { success: false, message: "Code already used." };
    }

    if (attempts >= CONFIG.MAX_OTP_ATTEMPTS) {
      return { success: false, message: "Maximum attempts reached. Request a new code." };
    }

    if (isNaN(expiry.getTime()) || now() > expiry) {
      return { success: false, message: "Administrator code expired." };
    }

    if (stored === enteredOTP) {
      const token = Utilities.getUuid();

      sheet.getRange(i + 1, 9).setValue("Yes");

      CacheService.getScriptCache().put(
        CONFIG.ADMIN_SESSION_PREFIX + token,
        JSON.stringify({
          email: email,
          name: access.name,
          role: access.role
        }),
        CONFIG.ADMIN_SESSION_TTL_SECONDS
      );

      return {
        success: true,
        authorized: true,
        email: email,
        name: access.name,
        role: access.role,
        sessionToken: token
      };
    }

    attempts++;
    sheet.getRange(i + 1, 10).setValue(attempts);

    return {
      success: false,
      message:
        "Incorrect code. Attempt " +
        attempts +
        "/" +
        CONFIG.MAX_OTP_ATTEMPTS +
        "."
    };
  }

  return {
    success: false,
    message: "Administrator account not found."
  };
}

function requireAdministratorSession(token) {
  token = String(token || "").trim();
  if (!token) throw new Error("Administrator session is required.");

  const cache = CacheService.getScriptCache();
  const raw = cache.get(CONFIG.ADMIN_SESSION_PREFIX + token);

  if (!raw) {
    throw new Error("Administrator session expired. Please log in again.");
  }

  const session = JSON.parse(raw);
  const access = checkAdministratorAccess(session.email);

  if (!access.authorized) {
    throw new Error("Administrator access has been revoked.");
  }

  cache.put(
    CONFIG.ADMIN_SESSION_PREFIX + token,
    raw,
    CONFIG.ADMIN_SESSION_TTL_SECONDS
  );

  return session;
}

function logoutAdministrator(token) {
  CacheService.getScriptCache().remove(
    CONFIG.ADMIN_SESSION_PREFIX + String(token || "").trim()
  );
  return { success: true };
}

function getDashboardData(sessionToken) {
  const session = requireAdministratorSession(sessionToken);
  const sheet = getMembersSheet();
  const values = sheet.getDataRange().getValues();

  const statistics = {
    currentStudents: {
      total: 0, male: 0, female: 0,
      bachelorCandidate: 0, masters: 0, phd: 0
    },
    alumni: {
      total: 0, male: 0, female: 0,
      bachelor: 0, masters: 0, phd: 0
    }
  };

  const applications = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every(v => String(v || "").trim() === "")) continue;

    const type = String(row[2] || "").toUpperCase();
    const gender = String(row[6] || "").toUpperCase();
    const degree = String(row[14] || "").toUpperCase();

    const stats = type.includes("ALUMNI")
      ? statistics.alumni
      : statistics.currentStudents;

    stats.total++;

    if (gender === "MALE") stats.male++;
    if (gender === "FEMALE") stats.female++;

    if (degree.includes("BACHELOR")) {
      if (type.includes("ALUMNI")) stats.bachelor++;
      else stats.bachelorCandidate++;
    }

    if (degree.includes("MASTER")) stats.masters++;
    if (degree.includes("PHD")) stats.phd++;

    const app = {};
    MEMBERS_HEADERS.forEach((h, index) => {
      let value = row[index];
      if (value instanceof Date) {
        value = Utilities.formatDate(
          value,
          Session.getScriptTimeZone(),
          "yyyy-MM-dd HH:mm:ss"
        );
      }
      app[h] = value;
    });

    applications.push(app);
  }

  return {
    success: true,
    administrator: session,
    statistics: statistics,
    applications: applications
  };
}

function addAdministrator(sessionToken, newEmail, newName) {
  const session = requireAdministratorSession(sessionToken);

  if (session.role !== "CHIEF_ADMINISTRATOR") {
    throw new Error("Only the Chief Administrator can add administrators.");
  }

  newEmail = extractEmail(newEmail);
  newName = String(newName || "").trim();

  if (!validateEmail(newEmail) || !newName) {
    throw new Error("Administrator name and valid email are required.");
  }

  if (isChiefAdministrator(newEmail)) {
    throw new Error("The Chief Administrator cannot be added again.");
  }

  const sheet = getAdminSheet();
  const values = sheet.getDataRange().getValues();
  let activeCoAdmins = 0;

  for (let i = 1; i < values.length; i++) {
    if (extractEmail(values[i][0]) === newEmail) {
      throw new Error("This administrator already exists.");
    }

    if (
      String(values[i][2]).toUpperCase() === "CO_ADMINISTRATOR" &&
      String(values[i][3]).toUpperCase() === "ACTIVE"
    ) {
      activeCoAdmins++;
    }
  }

  if (activeCoAdmins >= 3) {
    throw new Error("Maximum of 3 active co-administrators reached.");
  }

  sheet.appendRow([
    newEmail,
    newName,
    "CO_ADMINISTRATOR",
    "ACTIVE",
    now(),
    session.email,
    "",
    "",
    "No",
    0
  ]);

  sendEmail(
    newEmail,
    "LSU Administrator Access Authorized",
    "Dear " + newName + ",\n\n" +
    "You have been authorized as an LSU Co-Administrator.\n\n" +
    "You will receive a verification code when you log in.\n\n" +
    "Liberian Students Union in Odisha"
  );

  return {
    success: true,
    message: "Co-Administrator added successfully."
  };
}

function deactivateAdministrator(sessionToken, targetEmail) {
  const session = requireAdministratorSession(sessionToken);

  if (session.role !== "CHIEF_ADMINISTRATOR") {
    throw new Error("Only the Chief Administrator can deactivate administrators.");
  }

  targetEmail = extractEmail(targetEmail);

  if (isChiefAdministrator(targetEmail)) {
    throw new Error("The Chief Administrator cannot be deactivated.");
  }

  const sheet = getAdminSheet();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (extractEmail(values[i][0]) === targetEmail) {
      sheet.getRange(i + 1, 4).setValue("DEACTIVATED");
      return { success: true, message: "Administrator deactivated." };
    }
  }

  throw new Error("Administrator not found.");
}

function reactivateAdministrator(sessionToken, targetEmail) {
  const session = requireAdministratorSession(sessionToken);

  if (session.role !== "CHIEF_ADMINISTRATOR") {
    throw new Error("Only the Chief Administrator can reactivate administrators.");
  }

  targetEmail = extractEmail(targetEmail);

  const sheet = getAdminSheet();
  const values = sheet.getDataRange().getValues();

  let activeCoAdmins = 0;

  for (let i = 1; i < values.length; i++) {
    if (
      String(values[i][2]).toUpperCase() === "CO_ADMINISTRATOR" &&
      String(values[i][3]).toUpperCase() === "ACTIVE"
    ) {
      activeCoAdmins++;
    }
  }

  if (activeCoAdmins >= 3) {
    throw new Error("Maximum of 3 active co-administrators reached.");
  }

  for (let i = 1; i < values.length; i++) {
    if (extractEmail(values[i][0]) === targetEmail) {
      sheet.getRange(i + 1, 4).setValue("ACTIVE");
      return { success: true, message: "Administrator reactivated." };
    }
  }

  throw new Error("Administrator not found.");
}

function generateDocumentToken() {
  return Utilities.getUuid().replace(/-/g, "");
}

function createDocumentUpdate(payload) {
  const session = requireAdministratorSession(payload.sessionToken);
  const appId = String(payload.applicationId || "").trim();
  let docType = String(payload.updateDocType || "").trim();
  const reason = String(payload.reason || payload.rejectionReason || "").trim();

  if (docType === "Passport Photo") docType = "Identification Photo";

  const allowed = [
    "EFRO File",
    "Passport Document",
    "Identification Photo"
  ];

  if (!allowed.includes(docType)) {
    throw new Error("Invalid document type.");
  }

  if (!appId || !reason) {
    throw new Error("Application ID and reason are required.");
  }

  const found = findApplication(appId);
  const row = found.row;
  const email = getApplicantEmail(row);

  if (!email) throw new Error("Applicant email not found.");

  const previousUrl =
    docType === "EFRO File" ? row[22] :
    docType === "Passport Document" ? row[23] :
    row[24];

  const token = generateDocumentToken();
  const created = now();
  const expiry = new Date(
    created.getTime() +
    CONFIG.DOC_UPDATE_EXPIRY_HOURS * 60 * 60 * 1000
  );

  PropertiesService.getScriptProperties().setProperty(
    "DOC_UPDATE_" + token,
    JSON.stringify({
      appId: appId,
      email: email,
      docType: docType,
      reason: reason,
      createdAt: created.toISOString(),
      expiresAt: expiry.toISOString(),
      requestedBy: session.email
    })
  );

  const updates = getDocumentUpdatesSheet();
  const updateId =
    "UPD-" +
    now().getTime() +
    "-" +
    Math.floor(100 + Math.random() * 900);

  updates.appendRow([
    updateId,
    appId,
    email,
    docType,
    getFileId(previousUrl),
    previousUrl,
    "",
    "",
    session.email,
    created,
    reason,
    "",
    "REQUESTED",
    "",
    ""
  ]);

  found.sheet.getRange(found.rowNumber, 28).setValue("NEEDS_CLARIFICATION");
  found.sheet.getRange(found.rowNumber, 37).setValue(
    "Update requested for: " + docType + ". Reason: " + reason
  );

  const link =
    CONFIG.FRONTEND_UPDATE_URL +
    "?token=" +
    encodeURIComponent(token);

  sendEmail(
    email,
    "LSU Membership - Document Update Required",
    "Dear " + getApplicantName(row) + ",\n\n" +
    "Document required: " + docType + "\n\n" +
    "Reason / Instructions:\n" + reason + "\n\n" +
    "Upload your replacement document here:\n" +
    link + "\n\n" +
    "This secure link is valid for 24 hours and expires on:\n" +
    formatExactDateTime(expiry) + "\n\n" +
    "Liberian Students Union in Odisha"
  );

  return {
    success: true,
    message: "Document update link sent. It expires in 24 hours."
  };
}

function getFileId(url) {
  const match = String(url || "").match(/[-\w]{25,}/);
  return match ? match[0] : "";
}

function resendUploadLink(payload) {
  return createDocumentUpdate(payload);
}

function getDocumentUpdateInfo(token) {
  token = String(token || "").trim();

  const raw = PropertiesService.getScriptProperties()
    .getProperty("DOC_UPDATE_" + token);

  if (!raw) {
    throw new Error("This document update link is invalid or expired.");
  }

  const data = JSON.parse(raw);
  const expiry = new Date(data.expiresAt);

  if (isNaN(expiry.getTime()) || now() > expiry) {
    throw new Error(
      "This document update link expired on " +
      formatExactDateTime(expiry) +
      ". Please request a new link."
    );
  }

  const found = findApplication(data.appId);

  if (String(found.row[27]).toUpperCase() !== "NEEDS_CLARIFICATION") {
    throw new Error("This application is not awaiting a document update.");
  }

  return {
    success: true,
    appId: data.appId,
    docType: data.docType,
    reason: data.reason,
    expiresAt: formatExactDateTime(expiry)
  };
}

function submitDocumentUpdate(payload) {
  const token = String(payload.token || "").trim();

  const raw = PropertiesService.getScriptProperties()
    .getProperty("DOC_UPDATE_" + token);

  if (!raw) throw new Error("Invalid or expired document update link.");

  const data = JSON.parse(raw);
  const expiry = new Date(data.expiresAt);

  if (isNaN(expiry.getTime()) || now() > expiry) {
    throw new Error(
      "This document update link has expired. Please request a new link."
    );
  }

  const file = payload.file;
  const type =
    data.docType === "Identification Photo"
      ? "IMAGE"
      : "PDF";

  validateFile(file, data.docType, type);

  const found = findApplication(data.appId);
  const row = found.row;
  const folder = getApplicationFolder(
    data.appId,
    row[2]
  );

  const newFile = saveFile(file, folder);
  const oldUrl =
    data.docType === "EFRO File" ? row[22] :
    data.docType === "Passport Document" ? row[23] :
    row[24];

  const col =
    data.docType === "EFRO File" ? 23 :
    data.docType === "Passport Document" ? 24 :
    25;

  // New file is saved first. Only then update the database.
  found.sheet.getRange(found.rowNumber, col).setValue(newFile.getUrl());
  found.sheet.getRange(found.rowNumber, 28).setValue("UNDER_REVIEW");

  const updates = getDocumentUpdatesSheet();
  const updateValues = updates.getDataRange().getValues();

  for (let i = updateValues.length - 1; i >= 1; i--) {
    if (
      String(updateValues[i][1]) === data.appId &&
      String(updateValues[i][3]) === data.docType &&
      String(updateValues[i][12]).toUpperCase() === "REQUESTED"
    ) {
      updates.getRange(i + 1, 7, 1, 9).setValues([[
        getFileId(newFile.getUrl()),
        newFile.getUrl(),
        data.requestedBy || "",
        updateValues[i][9],
        updateValues[i][10],
        now(),
        "RECEIVED",
        "",
        ""
      ]]);
      break;
    }
  }

  PropertiesService.getScriptProperties()
    .deleteProperty("DOC_UPDATE_" + token);

  // Archive old file only after the new file and sheet update succeeded.
  if (oldUrl) archiveFile(oldUrl);

  return {
    success: true,
    message: "Document replaced successfully and returned for review."
  };
}

function archiveFile(url) {
  const id = getFileId(url);
  if (!id) return;

  try {
    const file = DriveApp.getFileById(id);
    file.setName("ARCHIVED_" + file.getName());
  } catch (e) {
    Logger.log("Could not archive previous file: " + e);
  }
}

function generateMembershipId(membershipType) {
  const sheet = getMembersSheet();
  const values = sheet.getDataRange().getValues();
  const prefix =
    String(membershipType).toUpperCase().includes("ALUMNI")
      ? "LSUA"
      : "LSU";

  const year = String(now().getFullYear()).slice(-2);
  let max = 0;

  for (let i = 1; i < values.length; i++) {
    const id = String(values[i][34] || "").trim().toUpperCase();
    const m = id.match(new RegExp("^" + year + prefix + "(\\d+)$"));
    if (m) max = Math.max(max, Number(m[1]));
  }

  return year + prefix + String(max + 1).padStart(2, "0");
}

function issueVerificationCode(found) {
  const row = found.row;
  const email = getApplicantEmail(row);
  const name = getApplicantName(row);
  const code =
    "LSU" +
    String(now().getFullYear()).slice(-2) +
    "-" +
    Math.floor(100000 + Math.random() * 900000);

  const sent = now();
  const expiry = new Date(
    sent.getTime() +
    CONFIG.VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000
  );

  found.sheet.getRange(found.rowNumber, 32, 1, 2)
    .setValues([[code, sent]]);

  sendEmail(
    email,
    "LSU Membership Verification Code",
    "Dear " + name + ",\n\n" +
    "Your membership application has reached the final verification stage.\n\n" +
    "Verification Code: " + code + "\n\n" +
    "Reply directly to this email with the code within 24 hours.\n" +
    "The code expires on: " + formatExactDateTime(expiry) + "\n\n" +
    "Liberian Students Union in Odisha"
  );

  PropertiesService.getScriptProperties().setProperty(
    "VERIFICATION_" + found.rowNumber,
    JSON.stringify({
      code: code,
      email: email,
      appId: row[26],
      sentAt: sent.toISOString(),
      expiresAt: expiry.toISOString()
    })
  );
}

function updateApplicationStatus(payload) {
  const session = requireAdministratorSession(payload.sessionToken);
  const appId = String(payload.applicationId || "").trim();
  const newStatus = String(payload.newStatus || "").trim().toUpperCase();
  const reason = String(payload.rejectionReason || "").trim();

  const allowed = [
    "UNDER_REVIEW",
    "NEEDS_CLARIFICATION",
    "REJECTED",
    "VERIFICATION_PENDING",
    "MEMBER_CONFIRMED"
  ];

  if (!allowed.includes(newStatus)) {
    throw new Error("Invalid application status.");
  }

  const found = findApplication(appId);
  const row = found.row;
  const email = getApplicantEmail(row);
  const name = getApplicantName(row);

  if (
    (newStatus === "REJECTED" ||
     newStatus === "NEEDS_CLARIFICATION") &&
    !reason
  ) {
    throw new Error("A reason is required.");
  }

  found.sheet.getRange(found.rowNumber, 28).setValue(newStatus);
  found.sheet.getRange(found.rowNumber, 30, 1, 2)
    .setValues([[now(), session.email]]);

  if (newStatus === "REJECTED") {
    found.sheet.getRange(found.rowNumber, 37).setValue(reason);

    sendEmail(
      email,
      "LSU Membership Application Update - Rejected",
      "Dear " + name + ",\n\n" +
      "Your application (" + appId + ") has been rejected.\n\n" +
      "Reason:\n" + reason + "\n\n" +
      "Liberian Students Union in Odisha"
    );
  }

  if (newStatus === "NEEDS_CLARIFICATION") {
    // The admin UI may call createDocumentUpdate directly.
    throw new Error(
      "Use the document update action when requesting a document."
    );
  }

  if (newStatus === "VERIFICATION_PENDING") {
    issueVerificationCode(found);
  }

  return {
    success: true,
    message: "Application status updated successfully."
  };
}

function resendVerificationCode(payload) {
  requireAdministratorSession(payload.sessionToken);

  const found = findApplication(
    String(payload.applicationId || "").trim()
  );

  found.sheet.getRange(found.rowNumber, 28).setValue(
    "VERIFICATION_PENDING"
  );

  issueVerificationCode(found);

  return {
    success: true,
    message: "New verification code sent. It is valid for 24 hours."
  };
}

function processVerificationReplies(payload) {
  if (payload && payload.sessionToken) {
    requireAdministratorSession(payload.sessionToken);
  }

  const threads = GmailApp.search(
    'is:unread newer_than:2d'
  );

  let processed = 0;
  const sheet = getMembersSheet();
  const values = sheet.getDataRange().getValues();

  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      if (!message.isUnread()) continue;

      const subject = message.getSubject() || "";
      if (
        !subject.toLowerCase().includes("lsu membership") ||
        !subject.toLowerCase().includes("verification")
      ) {
        continue;
      }

      const sender = extractEmail(message.getFrom());
      const body = String(message.getPlainBody() || "").toUpperCase();

      for (let i = 1; i < values.length; i++) {
        const row = values[i];

        if (
          extractEmail(row[1]) !== sender ||
          String(row[27]).toUpperCase() !== "VERIFICATION_PENDING"
        ) {
          continue;
        }

        const sent = new Date(row[32]);
        const code = String(row[31] || "").toUpperCase();

        if (
          isNaN(sent.getTime()) ||
          now().getTime() - sent.getTime() >
            CONFIG.VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000
        ) {
          message.markRead();
          continue;
        }

        if (!code || !body.includes(code)) continue;

        const membershipId = generateMembershipId(row[2]);
        const confirmed = now();

        sheet.getRange(i + 1, 28).setValue("MEMBER_CONFIRMED");
        sheet.getRange(i + 1, 34, 1, 2)
          .setValues([[confirmed, membershipId]]);
        sheet.getRange(i + 1, 36).setValue(confirmed);

        sendEmail(
          sender,
          "LSU Membership Confirmed",
          "Dear " + getApplicantName(row) + ",\n\n" +
          "Your LSU membership has been confirmed.\n\n" +
          "Membership ID: " + membershipId + "\n" +
          "Status: MEMBER_CONFIRMED\n\n" +
          "Welcome to the Liberian Students Union in Odisha."
        );

        message.markRead();
        processed++;
        break;
      }
    }
  }

  return {
    success: true,
    processed: processed
  };
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({
        success: false,
        message: "No request data received."
      });
    }

    const payload = JSON.parse(e.postData.contents);
    const action = String(payload.action || "").trim();

    switch (action) {
      case "sendOTP":
        return jsonResponse(sendOTP(payload.email));

      case "verifyOTP":
        return jsonResponse(verifyOTP(payload.email, payload.otp));

      case "submitApplication":
        return jsonResponse(submitApplication(payload));

      case "checkAdministratorAccess":
        return jsonResponse(checkAdministratorAccess(payload.email));

      case "sendAdministratorOTP":
        return jsonResponse(sendAdministratorOTP(payload.email));

      case "verifyAdministratorOTP":
        return jsonResponse(
          verifyAdministratorOTP(payload.email, payload.otp)
        );

      case "logoutAdministrator":
        return jsonResponse(
          logoutAdministrator(payload.sessionToken)
        );

      case "getDashboardData":
        return jsonResponse(
          getDashboardData(payload.sessionToken)
        );

      case "updateApplicationStatus":
        return jsonResponse(
          updateApplicationStatus(payload)
        );

      case "createDocumentUpdate":
      case "requestDocumentUpdate":
        return jsonResponse(
          createDocumentUpdate(payload)
        );

      case "resendUploadLink":
      case "resendDocumentUpdateLink":
        return jsonResponse(
          resendUploadLink(payload)
        );

      case "getDocumentUpdateInfo":
        return jsonResponse(
          getDocumentUpdateInfo(payload.token)
        );

      case "submitDocumentUpdate":
        return jsonResponse(
          submitDocumentUpdate(payload)
        );

      case "resendVerificationCode":
        return jsonResponse(
          resendVerificationCode(payload)
        );

      case "processVerificationReplies":
        return jsonResponse(
          processVerificationReplies(payload)
        );

      case "getAdministrators":
        return jsonResponse(
          getAdministrators(payload.sessionToken)
        );

      case "addAdministrator":
        return jsonResponse(
          addAdministrator(
            payload.sessionToken,
            payload.newEmail,
            payload.newName
          )
        );

      case "deactivateAdministrator":
        return jsonResponse(
          deactivateAdministrator(
            payload.sessionToken,
            payload.targetEmail
          )
        );

      case "reactivateAdministrator":
        return jsonResponse(
          reactivateAdministrator(
            payload.sessionToken,
            payload.targetEmail
          )
        );

      default:
        return jsonResponse({
          success: false,
          message: "Invalid action: " + action
        });
    }
  } catch (error) {
    console.error(error);
    return jsonResponse({
      success: false,
      message: error.message || String(error)
    });
  }
}

function getAdministrators(sessionToken) {
  const session = requireAdministratorSession(sessionToken);
  if (session.role !== "CHIEF_ADMINISTRATOR") {
    throw new Error("Unauthorized.");
  }

  const sheet = getAdminSheet();
  const values = sheet.getDataRange().getValues();
  const result = [];

  for (let i = 1; i < values.length; i++) {
    result.push({
      email: values[i][0],
      name: values[i][1],
      role: values[i][2],
      status: values[i][3],
      addedDate: values[i][4],
      addedBy: values[i][5]
    });
  }

  return {
    success: true,
    administrators: result
  };
}

function doGet() {
  return jsonResponse({
    success: true,
    message: "LSU Membership Backend is online."
  });
}
