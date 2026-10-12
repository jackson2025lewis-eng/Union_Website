/*******************************************************
 * LSU MEMBERSHIP & DUES PAYMENT DATABASE - GOOGLE APPS SCRIPT
 * Unified Resilient Backend for LSUO Membership, Dues Payments & Admin Portals
 * Fully Hardened with Security Tokens, Bot Mitigation, Expiration Housekeeping,
 * and Transaction Locking.
 *******************************************************/

const CONFIG = {
  SHEET_NAME: "Members",
  OTP_SHEET_NAME: "OTP",
  ROOT_DRIVE_FOLDER_ID: "1wIX_Hnr3T3lX1xpYzDm9G3kBlDm8FRk3",
  OTP_PREFIX: "LSU",
  OTP_LENGTH: 4,
  OTP_EXPIRY_MINUTES: 5,
  MAX_ATTEMPTS: 3,
  VERIFICATION_HOURS: 24, // Verification codes expire after 24 hours
  DOC_UPDATE_EXPIRY_HOURS: 24, // Document update links expire after 24 hours
  MAX_SINGLE_FILE_BYTES: 5 * 1024 * 1024, // 5 MB per file
  MAX_TOTAL_UPLOAD_BYTES: 15 * 1024 * 1024, // 15 MB total set
  FRONTEND_UPDATE_URL: "https://lsu-odisha.vercel.app/update-portal/index.html"
};

const CHIEF_ADMIN_EMAIL = "solojackson2022@gmail.com";
const ADMIN_SHEET_NAME = "Administrators";
const ADMIN_SESSION_TTL_SECONDS = 900;
const ADMIN_SESSION_PREFIX = "LSU_ADMIN_SESSION_";

const LSU_PAYMENT_CONFIG = {
  PAYMENT_SHEET_NAME: "Payments",
  ALLOCATION_SHEET_NAME: "PaymentAllocations",
  MEMBER_OTP_PREFIX: "LSU_DUE_OTP_",
  MEMBER_SESSION_PREFIX: "LSU_DUE_MEMBER_SESSION_",
  PAYMENT_ADMIN_OTP_PREFIX: "LSU_PAYMENT_ADMIN_OTP_",
  PAYMENT_ADMIN_SESSION_PREFIX: "LSU_PAYMENT_ADMIN_SESSION_",
  OTP_EXPIRY_MINUTES: 5,
  SESSION_TTL_SECONDS: 900,
  MAX_OTP_ATTEMPTS: 3,
  MAX_OTHER_MEMBERS: 2
};

/*******************************************************
 * HELPERS & RESILIENT SHEET INITIALIZERS
 *******************************************************/
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function extractEmail(str) {
  if (!str) return "";
  const s = String(str).trim();
  const match = s.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].trim().toLowerCase() : "";
}

function validateEmail(email) {
  return extractEmail(email).length > 0;
}

function formatExactDateTime(dateObj) {
  if (!dateObj || !(dateObj instanceof Date)) return "";
  return Utilities.formatDate(dateObj, Session.getScriptTimeZone() || "GMT+05:30", "MMMM dd, yyyy 'at' hh:mm a z");
}

function findColumnIndex(headers, ...possibleNames) {
  if (!headers || !headers.length) return -1;
  for (const name of possibleNames) {
    const cleanName = String(name || "").trim().toLowerCase();
    if (!cleanName) continue;
    let idx = headers.findIndex(h => String(h || "").trim().toLowerCase() === cleanName);
    if (idx !== -1) return idx;
    idx = headers.findIndex(h => {
      const hClean = String(h || "").trim().toLowerCase();
      return hClean.includes(cleanName) || cleanName.includes(hClean);
    });
    if (idx !== -1) return idx;
  }
  return -1;
}

function findEmailInRow(row, headers) {
  if (!row) return "";
  if (headers && headers.length > 0) {
    const emailHeaders = [
      "Applicant Email", "Email", "Email Address", "Applicant's Email",
      "Untitled Question", "Your Email", "Student Email", "E-mail", "Username", "Contact Email"
    ];
    for (const hName of emailHeaders) {
      const idx = headers.findIndex(h => String(h || "").trim().toLowerCase() === hName.toLowerCase());
      if (idx !== -1) {
        const found = extractEmail(row[idx]);
        if (found) return found;
      }
    }
    for (let c = 0; c < headers.length; c++) {
      const h = String(headers[c] || "").toLowerCase();
      if (h.includes("mail") || h.includes("question") || h.includes("user")) {
        const found = extractEmail(row[c]);
        if (found) return found;
      }
    }
  }

  for (let c = 0; c < row.length; c++) {
    const found = extractEmail(row[c]);
    if (found) return found;
  }
  return "";
}

function ensureMembersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_NAME);

  const standardHeaders = [
    "Timestamp", "Email", "Membership Type", "First Name", "Middle Name",
    "Last Name", "Gender", "Date of Birth", "Position / Role",
    "WhatsApp Number", "Mobile Number", "Passport Number",
    "College Registration Number", "University", "Degree Type",
    "Study From", "Study To", "Field of Studies", "Mother Name",
    "Father Name", "Parents Contact", "Graduation Date", "EFRO File",
    "Passport Document", "Identification Photo", "Privacy Consent",
    "Application ID", "Application Status", "Submission Date", "Review Date",
    "Reviewed By", "Verification Code", "Verification Sent Date",
    "Verification Reply Date", "Membership ID", "Membership Confirmed Date",
    "Rejection Reason"
  ];

  const lastColumn = sheet.getLastColumn();
  const currentHeaders = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(h => String(h || '').trim())
    : [];

  if (currentHeaders.length === 0 || currentHeaders.every(h => h === '')) {
    sheet.getRange(1, 1, 1, standardHeaders.length).setValues([standardHeaders]);
    return sheet;
  }

  const normalize = h => String(h || '').replace(/\s+/g, ' ').trim();
  const actual = currentHeaders.map(normalize);
  const required = standardHeaders.map(normalize);

  if (actual.length !== required.length || actual.some((h, i) => h !== required[i])) {
    const differences = [];
    const max = Math.max(actual.length, required.length);
    for (let i = 0; i < max; i++) {
      if (actual[i] !== required[i]) {
        differences.push(`Column ${i + 1}: expected "${required[i] || '(none)'}" but found "${actual[i] || '(blank)'}"`);
      }
    }
    throw new Error('Members headers do not match the required 37-column structure. ' + differences.slice(0, 5).join('; '));
  }

  return sheet;
}

function ensureOTPSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.OTP_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.OTP_SHEET_NAME);
    sheet.appendRow(["Timestamp", "Email", "OTP", "ExpiresAt", "Verified", "Attempts"]);
  }
  return sheet;
}

function ensureAdministratorSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ADMIN_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(ADMIN_SHEET_NAME);

  const headers = ["Email", "Name", "Role", "Status", "Added Date", "Added By", "Admin OTP", "OTP Expiry", "OTP Verified", "OTP Attempts"];
  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  let headersNeedUpdate = false;
  for (let i = 0; i < headers.length; i++) {
    if (currentHeaders[i] !== headers[i]) {
      headersNeedUpdate = true;
      break;
    }
  }
  if (headersNeedUpdate) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const data = sheet.getDataRange().getValues();
  let chiefExists = false;
  for (let i = 1; i < data.length; i++) {
    if (extractEmail(data[i][0]) === extractEmail(CHIEF_ADMIN_EMAIL)) {
      chiefExists = true;
      break;
    }
  }
  if (!chiefExists) {
    sheet.appendRow([CHIEF_ADMIN_EMAIL.toLowerCase(), "Chief Administrator", "CHIEF_ADMINISTRATOR", "ACTIVE", new Date(), "SYSTEM", "", "", "No", 0]);
  }
  return sheet;
}

function lsuPaymentSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    if (current.some((v, i) => String(v || "").trim() !== headers[i])) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  return sheet;
}

function ensurePaymentSheets() {
  lsuPaymentSheet_(LSU_PAYMENT_CONFIG.PAYMENT_SHEET_NAME, [
    "Payment ID","Payer","Payer Email","Payment Method","Total Amount",
    "Payment Date","UPI Ref No.","Cash Receiver Name","Cash Receiver Position",
    "Status","Submitted Date","Approved Date","Approved By","Receipt ID","Rejection Reason"
  ]);
  lsuPaymentSheet_(LSU_PAYMENT_CONFIG.ALLOCATION_SHEET_NAME, [
    "Payment ID","Member Email","Member Name","Membership ID","Amount","Receipt Status"
  ]);
}

function sendSecureEmail(toEmail, subject, bodyText) {
  const cleanEmail = extractEmail(toEmail);
  if (!cleanEmail) {
    Logger.log("sendSecureEmail skipped: Invalid recipient: " + toEmail);
    return;
  }
  try {
    MailApp.sendEmail({
      to: cleanEmail,
      subject: subject,
      body: bodyText
    });
  } catch (mailErr) {
    Logger.log("MailApp.sendEmail error: " + mailErr.toString() + ". Retrying with GmailApp...");
    try {
      GmailApp.sendEmail(cleanEmail, subject, bodyText);
    } catch (gmailErr) {
      Logger.log("GmailApp.sendEmail failed: " + gmailErr.toString());
    }
  }
}

function getOrCreateFolder(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return parentFolder.createFolder(folderName);
}

function validateFileObject(fileObject, fieldLabel, expectedType) {
  if (!fileObject || !fileObject.content || !fileObject.name) {
    throw new Error(`Invalid file upload for ${fieldLabel}.`);
  }
  
  const decoded = Utilities.base64Decode(fileObject.content);
  const sizeBytes = decoded.length;
  
  if (sizeBytes > CONFIG.MAX_SINGLE_FILE_BYTES) {
    throw new Error(`${fieldLabel} exceeds maximum allowed size of 5 MB.`);
  }
  
  const mime = String(fileObject.type || "").toLowerCase();
  const name = String(fileObject.name || "").toLowerCase();
  
  if (expectedType === "IMAGE") {
    const isJpg = mime.includes("image/jpeg") || mime.includes("image/jpg") || name.endsWith(".jpg") || name.endsWith(".jpeg");
    if (!isJpg) {
      throw new Error(`${fieldLabel} must be in JPG/JPEG format.`);
    }
  } else if (expectedType === "PDF") {
    const isPdf = mime.includes("application/pdf") || name.endsWith(".pdf");
    if (!isPdf) {
      throw new Error(`${fieldLabel} must be a PDF document.`);
    }
  }
  
  return { decoded, sizeBytes };
}

function saveFileToDrive(fileObject, applicationFolder) {
  if (!fileObject || !fileObject.content || !fileObject.name || !fileObject.type) {
    throw new Error("Invalid file data received.");
  }
  const decoded = Utilities.base64Decode(fileObject.content);
  const blob = Utilities.newBlob(decoded, fileObject.type, fileObject.name);
  const file = applicationFolder.createFile(blob);
  return file.getUrl();
}

function getFileIdFromUrl(url) {
  const match = String(url || "").match(/[-\w]{25,}/);
  return match ? match[0] : null;
}

function archiveOldDocument(oldUrl) {
  if (!oldUrl) return;
  try {
    const fileId = getFileIdFromUrl(oldUrl);
    if (fileId) {
      const file = DriveApp.getFileById(fileId);
      file.setName("ARCHIVED_" + file.getName());
    }
  } catch (e) {
    // Ignore errors if file doesn't exist
  }
}

/*******************************************************
 * SECURITY, ANTI-BOT & TOKEN HOUSEKEEPING
 *******************************************************/

/**
 * Validates Cloudflare Turnstile token server-side via official Siteverify endpoint.
 * Resilient: enforces verification if secret is configured in Script Properties.
 */
function validateCloudflareTurnstile_(turnstileToken) {
  const turnstileSecret = PropertiesService.getScriptProperties().getProperty("CLOUDFLARE_TURNSTILE_SECRET");
  if (!turnstileSecret) {
    Logger.log("Notice: CLOUDFLARE_TURNSTILE_SECRET is not configured in Script Properties. Turnstile validation skipped.");
    return true;
  }
  
  const token = String(turnstileToken || "").trim();
  if (!token) {
    throw new Error("CAPTCHA verification is required. Please complete the CAPTCHA.");
  }
  
  try {
    const response = UrlFetchApp.fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "post",
      payload: {
        secret: turnstileSecret,
        response: token
      },
      muteHttpExceptions: true
    });
    
    const result = JSON.parse(response.getContentText());
    if (!result || result.success !== true) {
      const errorCodes = (result && Array.isArray(result['error-codes'])) ? result['error-codes'].join(', ') : 'Verification rejected';
      Logger.log("Cloudflare Turnstile verification failed. Code: " + errorCodes);
      throw new Error("CAPTCHA verification failed or has expired. Please refresh the page and try again.");
    }
    return true;
  } catch (e) {
    if (e.message && e.message.includes("CAPTCHA")) {
      throw e;
    }
    Logger.log("Cloudflare Turnstile network error: " + e.message);
    throw new Error("Unable to verify CAPTCHA with Cloudflare. Please try again.");
  }
}

/**
 * Safely prunes expired document update and applicant verification tokens from PropertiesService.
 */
function cleanupExpiredTokens_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const allProps = props.getProperties();
    const now = Date.now();
    const keysToDelete = [];
    
    for (const [key, val] of Object.entries(allProps)) {
      if (key.startsWith("DOC_UPDATE_") || key.startsWith("VERIF_TOKEN_")) {
        try {
          const parsed = JSON.parse(val);
          if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < now) {
            keysToDelete.push(key);
          }
        } catch (e) {
          keysToDelete.push(key);
        }
      }
    }
    
    for (const k of keysToDelete) {
      props.deleteProperty(k);
    }
  } catch (err) {
    Logger.log("cleanupExpiredTokens_ error: " + err.toString());
  }
}

/*******************************************************
 * ADMINISTRATOR HIERARCHY & AUTHENTICATION
 *******************************************************/
function isChiefAdministrator(email) {
  return (extractEmail(email) === extractEmail(CHIEF_ADMIN_EMAIL));
}

function checkAdministratorAccess(email) {
  email = extractEmail(email);
  if (!email) return { success: false, authorized: false, message: "Email required." };
  
  if (isChiefAdministrator(email)) {
    return { success: true, authorized: true, role: "CHIEF_ADMINISTRATOR", name: "Chief Administrator", message: "Confirmed." };
  }
  
  const sheet = ensureAdministratorSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (extractEmail(data[i][0]) === email && String(data[i][3]).trim().toUpperCase() === "ACTIVE") {
      return { success: true, authorized: true, role: String(data[i][2]), name: String(data[i][1]), message: "Confirmed." };
    }
  }
  return { success: false, authorized: false, message: "You are not authorized to access the Administrator Portal." };
}

function getActiveCoAdminCount(data) {
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    const role = String(data[i][2]).trim().toUpperCase();
    const status = String(data[i][3]).trim().toUpperCase();
    if (role === "CO_ADMINISTRATOR" && status === "ACTIVE") count++;
  }
  return count;
}

function getAdministrators(sessionToken) {
  const session = requireAdministratorSession(sessionToken);
  if (session.role !== "CHIEF_ADMINISTRATOR") throw new Error("Unauthorized.");
  
  const sheet = ensureAdministratorSheet();
  const data = sheet.getDataRange().getValues();
  const admins = [];
  for (let i = 1; i < data.length; i++) {
    admins.push({
      email: data[i][0], name: data[i][1], role: data[i][2], status: data[i][3],
      addedDate: data[i][4] ? Utilities.formatDate(new Date(data[i][4]), Session.getScriptTimeZone(), "yyyy-MM-dd") : "",
      addedBy: data[i][5]
    });
  }
  return { success: true, administrators: admins };
}

function addAdministrator(sessionToken, newEmail, newName) {
  const session = requireAdministratorSession(sessionToken);
  if (session.role !== "CHIEF_ADMINISTRATOR") throw new Error("Only the Chief Administrator can add co-administrators.");
  
  newEmail = extractEmail(newEmail);
  newName = String(newName || "").trim();
  if (!validateEmail(newEmail)) throw new Error("Invalid email.");
  if (isChiefAdministrator(newEmail)) throw new Error("Cannot add the Chief Administrator again.");
  
  const sheet = ensureAdministratorSheet();
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (extractEmail(data[i][0]) === newEmail) {
      throw new Error("This email is already registered as an administrator.");
    }
  }
  
  if (getActiveCoAdminCount(data) >= 3) {
    throw new Error("Maximum of 3 active co-administrators reached. Deactivate one before adding another.");
  }
  
  sheet.appendRow([newEmail, newName, "CO_ADMINISTRATOR", "ACTIVE", new Date(), session.email, "", "", "No", 0]);
  
  sendSecureEmail(
    newEmail,
    "LSU Administrator Access Authorized",
    `Dear ${newName},\n\nYou have been authorized as an LSU Co-Administrator by the Chief Administrator.\n\nYou can now log into the Administrator Portal using this email address. You will receive a verification code upon login.\n\nRegards,\nLiberian Students Union in Odisha`
  );
  
  return { success: true, message: "Co-Administrator added successfully." };
}

function deactivateAdministrator(sessionToken, targetEmail) {
  const session = requireAdministratorSession(sessionToken);
  if (session.role !== "CHIEF_ADMINISTRATOR") throw new Error("Unauthorized.");
  targetEmail = extractEmail(targetEmail);
  if (isChiefAdministrator(targetEmail)) throw new Error("Cannot deactivate the Chief Administrator.");
  
  const sheet = ensureAdministratorSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (extractEmail(data[i][0]) === targetEmail) {
      sheet.getRange(i + 1, 4).setValue("DEACTIVATED");
      return { success: true, message: "Administrator deactivated." };
    }
  }
  throw new Error("Administrator not found.");
}

function reactivateAdministrator(sessionToken, targetEmail) {
  const session = requireAdministratorSession(sessionToken);
  if (session.role !== "CHIEF_ADMINISTRATOR") throw new Error("Unauthorized.");
  targetEmail = extractEmail(targetEmail);
  
  const sheet = ensureAdministratorSheet();
  const data = sheet.getDataRange().getValues();
  
  if (getActiveCoAdminCount(data) >= 3) {
    throw new Error("Cannot reactivate: Maximum 3 active co-administrators currently active.");
  }
  
  for (let i = 1; i < data.length; i++) {
    if (extractEmail(data[i][0]) === targetEmail) {
      sheet.getRange(i + 1, 4).setValue("ACTIVE");
      return { success: true, message: "Administrator reactivated." };
    }
  }
  throw new Error("Administrator not found.");
}

function sendAdministratorOTP(email) {
  email = extractEmail(email);
  if (!email) return { success: false, message: "Email is required." };
  
  const access = checkAdministratorAccess(email);
  if (!access.authorized) return { success: false, message: "You are not authorized to access the Administrator Portal." };

  const sheet = ensureAdministratorSheet();
  const data = sheet.getDataRange().getValues();
  let rowNumber = -1;
  let adminName = access.name || "Administrator";
  for (let i = 1; i < data.length; i++) {
    if (extractEmail(data[i][0]) === email) { rowNumber = i + 1; break; }
  }
  if (rowNumber === -1) return { success: false, message: "Administrator account not found." };

  const otp = "ADM" + Math.floor(100 + Math.random() * 900) + "LSU";
  const expiresAt = new Date(Date.now() + CONFIG.OTP_EXPIRY_MINUTES * 60000);

  sheet.getRange(rowNumber, 7, 1, 4).setValues([[otp, expiresAt, "No", 0]]);

  sendSecureEmail(
    email,
    "LSU Administrator Verification Code",
    `Dear ${adminName},\n\nYour administrator verification code is:\n\n${otp}\n\nThis verification code will expire in ${CONFIG.OTP_EXPIRY_MINUTES} minutes.\n\nRegards,\nLiberian Students Union in Odisha`
  );
  return { success: true, message: "Verification code sent to your email." };
}

function verifyAdministratorOTP(email, enteredOTP) {
  email = extractEmail(email);
  enteredOTP = String(enteredOTP || "").trim().toUpperCase();
  if (!email || !enteredOTP) return { success: false, message: "Email and verification code are required." };
  
  const access = checkAdministratorAccess(email);
  if (!access.authorized) return { success: false, message: "Unauthorized account." };

  const sheet = ensureAdministratorSheet();
  const data = sheet.getDataRange().getValues();
  let rowNumber = -1;
  for (let i = 1; i < data.length; i++) {
    if (extractEmail(data[i][0]) === email) { rowNumber = i + 1; break; }
  }
  if (rowNumber === -1) return { success: false, message: "Administrator account not found." };

  const storedOTP = String(data[rowNumber - 1][6] || "").trim().toUpperCase();
  const expiresAt = new Date(data[rowNumber - 1][7]);
  const verified = String(data[rowNumber - 1][8] || "").trim().toUpperCase();
  let attempts = Number(data[rowNumber - 1][9] || 0);

  if (verified === "YES") return { success: false, message: "This verification code has already been used. Please request a new code." };
  if (attempts >= CONFIG.MAX_ATTEMPTS) return { success: false, message: "Maximum attempts reached. Please request a new code." };
  if (new Date() > expiresAt) return { success: false, message: "Verification code has expired. Please request a new code." };

  if (storedOTP === enteredOTP) {
    sheet.getRange(rowNumber, 9).setValue("Yes");
    const sessionToken = Utilities.getUuid();
    const sessionData = { email: email, role: access.role, name: access.name };
    CacheService.getScriptCache().put(ADMIN_SESSION_PREFIX + sessionToken, JSON.stringify(sessionData), ADMIN_SESSION_TTL_SECONDS);
    return { success: true, sessionToken: sessionToken, role: access.role, name: access.name };
  }

  attempts++;
  sheet.getRange(rowNumber, 10).setValue(attempts);
  return { success: false, message: `Incorrect code. Attempt ${attempts}/${CONFIG.MAX_ATTEMPTS}.` };
}

function requireAdministratorSession(token) {
  const cached = CacheService.getScriptCache().get(ADMIN_SESSION_PREFIX + String(token || "").trim());
  if (!cached) throw new Error("Administrator session expired. Please log in again.");
  const session = JSON.parse(cached);
  const access = checkAdministratorAccess(session.email);
  if (!access.authorized || access.role !== session.role) throw new Error("Administrator access revoked.");
  CacheService.getScriptCache().put(ADMIN_SESSION_PREFIX + token, cached, ADMIN_SESSION_TTL_SECONDS);
  return session;
}

function logoutAdministrator(token) {
  CacheService.getScriptCache().remove(ADMIN_SESSION_PREFIX + String(token || "").trim());
  return { success: true };
}

/*******************************************************
 * DASHBOARD STATISTICS
 *******************************************************/
function getDashboardData(sessionToken) {
  const session = requireAdministratorSession(sessionToken);
  const sheet = ensureMembersSheet();
  
  const values = sheet.getDataRange().getValues();
  const applications = [];
  
  const statistics = {
    currentStudents: { total: 0, male: 0, female: 0, bachelorCandidate: 0, masters: 0, phd: 0, universities: {} },
    alumni: { total: 0, male: 0, female: 0, bachelor: 0, masters: 0, phd: 0, universities: {} }
  };

  if (values.length > 1) {
    const headers = values[0].map(h => String(h || "").trim());
    
    const idxType = findColumnIndex(headers, "Membership Type", "Type");
    const idxGender = findColumnIndex(headers, "Gender", "Sex");
    const idxDegree = findColumnIndex(headers, "Degree Type", "Degree", "Course");
    const idxUni = findColumnIndex(headers, "University", "College", "Institution");
    const idxAppId = findColumnIndex(headers, "Application ID", "Application Id", "ApplicationID", "App ID", "ID");
    const idxPhoto = findColumnIndex(headers, "Identification Photo", "Passport Photo");

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (!row || row.every(cell => String(cell || "").trim() === "")) continue;
      
      let appId = idxAppId !== -1 ? String(row[idxAppId] || "").trim() : "";
      if (!appId) {
        for (let c = 0; c < row.length; c++) {
          const val = String(row[c] || "").trim();
          if (val.startsWith("APP-") || val.startsWith("LSU-APP-")) {
            appId = val;
            break;
          }
        }
      }
      
      const type = idxType >= 0 ? String(row[idxType] || "").trim().toUpperCase() : "";
      const gender = idxGender >= 0 ? String(row[idxGender] || "").trim() : "";
      const isMale = (gender.toUpperCase() === "MALE");
      const isFemale = (gender.toUpperCase() === "FEMALE");
      
      const rawDegree = idxDegree >= 0 ? String(row[idxDegree] || "").trim() : "";
      const degreeUp = rawDegree.toUpperCase();
      let normDegree = "Other";
      if (degreeUp.includes("BACHELOR")) normDegree = "Bachelor";
      if (degreeUp.includes("MASTER")) normDegree = "Master";
      if (degreeUp.includes("PHD") || degreeUp.includes("DOCTORATE")) normDegree = "PHD";
      
      const rawUni = idxUni >= 0 ? String(row[idxUni] || "").trim() : "";
      const uni = rawUni || "Unknown University";
      
      let targetStats = null;
      if (type.includes("STUDENT")) {
        targetStats = statistics.currentStudents;
        if (normDegree === "Bachelor") targetStats.bachelorCandidate++;
      } else if (type.includes("ALUMNI")) {
        targetStats = statistics.alumni;
        if (normDegree === "Bachelor") targetStats.bachelor++;
      }
      
      if (targetStats) {
        targetStats.total++;
        if (isMale) targetStats.male++;
        if (isFemale) targetStats.female++;
        if (normDegree === "Master") targetStats.masters++;
        if (normDegree === "PHD") targetStats.phd++;
        
        if (!targetStats.universities[uni]) targetStats.universities[uni] = {};
        if (!targetStats.universities[uni][normDegree]) {
          targetStats.universities[uni][normDegree] = { male: 0, female: 0, total: 0 };
        }
        
        if (isMale || isFemale) {
            targetStats.universities[uni][normDegree].total++;
            if (isMale) targetStats.universities[uni][normDegree].male++;
            if (isFemale) targetStats.universities[uni][normDegree].female++;
        }
      }

      const app = {};
      for (let c = 0; c < headers.length; c++) {
        let val = row[c];
        if (val instanceof Date) val = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
        app[headers[c]] = val;
      }
      
      const extractedEmail = findEmailInRow(row, headers);
      app['Email'] = extractedEmail;
      app['Applicant Email'] = extractedEmail;
      app['Application ID'] = appId || (idxAppId !== -1 ? row[idxAppId] : '') || ('ROW-' + (i + 1));
      
      const photoUrl = (idxPhoto !== -1 && row[idxPhoto]) ? row[idxPhoto] : (app['Identification Photo'] || app['Passport Photo'] || '');
      app['Identification Photo'] = photoUrl;
      app['Passport Photo'] = photoUrl;
      
      applications.push(app);
    }
  }

  return { success: true, administrator: session, statistics: statistics, applications: applications };
}

/*******************************************************
 * APPLICATION STATUS WORKFLOW
 *******************************************************/
function updateApplicationStatus(payload) {
  const session = requireAdministratorSession(payload.sessionToken);
  const appId = String(payload.applicationId || "").trim();
  const newStatus = String(payload.newStatus || "").trim().toUpperCase();
  const reason = String(payload.rejectionReason || "").trim();
  let docType = String(payload.updateDocType || "").trim();
  
  if (docType === "Passport Photo") {
    docType = "Identification Photo";
  }
  
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error("System is busy processing another request. Please retry.");
  }
  
  try {
    const sheet = ensureMembersSheet();
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(h => String(h || "").trim());
    
    const colAppId = findColumnIndex(headers, "Application ID", "Application Id", "ApplicationID", "App ID", "ID");
    const colStatus = findColumnIndex(headers, "Application Status", "Status", "Application status");
    const colFirstName = findColumnIndex(headers, "First Name", "FirstName", "First name", "Applicant Name", "Name");
    const colLastName = findColumnIndex(headers, "Last Name", "LastName", "Last name", "Surname");
    const colReviewDate = findColumnIndex(headers, "Review Date", "Reviewed Date", "Review date");
    const colReviewedBy = findColumnIndex(headers, "Reviewed By", "Reviewer", "Reviewed by");
    const colReason = findColumnIndex(headers, "Rejection Reason", "Reason", "Rejection reason", "Remarks");
    const colVCode = findColumnIndex(headers, "Verification Code", "Verification code", "OTP");
    const colVSent = findColumnIndex(headers, "Verification Sent Date", "Verification Sent", "Verification sent date");
    const colMemId = findColumnIndex(headers, "Membership ID", "Membership Id", "Member ID", "Membership Number");
    const colMemConf = findColumnIndex(headers, "Membership Confirmed Date", "Confirmed Date", "Membership Confirmed");
    
    let targetRow = -1;
    let targetRowData = null;
    
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      let isMatch = false;
      
      if (colAppId !== -1 && String(row[colAppId] || "").trim().toUpperCase() === appId.toUpperCase()) {
        isMatch = true;
      } else {
        for (let c = 0; c < row.length; c++) {
          if (String(row[c] || "").trim().toUpperCase() === appId.toUpperCase()) {
            isMatch = true;
            break;
          }
        }
      }
      
      if (isMatch) {
        targetRow = i + 1;
        targetRowData = row;
        break;
      }
    }
    
    if (targetRow === -1) throw new Error("Application '" + appId + "' not found in database.");
    
    let applicantEmail = extractEmail(payload.applicantEmail);
    if (!applicantEmail && targetRowData) {
      applicantEmail = findEmailInRow(targetRowData, headers);
    }
    
    let applicantName = String(payload.applicantName || "").trim();
    if (!applicantName && targetRowData) {
      const fn = colFirstName !== -1 ? String(targetRowData[colFirstName] || "").trim() : "";
      const ln = colLastName !== -1 ? String(targetRowData[colLastName] || "").trim() : "";
      applicantName = (fn + " " + ln).trim() || "Applicant";
    }
    if (!applicantName) applicantName = "Applicant";
    
    if ((newStatus === "CONFIRMED" || newStatus === "MEMBER_CONFIRMED") && applicantEmail.toLowerCase() === session.email.toLowerCase() && !isChiefAdministrator(session.email)) {
      throw new Error("Cannot confirm your own application.");
    }
    
    if (colStatus !== -1) sheet.getRange(targetRow, colStatus + 1).setValue(newStatus);
    if (colReviewDate !== -1) sheet.getRange(targetRow, colReviewDate + 1).setValue(new Date());
    if (colReviewedBy !== -1) sheet.getRange(targetRow, colReviewedBy + 1).setValue(session.email);
    
    if (newStatus === "REJECTED") {
      if (!reason) throw new Error("Rejection reason is required.");
      if (colReason !== -1) sheet.getRange(targetRow, colReason + 1).setValue(reason);
      
      if (applicantEmail) {
        sendSecureEmail(
          applicantEmail,
          "LSU Membership Application Update - Rejected",
          `Dear ${applicantName},\n\nYour membership application (${appId}) has been reviewed and unfortunately could not be approved at this time.\n\nReason:\n${reason}\n\nFor any questions, please reply to this email.\n\nRegards,\nLiberian Students Union in Odisha`
        );
      }
    } 
    else if (newStatus === "NEEDS_CLARIFICATION") {
      if (!reason || !docType) throw new Error("Document type and reason required for updates.");
      if (colReason !== -1) sheet.getRange(targetRow, colReason + 1).setValue(`Update requested for: ${docType}. Reason: ${reason}`);
      
      const token = Utilities.getUuid();
      const expiryTime = new Date(Date.now() + CONFIG.DOC_UPDATE_EXPIRY_HOURS * 60 * 60 * 1000);
      const formattedExpiry = formatExactDateTime(expiryTime);
      
      PropertiesService.getScriptProperties().setProperty('DOC_UPDATE_' + token, JSON.stringify({
        appId: appId,
        email: applicantEmail,
        docType: docType,
        reason: reason,
        createdAt: new Date().toISOString(),
        expiresAt: expiryTime.toISOString()
      }));
      
      const updateLink = `${CONFIG.FRONTEND_UPDATE_URL}?token=${token}`;
      
      if (applicantEmail) {
        sendSecureEmail(
          applicantEmail,
          "LSU Membership Application - Document Update Required (24-Hour Expiry)",
          `Dear ${applicantName},\n\nYour LSU membership application (${appId}) has been reviewed.\n\nWe need you to update the following document before your application can be processed:\n\nDocument Required: ${docType}\nReason / Instructions: ${reason}\n\nPlease click the secure link below to upload your replacement document:\n${updateLink}\n\nIMPORTANT: This link will expire in 24 hours on ${formattedExpiry}.\n\nYour application will remain under review until the requested document is received.\n\nRegards,\nLiberian Students Union in Odisha`
        );
      }
    }
    else if (newStatus === "VERIFICATION_PENDING") {
      const code = "LSU26-" + Math.floor(100000 + Math.random() * 900000);
      const sentTime = new Date();
      const expiryTime = new Date(sentTime.getTime() + CONFIG.VERIFICATION_HOURS * 60 * 60 * 1000);
      const formattedExpiry = formatExactDateTime(expiryTime);
      
      if (colVCode !== -1) sheet.getRange(targetRow, colVCode + 1).setValue(code);
      if (colVSent !== -1) sheet.getRange(targetRow, colVSent + 1).setValue(sentTime);
      
      if (applicantEmail) {
        sendSecureEmail(
          applicantEmail,
          "LSU Membership Application - Verification Required (24-Hour Expiry)",
          `Dear ${applicantName},\n\nYour LSU membership application (${appId}) has been pre-approved!\n\nTo complete your membership registration, please reply directly to this email with the following verification code within 24 hours:\n\n${code}\n\nIMPORTANT: This verification code will expire on ${formattedExpiry} (in 24 hours).\n\nOnce received, your official LSU Membership ID will be issued.\n\nRegards,\nLiberian Students Union in Odisha`
        );
      }
    }
    else if (newStatus === "MEMBER_CONFIRMED" || newStatus === "CONFIRMED") {
      let memId = colMemId !== -1 ? String(targetRowData[colMemId] || "").trim() : "";
      if (!memId) {
        memId = "LSU-" + new Date().getFullYear() + "-" + Math.floor(1000 + Math.random() * 9000);
        if (colMemId !== -1) sheet.getRange(targetRow, colMemId + 1).setValue(memId);
      }
      if (colMemConf !== -1) sheet.getRange(targetRow, colMemConf + 1).setValue(new Date());

      if (applicantEmail) {
        sendSecureEmail(
          applicantEmail,
          "LSU Membership Application Approved - Welcome to LSUO!",
          `Dear ${applicantName},\n\nCongratulations! Your LSU membership application (${appId}) has been officially APPROVED!\n\nOfficial Membership ID: ${memId}\nStatus: Member Confirmed\n\nWelcome to the Liberian Students Union in Odisha (LSUO)!\n\nRegards,\nLiberian Students Union in Odisha`
        );
      }
    }
    
    return { success: true, message: "Status updated successfully." };
  } finally {
    lock.releaseLock();
  }
}

/*******************************************************
 * ADMIN RESEND ACTIONS (24-HOUR EXPIRATION)
 *******************************************************/
function resendUploadLink(payload) {
  const session = requireAdministratorSession(payload.sessionToken);
  const appId = String(payload.applicationId || "").trim();
  
  const sheet = ensureMembersSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(h => String(h || "").trim());
  
  const colAppId = findColumnIndex(headers, "Application ID", "Application Id", "ApplicationID", "App ID", "ID");
  const colFirstName = findColumnIndex(headers, "First Name", "FirstName", "Applicant Name", "Name");
  const colLastName = findColumnIndex(headers, "Last Name", "LastName");
  const colReason = findColumnIndex(headers, "Rejection Reason", "Reason", "Rejection reason", "Remarks");
  
  let targetRow = -1;
  let targetRowData = null;
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (colAppId !== -1 && String(row[colAppId] || "").trim().toUpperCase() === appId.toUpperCase()) {
      targetRow = i + 1;
      targetRowData = row;
      break;
    }
  }
  
  if (targetRow === -1) throw new Error("Application '" + appId + "' not found.");
  
  const applicantEmail = findEmailInRow(targetRowData, headers);
  if (!applicantEmail) throw new Error("Applicant email not found.");
  
  const fn = colFirstName !== -1 ? String(targetRowData[colFirstName] || "").trim() : "";
  const ln = colLastName !== -1 ? String(targetRowData[colLastName] || "").trim() : "";
  const applicantName = (fn + " " + ln).trim() || "Applicant";
  
  let docType = String(payload.updateDocType || "").trim();
  let reason = String(payload.rejectionReason || "").trim();
  
  if (!docType && colReason !== -1) {
    const existingReason = String(targetRowData[colReason] || "");
    const match = existingReason.match(/Update requested for:\s*([^.]+)\.\s*Reason:\s*(.*)/i);
    if (match) {
      docType = match[1].trim();
      if (!reason) reason = match[2].trim();
    }
  }
  if (!docType) docType = "Identification Photo";
  if (!reason) reason = "Please upload an updated document.";
  if (docType === "Passport Photo") docType = "Identification Photo";
  
  const token = Utilities.getUuid();
  const expiryTime = new Date(Date.now() + CONFIG.DOC_UPDATE_EXPIRY_HOURS * 60 * 60 * 1000);
  const formattedExpiry = formatExactDateTime(expiryTime);
  
  PropertiesService.getScriptProperties().setProperty('DOC_UPDATE_' + token, JSON.stringify({
    appId: appId,
    email: applicantEmail,
    docType: docType,
    reason: reason,
    createdAt: new Date().toISOString(),
    expiresAt: expiryTime.toISOString()
  }));
  
  const updateLink = `${CONFIG.FRONTEND_UPDATE_URL}?token=${token}`;
  
  sendSecureEmail(
    applicantEmail,
    "LSU Membership Application - New Document Update Link (24-Hour Expiry)",
    `Dear ${applicantName},\n\nA new secure document update link has been generated for your LSU membership application (${appId}).\n\nDocument Required: ${docType}\nReason / Instructions: ${reason}\n\nPlease click the link below to upload your document:\n${updateLink}\n\nIMPORTANT: This new link is valid for 24 hours and will expire on ${formattedExpiry}.\n\nRegards,\nLiberian Students Union in Odisha`
  );
  
  return { success: true, message: `New upload link generated and sent. Valid until ${formattedExpiry}.` };
}

function resendVerificationCode(payload) {
  const session = requireAdministratorSession(payload.sessionToken);
  const appId = String(payload.applicationId || "").trim();
  
  const sheet = ensureMembersSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(h => String(h || "").trim());
  
  const colAppId = findColumnIndex(headers, "Application ID", "Application Id", "ApplicationID", "App ID", "ID");
  const colFirstName = findColumnIndex(headers, "First Name", "FirstName", "Applicant Name", "Name");
  const colLastName = findColumnIndex(headers, "Last Name", "LastName");
  const colStatus = findColumnIndex(headers, "Application Status", "Status");
  const colVCode = findColumnIndex(headers, "Verification Code", "Verification code", "OTP");
  const colVSent = findColumnIndex(headers, "Verification Sent Date", "Verification Sent");
  
  let targetRow = -1;
  let targetRowData = null;
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (colAppId !== -1 && String(row[colAppId] || "").trim().toUpperCase() === appId.toUpperCase()) {
      targetRow = i + 1;
      targetRowData = row;
      break;
    }
  }
  
  if (targetRow === -1) throw new Error("Application '" + appId + "' not found.");
  
  const applicantEmail = findEmailInRow(targetRowData, headers);
  if (!applicantEmail) throw new Error("Applicant email not found.");
  
  const fn = colFirstName !== -1 ? String(targetRowData[colFirstName] || "").trim() : "";
  const ln = colLastName !== -1 ? String(targetRowData[colLastName] || "").trim() : "";
  const applicantName = (fn + " " + ln).trim() || "Applicant";
  
  const newCode = "LSU26-" + Math.floor(100000 + Math.random() * 900000);
  const sentTime = new Date();
  const expiryTime = new Date(sentTime.getTime() + CONFIG.VERIFICATION_HOURS * 60 * 60 * 1000);
  const formattedExpiry = formatExactDateTime(expiryTime);
  
  if (colStatus !== -1) sheet.getRange(targetRow, colStatus + 1).setValue("VERIFICATION_PENDING");
  if (colVCode !== -1) sheet.getRange(targetRow, colVCode + 1).setValue(newCode);
  if (colVSent !== -1) sheet.getRange(targetRow, colVSent + 1).setValue(sentTime);
  
  sendSecureEmail(
    applicantEmail,
    "LSU Membership Application - New Verification Code (24-Hour Expiry)",
    `Dear ${applicantName},\n\nA new verification code has been issued for your LSU membership application (${appId}).\n\nVerification Code:\n${newCode}\n\nIMPORTANT: This code is valid for 24 hours and will expire on ${formattedExpiry}.\n\nPlease reply directly to this email with the verification code above to complete your membership confirmation.\n\nRegards,\nLiberian Students Union in Odisha`
  );
  
  return { success: true, message: `New verification code sent. Valid until ${formattedExpiry}.` };
}

/*******************************************************
 * DOCUMENT UPDATE PORTAL LOGIC
 *******************************************************/
function getDocumentUpdateInfo(token) {
  token = String(token || "").trim();
  const dataStr = PropertiesService.getScriptProperties().getProperty('DOC_UPDATE_' + token);
  if (!dataStr) throw new Error("This document update link is invalid or has expired. Please contact the LSU administrator.");
  
  const data = JSON.parse(dataStr);
  
  if (data.expiresAt) {
    const expiryDate = new Date(data.expiresAt);
    if (new Date() > expiryDate) {
      throw new Error(`This document update link expired on ${formatExactDateTime(expiryDate)}. Please request a new link from the administrator.`);
    }
  }
  
  if (data.docType === "Passport Photo") {
    data.docType = "Identification Photo";
  }
  
  const sheet = ensureMembersSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idxId = findColumnIndex(headers, "Application ID", "Application Id", "ApplicationID", "App ID", "ID");
  const idxStatus = findColumnIndex(headers, "Application Status", "Status");
  
  let currentStatus = "";
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    let isMatch = false;
    if (idxId !== -1 && String(row[idxId] || "").trim().toUpperCase() === data.appId.toUpperCase()) {
      isMatch = true;
    } else {
      for (let c = 0; c < row.length; c++) {
        if (String(row[c] || "").trim().toUpperCase() === data.appId.toUpperCase()) {
          isMatch = true;
          break;
        }
      }
    }
    if (isMatch) {
      currentStatus = idxStatus !== -1 ? String(row[idxStatus]).trim().toUpperCase() : "NEEDS_CLARIFICATION";
      break;
    }
  }
  
  if (currentStatus && currentStatus !== "NEEDS_CLARIFICATION") {
    throw new Error("This application is no longer awaiting a document update.");
  }
  
  return {
    success: true,
    appId: data.appId,
    docType: data.docType,
    reason: data.reason,
    expiresAt: data.expiresAt ? formatExactDateTime(new Date(data.expiresAt)) : ""
  };
}

function submitDocumentUpdate(payload) {
  const token = String(payload.token || "").trim();
  const dataStr = PropertiesService.getScriptProperties().getProperty('DOC_UPDATE_' + token);
  if (!dataStr) throw new Error("Invalid or expired update token.");
  
  const data = JSON.parse(dataStr);
  
  if (data.expiresAt) {
    const expiryDate = new Date(data.expiresAt);
    if (new Date() > expiryDate) {
      throw new Error(`This document update link expired on ${formatExactDateTime(expiryDate)}. Please contact the administrator.`);
    }
  }
  
  if (!payload.file || !payload.file.content) throw new Error("No file provided.");
  
  let docType = data.docType;
  if (docType === "Passport Photo") docType = "Identification Photo";
  
  const isPhoto = (docType === "Identification Photo" || docType === "Passport Photo");
  validateFileObject(payload.file, docType, isPhoto ? "IMAGE" : "PDF");
  
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error("Server busy. Please retry.");
  }
  
  try {
    const sheet = ensureMembersSheet();
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(h => String(h || "").trim());
    
    const idxAppId = findColumnIndex(headers, "Application ID", "Application Id", "ApplicationID", "App ID", "ID");
    const idxStatus = findColumnIndex(headers, "Application Status", "Status");
    const idxDoc = findColumnIndex(headers, docType, isPhoto ? "Passport Photo" : docType);
    
    if (idxDoc === -1) throw new Error("Document column '" + docType + "' not found in database.");
    
    let targetRow = -1;
    let targetRowData = null;
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      let isMatch = false;
      if (idxAppId !== -1 && String(row[idxAppId] || "").trim().toUpperCase() === data.appId.toUpperCase()) {
        isMatch = true;
      } else {
        for (let c = 0; c < row.length; c++) {
          if (String(row[c] || "").trim().toUpperCase() === data.appId.toUpperCase()) {
            isMatch = true;
            break;
          }
        }
      }
      if (isMatch) {
        targetRow = i + 1;
        targetRowData = row;
        break;
      }
    }
    if (targetRow === -1) throw new Error("Application not found.");
    
    const idxType = findColumnIndex(headers, "Membership Type", "Type");
    const isStudent = (idxType !== -1 && String(targetRowData[idxType]).toUpperCase().includes("STUDENT"));

    const oldUrl = String(sheet.getRange(targetRow, idxDoc + 1).getValue());
    archiveOldDocument(oldUrl);
    
    let appFolder = null;
    const folders = DriveApp.getFoldersByName(data.appId);
    if (folders.hasNext()) {
      appFolder = folders.next();
    } else {
      try {
        const rootFolder = DriveApp.getFolderById(CONFIG.ROOT_DRIVE_FOLDER_ID);
        const yearF = getOrCreateFolder(rootFolder, new Date().getFullYear().toString());
        const catF = getOrCreateFolder(yearF, isStudent ? "Current Students" : "Alumni");
        appFolder = getOrCreateFolder(catF, data.appId);
      } catch (e) {
        const rootFolder = DriveApp.getFolderById(CONFIG.ROOT_DRIVE_FOLDER_ID);
        appFolder = getOrCreateFolder(rootFolder, data.appId);
      }
    }
    
    const newUrl = saveFileToDrive(payload.file, appFolder);
    
    sheet.getRange(targetRow, idxDoc + 1).setValue(newUrl);
    if (idxStatus !== -1) {
      sheet.getRange(targetRow, idxStatus + 1).setValue("UNDER_REVIEW");
    }
    
    PropertiesService.getScriptProperties().deleteProperty('DOC_UPDATE_' + token);
    cleanupExpiredTokens_();
    
    const applicantEmail = extractEmail(data.email) || findEmailInRow(targetRowData, headers);
    if (applicantEmail) {
      sendSecureEmail(
        applicantEmail,
        "LSU Membership - Document Received",
        `Dear Applicant,\n\nYour updated document (${docType}) has been successfully received.\nYour application (${data.appId}) has been returned to the administrator for review.\n\nPlease check your email regularly for further updates.\n\nRegards,\nLiberian Students Union in Odisha`
      );
    }
    
    return { success: true, message: "Document replaced successfully." };
  } finally {
    lock.releaseLock();
  }
}

/*******************************************************
 * EMAIL REPLY VERIFICATION (SERVER-SIDE 24-HOUR EXPIRATION)
 *******************************************************/
function processVerificationReplies(payload) {
  if (payload && payload.sessionToken) {
    requireAdministratorSession(payload.sessionToken);
  }
  
  const threads = GmailApp.search('is:unread subject:"Re: LSU Membership Application - Verification Required"');
  let processedCount = 0;
  
  const sheet = ensureMembersSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(h => String(h || "").trim());
  
  const idxStatus = findColumnIndex(headers, "Application Status", "Status");
  const idxVCode = findColumnIndex(headers, "Verification Code", "Verification code", "OTP");
  const idxVSent = findColumnIndex(headers, "Verification Sent Date", "Verification Sent");
  const idxVReply = findColumnIndex(headers, "Verification Reply Date", "Verification Reply");
  const idxMemId = findColumnIndex(headers, "Membership ID", "Membership Id", "Member ID");
  const idxMemConf = findColumnIndex(headers, "Membership Confirmed Date", "Confirmed Date");
  const idxFirstName = findColumnIndex(headers, "First Name", "FirstName", "Applicant Name", "Name");
  const idxReason = findColumnIndex(headers, "Rejection Reason", "Reason");
  
  for (const thread of threads) {
    const messages = thread.getMessages();
    for (const msg of messages) {
      if (!msg.isUnread()) continue;
      
      const rawSender = msg.getFrom();
      const senderEmail = extractEmail(rawSender);
      const body = msg.getPlainBody();
      
      for (let i = 1; i < values.length; i++) {
        const rowEmail = findEmailInRow(values[i], headers);
        const curStatus = idxStatus !== -1 ? String(values[i][idxStatus]).trim().toUpperCase() : "";
        
        if (rowEmail === senderEmail && curStatus === "VERIFICATION_PENDING") {
          const expectedCode = idxVCode !== -1 ? String(values[i][idxVCode]).trim() : "";
          const sentDate = idxVSent !== -1 ? new Date(values[i][idxVSent]) : new Date();
          const now = new Date();
          
          const hoursDiff = (now.getTime() - sentDate.getTime()) / (1000 * 60 * 60);
          
          if (hoursDiff > CONFIG.VERIFICATION_HOURS) {
            if (idxStatus !== -1) sheet.getRange(i + 1, idxStatus + 1).setValue("REJECTED");
            if (idxReason !== -1) sheet.getRange(i + 1, idxReason + 1).setValue("Verification code expired (24 hours).");
            msg.markRead();
            continue;
          }
          
          if (expectedCode && body.toUpperCase().includes(expectedCode.toUpperCase())) {
            const memId = "LSU-" + new Date().getFullYear() + "-" + Math.floor(1000 + Math.random() * 9000);
            if (idxStatus !== -1) sheet.getRange(i + 1, idxStatus + 1).setValue("MEMBER_CONFIRMED");
            if (idxVReply !== -1) sheet.getRange(i + 1, idxVReply + 1).setValue(now);
            if (idxMemId !== -1) sheet.getRange(i + 1, idxMemId + 1).setValue(memId);
            if (idxMemConf !== -1) sheet.getRange(i + 1, idxMemConf + 1).setValue(now);
            
            const applicantName = idxFirstName !== -1 ? String(values[i][idxFirstName] || "Applicant") : "Applicant";
            
            sendSecureEmail(
              senderEmail,
              "LSU Membership Confirmed - Official Membership ID",
              `Dear ${applicantName},\n\nCongratulations! Your verification has succeeded.\n\nYour official LSU Membership ID is: ${memId}\nStatus: Member Confirmed\n\nWelcome to the Liberian Students Union in Odisha!\n\nRegards,\nLiberian Students Union in Odisha`
            );
            
            processedCount++;
            msg.markRead();
          }
        }
      }
    }
  }
  
  return { success: true, message: `Processed ${processedCount} verifications.` };
}

/*******************************************************
 * FRONTEND USER OTP & SECURE SUBMISSION
 *******************************************************/
function sendOTP(email, turnstileToken) {
  email = extractEmail(email);
  if (!validateEmail(email)) throw new Error("Please enter a valid email address.");
  
  // 1. Server-side Turnstile CAPTCHA verification
  validateCloudflareTurnstile_(turnstileToken);
  
  // 2. Resend Cooldown & Rate Limiting (60 seconds per email)
  const cooldownKey = "LSU_OTP_COOLDOWN_" + email;
  const inCooldown = CacheService.getScriptCache().get(cooldownKey);
  if (inCooldown) {
    throw new Error("Please wait 60 seconds before requesting a new verification code.");
  }
  
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error("Server busy. Please retry.");
  }
  
  try {
    const sheet = ensureOTPSheet();
    const otp = CONFIG.OTP_PREFIX + Math.floor(1000 + Math.random() * 9000);
    const expiresAt = new Date(Date.now() + CONFIG.OTP_EXPIRY_MINUTES * 60000);
    
    sheet.appendRow([new Date(), email, otp, expiresAt, "No", 0]);
    
    // Set 60-second cooldown in cache
    CacheService.getScriptCache().put(cooldownKey, "1", 60);
    
    sendSecureEmail(
      email,
      "LSU Email Verification Code",
      `Dear Applicant,\n\nYour LSU email verification code is:\n\n${otp}\n\nThis verification code will expire in ${CONFIG.OTP_EXPIRY_MINUTES} minutes.\n\nIf you did not request this, please ignore this email.\n\nRegards,\nLiberian Students Union in Odisha`
    );
    return { success: true, message: "Verification code sent to your email." };
  } finally {
    lock.releaseLock();
  }
}

function verifyOTP(email, enteredOTP) {
  email = extractEmail(email);
  enteredOTP = String(enteredOTP || "").trim().toUpperCase();
  if (!email || !enteredOTP) throw new Error("Email and OTP are required.");
  
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error("Server busy. Please retry.");
  }
  
  try {
    const sheet = ensureOTPSheet();
    const values = sheet.getDataRange().getValues();
    
    for (let i = values.length - 1; i >= 1; i--) {
      if (extractEmail(values[i][1]) === email) {
        const storedOtp = String(values[i][2] || "").trim().toUpperCase();
        const expiresAt = new Date(values[i][3]);
        const verified = String(values[i][4] || "").trim().toUpperCase();
        let attempts = Number(values[i][5] || 0);
        
        if (verified === "YES") {
          return { success: false, message: "This verification code has already been used. Please request a new code." };
        }
        if (attempts >= CONFIG.MAX_ATTEMPTS) {
          return { success: false, message: "Maximum attempts reached. This verification code has been invalidated. Please request a new code." };
        }
        if (new Date() > expiresAt) {
          return { success: false, message: "Verification code has expired. Please request a new code." };
        }
        
        if (storedOtp === enteredOTP) {
          // Success: Mark code as verified
          sheet.getRange(i + 1, 5).setValue("Yes");
          
          // Issue a cryptographically secure, temporary verification token
          const verificationToken = "LSU_VT_" + Utilities.getUuid();
          const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 60 minutes
          const tokenRecord = JSON.stringify({
            email: email,
            createdAt: new Date().toISOString(),
            expiresAt: tokenExpiry.toISOString(),
            used: false
          });
          
          // Store both in durable PropertiesService and high-speed CacheService
          PropertiesService.getScriptProperties().setProperty("VERIF_TOKEN_" + verificationToken, tokenRecord);
          CacheService.getScriptCache().put("VERIF_TOKEN_" + verificationToken, tokenRecord, 3600);
          
          return {
            success: true,
            verificationToken: verificationToken,
            email: email,
            message: "Email verified successfully."
          };
        }
        
        // Failed attempt: increment counter and lock out if max attempts reached
        attempts++;
        sheet.getRange(i + 1, 6).setValue(attempts);
        
        if (attempts >= CONFIG.MAX_ATTEMPTS) {
          return {
            success: false,
            message: `Maximum attempts reached (${attempts}/${CONFIG.MAX_ATTEMPTS}). This verification code is now invalidated. Please request a new code.`
          };
        }
        
        return {
          success: false,
          message: `Invalid verification code. Attempt ${attempts}/${CONFIG.MAX_ATTEMPTS}.`
        };
      }
    }
    return { success: false, message: "No active verification code found for this email. Please request a new code." };
  } finally {
    lock.releaseLock();
  }
}

function submitApplication(payload) {
  const data = payload.data || {};
  const isStudent = String(data["Membership Type"] || "").toUpperCase().includes("STUDENT");
  
  // 1. Validate Verification Token and Email Binding
  const verificationToken = String(payload.verificationToken || payload.token || "").trim();
  if (!verificationToken) {
    throw new Error("Verification token is required. Please verify your email before submitting.");
  }
  
  let tokenDataStr = CacheService.getScriptCache().get("VERIF_TOKEN_" + verificationToken);
  if (!tokenDataStr) {
    tokenDataStr = PropertiesService.getScriptProperties().getProperty("VERIF_TOKEN_" + verificationToken);
  }
  
  if (!tokenDataStr) {
    throw new Error("Your email verification session has expired or is invalid. Please verify your email again.");
  }
  
  const tokenRecord = JSON.parse(tokenDataStr);
  if (tokenRecord.used) {
    throw new Error("This verification session has already been used to submit an application.");
  }
  
  if (new Date() > new Date(tokenRecord.expiresAt)) {
    throw new Error("Your verification session has expired. Please verify your email again.");
  }
  
  const applicantEmail = extractEmail(data["Email"]);
  if (!applicantEmail || applicantEmail !== extractEmail(tokenRecord.email)) {
    throw new Error("The submitted application email does not match the verified email address.");
  }
  
  let totalBytes = 0;
  
  // 2. Identification Photo (JPG/JPEG, max 5 MB)
  const idPhotoObj = payload.identificationPhoto || payload.passportPhoto;
  if (!idPhotoObj) throw new Error("Identification Photo is required.");
  const idPhotoValid = validateFileObject(idPhotoObj, "Identification Photo", "IMAGE");
  totalBytes += idPhotoValid.sizeBytes;
  
  // 3. Passport Document (PDF, max 5 MB)
  const passDocObj = payload.passportDocument || payload.passportFile;
  if (!passDocObj) throw new Error("Passport Document is required.");
  const passDocValid = validateFileObject(passDocObj, "Passport Document", "PDF");
  totalBytes += passDocValid.sizeBytes;
  
  // 4. EFRO File (PDF, max 5 MB, required for current students)
  let efroDocObj = payload.efroFile || payload.efro;
  if (isStudent) {
    if (!efroDocObj) throw new Error("EFRO Document is required for Current Students.");
    const efroDocValid = validateFileObject(efroDocObj, "EFRO File", "PDF");
    totalBytes += efroDocValid.sizeBytes;
  }
  
  // 5. Validate total upload set <= 15 MB
  if (totalBytes > CONFIG.MAX_TOTAL_UPLOAD_BYTES) {
    throw new Error("Total document upload size exceeds the maximum limit of 15 MB.");
  }
  
  const uniqueId = "APP-" + new Date().getFullYear() + "-" + Utilities.getUuid().split("-")[0].toUpperCase();
  
  const root = DriveApp.getFolderById(CONFIG.ROOT_DRIVE_FOLDER_ID);
  const yearF = getOrCreateFolder(root, new Date().getFullYear().toString());
  const catF = getOrCreateFolder(yearF, isStudent ? "Current Students" : "Alumni");
  const appF = getOrCreateFolder(catF, uniqueId);
  
  const efroUrl = isStudent && efroDocObj ? saveFileToDrive(efroDocObj, appF) : "";
  const passDocUrl = saveFileToDrive(passDocObj, appF);
  const idPhotoUrl = saveFileToDrive(idPhotoObj, appF);
  
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error("Database is currently handling multiple applications. Please click submit again.");
  }
  
  try {
    const sheet = ensureMembersSheet();
    const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    const row = new Array(headers.length).fill("");
    
    const setVal = (headerNames, value) => {
      const names = Array.isArray(headerNames) ? headerNames : [headerNames];
      const idx = findColumnIndex(headers, ...names);
      if (idx !== -1) {
        row[idx] = value;
      }
    };

    setVal(["Timestamp"], new Date());
    setVal(["Membership Type", "Type"], data["Membership Type"] || (isStudent ? "CURRENT STUDENT" : "ALUMNI"));
    setVal(["First Name", "FirstName"], data["First Name"] || "");
    setVal(["Middle Name", "MiddleName"], data["Middle Name"] || "");
    setVal(["Last Name", "LastName"], data["Last Name"] || "");
    setVal(["Gender", "Sex"], data["Gender"] || "");
    setVal(["Position / Role", "Role", "Position"], data["Position / Role"] || "");
    setVal(["WhatsApp Number", "WhatsApp"], data["WhatsApp Number"] || "");
    setVal(["Date of Birth", "DOB"], data["Date of Birth"] || "");
    setVal(["Mobile Number", "Mobile"], data["Mobile Number"] || "");
    setVal(["Passport Number", "Passport No"], data["Passport Number"] || "");
    setVal(["College Registration Number", "Registration Number"], data["College Registration Number"] || "");
    setVal(["University", "College"], data["University"] || "");
    setVal(["Degree Type", "Degree"], data["Degree Type"] || "");
    setVal(["Study From", "From"], data["Study From"] || "");
    setVal(["Study To", "To"], data["Study To"] || "");
    setVal(["Field of Studies", "Field of Study"], data["Field of Studies"] || "");
    setVal(["Mother Name", "Mother's Name"], data["Mother Name"] || "");
    setVal(["Father Name", "Father's Name"], data["Father Name"] || "");
    setVal(["Parents Contact", "Parent Contact"], data["Parents Contact"] || "");
    setVal(["Graduation Date"], data["Graduation Date"] || "");
    
    setVal(["EFRO File", "EFRO"], efroUrl);
    setVal(["Passport Document", "Passport File"], passDocUrl);
    setVal(["Identification Photo", "Passport Photo"], idPhotoUrl);
    setVal(["Privacy Consent", "Consent"], data["Privacy Consent"] || "");
    
    setVal(["Application ID", "App ID", "ID"], uniqueId);
    setVal(["Application Status", "Status"], "UNDER_REVIEW");
    setVal(["Submission Date", "Submitted Date"], new Date());
    
    headers.forEach((h, i) => {
      const hLower = String(h).trim().toLowerCase();
      if (hLower === "applicant email" || hLower === "email" || hLower === "email address" || hLower === "untitled question") {
        row[i] = applicantEmail;
      }
    });

    sheet.appendRow(row);

    // Invalidate the verification token immediately to prevent reuse
    PropertiesService.getScriptProperties().deleteProperty("VERIF_TOKEN_" + verificationToken);
    CacheService.getScriptCache().remove("VERIF_TOKEN_" + verificationToken);
    cleanupExpiredTokens_();

    if (applicantEmail) {
      const applicantName = ((data["First Name"] || "") + " " + (data["Last Name"] || "")).trim() || "Applicant";
      sendSecureEmail(
        applicantEmail,
        "LSU Membership Application Received - " + uniqueId,
        `Dear ${applicantName},\n\nYour membership application has been received successfully and is currently under review.\n\nApplication ID: ${uniqueId}\nMembership Type: ${data["Membership Type"] || ""}\nStatus: Under Review\n\nPlease check your email regularly for further updates.\n\nRegards,\nLiberian Students Union in Odisha (LSUO)`
      );
    }

    return { success: true, applicationId: uniqueId };
  } finally {
    lock.releaseLock();
  }
}

/*******************************************************
 * LSU DUES & PAYMENT PORTAL LOGIC
 *******************************************************/
function lsuFindMemberByEmail_(email) {
  email = extractEmail(email);
  if (!email) return null;

  const sheet = ensureMembersSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;

  const headers = values[0].map(String);
  const emailCol = findColumnIndex(headers, "Email", "Applicant Email", "Email Address", "Applicant's Email");
  const statusCol = findColumnIndex(headers, "Application Status", "Status", "Application status");
  const idCol = findColumnIndex(headers, "Membership ID", "Membership Id", "Member ID", "Membership Number");
  const firstCol = findColumnIndex(headers, "First Name", "FirstName", "Applicant Name");
  const middleCol = findColumnIndex(headers, "Middle Name", "MiddleName");
  const lastCol = findColumnIndex(headers, "Last Name", "LastName");

  let fallbackCandidate = null;
  for (let i = values.length - 1; i >= 1; i--) {
    const row = values[i];
    const rowEmail = (emailCol !== -1 ? extractEmail(row[emailCol]) : "") || findEmailInRow(row, headers);
    if (rowEmail === email) {
      const status = String(statusCol !== -1 ? row[statusCol] : "").trim().toUpperCase();
      const membershipId = String(idCol !== -1 ? row[idCol] : "").trim();
      const fullMember = (status === "MEMBER_CONFIRMED" || status === "CONFIRMED") && !!membershipId;
      const name = [
        firstCol !== -1 ? row[firstCol] : "",
        middleCol !== -1 ? row[middleCol] : "",
        lastCol !== -1 ? row[lastCol] : ""
      ].map(v => String(v || "").trim()).filter(Boolean).join(" ");

      const candidate = {
        row: i + 1,
        email,
        name: name || email,
        membershipId,
        status,
        fullMember
      };
      if (fullMember) return candidate;
      if (!fallbackCandidate) fallbackCandidate = candidate;
    }
  }
  return fallbackCandidate;
}

function lsuDueOtpKey_(email) {
  return LSU_PAYMENT_CONFIG.MEMBER_OTP_PREFIX + extractEmail(email);
}

function lsuDueSessionKey_(token) {
  return LSU_PAYMENT_CONFIG.MEMBER_SESSION_PREFIX + String(token || "").trim();
}

function sendDueOTP(email) {
  email = extractEmail(email);
  if (!validateEmail(email)) return { success: false, message: "Please enter a valid registered email address." };

  const member = lsuFindMemberByEmail_(email);
  if (!member) {
    return {
      success: false,
      message: "This email address is not registered in the LSU database. Please submit a membership registration application first."
    };
  }
  if (!member.fullMember) {
    if (member.status === "UNDER_REVIEW") {
      return {
        success: false,
        message: "Your LSU membership application is currently under review. Dues payment is available once approved."
      };
    }
    if (member.status === "VERIFICATION_PENDING") {
      return {
        success: false,
        message: "Your membership application is pending verification. Please complete verification before paying dues."
      };
    }
    if (member.status === "REJECTED") {
      return {
        success: false,
        message: "Your membership application was not approved. Please contact the administrator."
      };
    }
    return {
      success: false,
      message: "This email address is not associated with an approved, confirmed LSU member."
    };
  }

  const otp = "DUE" + Math.floor(100 + Math.random() * 900);
  const expires = new Date(Date.now() + LSU_PAYMENT_CONFIG.OTP_EXPIRY_MINUTES * 60000);

  CacheService.getScriptCache().put(lsuDueOtpKey_(email), JSON.stringify({
    otp, expiresAt: expires.toISOString(), attempts: 0, verified: false
  }), LSU_PAYMENT_CONFIG.OTP_EXPIRY_MINUTES * 60);

  sendSecureEmail(
    email,
    "LSU Dues Payment Verification Code",
    `Dear ${member.name},\n\nYour LSU dues payment verification code is:\n\n${otp}\n\nThis code expires in ${LSU_PAYMENT_CONFIG.OTP_EXPIRY_MINUTES} minutes.\n\nRegards,\nLiberian Students Union in Odisha`
  );

  return { success: true, message: "Verification code sent to your registered email address." };
}

function verifyDueOTP(email, enteredOTP) {
  email = extractEmail(email);
  enteredOTP = String(enteredOTP || "").trim().toUpperCase();

  const member = lsuFindMemberByEmail_(email);
  if (!member) {
    return {
      success: false,
      message: "This email address is not registered in the LSU database."
    };
  }
  if (!member.fullMember) {
    return {
      success: false,
      message: "This email address is not associated with an approved, confirmed LSU member."
    };
  }

  const raw = CacheService.getScriptCache().get(lsuDueOtpKey_(email));
  if (!raw) return { success: false, message: "Verification code expired or was not requested. Please request a new code." };

  const record = JSON.parse(raw);
  if (new Date() > new Date(record.expiresAt)) return { success: false, message: "Verification code has expired. Please request a new code." };
  if (record.attempts >= LSU_PAYMENT_CONFIG.MAX_OTP_ATTEMPTS) return { success: false, message: "Maximum attempts reached. Please request a new code." };

  if (record.otp !== enteredOTP) {
    record.attempts++;
    CacheService.getScriptCache().put(lsuDueOtpKey_(email), JSON.stringify(record), LSU_PAYMENT_CONFIG.OTP_EXPIRY_MINUTES * 60);
    return { success: false, message: `Incorrect code. Attempt ${record.attempts}/${LSU_PAYMENT_CONFIG.MAX_OTP_ATTEMPTS}.` };
  }

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(lsuDueSessionKey_(token), JSON.stringify({
    email, name: member.name, membershipId: member.membershipId
  }), LSU_PAYMENT_CONFIG.SESSION_TTL_SECONDS);
  CacheService.getScriptCache().remove(lsuDueOtpKey_(email));

  return { success: true, sessionToken: token, member: { email, name: member.name, membershipId: member.membershipId } };
}

function lsuRequireDueSession_(token) {
  token = String(token || "").trim();
  const raw = CacheService.getScriptCache().get(lsuDueSessionKey_(token));
  if (!raw) throw new Error("Your payment session has expired. Please log in again.");
  const session = JSON.parse(raw);
  const member = lsuFindMemberByEmail_(session.email);
  if (!member || !member.fullMember) throw new Error("Membership access is no longer available.");
  CacheService.getScriptCache().put(lsuDueSessionKey_(token), raw, LSU_PAYMENT_CONFIG.SESSION_TTL_SECONDS);
  return { ...session, member };
}

function getDuePaymentData(sessionToken, targetEmail) {
  const session = lsuRequireDueSession_(sessionToken);
  if (targetEmail) {
    const member = lsuFindMemberByEmail_(targetEmail);
    if (!member) {
      return {
        success: false,
        message: "This member cannot be added because this email address is not registered in the LSU database."
      };
    }
    if (!member.fullMember) {
      return {
        success: false,
        message: "This member cannot be added because this email address is not associated with a confirmed LSU member."
      };
    }
    return {
      success: true,
      member: { email: member.email, name: member.name, membershipId: member.membershipId }
    };
  }
  return {
    success: true,
    payer: { email: session.email, name: session.member.name, membershipId: session.member.membershipId }
  };
}

function lsuValidateAmount_(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 100000000) throw new Error("Each payment amount must be greater than zero.");
  return Math.round(n * 100) / 100;
}

function lsuPaymentMethod_(method) {
  method = String(method || "").trim().toUpperCase();
  if (method === "ONLINE" || method === "UPI" || method === "ONLINE / UPI") return "ONLINE / UPI";
  if (method === "CASH") return "CASH";
  throw new Error("Please select Online / UPI or Cash.");
}

function lsuPaymentId_() {
  const year = new Date().getFullYear();
  const sheet = lsuPaymentSheet_(LSU_PAYMENT_CONFIG.PAYMENT_SHEET_NAME, [
    "Payment ID","Payer","Payer Email","Payment Method","Total Amount",
    "Payment Date","UPI Ref No.","Cash Receiver Name","Cash Receiver Position",
    "Status","Submitted Date","Approved Date","Approved By","Receipt ID","Rejection Reason"
  ]);
  return "PAY-" + year + "-" + Utilities.formatString("%04d", Math.max(1, sheet.getLastRow()));
}

function submitDuePayment(payload) {
  const session = lsuRequireDueSession_(payload.sessionToken);
  ensurePaymentSheets();

  const method = lsuPaymentMethod_(payload.paymentMethod);
  const payer = session.member;
  const requested = Array.isArray(payload.members) ? payload.members : (Array.isArray(payload.allocations) ? payload.allocations : []);
  const isConfirmed = payload.confirmed === true || payload.confirmation === true;

  if (!requested.length || requested.length > 3) throw new Error("Select at least one member and no more than three members.");

  const seen = {};
  const allocations = [];
  let total = 0;

  for (const item of requested) {
    const email = extractEmail(item.email);
    if (!email) throw new Error("A valid member email is required.");

    if (seen[email]) throw new Error("Duplicate member emails are not allowed.");
    seen[email] = true;

    if (payload.paymentChoice === "PAY_FOR_OTHER_MEMBERS" && email === payer.email) {
      throw new Error("Payer email cannot be added when paying for other members.");
    }

    if (email !== payer.email && Object.keys(seen).length > 3) {
      throw new Error("You can pay for a maximum of two other members.");
    }

    if (email !== payer.email && requested.filter(x => extractEmail(x.email) !== payer.email).length > 2) {
      throw new Error("You can pay for a maximum of two other members.");
    }

    const member = lsuFindMemberByEmail_(email);
    if (!member || !member.fullMember) {
      throw new Error("This member cannot be added because this email address is not associated with a registered full LSU member.");
    }

    const amount = lsuValidateAmount_(item.amount);
    allocations.push({ email: member.email, name: member.name, membershipId: member.membershipId, amount });
    total += amount;
  }

  if (allocations.length > 3) throw new Error("A payment can cover the payer and up to two other members.");

  total = Math.round(total * 100) / 100;

  if (method === "ONLINE / UPI") {
    if (!String(payload.upiRefNo || "").trim()) throw new Error("UPI Ref No. is required.");
    if (!payload.paymentDate) throw new Error("Payment date is required.");
    if (!isConfirmed) throw new Error("Please confirm the payment before submitting.");
  }

  if (method === "CASH") {
    if (!payload.paymentDate) throw new Error("Cash payment date is required.");
    if (!String(payload.cashReceiverName || "").trim()) throw new Error("Cash receiver name is required.");
    if (!String(payload.cashReceiverPosition || "").trim()) throw new Error("Cash receiver position is required.");
    if (!isConfirmed) throw new Error("Please confirm the cash payment before submitting.");
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error("Payment system is busy processing another transaction. Please retry in a moment.");
  }

  try {
    const paymentSheet = lsuPaymentSheet_(LSU_PAYMENT_CONFIG.PAYMENT_SHEET_NAME, [
      "Payment ID","Payer","Payer Email","Payment Method","Total Amount",
      "Payment Date","UPI Ref No.","Cash Receiver Name","Cash Receiver Position",
      "Status","Submitted Date","Approved Date","Approved By","Receipt ID","Rejection Reason"
    ]);
    const allocationSheet = lsuPaymentSheet_(LSU_PAYMENT_CONFIG.ALLOCATION_SHEET_NAME, [
      "Payment ID","Member Email","Member Name","Membership ID","Amount","Receipt Status"
    ]);

    const paymentId = lsuPaymentId_();
    const submitted = new Date();

    paymentSheet.appendRow([
      paymentId, payer.name, payer.email, method, total,
      String(payload.paymentDate), method === "ONLINE / UPI" ? String(payload.upiRefNo).trim() : "",
      method === "CASH" ? String(payload.cashReceiverName).trim() : "",
      method === "CASH" ? String(payload.cashReceiverPosition).trim() : "",
      "PENDING VERIFICATION", submitted, "", "", "", ""
    ]);

    allocations.forEach(a => allocationSheet.appendRow([
      paymentId, a.email, a.name, a.membershipId, a.amount, "PENDING VERIFICATION"
    ]));

    return {
      success: true,
      paymentId,
      status: "PENDING VERIFICATION",
      payer: payer.name,
      allocations,
      total,
      message: "Payment submitted successfully. Your payment is pending administrator verification."
    };
  } finally {
    lock.releaseLock();
  }
}

function logoutDueMember(sessionToken) {
  CacheService.getScriptCache().remove(lsuDueSessionKey_(sessionToken));
  return { success: true };
}

/*******************************************************
 * FINANCE PAYMENT ADMIN AUTH & ACTIONS
 *******************************************************/
function paymentAdminSendOTP(email) {
  email = extractEmail(email);
  const access = checkAdministratorAccess(email);
  if (!access.authorized) return { success: false, message: "You are not authorized to access the payment administration portal." };

  const otp = "FIN" + Math.floor(100 + Math.random() * 900) + "LSU";
  CacheService.getScriptCache().put(
    LSU_PAYMENT_CONFIG.PAYMENT_ADMIN_OTP_PREFIX + email,
    JSON.stringify({ otp, expiresAt: new Date(Date.now() + LSU_PAYMENT_CONFIG.OTP_EXPIRY_MINUTES * 60000).toISOString(), attempts: 0 }),
    LSU_PAYMENT_CONFIG.OTP_EXPIRY_MINUTES * 60
  );

  sendSecureEmail(
    email,
    "LSU Finance Payment Administration Verification Code",
    `Dear ${access.name || "Administrator"},\n\nYour payment administration verification code is:\n\n${otp}\n\nThis code expires in ${LSU_PAYMENT_CONFIG.OTP_EXPIRY_MINUTES} minutes.\n\nRegards,\nLiberian Students Union in Odisha`
  );

  return { success: true, message: "Payment administration verification code sent." };
}

function paymentAdminVerifyOTP(email, enteredOTP) {
  email = extractEmail(email);
  enteredOTP = String(enteredOTP || "").trim().toUpperCase();
  const access = checkAdministratorAccess(email);
  if (!access.authorized) return { success: false, message: "Unauthorized account." };

  const key = LSU_PAYMENT_CONFIG.PAYMENT_ADMIN_OTP_PREFIX + email;
  const raw = CacheService.getScriptCache().get(key);
  if (!raw) return { success: false, message: "Verification code expired or was not requested." };

  const record = JSON.parse(raw);
  if (new Date() > new Date(record.expiresAt)) return { success: false, message: "Verification code has expired." };
  if (record.attempts >= LSU_PAYMENT_CONFIG.MAX_OTP_ATTEMPTS) return { success: false, message: "Maximum attempts reached." };

  if (record.otp !== enteredOTP) {
    record.attempts++;
    CacheService.getScriptCache().put(key, JSON.stringify(record), LSU_PAYMENT_CONFIG.OTP_EXPIRY_MINUTES * 60);
    return { success: false, message: `Incorrect code. Attempt ${record.attempts}/${LSU_PAYMENT_CONFIG.MAX_OTP_ATTEMPTS}.` };
  }

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(
    LSU_PAYMENT_CONFIG.PAYMENT_ADMIN_SESSION_PREFIX + token,
    JSON.stringify({ email, role: access.role, name: access.name }),
    LSU_PAYMENT_CONFIG.SESSION_TTL_SECONDS
  );
  CacheService.getScriptCache().remove(key);

  return { success: true, sessionToken: token, email, role: access.role, name: access.name };
}

function lsuRequirePaymentAdmin_(token) {
  token = String(token || "").trim();
  const key = LSU_PAYMENT_CONFIG.PAYMENT_ADMIN_SESSION_PREFIX + token;
  const raw = CacheService.getScriptCache().get(key);
  if (!raw) throw new Error("Payment administration session expired. Please log in again.");

  const session = JSON.parse(raw);
  const access = checkAdministratorAccess(session.email);
  if (!access.authorized || access.role !== session.role) throw new Error("Administrator access revoked.");

  CacheService.getScriptCache().put(key, raw, LSU_PAYMENT_CONFIG.SESSION_TTL_SECONDS);
  return session;
}

function getPendingDuePayments(sessionToken) {
  lsuRequirePaymentAdmin_(sessionToken);
  ensurePaymentSheets();

  const ps = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LSU_PAYMENT_CONFIG.PAYMENT_SHEET_NAME);
  const as = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LSU_PAYMENT_CONFIG.ALLOCATION_SHEET_NAME);
  const pv = ps.getDataRange().getValues();
  const av = as.getDataRange().getValues();
  const payments = [];
  const allocations = {};

  for (let i = 1; i < av.length; i++) {
    const p = String(av[i][0] || "");
    if (!allocations[p]) allocations[p] = [];
    allocations[p].push({
      email: String(av[i][1] || ""),
      name: String(av[i][2] || ""),
      membershipId: String(av[i][3] || ""),
      amount: Number(av[i][4] || 0),
      status: String(av[i][5] || "")
    });
  }

  for (let i = 1; i < pv.length; i++) {
    const status = String(pv[i][9] || "");
    if (status === "PENDING VERIFICATION") {
      let subDate = pv[i][10];
      if (subDate instanceof Date) {
        subDate = formatExactDateTime(subDate);
      } else {
        subDate = String(subDate || "");
      }

      payments.push({
        paymentId: String(pv[i][0] || ""),
        payer: String(pv[i][1] || ""),
        payerEmail: String(pv[i][2] || ""),
        paymentMethod: String(pv[i][3] || ""),
        totalAmount: Number(pv[i][4] || 0),
        paymentDate: String(pv[i][5] || ""),
        upiRefNo: String(pv[i][6] || ""),
        cashReceiverName: String(pv[i][7] || ""),
        cashReceiverPosition: String(pv[i][8] || ""),
        status,
        submittedDate: subDate,
        allocations: allocations[String(pv[i][0] || "")] || []
      });
    }
  }
  return { success: true, payments };
}

function lsuPaymentRow_(paymentId) {
  ensurePaymentSheets();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LSU_PAYMENT_CONFIG.PAYMENT_SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || "") === paymentId) return { sheet, row: i + 1, data: values[i] };
  }
  throw new Error("Payment not found.");
}

function lsuAllocationRows_(paymentId) {
  ensurePaymentSheets();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LSU_PAYMENT_CONFIG.ALLOCATION_SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || "") === paymentId) rows.push({ row: i + 1, data: values[i] });
  }
  return { sheet, rows };
}

function lsuReceiptId_(paymentId) {
  return "LSU-REC-" + paymentId.replace(/^PAY-/, "");
}

function lsuPaymentReceiptText_(payment, paymentAllocations, recipientMember) {
  const allocationText = paymentAllocations.map(a =>
    `- ${a.name} (${a.email}) — ₹${Number(a.amount).toFixed(2)}`
  ).join("\n");

  let text =
`Liberian Students Union in Odisha
PAYMENT RECEIPT

Payment / Receipt ID: ${payment.receiptId}
Status: PAID / VERIFIED

Payer: ${payment.payer}
Payer Email: ${payment.payerEmail}

Members Paid For:
${allocationText}

Total Amount: ₹${Number(payment.totalAmount).toFixed(2)}
Payment Date: ${payment.paymentDate}
Payment Method: ${payment.paymentMethod}`;

  if (payment.paymentMethod === "ONLINE / UPI") {
    text += `\nUPI Ref No.: ${payment.upiRefNo}`;
  } else {
    text += `\nCash Receiver: ${payment.cashReceiverName}\nCash Receiver Position: ${payment.cashReceiverPosition}`;
  }

  text += `\nApproved Date: ${payment.approvedDate}\n\n`;
  if (recipientMember) text += "Your LSU dues have been paid on your behalf.\nPayer registered email: " + payment.payerEmail + "\n\n";
  text += "Regards,\nLiberian Students Union in Odisha";
  return text;
}

function approveDuePayment(payload) {
  const session = lsuRequirePaymentAdmin_(payload.sessionToken);
  const paymentId = String(payload.paymentId || "").trim();
  if (!paymentId) throw new Error("Payment ID is required.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error("Payment system is busy. Please retry in a moment.");
  }

  try {
    ensurePaymentSheets();
    const payment = lsuPaymentRow_(paymentId);
    const allocations = lsuAllocationRows_(paymentId);

    if (String(payment.data[9]) !== "PENDING VERIFICATION") throw new Error("This payment has already been processed.");

    const expectedTotal = allocations.rows.reduce((sum, r) => sum + Number(r.data[4] || 0), 0);
    const storedTotal = Number(payment.data[4] || 0);
    if (Math.abs(expectedTotal - storedTotal) > 0.001) throw new Error("Payment total does not match its allocation amounts.");

    const receiptId = lsuReceiptId_(paymentId);
    const approvedDate = new Date();

    payment.sheet.getRange(payment.row, 10).setValue("PAID / VERIFIED");
    payment.sheet.getRange(payment.row, 12, 1, 4).setValues([[
      approvedDate, session.email, receiptId, ""
    ]]);

    allocations.rows.forEach(r => {
      allocations.sheet.getRange(r.row, 6).setValue("PAID / VERIFIED");
    });

    const receiptPayment = {
      payer: String(payment.data[1] || ""),
      payerEmail: String(payment.data[2] || ""),
      paymentMethod: String(payment.data[3] || ""),
      totalAmount: storedTotal,
      paymentDate: String(payment.data[5] || ""),
      upiRefNo: String(payment.data[6] || ""),
      cashReceiverName: String(payment.data[7] || ""),
      cashReceiverPosition: String(payment.data[8] || ""),
      receiptId,
      approvedDate: formatExactDateTime(approvedDate)
    };
    const receiptAllocations = allocations.rows.map(r => ({
      email: String(r.data[1] || ""), name: String(r.data[2] || ""),
      membershipId: String(r.data[3] || ""), amount: Number(r.data[4] || 0)
    }));

    sendSecureEmail(
      receiptPayment.payerEmail,
      "LSU Dues Payment Receipt - " + receiptId,
      lsuPaymentReceiptText_(receiptPayment, receiptAllocations, null)
    );

    receiptAllocations.forEach(member => {
      if (extractEmail(member.email) !== extractEmail(receiptPayment.payerEmail)) {
        sendSecureEmail(
          member.email,
          "LSU Dues Paid on Your Behalf - " + receiptId,
          lsuPaymentReceiptText_(receiptPayment, receiptAllocations, member)
        );
      }
    });

    return { success: true, message: "Payment approved and receipts sent.", paymentId, receiptId, status: "PAID / VERIFIED" };
  } finally {
    lock.releaseLock();
  }
}

function rejectDuePayment(payload) {
  const session = lsuRequirePaymentAdmin_(payload.sessionToken);
  const paymentId = String(payload.paymentId || "").trim();
  const reason = String(payload.rejectionReason || "").trim();
  if (!paymentId) throw new Error("Payment ID is required.");
  if (!reason) throw new Error("Rejection reason is required.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error("Payment system is busy. Please retry in a moment.");
  }

  try {
    ensurePaymentSheets();
    const payment = lsuPaymentRow_(paymentId);
    const allocations = lsuAllocationRows_(paymentId);
    if (String(payment.data[9]) !== "PENDING VERIFICATION") throw new Error("This payment has already been processed.");

    payment.sheet.getRange(payment.row, 10).setValue("REJECTED");
    payment.sheet.getRange(payment.row, 12, 1, 4).setValues([[
      "", session.email, "", reason
    ]]);
    allocations.rows.forEach(r => allocations.sheet.getRange(r.row, 6).setValue("REJECTED"));

    sendSecureEmail(
      String(payment.data[2] || ""),
      "LSU Dues Payment Rejected - " + paymentId,
      `Your LSU dues payment (${paymentId}) was rejected.\n\nReason:\n${reason}\n\nPlease contact the Liberian Students Union in Odisha if you need assistance.`
    );

    return { success: true, message: "Payment rejected.", paymentId, status: "REJECTED" };
  } finally {
    lock.releaseLock();
  }
}

function logoutPaymentAdmin(sessionToken) {
  CacheService.getScriptCache().remove(LSU_PAYMENT_CONFIG.PAYMENT_ADMIN_SESSION_PREFIX + String(sessionToken || "").trim());
  return { success: true };
}

/*******************************************************
 * MAIN WEB APP ENDPOINT
 *******************************************************/
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, message: "Empty request payload." });
    }
    
    const payload = JSON.parse(e.postData.contents);
    const action = String(payload.action || "").trim();

    // Membership Registration Routes
    if (action === "sendOTP") return jsonResponse(sendOTP(payload.email, payload.turnstileToken));
    if (action === "verifyOTP") return jsonResponse(verifyOTP(payload.email, payload.otp));
    if (action === "submitApplication") return jsonResponse(submitApplication(payload));
    
    // Administrator Authentication Routes
    if (action === "checkAdministratorAccess") return jsonResponse(checkAdministratorAccess(payload.email));
    if (action === "sendAdministratorOTP") return jsonResponse(sendAdministratorOTP(payload.email));
    if (action === "verifyAdministratorOTP") return jsonResponse(verifyAdministratorOTP(payload.email, payload.otp));
    if (action === "logoutAdministrator") return jsonResponse(logoutAdministrator(payload.sessionToken));
    
    // Administrator Dashboard Actions
    if (action === "getDashboardData") return jsonResponse(getDashboardData(payload.sessionToken));
    if (action === "updateApplicationStatus") return jsonResponse(updateApplicationStatus(payload));
    if (action === "resendUploadLink" || action === "resendDocumentUpdateLink") return jsonResponse(resendUploadLink(payload));
    if (action === "resendVerificationCode") return jsonResponse(resendVerificationCode(payload));
    if (action === "getAdministrators") return jsonResponse(getAdministrators(payload.sessionToken));
    if (action === "addAdministrator") return jsonResponse(addAdministrator(payload.sessionToken, payload.newEmail, payload.newName));
    if (action === "deactivateAdministrator") return jsonResponse(deactivateAdministrator(payload.sessionToken, payload.targetEmail));
    if (action === "reactivateAdministrator") return jsonResponse(reactivateAdministrator(payload.sessionToken, payload.targetEmail));
    if (action === "processVerificationReplies") return jsonResponse(processVerificationReplies(payload));
    if (action === "cleanupExpiredTokens") {
      requireAdministratorSession(payload.sessionToken);
      cleanupExpiredTokens_();
      return jsonResponse({ success: true, message: "Expired tokens cleaned up successfully." });
    }
    
    // Applicant Document Update Actions
    if (action === "getDocumentUpdateInfo") return jsonResponse(getDocumentUpdateInfo(payload.token));
    if (action === "submitDocumentUpdate") return jsonResponse(submitDocumentUpdate(payload));

    // LSU DUES PAYMENT ROUTES
    if (action === "sendDueOTP") return jsonResponse(sendDueOTP(payload.email));
    if (action === "verifyDueOTP") return jsonResponse(verifyDueOTP(payload.email, payload.otp));
    if (action === "getDuePaymentData") return jsonResponse(getDuePaymentData(payload.sessionToken, payload.targetEmail || payload.otherEmail || payload.email));
    if (action === "submitDuePayment") return jsonResponse(submitDuePayment(payload));
    if (action === "logoutDueMember") return jsonResponse(logoutDueMember(payload.sessionToken));
    if (action === "sendPaymentAdminOTP") return jsonResponse(paymentAdminSendOTP(payload.email));
    if (action === "verifyPaymentAdminOTP") return jsonResponse(paymentAdminVerifyOTP(payload.email, payload.otp));
    if (action === "getPendingDuePayments") return jsonResponse(getPendingDuePayments(payload.sessionToken));
    if (action === "approveDuePayment") return jsonResponse(approveDuePayment(payload));
    if (action === "rejectDuePayment") return jsonResponse(rejectDuePayment(payload));
    if (action === "logoutPaymentAdmin") return jsonResponse(logoutPaymentAdmin(payload.sessionToken));

    return jsonResponse({ success: false, message: "Invalid action: " + action });
  } catch (error) {
    Logger.log("doPost error: " + error.toString());
    return jsonResponse({ success: false, message: error.message || error.toString() });
  }
}

function doGet() {
  return jsonResponse({ success: true, message: "LSU Unified System Online." });
}
