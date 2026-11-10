const test = require('node:test');
const { equal, notEqual, deepEqual, throws, ok } = require('node:assert');
const fs = require('fs');
const vm = require('vm');

class Sheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
  }
  getName() { return this.name; }
  appendRow(row) { this.rows.push([...row]); }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((max, r) => Math.max(max, r.length), 0); }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
  getDataRange() {
    return {
      getValues: () => this.rows.map(r => [...r])
    };
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    return {
      getValues: () => {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const rowData = [];
          for (let c = 0; c < numCols; c++) {
            const rowIndex = row - 1 + r;
            const colIndex = col - 1 + c;
            rowData.push(this.rows[rowIndex] ? this.rows[rowIndex][colIndex] : '');
          }
          out.push(rowData);
        }
        return out;
      },
      getDisplayValues: () => {
        return this.getRange(row, col, numRows, numCols).getValues().map(r => r.map(v => v === null || v === undefined ? '' : String(v)));
      },
      setValue: (val) => {
        while (this.rows.length < row) this.rows.push([]);
        while (this.rows[row - 1].length < col) this.rows[row - 1].push('');
        this.rows[row - 1][col - 1] = val;
      },
      setValues: (values) => {
        for (let r = 0; r < values.length; r++) {
          const targetRow = row + r;
          while (this.rows.length < targetRow) this.rows.push([]);
          for (let c = 0; c < values[r].length; c++) {
            const targetCol = col + c;
            while (this.rows[targetRow - 1].length < targetCol) this.rows[targetRow - 1].push('');
            this.rows[targetRow - 1][targetCol - 1] = values[r][c];
          }
        }
      },
      clearContent: () => {
        for (let r = 0; r < numRows; r++) {
          const rowIndex = row - 1 + r;
          if (this.rows[rowIndex]) {
            for (let c = 0; c < numCols; c++) {
              const colIndex = col - 1 + c;
              this.rows[rowIndex][colIndex] = '';
            }
          }
        }
      }
    };
  }
}

class Workbook {
  constructor(id, sheets = []) {
    this.id = id;
    this.sheets = new Map(sheets.map(s => [s.getName(), s]));
  }
  getId() { return this.id; }
  getSheets() { return Array.from(this.sheets.values()); }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) {
    const s = new Sheet(name);
    this.sheets.set(name, s);
    return s;
  }
}

class ScriptProperties {
  constructor() { this.values = new Map(); }
  getProperty(key) { return this.values.has(key) ? this.values.get(key) : null; }
  getProperties() { return Object.fromEntries(this.values); }
  setProperty(key, value) { this.values.set(key, String(value)); }
  deleteProperty(key) { this.values.delete(key); }
}

class Cache {
  constructor() { this.store = new Map(); }
  get(key) { return this.store.get(key) || null; }
  put(key, value) { this.store.set(key, String(value)); }
  remove(key) { this.store.delete(key); }
}

function createTestContext(options = {}) {
  const membersSheet = new Sheet('Members');
  const memberHeaders = [
    'Timestamp', 'Email', 'Membership Type', 'First Name', 'Middle Name',
    'Last Name', 'Gender', 'Date of Birth', 'Position / Role',
    'WhatsApp Number', 'Mobile Number', 'Passport Number',
    'College Registration Number', 'University', 'Degree Type',
    'Study From', 'Study To', 'Field of Studies', 'Mother Name',
    'Father Name', 'Parents Contact', 'Graduation Date', 'EFRO File',
    'Passport Document', 'Identification Photo', 'Privacy Consent',
    'Application ID', 'Application Status', 'Submission Date', 'Review Date',
    'Reviewed By', 'Verification Code', 'Verification Sent Date',
    'Verification Reply Date', 'Membership ID', 'Membership Confirmed Date',
    'Rejection Reason'
  ];
  membersSheet.appendRow(memberHeaders);

  // Add a regular member (Position: "Member")
  const regularMember = new Array(memberHeaders.length).fill('');
  regularMember[1] = 'member@example.com';
  regularMember[3] = 'John'; regularMember[5] = 'Member';
  regularMember[8] = 'Member'; // Position / Role = "Member"
  regularMember[27] = 'MEMBER_CONFIRMED';
  regularMember[34] = 'LSU-2026-001';
  membersSheet.appendRow(regularMember);

  // Add a leader member (Position: "President")
  const leaderMember = new Array(memberHeaders.length).fill('');
  leaderMember[1] = 'leader@example.com';
  leaderMember[3] = 'Alice'; leaderMember[5] = 'President';
  leaderMember[8] = 'President'; // Position / Role = "President" (Leader)
  leaderMember[27] = 'MEMBER_CONFIRMED';
  leaderMember[34] = 'LSU-2026-002';
  membersSheet.appendRow(leaderMember);

  // Add a second regular member
  const memberTwo = new Array(memberHeaders.length).fill('');
  memberTwo[1] = 'member2@example.com';
  memberTwo[3] = 'Bob'; memberTwo[5] = 'Student';
  memberTwo[8] = 'Member';
  memberTwo[27] = 'MEMBER_CONFIRMED';
  memberTwo[34] = 'LSU-2026-003';
  membersSheet.appendRow(memberTwo);

  // Admin sheet
  const adminSheet = new Sheet('Administrators');
  const adminHeaders = ["Email", "Name", "Role", "Status", "Added Date", "Added By", "Admin OTP", "OTP Expiry", "OTP Verified", "OTP Attempts"];
  adminSheet.appendRow(adminHeaders);
  adminSheet.appendRow(['solojackson2022@gmail.com', 'Chief Admin', 'CHIEF_ADMINISTRATOR', 'ACTIVE', new Date(), 'SYSTEM', '', '', 'No', 0]);
  adminSheet.appendRow(['finance@example.com', 'Finance Admin', 'FINANCIAL_CO_ADMINISTRATOR', 'ACTIVE', new Date(), 'solojackson2022@gmail.com', '', '', 'No', 0]);
  adminSheet.appendRow(['membership@example.com', 'Membership Admin', 'MEMBERSHIP_CO_ADMINISTRATOR', 'ACTIVE', new Date(), 'solojackson2022@gmail.com', '', '', 'No', 0]);

  const workbook = new Workbook('test-workbook', [membersSheet, adminSheet]);
  const props = new ScriptProperties();
  props.setProperty('LSU_ADMIN_WORKBOOK_ID', 'test-workbook');
  props.setProperty('LSU_ADMIN_INITIALIZED_WORKBOOK_ID', 'test-workbook');

  const cache = new Cache();
  const sentEmails = [];
  const lockStats = { acquisitions: 0, releases: 0, held: false };

  const ctx = vm.createContext({
    SpreadsheetApp: {
      getActiveSpreadsheet: () => workbook
    },
    PropertiesService: {
      getScriptProperties: () => props
    },
    CacheService: {
      getScriptCache: () => cache
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          if (lockStats.held) throw new Error('Script lock is already held.');
          lockStats.held = true;
          lockStats.acquisitions++;
        },
        releaseLock: () => {
          lockStats.held = false;
          lockStats.releases++;
        }
      })
    },
    MailApp: {
      sendEmail: (opts) => { sentEmails.push(opts); }
    },
    GmailApp: {
      sendEmail: (to, subject, body) => { sentEmails.push({ to, subject, body }); }
    },
    Utilities: {
      getUuid: () => 'uuid-' + Math.random().toString(36).slice(2, 9),
      formatDate: (d, tz, fmt) => d.toISOString(),
      formatString: (fmt, ...args) => {
        let str = fmt;
        args.forEach(a => {
          if (str.includes('%03d')) str = str.replace('%03d', String(a).padStart(3, '0'));
          else if (str.includes('%04d')) str = str.replace('%04d', String(a).padStart(4, '0'));
          else str = str.replace(/%[sd]/, String(a));
        });
        return str;
      }
    },
    Session: {
      getScriptTimeZone: () => 'GMT+05:30'
    },
    Logger: {
      log: () => {}
    },
    ContentService: {
      createTextOutput: (text) => ({
        setMimeType: () => text
      }),
      MimeType: { JSON: 'application/json' }
    },
    Date,
    Math,
    JSON,
    String,
    Number,
    Object,
    Array,
    Error,
    RegExp
  });

  vm.runInContext(fs.readFileSync(require.resolve('../Code.gs'), 'utf8'), ctx);

  // Setup admin sessions in cache
  const createdAt = Date.now();
  cache.put('LSU_PAYMENT_ADMIN_SESSION_chief-token', JSON.stringify({
    email: 'solojackson2022@gmail.com', role: 'CHIEF_ADMINISTRATOR', name: 'Chief Admin', createdAt, issuedAt: createdAt
  }));
  cache.put('LSU_PAYMENT_ADMIN_SESSION_finance-token', JSON.stringify({
    email: 'finance@example.com', role: 'FINANCIAL_CO_ADMINISTRATOR', name: 'Finance Admin', createdAt, issuedAt: createdAt
  }));
  cache.put('LSU_ADMIN_SESSION_membership-token', JSON.stringify({
    email: 'membership@example.com', role: 'MEMBERSHIP_CO_ADMINISTRATOR', name: 'Membership Admin', createdAt, issuedAt: createdAt
  }));

  // Setup member sessions in cache
  cache.put('LSU_DUE_MEMBER_SESSION_member-token', JSON.stringify({
    email: 'member@example.com',
    member: { email: 'member@example.com', name: 'John Member', membershipId: 'LSU-2026-001' }
  }));
  cache.put('LSU_DUE_MEMBER_SESSION_leader-token', JSON.stringify({
    email: 'leader@example.com',
    member: { email: 'leader@example.com', name: 'Alice President', membershipId: 'LSU-2026-002' }
  }));

  return { ctx, workbook, cache, sentEmails, props, lockStats };
}

test('Event Contributions: Membership position classification', () => {
  const { ctx } = createTestContext();
  
  // Member with position "Member" must be classified as MEMBER
  const m1 = ctx.lsuFindMemberByEmail_('member@example.com');
  equal(m1.category, 'MEMBER');
  equal(m1.isLeader, false);
  equal(m1.position, 'Member');

  // Member with position "President" must be classified as LEADER
  const m2 = ctx.lsuFindMemberByEmail_('leader@example.com');
  equal(m2.category, 'LEADER');
  equal(m2.isLeader, true);
  equal(m2.position, 'President');
});

test('Event Contributions: Permissions - Financial Co-Admin and Chief Admin can manage; Membership Co-Admin blocked', () => {
  const { ctx } = createTestContext();

  // Financial Co-Admin can create event
  const res1 = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Gala Dinner 2026',
    description: 'Annual LSU Gala Dinner',
    eventDate: '2026-12-20',
    targetGroup: 'ALL',
    memberAmount: 200,
    leaderAmount: 500
  });
  equal(res1.success, true);
  ok(res1.eventId.startsWith('EVT-'));

  // Chief Admin can update event
  const res2 = ctx.updateEvent({
    sessionToken: 'chief-token',
    eventId: res1.eventId,
    title: 'Gala Dinner 2026 - Updated'
  });
  equal(res2.success, true);

  // Membership Co-Admin is blocked
  throws(() => {
    ctx.createEvent({
      sessionToken: 'membership-token',
      title: 'Unauthorized Event',
      eventDate: '2026-12-25',
      targetGroup: 'ALL',
      memberAmount: 100
    });
  }, /Authorization denied|Unauthorized/);
  throws(() => ctx.getEvents({ sessionToken: 'membership-token' }), /Authorization denied|Unauthorized/);
  throws(() => ctx.getEvents({ memberEmail: 'member@example.com' }), /valid member or financial administrator session/);
});

test('Event Contributions: Target group ALL with differential amounts for Members vs Leaders', () => {
  const { ctx } = createTestContext();

  const createRes = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Independence Day 2026',
    description: 'National celebration',
    eventDate: '2026-07-26',
    targetGroup: 'ALL',
    memberAmount: 300,
    leaderAmount: 1000
  });
  equal(createRes.success, true);
  const eventId = createRes.eventId;

  // Regular member sees required amount of 300
  const memberEvents = ctx.getEvents({ memberSessionToken: 'member-token' });
  const mEv = memberEvents.events.find(e => e.eventId === eventId);
  equal(mEv.requiredAmount, 300);
  equal(mEv.memberCategory, 'MEMBER');
  equal(mEv.isEligible, true);
  equal(mEv.myPaymentStatus, 'UNPAID');

  // Leader sees required amount of 1000
  const leaderEvents = ctx.getEvents({ memberSessionToken: 'leader-token' });
  const lEv = leaderEvents.events.find(e => e.eventId === eventId);
  equal(lEv.requiredAmount, 1000);
  equal(lEv.memberCategory, 'LEADER');
  equal(lEv.isEligible, true);

  const sameRateRes = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Union Meeting',
    eventDate: '2026-07-30',
    targetGroup: 'ALL',
    memberAmount: 150
  });
  const sameRateEvents = ctx.getEvents({ memberSessionToken: 'leader-token' });
  equal(sameRateEvents.events.find(e => e.eventId === sameRateRes.eventId).requiredAmount, 150);
  equal(lEv.myPaymentStatus, 'UNPAID');
});

test('Event Contributions: Target group MEMBERS and LEADERS eligibility enforcement', () => {
  const { ctx } = createTestContext();

  // Create Leader-only event
  const leaderEventRes = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Executive Retreat',
    eventDate: '2026-08-15',
    targetGroup: 'LEADERS',
    leaderAmount: 1500
  });
  const leaderEvId = leaderEventRes.eventId;

  // Regular member attempting to pay for Leader-only event is rejected
  throws(() => {
    ctx.submitContributionPayment({
      sessionToken: 'member-token',
      eventId: leaderEvId,
      confirmed: true,
      paymentMethod: 'ONLINE / UPI',
      paymentDate: '2026-08-01',
      upiRefNo: 'UPI12345678',
      payForSelf: true
    });
  }, /registered as a Member and cannot be assigned a Leader-only contribution/);

  // Leader can pay
  const payRes = ctx.submitContributionPayment({
    sessionToken: 'leader-token',
    eventId: leaderEvId,
    confirmed: true,
    paymentMethod: 'ONLINE / UPI',
    paymentDate: '2026-08-01',
    upiRefNo: 'UPI12345678',
    payForSelf: true
  });
  equal(payRes.success, true);
  equal(payRes.totalAmount, 1500);

  const memberEventRes = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Members Workshop',
    eventDate: '2026-08-20',
    targetGroup: 'MEMBERS',
    memberAmount: 300
  });
  throws(() => {
    ctx.submitContributionPayment({
      sessionToken: 'leader-token',
      eventId: memberEventRes.eventId,
      confirmed: true,
      position: 'Member',
      paymentMethod: 'ONLINE / UPI',
      paymentDate: '2026-08-02',
      upiRefNo: 'UPI-LEADER-OVERRIDE',
      payForSelf: true
    });
  }, /registered as a President and cannot be assigned a Member-only contribution/);
  const memberPayRes = ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: memberEventRes.eventId,
    confirmed: true,
    paymentMethod: 'ONLINE / UPI',
    paymentDate: '2026-08-02',
    upiRefNo: 'UPI-MEMBER-300',
    payForSelf: true
  });
  equal(memberPayRes.totalAmount, 300);
});

test('Event Contributions: Multi-member payment (self + up to two other registered members)', () => {
  const { ctx } = createTestContext();

  const evRes = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Welcome Bash',
    eventDate: '2026-09-10',
    targetGroup: 'ALL',
    memberAmount: 250,
    leaderAmount: 500
  });
  const eventId = evRes.eventId;

  // Member pays for self (250) + leader (500) + member2 (250) = 1000
  const payRes = ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: eventId,
    confirmed: true,
    paymentMethod: 'ONLINE / UPI',
    paymentDate: '2026-09-01',
    upiRefNo: 'UPI-MULTI-999',
    payForSelf: true,
    otherEmails: ['leader@example.com', 'member2@example.com']
  });

  equal(payRes.success, true);
  equal(payRes.totalAmount, 1000); // 250 + 500 + 250

  throws(() => {
    ctx.submitContributionPayment({
      sessionToken: 'member-token',
      eventId,
      confirmed: true,
      paymentMethod: 'ONLINE / UPI',
      paymentDate: '2026-09-01',
      upiRefNo: 'UPI-TOO-MANY',
      otherEmails: ['leader@example.com', 'member2@example.com', 'other@example.com', 'other2@example.com']
    });
  }, /one or two other registered members/);
});

test('Event Contributions: Duplicate request IDs are idempotent while installments remain available', () => {
  const { ctx, workbook } = createTestContext();

  const evRes = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Sports Day 2026',
    eventDate: '2026-10-05',
    targetGroup: 'ALL',
    memberAmount: 100,
    leaderAmount: 200
  });
  const eventId = evRes.eventId;

  // Submit first payment
  const firstPayment = ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: eventId,
    confirmed: true,
    paymentMethod: 'CASH',
    paymentDate: '2026-10-01',
    cashReceiverName: 'Finance Officer',
    cashReceiverPosition: 'Financial Secretary',
    payForSelf: true,
    requestId: 'event-request-duplicate'
  });

  const paymentSheet = workbook.getSheetByName('Payments');
  const allocationSheet = workbook.getSheetByName('PaymentAllocations');
  const paymentsBeforeRetry = paymentSheet.getLastRow();
  const allocationsBeforeRetry = allocationSheet.getLastRow();
  const retry = ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: eventId,
    confirmed: true,
    paymentMethod: 'CASH',
    paymentDate: '2026-10-01',
    cashReceiverName: 'Finance Officer',
    cashReceiverPosition: 'Financial Secretary',
    payForSelf: true,
    requestId: 'event-request-duplicate'
  });
  equal(retry.duplicate, true);
  equal(retry.paymentId, firstPayment.paymentId);
  equal(paymentSheet.getLastRow(), paymentsBeforeRetry);
  equal(allocationSheet.getLastRow(), allocationsBeforeRetry);
  throws(() => ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: eventId,
    requestId: 'event-request-duplicate',
    members: [{ email: 'member@example.com', amount: 99 }],
    confirmed: true,
    paymentMethod: 'CASH',
    paymentDate: '2026-10-01',
    cashReceiverName: 'Finance Officer',
    cashReceiverPosition: 'Financial Secretary'
  }), /already used with different recipients or installment amounts/);

  ctx.approveDuePayment({ sessionToken: 'finance-token', paymentId: firstPayment.paymentId });
  throws(() => {
    ctx.submitContributionPayment({
      sessionToken: 'member-token',
      eventId: eventId,
      confirmed: true,
      paymentMethod: 'CASH',
      paymentDate: '2026-10-01',
      cashReceiverName: 'Finance Officer',
      cashReceiverPosition: 'Financial Secretary',
      payForSelf: true,
      requestId: 'event-request-new'
    });
  }, /exact maximum you can submit now is ₹0\.00/);
});

test('Event Contributions: Concurrent retries with the same request ID create one payment', async () => {
  const { ctx, workbook, lockStats } = createTestContext();
  const event = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Concurrent Retry',
    eventDate: '2026-12-10',
    targetGroup: 'MEMBERS',
    memberAmount: 500
  });
  const payload = {
    sessionToken: 'member-token',
    eventId: event.eventId,
    requestId: 'concurrent-same-request',
    members: [{ email: 'member@example.com', amount: 250 }],
    confirmed: true,
    paymentMethod: 'CASH',
    paymentDate: '2026-12-01',
    cashReceiverName: 'Finance Officer',
    cashReceiverPosition: 'Treasurer'
  };

  const results = await Promise.all([
    Promise.resolve().then(() => ctx.submitContributionPayment(payload)),
    Promise.resolve().then(() => ctx.submitContributionPayment(payload))
  ]);
  equal(results.every(result => result.success), true);
  equal(results.filter(result => result.duplicate === true).length, 1);
  equal(results[0].paymentId, results[1].paymentId);
  equal(workbook.getSheetByName('Payments').getLastRow(), 2);
  equal(workbook.getSheetByName('PaymentAllocations').getLastRow(), 2);
  equal(lockStats.held, false);
  equal(lockStats.acquisitions, lockStats.releases);
});

test('Event Contributions: Concurrent distinct installments cannot exceed available balance', async () => {
  const { ctx, workbook, lockStats } = createTestContext();
  const event = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Concurrent Installments',
    eventDate: '2026-12-11',
    targetGroup: 'MEMBERS',
    memberAmount: 500
  });
  const createPayload = requestId => ({
    sessionToken: 'member-token',
    eventId: event.eventId,
    requestId,
    members: [{ email: 'member@example.com', amount: 300 }],
    confirmed: true,
    paymentMethod: 'CASH',
    paymentDate: '2026-12-01',
    cashReceiverName: 'Finance Officer',
    cashReceiverPosition: 'Treasurer'
  });

  const outcomes = await Promise.allSettled([
    Promise.resolve().then(() => ctx.submitContributionPayment(createPayload('concurrent-installment-1'))),
    Promise.resolve().then(() => ctx.submitContributionPayment(createPayload('concurrent-installment-2')))
  ]);
  equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  equal(outcomes.filter(result => result.status === 'rejected').length, 1);
  const rejection = outcomes.find(result => result.status === 'rejected');
  ok(rejection.reason.message.includes('exact maximum you can submit now is ₹200.00'));
  const balance = ctx.getEventMemberBalance({
    sessionToken: 'member-token',
    eventId: event.eventId,
    targetEmail: 'member@example.com'
  }).balance;
  equal(balance.pendingAmount, 300);
  equal(balance.availableAmount, 200);
  equal(workbook.getSheetByName('Payments').getLastRow(), 2);
  equal(workbook.getSheetByName('PaymentAllocations').getLastRow(), 2);
  equal(lockStats.held, false);
  equal(lockStats.acquisitions, lockStats.releases);
});

test('Event Contributions: Failed multi-recipient write rolls back incomplete records', () => {
  const { ctx, workbook, lockStats } = createTestContext();
  const event = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Rollback Test',
    eventDate: '2026-12-12',
    targetGroup: 'ALL',
    memberAmount: 500,
    leaderAmount: 900
  });
  ctx.ensurePaymentSheets();
  const payments = workbook.getSheetByName('Payments');
  const allocations = workbook.getSheetByName('PaymentAllocations');
  const originalAppendRow = allocations.appendRow.bind(allocations);
  let appendAttempts = 0;
  allocations.appendRow = row => {
    appendAttempts++;
    if (appendAttempts === 2) throw new Error('injected allocation write failure');
    return originalAppendRow(row);
  };

  throws(() => ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: event.eventId,
    requestId: 'rollback-test-request',
    members: [
      { email: 'member@example.com', amount: 100 },
      { email: 'leader@example.com', amount: 200 }
    ],
    confirmed: true,
    paymentMethod: 'CASH',
    paymentDate: '2026-12-01',
    cashReceiverName: 'Finance Officer',
    cashReceiverPosition: 'Treasurer'
  }), /Payment could not be saved completely\. No payment was recorded/);

  equal(payments.getLastRow(), 1);
  equal(allocations.getLastRow(), 1);
  equal(lockStats.held, false);
  equal(lockStats.acquisitions, lockStats.releases);
});

test('Event Contributions: Partial installments reserve pending balances and expose exact overpayment limit', () => {
  const { ctx } = createTestContext();
  const event = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Installment Fund',
    eventDate: '2026-12-15',
    targetGroup: 'ALL',
    memberAmount: 500,
    leaderAmount: 800
  });

  const first = ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: event.eventId,
    members: [{ email: 'member@example.com', amount: 200 }],
    confirmed: true,
    paymentMethod: 'CASH',
    paymentDate: '2026-12-01',
    cashReceiverName: 'Finance Officer',
    cashReceiverPosition: 'Treasurer'
  });
  equal(first.totalAmount, 200);

  const balanceWhilePending = ctx.getEventMemberBalance({
    sessionToken: 'member-token',
    eventId: event.eventId,
    targetEmail: 'member@example.com'
  }).balance;
  equal(balanceWhilePending.requiredAmount, 500);
  equal(balanceWhilePending.approvedAmount, 0);
  equal(balanceWhilePending.pendingAmount, 200);
  equal(balanceWhilePending.remainingBalance, 500);
  equal(balanceWhilePending.availableAmount, 300);

  throws(() => ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: event.eventId,
    members: [{ email: 'member@example.com', amount: 301 }],
    confirmed: true,
    paymentMethod: 'CASH',
    paymentDate: '2026-12-02',
    cashReceiverName: 'Finance Officer',
    cashReceiverPosition: 'Treasurer'
  }), /exact maximum you can submit now is ₹300\.00/);

  const exactRemainder = ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: event.eventId,
    members: [{ email: 'member@example.com', amount: 300 }],
    confirmed: true,
    paymentMethod: 'CASH',
    paymentDate: '2026-12-02',
    cashReceiverName: 'Finance Officer',
    cashReceiverPosition: 'Treasurer'
  });
  equal(exactRemainder.totalAmount, 300);

  ctx.approveDuePayment({ sessionToken: 'finance-token', paymentId: first.paymentId });
  ctx.approveDuePayment({ sessionToken: 'finance-token', paymentId: exactRemainder.paymentId });
  const paidBalance = ctx.getEvents({ memberSessionToken: 'member-token' }).events
    .find(item => item.eventId === event.eventId);
  equal(paidBalance.myApprovedAmount, 500);
  equal(paidBalance.myPendingAmount, 0);
  equal(paidBalance.myRemainingBalance, 0);
  equal(paidBalance.myAvailableAmount, 0);
  equal(paidBalance.myPaymentStatus, 'PAID / VERIFIED');
});

test('Event Contributions: Rejected installment does not count and restores available balance', () => {
  const { ctx } = createTestContext();
  const event = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Rejected Installment',
    eventDate: '2026-12-16',
    targetGroup: 'MEMBERS',
    memberAmount: 500
  });
  const payment = ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: event.eventId,
    members: [{ email: 'member@example.com', amount: 175 }],
    confirmed: true,
    paymentMethod: 'CASH',
    paymentDate: '2026-12-02',
    cashReceiverName: 'Finance Officer',
    cashReceiverPosition: 'Treasurer'
  });
  ctx.rejectDuePayment({
    sessionToken: 'finance-token',
    paymentId: payment.paymentId,
    rejectionReason: 'Receipt could not be verified'
  });

  const balance = ctx.getEventMemberBalance({
    sessionToken: 'member-token',
    eventId: event.eventId,
    targetEmail: 'member@example.com'
  }).balance;
  equal(balance.approvedAmount, 0);
  equal(balance.pendingAmount, 0);
  equal(balance.remainingBalance, 500);
  equal(balance.availableAmount, 500);
});

test('Event Contributions: Pay Balance balance lookup for one or two other members', () => {
  const { ctx, workbook } = createTestContext();
  const event = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Member Balance Lookup',
    eventDate: '2026-12-17',
    targetGroup: 'ALL',
    memberAmount: 500,
    leaderAmount: 900
  });

  const lookup = ctx.getEventMemberBalance({
    sessionToken: 'member-token',
    eventId: event.eventId,
    targetEmail: 'leader@example.com'
  });
  equal(lookup.member.category, 'LEADER');
  equal(lookup.balance.requiredAmount, 900);
  equal(lookup.balance.availableAmount, 900);

  const twoRecipients = ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: event.eventId,
    members: [
      { email: 'leader@example.com', amount: 300 },
      { email: 'member2@example.com', amount: 200 }
    ],
    confirmed: true,
    paymentMethod: 'CASH',
    paymentDate: '2026-12-03',
    cashReceiverName: 'Finance Officer',
    cashReceiverPosition: 'Treasurer'
  });
  equal(twoRecipients.totalAmount, 500);
  equal(workbook.getSheetByName('PaymentAllocations').getLastRow(), 3);

  throws(() => ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: event.eventId,
    members: [
      { email: 'leader@example.com', amount: 100 },
      { email: 'member2@example.com', amount: 100 },
      { email: 'member@example.com', amount: 100 },
      { email: 'other@example.com', amount: 100 }
    ],
    confirmed: true,
    paymentMethod: 'CASH',
    paymentDate: '2026-12-04',
    cashReceiverName: 'Finance Officer',
    cashReceiverPosition: 'Treasurer'
  }), /one or two other registered members/);
});

test('Event Contributions: Fee change preserves history and logs to EventAudits', () => {
  const { ctx, workbook } = createTestContext();

  const evRes = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Cultural Festival',
    eventDate: '2026-11-15',
    targetGroup: 'ALL',
    memberAmount: 200,
    leaderAmount: 400
  });
  const eventId = evRes.eventId;

  // Member pays at initial rate (200)
  const payRes = ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: eventId,
    confirmed: true,
    paymentMethod: 'ONLINE / UPI',
    paymentDate: '2026-11-01',
    upiRefNo: 'UPI-INITIAL-200',
    payForSelf: true
  });
  equal(payRes.totalAmount, 200);

  // Financial Admin updates fee to 350 for members and 600 for leaders
  ctx.updateEvent({
    sessionToken: 'finance-token',
    eventId: eventId,
    memberAmount: 350,
    leaderAmount: 600
  });

  // Verify EventAudits sheet recorded the change
  const auditSheet = workbook.getSheetByName('EventAudits');
  const auditRows = auditSheet.getDataRange().getValues();
  const changeEntry = auditRows.find(r => r[1] === eventId && r[3] === 'AMOUNT_CHANGED');
  ok(changeEntry, 'Audit entry for AMOUNT_CHANGED must exist');
  ok(changeEntry[0] instanceof Date);
  equal(changeEntry[2], 'finance@example.com');
  equal(changeEntry[4], 200); // Previous member amount
  equal(changeEntry[5], 350); // New member amount
  equal(changeEntry[6], 400); // Previous leader amount
  equal(changeEntry[7], 600); // New leader amount

  // Verify previous payment allocation still has original amount of 200
  const allocSheet = workbook.getSheetByName('PaymentAllocations');
  const allocRows = allocSheet.getDataRange().getValues();
  const myAlloc = allocRows.find(r => r[0] === payRes.paymentId && r[7] === eventId);
  equal(myAlloc[4], 200); // Amount preserved at 200
});

test('Event Contributions: Separation of Dues and Event Contributions in Financial Report', () => {
  const { ctx } = createTestContext();

  // 1. Submit Monthly Dues payment (500)
  const duesRes = ctx.submitDuePayment({
    sessionToken: 'member-token',
    paymentMethod: 'ONLINE / UPI',
    paymentDate: '2026-01-10',
    upiRefNo: 'UPI-DUES-500',
    confirmed: true,
    allocations: [{ email: 'member@example.com', amount: 500, year: '2025-2026' }]
  });

  // 2. Submit Event Contribution payment (300)
  const evRes = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'End of Year Banquet',
    eventDate: '2026-12-30',
    targetGroup: 'ALL',
    memberAmount: 300,
    leaderAmount: 500
  });
  const contribRes = ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: evRes.eventId,
    confirmed: true,
    paymentMethod: 'ONLINE / UPI',
    paymentDate: '2026-12-01',
    upiRefNo: 'UPI-BANQUET-300',
    payForSelf: true
  });

  // Before approval: Both are pending. Financial report shows 0 collected, 800 pending
  const reportBefore = ctx.getFinancialReport('finance-token').report;
  equal(reportBefore.totalMoneyCollected, 0);
  equal(reportBefore.totalDuesCollected, 0);
  equal(reportBefore.totalContributionsCollected, 0);
  equal(reportBefore.totalPendingAmount, 800);
  equal(reportBefore.pendingCount, 2);

  // Approve Dues payment
  ctx.approveDuePayment({ sessionToken: 'finance-token', paymentId: duesRes.paymentId });

  // After approving Dues: total collected is 500, dues collected is 500, contributions is 0
  const reportMid = ctx.getFinancialReport('finance-token').report;
  equal(reportMid.totalMoneyCollected, 500);
  equal(reportMid.totalDuesCollected, 500);
  equal(reportMid.totalContributionsCollected, 0);
  equal(reportMid.totalPendingAmount, 300);

  // Approve Contribution payment
  ctx.approveDuePayment({ sessionToken: 'finance-token', paymentId: contribRes.paymentId });

  // After approving Contribution: total is 800, dues is 500, contributions is 300
  const reportFinal = ctx.getFinancialReport('finance-token').report;
  equal(reportFinal.totalMoneyCollected, 800);
  equal(reportFinal.totalDuesCollected, 500);
  equal(reportFinal.totalContributionsCollected, 300);
  equal(reportFinal.contributionsTracked, true);
  equal(reportFinal.totalPendingAmount, 0);

  // Event breakdown verifies banquet has 300 collected
  const banquetStat = reportFinal.eventBreakdown.find(e => e.eventId === evRes.eventId);
  ok(banquetStat);
  equal(banquetStat.totalCollected, 300);
  equal(banquetStat.verifiedContributors, 1);
});

test('Financial Report: Year and month filters separate dues from active events and preserve closed event history', () => {
  const { ctx } = createTestContext();
  equal(ctx.lsuFinancialReportDateKey_(new Date('2026-02-20T12:00:00.000Z')), '2026-02');
  const duesPayment = ctx.submitDuePayment({
    sessionToken: 'member-token',
    paymentMethod: 'CASH',
    paymentDate: '2026-02-03',
    cashReceiverName: 'Finance Officer',
    cashReceiverPosition: 'Treasurer',
    confirmed: true,
    allocations: [{ email: 'member@example.com', amount: 200, year: '2025-2026' }]
  });
  ctx.approveDuePayment({ sessionToken: 'finance-token', paymentId: duesPayment.paymentId });

  function createApprovedEvent(title, date, amount, paymentDate, finalStatus) {
    const event = ctx.createEvent({
      sessionToken: 'finance-token',
      title,
      eventDate: date,
      targetGroup: 'MEMBERS',
      memberAmount: 500
    });
    const payment = ctx.submitContributionPayment({
      sessionToken: 'member-token',
      eventId: event.eventId,
      members: [{ email: 'member@example.com', amount }],
      requestId: `report-${event.eventId}`,
      confirmed: true,
      paymentMethod: 'CASH',
      paymentDate,
      cashReceiverName: 'Finance Officer',
      cashReceiverPosition: 'Treasurer'
    });
    ctx.approveDuePayment({ sessionToken: 'finance-token', paymentId: payment.paymentId });
    if (finalStatus !== 'ACTIVE') {
      ctx.updateEvent({ sessionToken: 'finance-token', eventId: event.eventId, status: finalStatus });
    }
    return event.eventId;
  }

  const activeEventId = createApprovedEvent('Active February Event', '2026-02-10', 100, '2026-02-10', 'ACTIVE');
  const closedEventId = createApprovedEvent('Closed February Event', '2026-02-12', 150, '2026-02-12', 'CLOSED');
  const archivedEventId = createApprovedEvent('Archived March Event', '2026-03-05', 300, '2026-03-05', 'ARCHIVED');
  const pendingClosedEvent = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Closed Event with Pending Receipt',
    eventDate: '2026-02-20',
    targetGroup: 'MEMBERS',
    memberAmount: 500
  });
  const pendingClosedPayment = ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: pendingClosedEvent.eventId,
    members: [{ email: 'member@example.com', amount: 75 }],
    requestId: `report-${pendingClosedEvent.eventId}`,
    confirmed: true,
    paymentMethod: 'CASH',
    paymentDate: '2026-02-20',
    cashReceiverName: 'Finance Officer',
    cashReceiverPosition: 'Treasurer'
  });
  ok(pendingClosedPayment.success);
  ctx.updateEvent({ sessionToken: 'finance-token', eventId: pendingClosedEvent.eventId, status: 'CLOSED' });

  const february = ctx.getFinancialReport('finance-token', { year: '2026', month: '2' }).report;
  equal(february.totalDuesCollected, 200);
  equal(february.totalContributionsCollected, 100);
  equal(february.totalMoneyCollected, 300);
  equal(february.totalPendingAmount, 0);
  deepEqual(Array.from(february.availableMonths), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  equal(february.year, 2026);
  equal(february.month, 2);

  const eventHistory = Object.fromEntries(february.eventBreakdown.map(event => [event.eventId, event]));
  equal(eventHistory[activeEventId].totalCollected, 100);
  equal(eventHistory[activeEventId].periodCollected, 100);
  equal(eventHistory[activeEventId].includedInCollectedTotal, true);
  equal(eventHistory[closedEventId].totalCollected, 150);
  equal(eventHistory[closedEventId].periodCollected, 150);
  equal(eventHistory[closedEventId].includedInCollectedTotal, false);
  equal(eventHistory[archivedEventId].totalCollected, 300);
  equal(eventHistory[archivedEventId].periodCollected, 0);
  equal(eventHistory[archivedEventId].includedInCollectedTotal, false);
  equal(eventHistory[pendingClosedEvent.eventId].pendingAmount, 75);
  equal(eventHistory[pendingClosedEvent.eventId].includedInCollectedTotal, false);

  const march = ctx.getFinancialReport('finance-token', { year: '2026', month: '3' }).report;
  equal(march.totalMoneyCollected, 0);
  equal(march.totalContributionsCollected, 0);
  const marchArchived = march.eventBreakdown.find(event => event.eventId === archivedEventId);
  equal(marchArchived.totalCollected, 300);
  equal(marchArchived.periodCollected, 300);
  throws(() => ctx.getFinancialReport('finance-token', { year: '2025', month: 'ALL' }), /Select a report year from 2026 onward/);
});

test('Event Contributions: Chief Administrator full access, Cash payment, and rejection workflow', () => {
  const { ctx, workbook } = createTestContext();

  // Chief Admin creates an event
  const chiefEvent = ctx.createEvent({
    sessionToken: 'chief-token',
    title: 'Gala Night 2026',
    description: 'Annual cultural gala',
    eventDate: '2026-11-20',
    targetGroup: 'ALL',
    memberAmount: 250,
    leaderAmount: 400
  });
  ok(chiefEvent.success);
  ok(chiefEvent.eventId);

  // Submit cash payment
  const cashRes = ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: chiefEvent.eventId,
    confirmed: true,
    paymentMethod: 'CASH',
    paymentDate: '2026-11-05',
    cashReceiverName: 'Treasurer Doe',
    cashReceiverPosition: 'Financial Secretary',
    payForSelf: true
  });
  ok(cashRes.success);
  equal(cashRes.paymentMethod, 'CASH');

  // Verify rejection by Chief Admin
  const rejRes = ctx.rejectDuePayment({
    sessionToken: 'chief-token',
    paymentId: cashRes.paymentId,
    rejectionReason: 'Cash not received by treasurer'
  });
  ok(rejRes.success);

  // Verify financial report shows payment rejected, not counted towards collected or pending
  const report = ctx.getFinancialReport('chief-token').report;
  equal(report.totalMoneyCollected, 0);
  equal(report.totalPendingAmount, 0);
  equal(report.totalContributionsCollected, 0);
});

test('Event Contributions: Non-destructive backward-compatibility for legacy 6-column PaymentAllocations', () => {
  const { ctx, workbook } = createTestContext();
  const allocSheet = workbook.insertSheet('PaymentAllocations');
  const legacyHeaders = ['Payment ID', 'Member Email', 'Member Name', 'Membership ID', 'Amount', 'Receipt Status'];
  allocSheet.appendRow(legacyHeaders);

  const legacyAllocation = ['PAY-LEGACY-001', 'old@example.com', 'Old Member', 'LSU-001', 200, 'PAID / VERIFIED'];
  allocSheet.appendRow(legacyAllocation);

  const paymentSheet = workbook.insertSheet('Payments');
  paymentSheet.appendRow([
    'Payment ID', 'Payer', 'Payer Email', 'Payment Method', 'Total Amount',
    'Payment Date', 'UPI Ref No.', 'Cash Receiver Name', 'Cash Receiver Position',
    'Status', 'Submitted Date', 'Approved Date', 'Approved By', 'Receipt ID', 'Rejection Reason'
  ]);
  paymentSheet.appendRow([
    'PAY-LEGACY-001', 'Old Member', 'old@example.com', 'ONLINE / UPI', 200,
    '2025-01-01', 'UPI-OLD-001', '', '', 'PAID / VERIFIED',
    new Date('2025-01-01T00:00:00Z'), new Date('2025-01-02T00:00:00Z'),
    'admin@example.com', 'LSU-REC-LEGACY-001', ''
  ]);

  // Migration adds only new headers and does not alter any existing header or allocation cell.
  const report = ctx.getFinancialReport('finance-token').report;
  const migratedRows = allocSheet.getDataRange().getValues();
  deepEqual(migratedRows[0].slice(0, 6), legacyHeaders);
  deepEqual(migratedRows[1].slice(0, 6), legacyAllocation);
  equal(migratedRows[0][6], 'Allocation Type');
  equal(migratedRows[0][7], 'Event ID');
  equal(report.totalDuesCollected, 200);
  equal(report.totalContributionsCollected, 0);
  equal(report.totalMoneyCollected, 200);
});

test('Event Contributions: Appends new allocation columns after unrelated legacy columns', () => {
  const { ctx, workbook } = createTestContext();
  const allocSheet = workbook.insertSheet('PaymentAllocations');
  allocSheet.appendRow(['Payment ID', 'Member Email', 'Member Name', 'Membership ID', 'Amount', 'Receipt Status', 'Legacy Notes']);
  allocSheet.appendRow(['PAY-OLD', 'old@example.com', 'Old Member', 'LSU-OLD', 25, 'PAID / VERIFIED', 'preserve this']);

  const event = ctx.createEvent({
    sessionToken: 'finance-token',
    title: 'Legacy Schema Check',
    eventDate: '2026-12-10',
    targetGroup: 'ALL',
    memberAmount: 75
  });
  ctx.submitContributionPayment({
    sessionToken: 'member-token',
    eventId: event.eventId,
    confirmed: true,
    paymentMethod: 'ONLINE / UPI',
    paymentDate: '2026-12-01',
    upiRefNo: 'UPI-LEGACY-SCHEMA',
    payForSelf: true
  });

  const rows = allocSheet.getDataRange().getValues();
  equal(rows[0][6], 'Legacy Notes');
  equal(rows[0][7], 'Allocation Type');
  equal(rows[0][8], 'Event ID');
  equal(rows[1][6], 'preserve this');
  equal(rows[1][7] || '', '');
  equal(rows[1][8] || '', '');
  equal(rows[2][6], '');
  equal(rows[2][7], 'CONTRIBUTION');
  equal(rows[2][8], event.eventId);
});

test('Event Contributions: Position mapping edge cases and registration position immutability', () => {
  const { ctx, workbook } = createTestContext();

  // Test position classification
  const memberObj1 = ctx.lsuFindMemberByEmail_('member@example.com');
  equal(memberObj1.category, 'MEMBER');
  equal(memberObj1.isLeader, false);

  const leaderObj1 = ctx.lsuFindMemberByEmail_('leader@example.com');
  equal(leaderObj1.category, 'LEADER');
  equal(leaderObj1.isLeader, true);

  const membersSheet = workbook.getSheetByName('Members');
  const lowerCasePosition = new Array(37).fill('');
  lowerCasePosition[1] = 'case@example.com';
  lowerCasePosition[3] = 'Case';
  lowerCasePosition[8] = 'member';
  lowerCasePosition[27] = 'MEMBER_CONFIRMED';
  lowerCasePosition[34] = 'LSU-2026-004';
  membersSheet.appendRow(lowerCasePosition);
  const exactPosition = ctx.lsuFindMemberByEmail_('case@example.com');
  equal(exactPosition.category, 'LEADER');
  equal(exactPosition.isLeader, true);

  const unregistered = ctx.lsuFindMemberByEmail_('nonexistent@example.com');
  equal(unregistered, null);
});

test('Event Contributions: Frontend verification of HTML templates and JS controller bindings', () => {
  const html = fs.readFileSync('pay-dues.html', 'utf8');
  const js = fs.readFileSync('pay-dues.js', 'utf8');
  const css = fs.readFileSync('pay-dues.css', 'utf8');

  // HTML checks
  ok(html.includes('id="btn-choice-monthly-dues"'), 'Monthly Dues choice button must exist');
  ok(html.includes('id="btn-choice-event-contributions"'), 'Event Contributions choice button must exist');
  ok(html.includes('id="view-event-contributions"'), 'Member Event Contributions view must exist');
  ok(html.includes('id="view-event-payment-setup"'), 'Member Event Payment Setup view must exist');
  ok(html.includes('id="tab-admin-pending"'), 'Admin Pending Tab must exist');
  ok(html.includes('id="tab-admin-events"'), 'Admin Events Tab must exist');
  ok(html.includes('id="duesCreateEventModal"'), 'Create Event Modal must exist');
  ok(html.includes('id="duesEditEventModal"'), 'Edit Event Modal must exist');
  ok(html.includes('id="duesEventAuditModal"'), 'Event Audit Modal must exist');
  ok(html.includes('id="rep-events-tbody"'), 'Event Breakdown Table in Financial Report must exist');
  ok(html.includes('id="financial-report-year"'), 'Financial report year selector must exist');
  ok(html.includes('id="financial-report-month"'), 'Financial report month selector must exist');
  ok(html.includes('Lifetime Collected'), 'Event history must display lifetime closed/archived amounts');
  ok(html.includes('id="financial-report-dashboard-slot"'), 'Financial report must be hosted in the admin dashboard');
  ok(!html.includes('<div class="dues-modal-backdrop" id="duesFinancialReportModal">'), 'Financial report must not render as a modal popup');

  // JS checks
  ok(js.includes('loadMemberEvents'), 'loadMemberEvents controller function must exist');
  ok(js.includes('setupEventPayment'), 'setupEventPayment controller function must exist');
  ok(js.includes('submitContributionPayment'), 'submitContributionPayment action call must exist');
  ok(js.includes('loadAdminEvents'), 'loadAdminEvents controller function must exist');
  ok(js.includes('No pending payments or contributions found.'), 'The empty pending queue must mention dues and event contributions');
  ok(js.includes('There are no monthly dues or event contribution payments awaiting review.'), 'The empty queue must explain what has no pending review');
  ok(js.includes('openCreateEventModal'), 'openCreateEventModal function must exist');
  ok(js.includes('openEditEventModal'), 'openEditEventModal function must exist');
  ok(js.includes('openEventAuditModal'), 'openEventAuditModal function must exist');

  // CSS checks
  ok(css.includes('.dues-tabs'), 'Dues tabs styles must exist');
  ok(css.includes('.dues-event-grid'), 'Event grid styles must exist');
  ok(css.includes('.dues-event-card'), 'Event card styles must exist');
  ok(css.includes('.dues-financial-report-card'), 'Financial report dashboard card styles must exist');
  ok(css.includes('.dues-financial-report-filters'), 'Financial report filters must have responsive styles');
});
