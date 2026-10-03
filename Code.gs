
  LSU MEMBERSHIP DATABASE - GOOGLE APPS SCRIPT
  Complete Working Backend for LSUO Membership & Administrator Portal


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


  HELPERS

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
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
    // 1. Exact match (case-insensitive)
    let idx = headers.findIndex(h => String(h || "").trim().toLowerCase() === cleanName);
    if (idx !== -1) return idx;
    // 2. Contains match
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
  
  // 1. Check known email columns by header if headers exist
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
    // Check any column header containing 'mail' or 'question'
    for (let c = 0; c < headers.length; c++) {
      const h = String(headers[c] || "").toLowerCase();
      if (h.includes("mail") || h.includes("question") || h.includes("user")) {
        const found = extractEmail(row[c]);
        if (found) return found;
      }
    }
  }

  // 2. Scan every cell across the entire row
  for (let c = 0; c < row.length; c++) {
    const found = extractEmail(row[c]);
    if (found) return found;
  }
  
  return "";
}

function sendSecureEmail(toEmail, subject, bodyText) {
  const cleanEmail = extractEmail(toEmail);
  if (!cleanEmail) {
    throw new Error("Invalid recipient email address: " + toEmail);
  }
  try {
    MailApp.sendEmail({
      to: cleanEmail,
      subject: subject,
      body: bodyText
    });
  } catch (mailErr) {
    Logger.log("MailApp.sendEmail failed: " + mailErr.toString() + ". Retrying with GmailApp...");
    try {
      GmailApp.sendEmail(cleanEmail, subject, bodyText);
    } catch (gmailErr) {
      Logger.log("GmailApp.sendEmail failed: " + gmailErr.toString());
      throw new Error("Email delivery failed to " + cleanEmail + ": " + (gmailErr.message || gmailErr.toString()));
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
    // Ignore errors if file doesn't exist or permissions fail
  }
}


 ADMINISTRATOR HIERARCHY
 
function isChiefAdministrator(email) {
  return (extractEmail(email) === extractEmail(CHIEF_ADMIN_EMAIL));
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
  return { success: true, authorized: false, message: "Not authorized." };
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
    throw new Error("Maximum of 3 active co-administrators has been reached. Deactivate one before adding another.");
  }
  
  sheet.appendRow([newEmail, newName, "CO_ADMINISTRATOR", "ACTIVE", new Date(), session.email, "", "", "No", 0]);
  
  sendSecureEmail(
    newEmail,
    "LSU Administrator Access Authorized",
    `Dear ${newName},\n\nYou have been authorized as an LSU Co-Administrator by the Chief Administrator.\n\nYou can now log into the Administrator Portal using this email address. You will receive an OTP upon login.\n\nRegards,\nLiberian Students Union in Odisha`
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
  const access = checkAdministratorAccess(email);
  if (!access.authorized) return { success: false, message: "Unauthorized." };

  const sheet = ensureAdministratorSheet();
  const data = sheet.getDataRange().getValues();
  let rowNumber = -1;
  let adminName = access.name || "Administrator";
  for (let i = 1; i < data.length; i++) {
    if (extractEmail(data[i][0]) === email) { rowNumber = i + 1; break; }
  }
  if (rowNumber === -1) return { success: false, message: "Account not found." };

  const otp = "ADM" + Math.floor(100 + Math.random() * 900) + "LSU";
  const expiresAt = new Date(Date.now() + CONFIG.OTP_EXPIRY_MINUTES * 60000);

  sheet.getRange(rowNumber, 7).setValue(otp);
  sheet.getRange(rowNumber, 8).setValue(expiresAt);
  sheet.getRange(rowNumber, 9).setValue("No");
  sheet.getRange(rowNumber, 10).setValue(0);

  sendSecureEmail(
    email,
    "LSU Administrator Verification Code",
    `Dear ${adminName},\n\nYour administrator verification code is:\n\n${otp}\n\nExpires in ${CONFIG.OTP_EXPIRY_MINUTES} minutes.`
  );
  return { success: true, message: "OTP sent." };
}

function verifyAdministratorOTP(email, enteredOTP) {
  email = extractEmail(email);
  enteredOTP = String(enteredOTP || "").trim().toUpperCase();
  const access = checkAdministratorAccess(email);
  if (!access.authorized) return { success: false, message: "Unauthorized." };

  const sheet = ensureAdministratorSheet();
  const data = sheet.getDataRange().getValues();
  let rowNumber = -1;
  for (let i = 1; i < data.length; i++) {
    if (extractEmail(data[i][0]) === email) { rowNumber = i + 1; break; }
  }
  if (rowNumber === -1) return { success: false, message: "Account not found." };

  const storedOTP = String(sheet.getRange(rowNumber, 7).getValue()).trim().toUpperCase();
  const expiresAt = new Date(sheet.getRange(rowNumber, 8).getValue());
  const verified = String(sheet.getRange(rowNumber, 9).getValue()).trim().toUpperCase();
  let attempts = Number(sheet.getRange(rowNumber, 10).getValue() || 0);

  if (verified === "YES") return { success: false, message: "OTP already used." };
  if (attempts >= CONFIG.MAX_ATTEMPTS) return { success: false, message: "Max attempts reached." };
  if (new Date() > expiresAt) return { success: false, message: "OTP expired." };

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


 DASHBOARD STATISTICS

function getDashboardData(sessionToken) {
  const session = requireAdministratorSession(sessionToken);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error("Members sheet not found.");
  
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
        
        // Dynamic University Breakdown
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

      // App for array
      const app = {};
      for (let c = 0; c < headers.length; c++) {
        let val = row[c];
        if (val instanceof Date) val = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
        app[headers[c]] = val;
      }
      
      // Explicitly guarantee essential normalized properties
      const extractedEmail = findEmailInRow(row, headers);
      app['Email'] = extractedEmail;
      app['Applicant Email'] = extractedEmail;
      app['Application ID'] = appId || (idxAppId !== -1 ? row[idxAppId] : '') || ('ROW-' + (i + 1));
      
      // Keep both Identification Photo and Passport Photo properties synced
      const photoUrl = (idxPhoto !== -1 && row[idxPhoto]) ? row[idxPhoto] : (app['Identification Photo'] || app['Passport Photo'] || '');
      app['Identification Photo'] = photoUrl;
      app['Passport Photo'] = photoUrl;
      
      applications.push(app);
    }
  }

  return { success: true, administrator: session, statistics: statistics, applications: applications };
}


APPLICATION STATUS WORKFLOW

function updateApplicationStatus(payload) {
  const session = requireAdministratorSession(payload.sessionToken);
  const appId = String(payload.applicationId || "").trim();
  const newStatus = String(payload.newStatus || "").trim().toUpperCase();
  const reason = String(payload.rejectionReason || "").trim();
  let docType = String(payload.updateDocType || "").trim();
  
  if (docType === "Passport Photo") {
    docType = "Identification Photo";
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
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
  
  // Rule: Cannot confirm own application unless Chief Admin
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
    } else {
      throw new Error("Application status updated to REJECTED, but no valid email address was found for this applicant in the sheet.");
    }
  } 
  else if (newStatus === "NEEDS_CLARIFICATION") {
    if (!reason || !docType) throw new Error("Document type and reason required for updates.");
    if (colReason !== -1) sheet.getRange(targetRow, colReason + 1).setValue(`Update requested for: ${docType}. Reason: ${reason}`);
    
    // Generate secure token with server-side 24-hour expiration
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
        `Dear ${applicantName},\n\nYour LSU membership application (${appId}) has been reviewed.\n\nWe need you to update the following document before your application can be processed:\n\nDocument Required: ${docType}\nReason / Instructions: ${reason}\n\nPlease click the secure link below to upload your replacement document:\n${updateLink}\n\nIMPORTANT: This link will expire in 24 hours on ${formattedExpiry}.\n\nYour application will remain under review until the requested document is received. Please check your email regularly for further updates.\n\nRegards,\nLiberian Students Union in Odisha`
      );
    } else {
      throw new Error("Unable to locate a valid email address for application " + appId + ". Please check the spreadsheet row.");
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
    } else {
      throw new Error("Unable to locate a valid email address for application " + appId + ". Please check the spreadsheet row.");
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
        `Dear ${applicantName},\n\nCongratulations! Your LSU membership application (${appId}) has been officially APPROVED!\n\nOfficial Membership ID: ${memId}\nStatus: Member Confirmed\n\nWelcome to the Liberian Students Union in Odisha (LSUO). Please check your email regularly for union announcements and updates.\n\nRegards,\nLiberian Students Union in Odisha`
      );
    }
  }
  
  return { success: true, message: "Status updated successfully." };
}


  ADMIN RESEND ACTIONS (24-HOUR EXPIRATION)

function resendUploadLink(payload) {
  const session = requireAdministratorSession(payload.sessionToken);
  const appId = String(payload.applicationId || "").trim();
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
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
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
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


 DOCUMENT UPDATE PORTAL LOGIC

function getDocumentUpdateInfo(token) {
  token = String(token || "").trim();
  const dataStr = PropertiesService.getScriptProperties().getProperty('DOC_UPDATE_' + token);
  if (!dataStr) throw new Error("This document update link is invalid or has expired. Please contact the LSU administrator.");
  
  const data = JSON.parse(dataStr);
  
  // Server-side 24-hour expiration check
  if (data.expiresAt) {
    const expiryDate = new Date(data.expiresAt);
    if (new Date() > expiryDate) {
      throw new Error(`This document update link expired on ${formatExactDateTime(expiryDate)}. Please request a new link from the administrator.`);
    }
  }
  
  // Normalize docType name
  if (data.docType === "Passport Photo") {
    data.docType = "Identification Photo";
  }
  
  // Verify application is still NEEDS_CLARIFICATION
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
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
  
  // Server-side 24-hour expiration check
  if (data.expiresAt) {
    const expiryDate = new Date(data.expiresAt);
    if (new Date() > expiryDate) {
      throw new Error(`This document update link expired on ${formatExactDateTime(expiryDate)}. Please contact the administrator.`);
    }
  }
  
  if (!payload.file || !payload.file.content) throw new Error("No file provided.");
  
  // Normalize docType
  let docType = data.docType;
  if (docType === "Passport Photo") docType = "Identification Photo";
  
  // Validate file size and type (5 MB max)
  const isPhoto = (docType === "Identification Photo" || docType === "Passport Photo");
  validateFileObject(payload.file, docType, isPhoto ? "IMAGE" : "PDF");
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
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
  
  // Determine membership type for folder structure
  const idxType = findColumnIndex(headers, "Membership Type", "Type");
  const isStudent = (idxType !== -1 && String(targetRowData[idxType]).toUpperCase().includes("STUDENT"));

  // Archive Old Document
  const oldUrl = String(sheet.getRange(targetRow, idxDoc + 1).getValue());
  archiveOldDocument(oldUrl);
  
  // Save New File - Find or Create Folder reliably
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
  
  // Update Row
  sheet.getRange(targetRow, idxDoc + 1).setValue(newUrl);
  if (idxStatus !== -1) {
    sheet.getRange(targetRow, idxStatus + 1).setValue("UNDER_REVIEW");
  }
  
  // Invalidate token immediately upon successful use
  PropertiesService.getScriptProperties().deleteProperty('DOC_UPDATE_' + token);
  
  // Notify Applicant
  const applicantEmail = extractEmail(data.email) || findEmailInRow(targetRowData, headers);
  if (applicantEmail) {
    sendSecureEmail(
      applicantEmail,
      "LSU Membership - Document Received",
      `Dear Applicant,\n\nYour updated document (${docType}) has been successfully received.\nYour application (${data.appId}) has been returned to the administrator for review.\n\nPlease constantly check your email for further information regarding your membership status and progress.\n\nRegards,\nLiberian Students Union in Odisha`
    );
  }
  
  return { success: true, message: "Document replaced successfully." };
}


 EMAIL REPLY VERIFICATION (SERVER-SIDE 24-HOUR EXPIRATION)
 
function processVerificationReplies(payload) {
  if (payload && payload.sessionToken) {
    requireAdministratorSession(payload.sessionToken);
  }
  
  const threads = GmailApp.search('is:unread subject:"Re: LSU Membership Application - Verification Required"');
  let processedCount = 0;
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
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
          
          // Server-side 24-hour expiration check
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


 FRONTEND USER OTP & SUBMISSION

function sendOTP(email) {
  email = extractEmail(email);
  if (!validateEmail(email)) throw new Error("Invalid email.");
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.OTP_SHEET_NAME);
  const otp = CONFIG.OTP_PREFIX + Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  sheet.appendRow([new Date(), email, otp, new Date(Date.now() + CONFIG.OTP_EXPIRY_MINUTES * 60000), "No", 0]);
  sendSecureEmail(email, "LSU Email Verification", `Your verification code is: ${otp}`);
  return { success: true };
}

function verifyOTP(email, enteredOTP) {
  email = extractEmail(email);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.OTP_SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (extractEmail(values[i][1]) === email) {
      if (String(values[i][2]).toUpperCase() === String(enteredOTP).toUpperCase()) {
        sheet.getRange(i + 1, 5).setValue("Yes");
        return { success: true };
      }
      return { success: false, message: "Invalid code." };
    }
  }
  return { success: false, message: "Code not found." };
}

function submitApplication(payload) {
  const data = payload.data || {};
  const isStudent = String(data["Membership Type"] || "").toUpperCase().includes("STUDENT");
  
  // Validate documents on server-side
  let totalBytes = 0;
  
  // 1. Identification Photo (JPG/JPEG, max 5 MB)
  const idPhotoObj = payload.identificationPhoto || payload.passportPhoto;
  if (!idPhotoObj) throw new Error("Identification Photo is required.");
  const idPhotoValid = validateFileObject(idPhotoObj, "Identification Photo", "IMAGE");
  totalBytes += idPhotoValid.sizeBytes;
  
  // 2. Passport Document (PDF, max 5 MB)
  const passDocObj = payload.passportDocument || payload.passportFile;
  if (!passDocObj) throw new Error("Passport Document is required.");
  const passDocValid = validateFileObject(passDocObj, "Passport Document", "PDF");
  totalBytes += passDocValid.sizeBytes;
  
  // 3. EFRO File (PDF, max 5 MB, required for current students)
  let efroDocValid = null;
  const efroDocObj = payload.efroFile || payload.efro;
  if (isStudent) {
    if (!efroDocObj) throw new Error("EFRO Document is required for Current Students.");
    efroDocValid = validateFileObject(efroDocObj, "EFRO File", "PDF");
    totalBytes += efroDocValid.sizeBytes;
  }
  
  // 4. Validate total upload set <= 15 MB
  if (totalBytes > CONFIG.MAX_TOTAL_UPLOAD_BYTES) {
    throw new Error("Total document upload size exceeds the maximum limit of 15 MB.");
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  
  const uniqueId = "APP-" + new Date().getFullYear() + "-" + Utilities.getUuid().split("-")[0].toUpperCase();
  const root = DriveApp.getFolderById(CONFIG.ROOT_DRIVE_FOLDER_ID);
  const yearF = getOrCreateFolder(root, new Date().getFullYear().toString());
  const catF = getOrCreateFolder(yearF, isStudent ? "Current Students" : "Alumni");
  const appF = getOrCreateFolder(catF, uniqueId);
  
  const efroUrl = isStudent && efroDocObj ? saveFileToDrive(efroDocObj, appF) : "";
  const passDocUrl = saveFileToDrive(passDocObj, appF);
  const idPhotoUrl = saveFileToDrive(idPhotoObj, appF);
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = new Array(headers.length).fill("");
  
  const setVal = (headerNames, value) => {
    const names = Array.isArray(headerNames) ? headerNames : [headerNames];
    const idx = findColumnIndex(headers, ...names);
    if (idx !== -1) {
      row[idx] = value;
    }
  };

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
  // Keeps exact same column position whether named Identification Photo or Passport Photo
  setVal(["Identification Photo", "Passport Photo"], idPhotoUrl);
  setVal(["Privacy Consent", "Consent"], data["Privacy Consent"] || "");
  
  setVal(["Application ID", "App ID", "ID"], uniqueId);
  setVal(["Application Status", "Status"], "UNDER_REVIEW");
  setVal(["Submission Date", "Submitted Date"], new Date());
  
  // Set email in any matching column ("Email", "Applicant Email", "Untitled Question")
  headers.forEach((h, i) => {
    const hLower = String(h).trim().toLowerCase();
    if (hLower === "applicant email" || hLower === "email" || hLower === "email address" || hLower === "untitled question") {
      row[i] = data["Email"] || "";
    }
  });

  sheet.appendRow(row);

  // Send acknowledgment email to applicant
  const applicantEmail = extractEmail(data["Email"]);
  if (applicantEmail) {
    try {
      const applicantName = ((data["First Name"] || "") + " " + (data["Last Name"] || "")).trim() || "Applicant";
      sendSecureEmail(
        applicantEmail,
        "LSU Membership Application Received - " + uniqueId,
        `Dear ${applicantName},\n\nYour membership application has been received successfully and is currently under review.\n\nApplication ID: ${uniqueId}\nMembership Type: ${data["Membership Type"] || ""}\nStatus: Under Review\n\nPlease constantly check your email for further information regarding your membership status and progress.\n\nRegards,\nLiberian Students Union in Odisha (LSUO)`
      );
    } catch (e) {
      Logger.log("Acknowledgment email error: " + e.toString());
    }
  }

  return { success: true, applicationId: uniqueId };
}


 MAIN WEB APP ENDPOINT

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = String(payload.action || "").trim();

    if (action === "sendOTP") return jsonResponse(sendOTP(payload.email));
    if (action === "verifyOTP") return jsonResponse(verifyOTP(payload.email, payload.otp));
    if (action === "submitApplication") return jsonResponse(submitApplication(payload));
    
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
    
    // Applicant Document Update Actions
    if (action === "getDocumentUpdateInfo") return jsonResponse(getDocumentUpdateInfo(payload.token));
    if (action === "submitDocumentUpdate") return jsonResponse(submitDocumentUpdate(payload));

    return jsonResponse({ success: false, message: "Invalid action." });
  } catch (error) {
    return jsonResponse({ success: false, message: error.message });
  }
}

function doGet() {
  return jsonResponse({ success: true, message: "LSU System Online." });
}
