const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

let assertions = 0;
function ok(value, message) { assertions++; assert.ok(value, message); }
function equal(actual, expected, message) { assertions++; assert.strictEqual(actual, expected, message); }
function throws(fn, pattern, message) { assertions++; assert.throws(fn, pattern, message); }

class Cache {
  constructor(now = Date.now) { this.values = new Map(); this.now = now; }
  get(key) {
    const entry = this.values.get(key);
    if (!entry || entry.expiresAt <= this.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }
  put(key, value, ttl) { this.values.set(key, { value: String(value), expiresAt: this.now() + ttl * 1000 }); }
  remove(key) { this.values.delete(key); }
}

class Sheet {
  constructor(name) { this.name = name; this.rows = []; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return Math.max(0, ...this.rows.map(row => row.length)); }
  getDataRange() { return { getValues: () => this.rows.map(row => row.slice()) }; }
  getRange(row, col, nr = 1, nc = 1) {
    const ensureRows = () => { while (this.rows.length < row + nr - 1) this.rows.push([]); };
    return {
      getValue: () => (this.rows[row - 1] || [])[col - 1] || '',
      getValues: () => Array.from({ length: nr }, (_, ri) => Array.from({ length: nc }, (_, ci) => (this.rows[row + ri - 1] || [])[col + ci - 1] || '')),
      getDisplayValues: () => Array.from({ length: nr }, (_, ri) => Array.from({ length: nc }, (_, ci) => String((this.rows[row + ri - 1] || [])[col + ci - 1] || ''))),
      setValues: values => { ensureRows(); values.forEach((valuesRow, ri) => valuesRow.forEach((value, ci) => { this.rows[row + ri - 1][col + ci - 1] = value; })); },
      setValue: value => { ensureRows(); this.rows[row - 1][col - 1] = value; },
      clearContent: () => { ensureRows(); for (let ri = 0; ri < nr; ri++) for (let ci = 0; ci < nc; ci++) this.rows[row + ri - 1][col + ci - 1] = ''; }
    };
  }
  appendRow(row) { this.rows.push(row.slice()); }
}

class Workbook {
  constructor(id, sheets = []) { this.id = id; this.sheets = new Map(sheets.map(sheet => [sheet.getName(), sheet])); }
  getId() { return this.id; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  getSheets() { return Array.from(this.sheets.values()); }
  insertSheet(name) { const sheet = new Sheet(name); this.sheets.set(name, sheet); return sheet; }
}

class ScriptProperties {
  constructor() { this.values = new Map(); }
  getProperty(key) { return this.values.has(key) ? this.values.get(key) : null; }
  getProperties() { return Object.fromEntries(this.values); }
  setProperty(key, value) { this.values.set(key, String(value)); }
  deleteProperty(key) { this.values.delete(key); }
}

const headers = ['Email', 'Name', 'Role', 'Status', 'Added Date', 'Added By', 'Admin OTP', 'OTP Expiry', 'OTP Verified', 'OTP Attempts'];
const chief = ['solojackson2022@gmail.com', 'Chief', 'CHIEF_ADMINISTRATOR', 'ACTIVE', new Date(), 'SYSTEM', '', '', 'No', 0];

function fixture(rows = [], id = 'test-sheet', initialTime = Date.now()) {
  const admin = new Sheet('Administrators');
  admin.appendRow(headers);
  [chief, ...rows].forEach(row => admin.appendRow(row));
  const workbook = new Workbook(id, [admin]);
  const props = new ScriptProperties();
  props.setProperty('LSU_ADMIN_WORKBOOK_ID', id);
  props.setProperty('CLOUDFLARE_TURNSTILE_SECRET', 'mock-turnstile-secret');
  let currentTime = initialTime;
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [currentTime])); }
    static now() { return currentTime; }
  }
  const cache = new Cache(() => currentTime);
  const sentEmails = [];
  let uuidCounter = 0;
  const makeFolder = () => {
    const folders = new Map();
    const iterator = folder => ({
      hasNext: () => Boolean(folder),
      next: () => folder
    });
    return {
      getFoldersByName: name => iterator(folders.get(name)),
      createFolder: name => {
        const folder = makeFolder();
        folders.set(name, folder);
        return folder;
      },
      createFile: () => ({ getUrl: () => 'https://drive.google.com/file/d/mock-file-id' })
    };
  };
  const rootFolder = makeFolder();
  let turnstileResponseCode = 200;
  let turnstileResponseText = JSON.stringify({ success: true });
  let turnstileFailure = null;
  const turnstileRequests = [];
  const context = {
    Logger: { log() {} }, CacheService: { getScriptCache: () => cache },
    SpreadsheetApp: { getActiveSpreadsheet: () => workbook },
    PropertiesService: { getScriptProperties: () => props },
    UrlFetchApp: { fetch: (url, options) => {
      turnstileRequests.push({ url, options });
      if (turnstileFailure) throw turnstileFailure;
      return {
        getResponseCode: () => turnstileResponseCode,
        getContentText: () => turnstileResponseText
      };
    } },
    DriveApp: {
      getFolderById: () => rootFolder,
      getFoldersByName: () => ({ hasNext: () => false, next: () => null })
    },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: content => ({ content, setMimeType() { return this; } }) },
    Session: { getScriptTimeZone: () => 'UTC' }, Utilities: {
      formatDate: String, getUuid: () => `uuid-test-${++uuidCounter}`,
      base64Decode: value => Buffer.from(value, 'base64'),
      newBlob: (decoded, type, name) => ({ decoded, type, name })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    MailApp: { sendEmail: message => sentEmails.push(message) },
    Date: ClockDate, Math, JSON, String, Number, Object, Array, Error, RegExp
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../Code.gs'), 'utf8'), context, { filename: 'Code.gs' });
  const now = currentTime;
  cache.put('LSU_ADMIN_SESSION_chief-token', JSON.stringify({ email: chief[0], role: 'CHIEF_ADMINISTRATOR', name: 'Chief', issuedAt: now, createdAt: now }), 900);
  return {
    context, admin, workbook, props, cache,
    now: () => currentTime,
    advance: milliseconds => { currentTime += milliseconds; },
    setTurnstileResponse: (code, response) => {
      turnstileResponseCode = code;
      turnstileResponseText = typeof response === 'string' ? response : JSON.stringify(response);
      turnstileFailure = null;
    },
    setTurnstileFailure: error => { turnstileFailure = error; },
    turnstileRequests, sentEmails
  };
}

function setupApproval(props, action, id) {
  props.setProperty('LSU_ADMIN_SETUP_ACTION', action);
  props.setProperty('LSU_ADMIN_SETUP_SPREADSHEET_ID', id);
  props.setProperty('LSU_ADMIN_SETUP_CONFIRMATION', `${action} LSU ADMINISTRATORS FOR ${id}`);
}

// New installation requires explicit owner-supplied identity/approval and a sole blank default tab.
{
  const blank = new Sheet('Sheet1'), workbook = new Workbook('new-id', [blank]), props = new ScriptProperties();
  const context = vm.createContext({ Logger: { log() {} }, SpreadsheetApp: { getActiveSpreadsheet: () => workbook }, PropertiesService: { getScriptProperties: () => props }, Date, Math, JSON, String, Number, Object, Array, Error, RegExp });
  vm.runInContext(fs.readFileSync(require.resolve('../Code.gs'), 'utf8'), context);
  throws(() => context.initializeNewAdministratorInstallation_(), /identity requires manual review/);
  equal(workbook.getSheetByName('Administrators'), null);
  setupApproval(props, 'INITIALIZE', 'new-id');
  equal(context.initializeNewAdministratorInstallation_().success, true);
  const admin = workbook.getSheetByName('Administrators');
  equal(admin.rows[0].join('|'), headers.join('|'));
  equal(admin.rows.filter(row => String(row[0]).toLowerCase() === chief[0]).length, 1);
  throws(() => context.initializeNewAdministratorInstallation_(), /identity requires manual review/);
}

// Existing workbook without an admin tab and an empty existing admin tab both fail closed without edits.
{
  const memberSheet = new Sheet('Members'); memberSheet.appendRow(['existing member data']);
  const workbook = new Workbook('existing-id', [memberSheet]), props = new ScriptProperties();
  props.setProperty('LSU_ADMIN_WORKBOOK_ID', 'existing-id');
  const ctx = vm.createContext({ Logger: { log() {} }, SpreadsheetApp: { getActiveSpreadsheet: () => workbook }, PropertiesService: { getScriptProperties: () => props }, Date, Math, JSON, String, Number, Object, Array, Error, RegExp });
  vm.runInContext(fs.readFileSync(require.resolve('../Code.gs'), 'utf8'), ctx);
  throws(() => ctx.ensureAdministratorSheet(), /manual review/);
  equal(workbook.getSheetByName('Administrators'), null);
  const emptyAdmin = workbook.insertSheet('Administrators');
  setupApproval(props, 'BIND', 'existing-id');
  throws(() => ctx.bindExistingAdministratorWorkbook_(), /manual review/);
  equal(emptyAdmin.getLastRow(), 0);
  equal(props.getProperty('LSU_ADMIN_WORKBOOK_ID'), 'existing-id');
}

// Duplicate Chief, duplicate normalized email, and unauthorized Chief-role rows are rejected unchanged.
for (const rows of [
  [chief.slice()],
  [['CHIEF@EXAMPLE.COM', 'One', 'MEMBERSHIP_CO_ADMINISTRATOR', 'ACTIVE'], [' chief@example.com ', 'Two', 'FINANCIAL_CO_ADMINISTRATOR', 'ACTIVE']],
  [['other@example.com', 'Intruder', 'CHIEF_ADMINISTRATOR', 'ACTIVE']]
]) {
  const f = fixture(rows.map(row => [...row, new Date(), 'SYSTEM', '', '', 'No', 0]));
  setupApproval(f.props, 'BIND', 'test-sheet');
  const before = JSON.stringify(f.admin.rows);
  throws(() => f.context.bindExistingAdministratorWorkbook_(), /manual review/);
  equal(JSON.stringify(f.admin.rows), before);
  equal(f.props.getProperty('LSU_ADMIN_WORKBOOK_ID'), 'test-sheet');
}

// Four active legacy accounts can be assigned across roles without the legacy rows blocking capacity.
{
  const legacy = Array.from({ length: 4 }, (_, i) => [`legacy${i + 1}@example.com`, `Legacy ${i + 1}`, 'CO_ADMINISTRATOR', 'ACTIVE', new Date(), 'SYSTEM', '', '', 'No', 0]);
  const f = fixture(legacy);
  const migrate = (email, role) => f.context.changeAdministratorRole('chief-token', email, role);
  equal(migrate(legacy[0][0], 'MEMBERSHIP_CO_ADMINISTRATOR').success, true);
  equal(migrate(legacy[1][0], 'MEMBERSHIP_CO_ADMINISTRATOR').success, true);
  equal(migrate(legacy[2][0], 'FINANCIAL_CO_ADMINISTRATOR').success, true);
  const fourthBefore = f.admin.rows.find(row => row[0] === legacy[3][0]).slice();
  throws(() => migrate(legacy[3][0], 'MEMBERSHIP_CO_ADMINISTRATOR'), /two active accounts/);
  equal(JSON.stringify(f.admin.rows.find(row => row[0] === legacy[3][0])), JSON.stringify(fourthBefore));
  equal(migrate(legacy[3][0], 'FINANCIAL_CO_ADMINISTRATOR').success, true);
  const audit = f.workbook.getSheetByName('AdministratorAudit');
  const successful = audit.rows.filter(row => row[3] === 'legacy_coadministrator_migration' && row[5] === 'SUCCESS');
  const failed = audit.rows.filter(row => row[3] === 'legacy_coadministrator_migration' && row[5] === 'FAILED');
  equal(successful.length, 4);
  equal(failed.length, 1);
  equal(failed[0][4], legacy[3][0]);
  equal(f.admin.rows.filter(row => row[2] === 'MEMBERSHIP_CO_ADMINISTRATOR' && row[3] === 'ACTIVE').length, 2);
  equal(f.admin.rows.filter(row => row[2] === 'FINANCIAL_CO_ADMINISTRATOR' && row[3] === 'ACTIVE').length, 2);
}

// Only Chief can migrate; valid role permissions remain separated and role changes revoke old sessions.
{
  const member = ['member@example.com', 'Member', 'MEMBERSHIP_CO_ADMINISTRATOR', 'ACTIVE', new Date(), 'SYSTEM', '', '', 'No', 0];
  const f = fixture([member]);
  const now = Date.now();
  f.cache.put('LSU_ADMIN_SESSION_member-token', JSON.stringify({ email: member[0], role: member[2], name: member[1], issuedAt: now, createdAt: now }), 900);
  equal(f.context.requireAdministratorPermission_('member-token', 'membership').role, member[2]);
  throws(() => f.context.requireAdministratorPermission_('member-token', 'finance'), /Authorization denied/);
  throws(() => f.context.changeAdministratorRole('member-token', member[0], 'FINANCIAL_CO_ADMINISTRATOR'), /Authorization denied/);
  equal(f.context.changeAdministratorRole('chief-token', member[0], 'FINANCIAL_CO_ADMINISTRATOR').success, true);
  throws(() => f.context.requireAdministratorPermission_('member-token', 'finance'), /Authorization denied/);
  equal(f.admin.rows.find(row => row[0] === member[0])[2], 'FINANCIAL_CO_ADMINISTRATOR');
}

// Each administrator role is restricted to its own permissions; inactive accounts are rejected.
{
  const member = ['member@example.com', 'Member', 'MEMBERSHIP_CO_ADMINISTRATOR', 'ACTIVE', new Date(), 'SYSTEM', '', '', 'No', 0];
  const finance = ['finance@example.com', 'Finance', 'FINANCIAL_CO_ADMINISTRATOR', 'ACTIVE', new Date(), 'SYSTEM', '', '', 'No', 0];
  const f = fixture([member, finance]);
  const now = f.now();
  f.cache.put('LSU_ADMIN_SESSION_member-token', JSON.stringify({ email: member[0], role: member[2], issuedAt: now, createdAt: now }), 900);
  f.cache.put('LSU_ADMIN_SESSION_finance-token', JSON.stringify({ email: finance[0], role: finance[2], issuedAt: now, createdAt: now }), 900);
  f.cache.put('LSU_PAYMENT_ADMIN_SESSION_member-token', JSON.stringify({ email: member[0], role: member[2], issuedAt: now, createdAt: now }), 900);
  f.cache.put('LSU_PAYMENT_ADMIN_SESSION_finance-token', JSON.stringify({ email: finance[0], role: finance[2], issuedAt: now, createdAt: now }), 900);
  equal(f.context.requireAdministratorPermission_('chief-token', 'membership').role, 'CHIEF_ADMINISTRATOR');
  equal(f.context.requireAdministratorPermission_('chief-token', 'finance').role, 'CHIEF_ADMINISTRATOR');
  equal(f.context.requireAdministratorPermission_('chief-token', 'manage_admins').role, 'CHIEF_ADMINISTRATOR');
  equal(f.context.requireAdministratorPermission_('chief-token', 'audit').role, 'CHIEF_ADMINISTRATOR');
  equal(f.context.requireAdministratorPermission_('member-token', 'membership').role, member[2]);
  throws(() => f.context.lsuRequirePaymentAdmin_('member-token'), /Authorization denied/);
  equal(f.context.requireAdministratorPermission_('finance-token', 'finance').role, finance[2]);
  equal(f.context.lsuRequirePaymentAdmin_('finance-token').role, finance[2]);
  throws(() => f.context.requireAdministratorPermission_('member-token', 'manage_admins'), /Authorization denied/);
  throws(() => f.context.requireAdministratorPermission_('finance-token', 'membership'), /Authorization denied/);
  throws(() => f.context.requireAdministratorPermission_('finance-token', 'audit'), /Authorization denied/);
  f.admin.rows[3][3] = 'DEACTIVATED';
  equal(f.context.checkAdministratorAccess(finance[0]).authorized, false);
  throws(() => f.context.requireAdministratorPermission_('finance-token', 'finance'), /Authorization denied/);
  const audit = f.context.getAdministratorAuditLog('chief-token');
  ok(audit.records.some(record => record.action === 'authorization_denied' && record.outcome === 'DENIED'));
}

// Chief-only account management enforces role capacity, deactivation, reactivation, and session revocation.
{
  const f = fixture();
  const add = (email, role = 'FINANCIAL_CO_ADMINISTRATOR') =>
    f.context.addAdministrator('chief-token', email, email.split('@')[0], role);
  equal(add('finance-one@example.com').success, true);
  equal(add('finance-two@example.com').success, true);
  throws(() => add('finance-three@example.com'), /active account limit/);
  throws(() => f.context.addAdministrator('missing-token', 'member@example.com', 'Member', 'MEMBERSHIP_CO_ADMINISTRATOR'), /Authorization denied/);
  throws(() => f.context.deactivateAdministrator('chief-token', chief[0]), /Chief Administrator/);

  const accountToken = 'finance-one-token';
  const now = f.now();
  f.cache.put('LSU_ADMIN_SESSION_' + accountToken, JSON.stringify({
    email: 'finance-one@example.com', role: 'FINANCIAL_CO_ADMINISTRATOR', issuedAt: now, createdAt: now
  }), 900);
  equal(f.context.requireAdministratorPermission_(accountToken, 'finance').role, 'FINANCIAL_CO_ADMINISTRATOR');
  equal(f.context.deactivateAdministrator('chief-token', 'finance-one@example.com').success, true);
  throws(() => f.context.requireAdministratorPermission_(accountToken, 'finance'), /Authorization denied/);
  equal(f.context.reactivateAdministrator('chief-token', 'finance-one@example.com').success, true);
  throws(() => f.context.reactivateAdministrator('chief-token', 'finance-two@example.com'), /active account limit/);
  throws(() => f.context.requireAdministratorPermission_(accountToken, 'finance'), /Authorization denied/);

  const audit = f.context.getAdministratorAuditLog('chief-token');
  ok(audit.records.some(record => record.action === 'administrator_created' && record.outcome === 'SUCCESS'));
  ok(audit.records.some(record => record.action === 'administrator_deactivated' && record.outcome === 'SUCCESS'));
  ok(audit.records.some(record => record.action === 'administrator_activated' && record.outcome === 'SUCCESS'));
}

// Cache idle expiry and the independent absolute session limit both deny access.
{
  const member = ['member@example.com', 'Member', 'MEMBERSHIP_CO_ADMINISTRATOR', 'ACTIVE', new Date(), 'SYSTEM', '', '', 'No', 0];
  const f = fixture([member]);
  const now = f.now();
  f.cache.put('LSU_ADMIN_SESSION_idle-token', JSON.stringify({ email: member[0], role: member[2], issuedAt: now, createdAt: now }), 900);
  f.advance(15 * 60 * 1000 + 1);
  throws(() => f.context.requireAdministratorPermission_('idle-token', 'membership'), /Authorization denied/);

  const absoluteStart = f.now();
  f.cache.put('LSU_ADMIN_SESSION_absolute-token', JSON.stringify({
    email: member[0], role: member[2], issuedAt: absoluteStart, createdAt: absoluteStart
  }), 9 * 60 * 60);
  f.advance(8 * 60 * 60 * 1000);
  throws(() => f.context.requireAdministratorPermission_('absolute-token', 'membership'), /Authorization denied/);
}

// Administrator OTP is issued only to an active registered account and creates a role-bound session once verified.
{
  const member = ['member@example.com', 'Member', 'MEMBERSHIP_CO_ADMINISTRATOR', 'ACTIVE', new Date(), 'SYSTEM', '', '', 'No', 0];
  const f = fixture([member]);
  const sent = f.context.sendAdministratorOTP(member[0]);
  equal(sent.success, true);
  const email = f.sentEmails.find(message => message.to === member[0]);
  ok(Boolean(email));
  const otp = email.body.match(/ADM\d{3}LSU/)[0];
  const verified = f.context.verifyAdministratorOTP(member[0], otp);
  equal(verified.success, true);
  equal(verified.role, member[2]);
  equal(f.context.requireAdministratorPermission_(verified.sessionToken, 'membership').role, member[2]);
  equal(f.context.verifyAdministratorOTP(member[0], otp).success, false);
  equal(f.context.sendAdministratorOTP('not-admin@example.com').success, false);
}

// HTTP action errors remain sanitized; malformed JSON does not expose parser details.
{
  const f = fixture();
  const denied = JSON.parse(f.context.doPost({
    postData: { contents: JSON.stringify({ action: 'getAdministratorAuditLog', sessionToken: 'invalid' }) }
  }).content);
  equal(denied.success, false);
  equal(denied.message, 'Authorization denied.');

  const malformed = JSON.parse(f.context.doPost({ postData: { contents: '{' } }).content);
  equal(malformed.success, false);
  equal(malformed.message, 'Request could not be completed. Please check the submitted information or try again later.');
}

// Protected registration fails closed for every Turnstile failure and completes OTP verification on success.
{
  const f = fixture();
  const request = turnstileToken => JSON.parse(f.context.doPost({
    postData: { contents: JSON.stringify({ action: 'sendOTP', email: 'applicant@example.com', turnstileToken }) }
  }).content);

  f.props.deleteProperty('CLOUDFLARE_TURNSTILE_SECRET');
  equal(request('mock-token').message, 'Registration verification is temporarily unavailable. Please try again later.');
  equal(f.turnstileRequests.length, 0);

  f.props.setProperty('CLOUDFLARE_TURNSTILE_SECRET', 'mock-turnstile-secret');
  equal(request('').message, 'CAPTCHA verification is required. Please complete the CAPTCHA.');
  f.setTurnstileResponse(200, { success: false });
  equal(request('invalid-token').message, 'CAPTCHA verification failed or has expired. Please refresh the page and try again.');
  f.setTurnstileResponse(503, '');
  equal(request('mock-token').message, 'Unable to verify CAPTCHA with Cloudflare. Please try again.');
  f.setTurnstileFailure(new Error('simulated provider transport error'));
  const providerFailure = request('mock-token');
  equal(providerFailure.message, 'Unable to verify CAPTCHA with Cloudflare. Please try again.');
  ok(!JSON.stringify(providerFailure).includes('mock-turnstile-secret'));

  f.setTurnstileResponse(200, { success: true });
  const sent = request('valid-mock-token');
  equal(sent.success, true);
  const otpSheet = f.workbook.getSheetByName('OTP');
  const storedOtp = otpSheet.getDataRange().getValues()[1][2];
  const verified = JSON.parse(f.context.doPost({
    postData: { contents: JSON.stringify({ action: 'verifyOTP', email: 'applicant@example.com', otp: storedOtp }) }
  }).content);
  equal(verified.success, true);
  equal(verified.email, 'applicant@example.com');
  ok(Boolean(f.props.getProperty('VERIF_TOKEN_' + verified.verificationToken)));
  const application = JSON.parse(f.context.doPost({
    postData: { contents: JSON.stringify({
      action: 'submitApplication',
      verificationToken: verified.verificationToken,
      data: {
        'Email': 'applicant@example.com',
        'Membership Type': 'CURRENT STUDENT',
        'First Name': 'Test',
        'Last Name': 'Applicant',
        'Privacy Consent': 'Yes'
      },
      identificationPhoto: { name: 'photo.jpg', type: 'image/jpeg', content: Buffer.from('mock image').toString('base64') },
      passportDocument: { name: 'passport.pdf', type: 'application/pdf', content: Buffer.from('mock pdf').toString('base64') },
      efroFile: { name: 'efro.pdf', type: 'application/pdf', content: Buffer.from('mock efro').toString('base64') }
    }) }
  }).content);
  equal(application.success, true);
  const membersSheet = f.workbook.getSheetByName('Members');
  const membersHeaders = membersSheet.rows[0];
  const applicationRow = membersSheet.rows[1];
  equal(applicationRow[membersHeaders.indexOf('Application Status')], 'UNDER_REVIEW');
  equal(applicationRow[membersHeaders.indexOf('Email')], 'applicant@example.com');
  ok(Boolean(applicationRow[membersHeaders.indexOf('EFRO File')]));
  equal(f.props.getProperty('VERIF_TOKEN_' + verified.verificationToken), null);
  equal(f.turnstileRequests.length, 4);
}

// Membership review sends document requests for both membership categories; uploads use mocked Drive and update the application.
{
  const member = ['member@example.com', 'Member', 'MEMBERSHIP_CO_ADMINISTRATOR', 'ACTIVE', new Date(), 'SYSTEM', '', '', 'No', 0];
  const f = fixture([member]);
  const now = f.now();
  f.cache.put('LSU_ADMIN_SESSION_membership-token', JSON.stringify({
    email: member[0], role: member[2], issuedAt: now, createdAt: now
  }), 900);
  const sheet = f.context.ensureMembersSheet();
  const addApplication = (id, membershipType) => {
    const row = Array(37).fill('');
    const set = (name, value) => { row[sheet.rows[0].indexOf(name)] = value; };
    set('Email', `${id.toLowerCase()}@example.com`);
    set('Membership Type', membershipType);
    set('First Name', id);
    set('Last Name', 'Applicant');
    set('Application ID', id);
    set('Application Status', 'UNDER_REVIEW');
    sheet.appendRow(row);
    return row;
  };
  const student = addApplication('APP-STUDENT', 'CURRENT STUDENT');
  const alumni = addApplication('APP-ALUMNI', 'ALUMNI');

  for (const id of ['APP-STUDENT', 'APP-ALUMNI']) {
    const response = JSON.parse(f.context.doPost({
      postData: { contents: JSON.stringify({
        action: 'updateApplicationStatus', sessionToken: 'membership-token',
        applicationId: id, newStatus: 'NEEDS_CLARIFICATION',
        updateDocType: 'Passport Document', rejectionReason: 'Please upload a clearer copy.'
      }) }
    }).content);
    equal(response.success, true);
  }
  equal(sheet.rows[1][sheet.rows[0].indexOf('Application Status')], 'NEEDS_CLARIFICATION');
  equal(sheet.rows[2][sheet.rows[0].indexOf('Application Status')], 'NEEDS_CLARIFICATION');
  equal(f.sentEmails.filter(message => message.subject.includes('Document Update Required')).length, 2);

  const uploadToken = 'mock-document-upload-token';
  f.props.setProperty('DOC_UPDATE_' + uploadToken, JSON.stringify({
    appId: 'APP-STUDENT',
    email: 'app-student@example.com',
    docType: 'Passport Document',
    expiresAt: new Date(f.now() + 60 * 60 * 1000).toISOString()
  }));
  const uploaded = JSON.parse(f.context.doPost({
    postData: { contents: JSON.stringify({
      action: 'submitDocumentUpdate',
      token: uploadToken,
      file: { name: 'passport.pdf', type: 'application/pdf', content: Buffer.from('mock pdf').toString('base64') }
    }) }
  }).content);
  equal(uploaded.success, true);
  equal(sheet.rows[1][sheet.rows[0].indexOf('Application Status')], 'UNDER_REVIEW');
  ok(String(sheet.rows[1][sheet.rows[0].indexOf('Passport Document')]).startsWith('https://drive.google.com/'));
  equal(f.props.getProperty('DOC_UPDATE_' + uploadToken), null);
}

// Financial admin approval/rejection updates payment and allocation rows, logs actions, and blocks duplicate approval.
{
  const finance = ['finance@example.com', 'Finance', 'FINANCIAL_CO_ADMINISTRATOR', 'ACTIVE', new Date(), 'SYSTEM', '', '', 'No', 0];
  const f = fixture([finance]);
  const now = f.now();
  f.cache.put('LSU_PAYMENT_ADMIN_SESSION_finance-token', JSON.stringify({
    email: finance[0], role: finance[2], issuedAt: now, createdAt: now
  }), 900);
  f.context.ensurePaymentSheets();
  const payments = f.workbook.getSheetByName('Payments');
  const allocations = f.workbook.getSheetByName('PaymentAllocations');
  const addPayment = (paymentId, email) => {
    payments.appendRow([paymentId, 'Test Payer', email, 'ONLINE / UPI', 100, '2026-04-01', 'UPI-TEST', '', '', 'PENDING VERIFICATION', new Date(), '', '', '', '']);
    allocations.appendRow([paymentId, email, 'Test Member', 'LSU-TEST', 100, 'PENDING VERIFICATION']);
  };
  addPayment('PAY-TEST-1', 'payer-one@example.com');
  const approved = JSON.parse(f.context.doPost({
    postData: { contents: JSON.stringify({ action: 'approveDuePayment', sessionToken: 'finance-token', paymentId: 'PAY-TEST-1' }) }
  }).content);
  equal(approved.success, true);
  equal(payments.rows[1][9], 'PAID / VERIFIED');
  equal(allocations.rows[1][5], 'PAID / VERIFIED');
  throws(() => f.context.approveDuePayment({ sessionToken: 'finance-token', paymentId: 'PAY-TEST-1' }), /already been processed/);

  addPayment('PAY-TEST-2', 'payer-two@example.com');
  const rejected = JSON.parse(f.context.doPost({
    postData: { contents: JSON.stringify({
      action: 'rejectDuePayment', sessionToken: 'finance-token',
      paymentId: 'PAY-TEST-2', rejectionReason: 'Unable to verify the payment reference.'
    }) }
  }).content);
  equal(rejected.success, true);
  equal(payments.rows[2][9], 'REJECTED');
  equal(payments.rows[2][14], 'Unable to verify the payment reference.');
  equal(allocations.rows[2][5], 'REJECTED');
  ok(f.sentEmails.some(message => message.subject.includes('Payment Receipt')));
  ok(f.sentEmails.some(message => message.subject.includes('Payment Rejected')));
  const audit = f.context.getAdministratorAuditLog('chief-token');
  ok(audit.records.some(record => record.action === 'financial_payment_approved' && record.outcome === 'SUCCESS'));
  ok(audit.records.some(record => record.action === 'financial_payment_rejected' && record.outcome === 'SUCCESS'));
}

// Financial reports include only verified collected amounts and do not infer contribution totals.
{
  const finance = ['finance@example.com', 'Finance', 'FINANCIAL_CO_ADMINISTRATOR', 'ACTIVE', new Date(), 'SYSTEM', '', '', 'No', 0];
  const f = fixture([finance]);
  const now = f.now();
  f.cache.put('LSU_PAYMENT_ADMIN_SESSION_finance-token', JSON.stringify({
    email: finance[0], role: finance[2], issuedAt: now, createdAt: now
  }), 900);
  f.context.ensurePaymentSheets();
  const payments = f.workbook.getSheetByName('Payments');
  const allocations = f.workbook.getSheetByName('PaymentAllocations');
  payments.appendRow(['PAY-VERIFIED', 'Payer', 'payer@example.com', 'CASH', 250, '2026-04-01', '', 'Treasurer', 'Officer', 'PAID / VERIFIED', new Date(), new Date(), finance[0], 'RCPT-1', '']);
  payments.appendRow(['PAY-PENDING', 'Payer', 'payer@example.com', 'ONLINE / UPI', 100, '2026-04-02', 'UPI-2', '', '', 'PENDING VERIFICATION', new Date(), '', '', '', '']);
  allocations.appendRow(['PAY-VERIFIED', 'payer@example.com', 'Payer', 'LSU-1', 200, 'PAID / VERIFIED']);
  allocations.appendRow(['PAY-VERIFIED', 'member@example.com', 'Member', 'LSU-2', 50, 'PAID / VERIFIED']);

  const result = f.context.getFinancialReport('finance-token');
  equal(result.report.totalMoneyCollected, 250);
  equal(result.report.totalDuesCollected, 250);
  equal(result.report.totalPendingAmount, 100);
  equal(result.report.verifiedCount, 1);
  equal(result.report.contributionsTracked, false);
  equal(result.report.totalContributionsCollected, 0);
}

console.log(`Phase 2 migration tests: ${assertions} assertions passed.`);
