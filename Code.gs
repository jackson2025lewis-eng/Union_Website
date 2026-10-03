/*******************************************************
 * LSU MEMBERSHIP DATABASE - GOOGLE APPS SCRIPT
 * Complete Working Backend for LSUO Membership & Administrator Portal
 *******************************************************/

const CONFIG = {
  SHEET_NAME: "Members",
  OTP_SHEET_NAME: "OTP",
  ROOT_DRIVE_FOLDER_ID: "1wIX_Hnr3T3lX1xpYzDm9G3kBlDm8FRk3",
  OTP_PREFIX: "LSU",
  OTP_LENGTH: 4,
  OTP_EXPIRY_MINUTES: 5,
  MAX_ATTEMPTS: 3,
  VERIFICATION_HOURS: 48,
  FRONTEND_UPDATE_URL: "https://lsu-odisha.vercel.app/update-portal/index.html"
};

const CHIEF_ADMIN_EMAIL = "solojackson2022@gmail.com";
const ADMIN_SHEET_NAME = "Administrators";
const ADMIN_SESSION_TTL_SECONDS = 900;
const ADMIN_SESSION_PREFIX = "LSU_ADMIN_SESSION_";

/*******************************************************
 * HELPERS
 *******************************************************/
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

/*******************************************************
 * ADMINISTRATOR HIERARCHY
 *******************************************************/
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

/*******************************************************
 * DASHBOARD STATISTICS
 *******************************************************/
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
  const docType = String(payload.updateDocType || "").trim();
  
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
    
    // Generate secure token and store in Script Properties
    const token = Utilities.getUuid();
    PropertiesService.getScriptProperties().setProperty('DOC_UPDATE_' + token, JSON.stringify({
      appId: appId, email: applicantEmail, docType: docType, reason: reason
    }));
    
    const updateLink = `${CONFIG.FRONTEND_UPDATE_URL}?token=${token}`;
    
    if (applicantEmail) {
      sendSecureEmail(
        applicantEmail,
        "LSU Membership Application - Document Update Required",
        `Dear ${applicantName},\n\nYour LSU membership application (${appId}) has been reviewed.\n\nWe need you to update the following document before your application can be processed:\n\nDocument Required: ${docType}\nReason / Instructions: ${reason}\n\nPlease click the secure link below to upload your replacement document:\n${updateLink}\n\nYour application will remain under review until the requested document is received. Please constantly check your email for further information regarding your membership status and progress.\n\nRegards,\nLiberian Students Union in Odisha`
      );
    } else {
      throw new Error("Unable to locate a valid email address for application " + appId + ". Please check the spreadsheet row.");
    }
  }
  else if (newStatus === "VERIFICATION_PENDING") {
    const code = "LSU26-" + Math.floor(100000 + Math.random() * 900000);
    if (colVCode !== -1) sheet.getRange(targetRow, colVCode + 1).setValue(code);
    if (colVSent !== -1) sheet.getRange(targetRow, colVSent + 1).setValue(new Date());
    
    if (applicantEmail) {
      sendSecureEmail(
        applicantEmail,
        "LSU Membership Application - Verification Required",
        `Dear ${applicantName},\n\nYour LSU membership application (${appId}) has been pre-approved!\n\nTo complete your membership registration, please reply directly to this email with the following verification code within 48 hours:\n\n${code}\n\nOnce received, your official LSU Membership ID will be issued.\n\nRegards,\nLiberian Students Union in Odisha`
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

/*******************************************************
 * DOCUMENT UPDATE PORTAL LOGIC
 *******************************************************/
function getDocumentUpdateInfo(token) {
  token = String(token || "").trim();
  const dataStr = PropertiesService.getScriptProperties().getProperty('DOC_UPDATE_' + token);
  if (!dataStr) throw new Error("This document update link is invalid or has expired. Please contact the LSU.");
  const data = JSON.parse(dataStr);
  
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
  
  return { success: true, appId: data.appId, docType: data.docType, reason: data.reason };
}

function submitDocumentUpdate(payload) {
  const token = String(payload.token || "").trim();
  const dataStr = PropertiesService.getScriptProperties().getProperty('DOC_UPDATE_' + token);
  if (!dataStr) throw new Error("Invalid or expired update token.");
  const data = JSON.parse(dataStr);
  
  if (!payload.file || !payload.file.content) throw new Error("No file provided.");
  
  // Validate file type
  const fileType = String(payload.file.type).toLowerCase();
  if (data.docType === "Passport Photo") {
    if (!fileType.includes("image/jpeg") && !fileType.includes("image/jpg")) throw new Error("Passport Photo must be JPG/JPEG.");
  } else {
    if (!fileType.includes("application/pdf")) throw new Error("Document must be a PDF.");
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(h => String(h || "").trim());
  
  const idxAppId = findColumnIndex(headers, "Application ID", "Application Id", "ApplicationID", "App ID", "ID");
  const idxStatus = findColumnIndex(headers, "Application Status", "Status");
  const idxDoc = findColumnIndex(headers, data.docType);
  
  if (idxDoc === -1) throw new Error("Document column '" + data.docType + "' not found in database.");
  
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
  
  // Cleanup Token
  PropertiesService.getScriptProperties().deleteProperty('DOC_UPDATE_' + token);
  
  // Notify Applicant
  const applicantEmail = extractEmail(data.email) || findEmailInRow(targetRowData, headers);
  if (applicantEmail) {
    sendSecureEmail(
      applicantEmail,
      "LSU Membership - Document Received",
      `Dear Applicant,\n\nYour updated document (${data.docType}) has been successfully received.\nYour application (${data.appId}) has been returned to the administrator for review.\n\nPlease constantly check your email for further information regarding your membership status and progress.\n\nRegards,\nLiberian Students Union in Odisha`
    );
  }
  
  return { success: true, message: "Document replaced successfully." };
}

/*******************************************************
 * EMAIL REPLY VERIFICATION
 *******************************************************/
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
          
          const hoursDiff = (now - sentDate) / (1000 * 60 * 60);
          if (hoursDiff > CONFIG.VERIFICATION_HOURS) {
            if (idxStatus !== -1) sheet.getRange(i + 1, idxStatus + 1).setValue("REJECTED");
            if (idxReason !== -1) sheet.getRange(i + 1, idxReason + 1).setValue("Verification code expired (48 hours).");
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
 * FRONTEND USER OTP & SUBMISSION
 *******************************************************/
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
  const data = payload.data;
  const isStudent = String(data["Membership Type"] || "").toUpperCase().includes("STUDENT");
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  
  const uniqueId = "APP-" + new Date().getFullYear() + "-" + Utilities.getUuid().split("-")[0].toUpperCase();
  const root = DriveApp.getFolderById(CONFIG.ROOT_DRIVE_FOLDER_ID);
  const yearF = getOrCreateFolder(root, new Date().getFullYear().toString());
  const catF = getOrCreateFolder(yearF, isStudent ? "Current Students" : "Alumni");
  const appF = getOrCreateFolder(catF, uniqueId);
  
  const efroUrl = isStudent && payload.efroFile ? saveFileToDrive(payload.efroFile, appF) : "";
  const passDocUrl = saveFileToDrive(payload.passportFile, appF);
  const passPhotoUrl = saveFileToDrive(payload.passportPhoto, appF);
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = new Array(headers.length).fill("");
  
  const setVal = (headerName, value) => {
    let idx = headers.findIndex(h => String(h).trim().toLowerCase() === headerName.toLowerCase());
    if (idx !== -1) {
      row[idx] = value;
    }
  };

  setVal("Membership Type", data["Membership Type"] || (isStudent ? "CURRENT STUDENT" : "ALUMNI"));
  setVal("First Name", data["First Name"] || "");
  setVal("Middle Name", data["Middle Name"] || "");
  setVal("Last Name", data["Last Name"] || "");
  setVal("Gender", data["Gender"] || "");
  setVal("Position / Role", data["Position / Role"] || "");
  setVal("WhatsApp Number", data["WhatsApp Number"] || "");
  setVal("Date of Birth", data["Date of Birth"] || "");
  setVal("Mobile Number", data["Mobile Number"] || "");
  setVal("Passport Number", data["Passport Number"] || "");
  setVal("College Registration Number", data["College Registration Number"] || "");
  setVal("University", data["University"] || "");
  setVal("Degree Type", data["Degree Type"] || "");
  setVal("Study From", data["Study From"] || "");
  setVal("Study To", data["Study To"] || "");
  setVal("Field of Studies", data["Field of Studies"] || "");
  setVal("Mother Name", data["Mother Name"] || "");
  setVal("Father Name", data["Father Name"] || "");
  setVal("Parents Contact", data["Parents Contact"] || "");
  setVal("Graduation Date", data["Graduation Date"] || "");
  
  setVal("EFRO File", efroUrl);
  setVal("Passport Document", passDocUrl);
  setVal("Passport Photo", passPhotoUrl);
  setVal("Privacy Consent", data["Privacy Consent"] || "");
  
  setVal("Application ID", uniqueId);
  setVal("Application Status", "UNDER_REVIEW");
  setVal("Submission Date", new Date());
  
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

/*******************************************************
 * MAIN WEB APP ENDPOINT
 *******************************************************/
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
