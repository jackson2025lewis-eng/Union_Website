const BACKEND_URL = '/api/backend';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzZyI7gERGia6KDLpN_cp-S2OL4Tr7eOVL0vo9lWC3MILFJIIaVqjLs7jPG3Lpd_T_YIg/exec';

// State
let currentSessionToken = sessionStorage.getItem('adminSessionToken') || null;
let currentAdminEmail = sessionStorage.getItem('adminEmail') || null;
let currentAdminRole = sessionStorage.getItem('adminRole') || null;
let currentAdminName = sessionStorage.getItem('adminName') || null;
let cachedApplications = [];
let cachedAdministrators = [];

// DOM Elements - Login
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const emailStep = document.getElementById('email-step');
const otpStep = document.getElementById('otp-step');
const loginLoading = document.getElementById('login-loading');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // If the page was reloaded, return to the public homepage
    if (performance.navigation.type === 1) {
        sessionStorage.clear();
        window.location.href = '../index.html';
        return;
    }

    if (currentSessionToken && currentAdminEmail && currentAdminRole) {
        showDashboard();
    } else {
        loginView.classList.add('active');
    }

    setupEventListeners();
});

function setupEventListeners() {
    // Login Flow
    document.getElementById('btn-continue').addEventListener('click', handleCheckAccess);
    document.getElementById('btn-verify').addEventListener('click', handleVerifyOTP);
    document.getElementById('admin-email').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleCheckAccess();
        }
    });
    document.getElementById('admin-otp').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleVerifyOTP();
        }
    });
    document.getElementById('btn-back').addEventListener('click', () => {
        otpStep.style.display = 'none';
        emailStep.style.display = 'block';
        document.getElementById('admin-otp').value = '';
    });

    // Mobile Sidebar Drawer
    const sidebarToggle = document.getElementById('sidebarToggle');
    const adminSidebar = document.getElementById('admin-sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');

    if (sidebarToggle && adminSidebar) {
        sidebarToggle.addEventListener('click', () => {
            adminSidebar.classList.toggle('open');
            if (sidebarOverlay) sidebarOverlay.classList.toggle('active');
        });
    }

    if (closeSidebarBtn && adminSidebar) {
        closeSidebarBtn.addEventListener('click', () => {
            adminSidebar.classList.remove('open');
            if (sidebarOverlay) sidebarOverlay.classList.remove('active');
        });
    }

    if (sidebarOverlay && adminSidebar) {
        sidebarOverlay.addEventListener('click', () => {
            adminSidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
        });
    }

    // Logout
    document.getElementById('btn-logout').addEventListener('click', async (e) => {
        e.preventDefault();
        if (currentSessionToken) {
            try {
                await sendBackendRequest({ action: 'logoutAdministrator', sessionToken: currentSessionToken });
            } catch (err) { }
        }
        sessionStorage.clear();
        window.location.href = '../index.html';
    });

    // Navigation
    document.querySelectorAll('.admin-nav-link[data-target]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.admin-nav-link').forEach(l => l.classList.remove('active'));
            document.querySelectorAll('.dashboard-panel').forEach(p => p.classList.remove('active'));

            e.currentTarget.classList.add('active');
            document.getElementById(e.currentTarget.dataset.target).classList.add('active');

            if (window.innerWidth <= 768 && adminSidebar) {
                adminSidebar.classList.remove('open');
                if (sidebarOverlay) sidebarOverlay.classList.remove('active');
            }
        });
    });

    // Refresh Buttons with interactive feedback
    const handleRefresh = async (btnId) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const icon = btn.querySelector('i');
        if (icon) icon.classList.add('fa-spin');
        btn.disabled = true;
        try {
            await loadDashboardData();
        } finally {
            if (icon) icon.classList.remove('fa-spin');
            btn.disabled = false;
        }
    };

    document.getElementById('btn-refresh-apps').addEventListener('click', () => handleRefresh('btn-refresh-apps'));
    document.getElementById('btn-refresh-stats').addEventListener('click', () => handleRefresh('btn-refresh-stats'));

    // Filters
    document.getElementById('search-apps').addEventListener('input', renderApplications);
    document.getElementById('filter-status').addEventListener('change', renderApplications);

    // Modals
    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.target.closest('.admin-modal-overlay').classList.remove('active');
        });
    });

    // Add Admin Modal
    document.getElementById('btn-add-admin-modal').addEventListener('click', () => {
        document.getElementById('modal-add-admin').classList.add('active');
    });
    document.getElementById('btn-submit-add-admin').addEventListener('click', handleAddAdmin);
    document.getElementById('btn-refresh-admin-audit').addEventListener('click', loadAdministratorAuditLog);

    // Update Request Modal
    document.getElementById('btn-submit-update-request').addEventListener('click', handleSubmitUpdateRequest);

    // Reject Application Modal
    document.getElementById('btn-submit-reject').addEventListener('click', handleSubmitReject);

    // Sync Emails
    document.getElementById('btn-sync-emails').addEventListener('click', handleSyncEmails);

    // Stats Mode
    if (document.getElementById('stats-display-mode')) {
        document.getElementById('stats-display-mode').addEventListener('change', () => renderStats());
    }
}

// ==========================================
// LOGIN & AUTH
// ==========================================

async function sendBackendRequest(payload) {
    try {
        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });
        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch (parseErr) {
            console.error("Non-JSON backend response from proxy:", text);
            throw new Error("Invalid response received from server.");
        }
        if (!response.ok && !result.success) {
            throw new Error(result.message || "Backend request failed.");
        }
        return result;
    } catch (proxyError) {
        // Direct resilient fallback to Apps Script URL if proxy is unreachable
        try {
            const fbResponse = await fetch(SCRIPT_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8',
                },
                body: JSON.stringify(payload)
            });
            const fbText = await fbResponse.text();
            let fbResult;
            try {
                fbResult = JSON.parse(fbText);
            } catch (fbParseErr) {
                if (fbText.includes("<!DOCTYPE") || fbText.includes("<html")) {
                    throw new Error("Unable to connect to Google Apps Script. Please verify Web App deployment access.");
                }
                throw new Error(fbText || "Invalid response received from server.");
            }
            return fbResult;
        } catch (fbErr) {
            console.error("Backend request error:", fbErr);
            throw (fbErr instanceof Error ? fbErr : new Error("Unable to connect to LSU backend."));
        }
    }
}

async function handleCheckAccess() {
    const emailInput = document.getElementById('admin-email');
    const email = emailInput ? emailInput.value.trim() : '';
    const errorEl = document.getElementById('login-error');
    if (!email) {
        errorEl.textContent = 'Please enter an email address.';
        return;
    }

    errorEl.textContent = '';
    emailStep.style.display = 'none';
    loginLoading.style.display = 'block';

    try {
        // Direct single-request OTP dispatch: checks admin authorization and sends OTP code in 1 step
        const otpRes = await sendBackendRequest({ action: 'sendAdministratorOTP', email });
        loginLoading.style.display = 'none';

        if (otpRes.success) {
            otpStep.style.display = 'block';
            const otpInput = document.getElementById('admin-otp');
            if (otpInput) {
                otpInput.value = '';
                otpInput.focus();
            }
        } else {
            emailStep.style.display = 'block';
            errorEl.textContent = otpRes.message || 'You are not authorized to access the Administrator Portal.';
        }
    } catch (err) {
        loginLoading.style.display = 'none';
        emailStep.style.display = 'block';
        errorEl.textContent = err.message || 'An error occurred connecting to the server. Please check your internet connection.';
    }
}

async function handleVerifyOTP() {
    const email = document.getElementById('admin-email').value.trim();
    const otp = document.getElementById('admin-otp').value.trim();
    const errorEl = document.getElementById('otp-error');

    if (!otp) {
        errorEl.textContent = 'Please enter the verification code.';
        return;
    }

    errorEl.textContent = '';
    otpStep.style.display = 'none';
    loginLoading.style.display = 'block';

    try {
        const res = await sendBackendRequest({ action: 'verifyAdministratorOTP', email, otp });

        if (res.success) {
            // Success! Store session
            sessionStorage.setItem('adminSessionToken', res.sessionToken);
            sessionStorage.setItem('adminEmail', email);
            sessionStorage.setItem('adminRole', res.role);
            sessionStorage.setItem('adminName', res.name);

            currentSessionToken = res.sessionToken;
            currentAdminEmail = email;
            currentAdminRole = res.role;
            currentAdminName = res.name;

            showDashboard();
        } else {
            loginLoading.style.display = 'none';
            otpStep.style.display = 'block';
            errorEl.textContent = res.message || 'Invalid verification code.';
        }
    } catch (err) {
        loginLoading.style.display = 'none';
        otpStep.style.display = 'block';
        errorEl.textContent = 'An error occurred connecting to the server.';
    }
}

// ==========================================
// DASHBOARD
// ==========================================

function showDashboard() {
    loginView.classList.remove('active');
    dashboardView.classList.add('active');
    document.querySelectorAll('.chief-only').forEach(el => el.style.display = 'none');
    loadDashboardData();
}

function applyServerAdministratorRole(admin) {
    currentAdminRole = admin.role;
    currentAdminEmail = admin.email;
    currentAdminName = admin.name;
    sessionStorage.setItem('adminRole', admin.role);
    sessionStorage.setItem('adminEmail', admin.email);
    sessionStorage.setItem('adminName', admin.name);
    const isChief = admin.role === 'CHIEF_ADMINISTRATOR';
    const roleBadgeText = document.getElementById('current-admin-role-display');
    const badgeContainer = document.getElementById('admin-role-badge');
    const roleLabels = {
        CHIEF_ADMINISTRATOR: 'Chief Administrator',
        MEMBERSHIP_CO_ADMINISTRATOR: 'Membership Co-Administrator'
    };
    if (roleBadgeText) roleBadgeText.textContent = roleLabels[admin.role] || 'Administrator';
    if (badgeContainer) {
        badgeContainer.className = 'admin-role-badge-wrapper ' + (isChief ? 'chief-badge' : 'coadmin-badge');
        const badgeIcon = badgeContainer.querySelector('i');
        if (badgeIcon) badgeIcon.className = isChief ? 'fa-solid fa-shield-halved' : 'fa-solid fa-user-shield';
    }
    document.querySelectorAll('.chief-only').forEach(el => el.style.display = isChief ? '' : 'none');
}

async function loadDashboardData() {
    const loadingRow = document.createElement('tr');
    const loadingCell = document.createElement('td');
    loadingCell.colSpan = 6;
    loadingCell.style.textAlign = 'center';
    loadingCell.textContent = 'Loading applications...';
    loadingRow.appendChild(loadingCell);
    document.getElementById('apps-tbody').replaceChildren(loadingRow);

    try {
        const res = await sendBackendRequest({
            action: 'getDashboardData',
            sessionToken: currentSessionToken
        });

        if (res.success) {
            if (res.administrator) applyServerAdministratorRole(res.administrator);
            cachedApplications = (res.applications || []).map(row => {
                // Map the spreadsheet headers to frontend expected properties
                return {
                    ...row,
                    id: row['Application ID'] || row.applicationId,
                    name: (row['First Name'] || '') + ' ' + (row['Last Name'] || ''),
                    type: row['Membership Type'] || '',
                    status: row['Application Status'] || '',
                    date: row['Submission Date'] || row['Timestamp'] || '',
                    email: row['Email'] || row['Applicant Email'] || row['Untitled Question'] || '',
                    gender: row['Gender'] || '',
                    dob: row['Date of Birth'] || '',
                    passportNo: row['Passport Number'] || '',
                    mobile: row['Mobile Number'] || '',
                    whatsapp: row['WhatsApp Number'] || '',
                    university: row['University'] || '',
                    degree: row['Degree Type'] || '',
                    studyFrom: row['Study From'] || '',
                    studyTo: row['Study To'] || '',
                    passportDocUrl: row['Passport Document'] || '',
                    identificationPhotoUrl: row['Identification Photo'] || row['Passport Photo'] || '',
                    passportPhotoUrl: row['Identification Photo'] || row['Passport Photo'] || '',
                    efroUrl: row['EFRO File'] || ''
                };
            });
            renderStats(res.statistics);
            renderApplications();

            if (currentAdminRole === 'CHIEF_ADMINISTRATOR' || currentAdminRole === 'CHIEF_ADMIN') {
                loadAdministrators();
                loadAdministratorAuditLog();
            }
        } else {
            sessionStorage.clear();
            currentSessionToken = null;
            currentAdminEmail = null;
            currentAdminRole = null;
            dashboardView.classList.remove('active');
            loginView.classList.add('active');
            document.getElementById('login-error').textContent = res.message || 'Your administrator session is no longer active. Please sign in again.';
        }
    } catch (err) {
        document.querySelectorAll('.chief-only').forEach(el => el.style.display = 'none');
        alert('Unable to verify your administrator session. Please retry.');
    }
}

let lastStatsData = null;

function normalizeUniInitial(name) {
    const n = (name || '').toUpperCase();
    if (n.includes('SOA') || n.includes('ANUSANDHAN')) return 'SOA';
    if (n.includes('KIIT') || n.includes('KALINGA')) return 'KIIT';
    if (n.includes('RAMAN') || n.includes('CVR')) return 'CV Raman';
    return name.trim();
}

function renderStats(stats) {
    if (stats) lastStatsData = stats;
    else if (lastStatsData) stats = lastStatsData;
    else return;

    const mode = document.getElementById('stats-display-mode') ? document.getElementById('stats-display-mode').value : 'NUMBER';

    const container = document.getElementById('stats-container');
    if (!container) return;

    const cs = stats.currentStudents || {};
    const al = stats.alumni || {};

    const csBachelor = cs.bachelorCandidate || cs.bachelor || 0;
    const csMasters = cs.masters || cs.master || 0;
    const csPhd = cs.phd || 0;

    const alBachelor = al.bachelorCandidate || al.bachelor || 0;
    const alMasters = al.masters || al.master || 0;
    const alPhd = al.phd || 0;

    const grandTotal = (cs.total || 0) + (al.total || 0);
    const grandMale = (cs.male || 0) + (al.male || 0);
    const grandFemale = (cs.female || 0) + (al.female || 0);
    const grandBachelor = csBachelor + alBachelor;
    const grandMasters = csMasters + alMasters;
    const grandPhd = csPhd + alPhd;

    const formatVal = (num, denom) => {
        const val = num || 0;
        if (mode === 'PERCENTAGE') {
            if (!denom || denom === 0) return '0.0%';
            return ((val / denom) * 100).toFixed(1) + '%';
        }
        return val.toLocaleString();
    };

    // 1. Process University Statistics (Aggregate CS + Alumni by initial)
    const uniMap = {
        'SOA': { total: 0, male: 0, female: 0, bachelor: { male: 0, female: 0, total: 0 }, master: { male: 0, female: 0, total: 0 }, phd: { male: 0, female: 0, total: 0 } },
        'KIIT': { total: 0, male: 0, female: 0, bachelor: { male: 0, female: 0, total: 0 }, master: { male: 0, female: 0, total: 0 }, phd: { male: 0, female: 0, total: 0 } },
        'CV Raman': { total: 0, male: 0, female: 0, bachelor: { male: 0, female: 0, total: 0 }, master: { male: 0, female: 0, total: 0 }, phd: { male: 0, female: 0, total: 0 } }
    };

    const addUniDegrees = (target, degrees) => {
        if (!degrees) return;
        ['Bachelor', 'Master', 'PHD'].forEach(degKey => {
            const d = degrees[degKey] || degrees[degKey.toLowerCase()] || {};
            const m = d.male || 0;
            const f = d.female || 0;
            const t = d.total || (m + f);
            const normKey = degKey === 'PHD' ? 'phd' : degKey.toLowerCase();
            if (target[normKey]) {
                target[normKey].male += m;
                target[normKey].female += f;
                target[normKey].total += t;
            }
            target.male += m;
            target.female += f;
            target.total += t;
        });
    };

    const processUniSource = (unisObj) => {
        if (!unisObj) return;
        for (const [rawName, degs] of Object.entries(unisObj)) {
            const initial = normalizeUniInitial(rawName);
            if (!uniMap[initial]) {
                uniMap[initial] = { total: 0, male: 0, female: 0, bachelor: { male: 0, female: 0, total: 0 }, master: { male: 0, female: 0, total: 0 }, phd: { male: 0, female: 0, total: 0 } };
            }
            addUniDegrees(uniMap[initial], degs);
        }
    };

    processUniSource(cs.universities);
    processUniSource(al.universities);

    const makeElement = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = String(text);
        return element;
    };
    const makeIcon = (className, color) => {
        const icon = makeElement('i', className);
        if (color) icon.style.color = color;
        return icon;
    };
    const makeSection = (title, iconClass) => {
        const section = makeElement('section', 'stats-category-section');
        const header = makeElement('div', 'stats-category-header');
        header.appendChild(makeIcon(iconClass));
        header.appendChild(makeElement('h3', '', title));
        section.appendChild(header);
        return section;
    };
    const makeMetric = (value, label, iconClass, highlight) => {
        const card = makeElement('div', `metric-card${highlight ? ' highlight' : ''}`);
        card.appendChild(makeElement('div', 'metric-value', value));
        const labelElement = makeElement('div', 'metric-label');
        if (iconClass) {
            const color = iconClass.includes('mars') ? '#2563eb' : '#db2777';
            labelElement.appendChild(makeIcon(iconClass, color));
            labelElement.appendChild(document.createTextNode(' '));
        }
        labelElement.appendChild(document.createTextNode(label));
        card.appendChild(labelElement);
        return card;
    };
    const appendMetrics = (section, metrics) => {
        const grid = makeElement('div', 'metrics-grid');
        metrics.forEach(metric => grid.appendChild(makeMetric(...metric)));
        section.appendChild(grid);
    };
    const makeDegreeMetric = (title, degree, total) => {
        const item = makeElement('div', 'uni-degree-item');
        item.appendChild(makeElement('div', 'uni-degree-title', title));
        const metrics = makeElement('div', 'uni-degree-metrics');
        [
            ['Total: ', formatVal(degree.total, total)],
            ['M: ', formatVal(degree.male, degree.total)],
            ['F: ', formatVal(degree.female, degree.total)]
        ].forEach(([label, value]) => {
            const span = makeElement('span');
            span.appendChild(document.createTextNode(label));
            span.appendChild(makeElement('strong', '', value));
            metrics.appendChild(span);
        });
        item.appendChild(metrics);
        return item;
    };

    const universitySection = makeSection('University Statistics', 'fa-solid fa-building-columns');
    const universityGrid = makeElement('div', 'university-cards-grid');
    for (const [initial, uData] of Object.entries(uniMap)) {
        const uTotal = uData.total || 0;
        const card = makeElement('div', 'university-stat-card');
        const header = makeElement('div', 'uni-card-header');
        header.appendChild(makeElement('span', 'uni-initials-badge', initial));
        const totalBadge = makeElement('span', 'uni-total-badge');
        totalBadge.appendChild(document.createTextNode('Total: '));
        totalBadge.appendChild(makeElement('strong', '', formatVal(uTotal, grandTotal)));
        header.appendChild(totalBadge);
        card.appendChild(header);

        const genderRow = makeElement('div', 'uni-gender-row');
        [['fa-solid fa-mars', '#2563eb', 'Male', uData.male], ['fa-solid fa-venus', '#db2777', 'Female', uData.female]].forEach(([iconClass, color, label, value]) => {
            const pill = makeElement('div', 'uni-gender-pill');
            const labelElement = makeElement('span');
            labelElement.appendChild(makeIcon(iconClass, color));
            labelElement.appendChild(document.createTextNode(` ${label}`));
            pill.appendChild(labelElement);
            pill.appendChild(makeElement('strong', '', formatVal(value || 0, uTotal)));
            genderRow.appendChild(pill);
        });
        card.appendChild(genderRow);

        const degrees = makeElement('div', 'uni-degrees-list');
        degrees.appendChild(makeDegreeMetric('Bachelor Degree', uData.bachelor, uTotal));
        degrees.appendChild(makeDegreeMetric("Master's Degree", uData.master, uTotal));
        degrees.appendChild(makeDegreeMetric('PhD Degree', uData.phd, uTotal));
        card.appendChild(degrees);
        universityGrid.appendChild(card);
    }
    universitySection.appendChild(universityGrid);

    const currentSection = makeSection('Current Student Statistics', 'fa-solid fa-user-graduate');
    appendMetrics(currentSection, [
        [formatVal(cs.total, grandTotal), 'Total Current Students', null, true],
        [formatVal(cs.male, cs.total), 'Male Students', 'fa-solid fa-mars'],
        [formatVal(cs.female, cs.total), 'Female Students', 'fa-solid fa-venus'],
        [formatVal(csBachelor, cs.total), 'Bachelor Candidates'],
        [formatVal(csMasters, cs.total), "Master's Candidates"],
        [formatVal(csPhd, cs.total), 'PhD Candidates']
    ]);

    const alumniSection = makeSection('Alumni Statistics', 'fa-solid fa-graduation-cap');
    appendMetrics(alumniSection, [
        [formatVal(al.total, grandTotal), 'Total Alumni', null, true],
        [formatVal(al.male, al.total), 'Male Alumni', 'fa-solid fa-mars'],
        [formatVal(al.female, al.total), 'Female Alumni', 'fa-solid fa-venus'],
        [formatVal(alBachelor, al.total), 'Bachelor Degrees'],
        [formatVal(alMasters, al.total), "Master's Degrees"],
        [formatVal(alPhd, al.total), 'PhD Degrees']
    ]);

    const overallSection = makeSection('Overall Database Statistics', 'fa-solid fa-chart-pie');
    appendMetrics(overallSection, [
        [mode === 'PERCENTAGE' ? '100%' : grandTotal.toLocaleString(), 'Total Database Members', null, true],
        [formatVal(grandMale, grandTotal), 'Overall Male', 'fa-solid fa-mars'],
        [formatVal(grandFemale, grandTotal), 'Overall Female', 'fa-solid fa-venus'],
        [formatVal(grandBachelor, grandTotal), 'Overall Bachelor'],
        [formatVal(grandMasters, grandTotal), "Overall Master's"],
        [formatVal(grandPhd, grandTotal), 'Overall PhD']
    ]);

    container.replaceChildren(universitySection, currentSection, alumniSection, overallSection);
}

function getStatusClass(status) {
    const s = (status || '').toUpperCase();
    if (s === 'UNDER_REVIEW') return 'status-under-review';
    if (s === 'VERIFICATION_PENDING') return 'status-verified';
    if (s === 'MEMBER_CONFIRMED') return 'status-confirmed';
    if (s === 'REJECTED') return 'status-rejected';
    if (s === 'NEEDS_CLARIFICATION') return 'status-update-required';
    return '';
}

function renderApplications() {
    const tbody = document.getElementById('apps-tbody');
    const searchTerm = document.getElementById('search-apps').value.toLowerCase();
    const statusFilter = document.getElementById('filter-status').value;

    tbody.replaceChildren();

    const filtered = cachedApplications.filter(app => {
        const matchesSearch = (app.name || '').toLowerCase().includes(searchTerm) ||
            (app.email || '').toLowerCase().includes(searchTerm) ||
            (app.id || '').toLowerCase().includes(searchTerm);

        let matchesStatus = true;
        if (statusFilter !== 'ALL') {
            const normalizedAppStatus = (app.status || '').toUpperCase().replace(' ', '_');
            const normalizedFilter = statusFilter.toUpperCase().replace(' ', '_');
            matchesStatus = normalizedAppStatus === normalizedFilter;
        }

        return matchesSearch && matchesStatus;
    });

    if (filtered.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.style.textAlign = 'center';
        cell.textContent = 'No applications found.';
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }

    filtered.forEach(app => {
        const tr = document.createElement('tr');
        [app.id || 'N/A', app.name || '', app.type || ''].forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = String(value);
            tr.appendChild(cell);
        });
        const statusCell = document.createElement('td');
        const statusBadge = document.createElement('span');
        statusBadge.className = `status-badge ${getStatusClass(app.status)}`;
        statusBadge.textContent = app.status || 'UNKNOWN';
        statusCell.appendChild(statusBadge);
        tr.appendChild(statusCell);

        const dateCell = document.createElement('td');
        dateCell.textContent = app.date || '';
        tr.appendChild(dateCell);

        const actionCell = document.createElement('td');
        const viewButton = document.createElement('button');
        viewButton.className = 'secondary-btn';
        viewButton.textContent = 'View';
        viewButton.addEventListener('click', () => openAppDetail(app.id));
        actionCell.appendChild(viewButton);
        tr.appendChild(actionCell);
        tbody.appendChild(tr);
    });
}

// ==========================================
// APPLICATION ACTIONS
// ==========================================

let currentAppInModal = null;

function openAppDetail(appId) {
    const app = cachedApplications.find(a => a.id === appId);
    if (!app) return;
    currentAppInModal = app;

    const makeElement = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = String(text);
        return element;
    };
    const content = document.getElementById('app-detail-content');
    content.replaceChildren();

    const makeDetail = (label, value, status) => {
        const item = makeElement('div', 'detail-item');
        item.appendChild(makeElement('div', 'detail-label', label));
        const valueElement = makeElement('div', 'detail-value');
        if (status) {
            const badge = makeElement('span', `status-badge ${getStatusClass(value)}`, value || '');
            valueElement.appendChild(badge);
        } else {
            valueElement.textContent = value || 'N/A';
        }
        item.appendChild(valueElement);
        return item;
    };
    const makeGrid = (details) => {
        const grid = makeElement('div', 'detail-grid');
        details.forEach(([label, value, status]) => grid.appendChild(makeDetail(label, value, status)));
        return grid;
    };

    content.appendChild(makeGrid([
        ['Application ID', app.id],
        ['Status', app.status, true],
        ['Membership Type', app.type],
        ['Submission Date', app.date]
    ]));
    content.appendChild(makeElement('h4', '', 'Personal Information'));
    content.appendChild(makeGrid([
        ['Name', app.name],
        ['Gender', app.gender],
        ['Date of Birth', app.dob],
        ['Passport Number', app.passportNo],
        ['Email', app.email],
        ['Mobile Number', app.mobile],
        ['WhatsApp Number', app.whatsapp]
    ]));
    content.appendChild(makeElement('h4', '', 'Academic Information'));
    content.appendChild(makeGrid([
        ['University', app.university],
        ['Degree Type', app.degree],
        ['Study Period', `${app.studyFrom || ''} - ${app.studyTo || ''}`]
    ]));
    content.appendChild(makeElement('h4', '', 'Documents'));
    const documents = makeElement('div');
    const addDocumentLink = (url, label, iconClass) => {
        if (!url) return;
        let parsedUrl;
        try {
            parsedUrl = new URL(String(url), window.location.origin);
        } catch (error) {
            return;
        }
        if (parsedUrl.protocol !== 'https:') return;

        const link = makeElement('a', 'document-link');
        link.href = parsedUrl.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const icon = makeElement('i', iconClass);
        icon.setAttribute('aria-hidden', 'true');
        link.appendChild(icon);
        link.appendChild(document.createTextNode(` ${label}`));
        documents.appendChild(link);
    };
    addDocumentLink(app.passportDocUrl, 'Passport Document', 'fa-solid fa-file-pdf');
    addDocumentLink(app.identificationPhotoUrl || app.passportPhotoUrl, 'Identification Photo', 'fa-solid fa-image');
    if (app.type === 'CURRENT STUDENT') {
        addDocumentLink(app.efroUrl, 'EFRO File', 'fa-solid fa-file-pdf');
    }
    content.appendChild(documents);

    const actions = document.getElementById('app-detail-actions');
    actions.replaceChildren();
    const makeActionButton = (label, className, handler, iconClass) => {
        const button = makeElement('button', className, label);
        button.type = 'button';
        if (iconClass) {
            button.textContent = '';
            const icon = makeElement('i', iconClass);
            icon.setAttribute('aria-hidden', 'true');
            button.append(icon, document.createTextNode(` ${label}`));
        }
        button.addEventListener('click', handler);
        actions.appendChild(button);
        return button;
    };
    const addCloseButton = () => makeActionButton('Close', 'secondary-btn close-modal-btn', () => {
        document.getElementById('modal-app-detail').classList.remove('active');
    });

    const isOwnApp = String(app.email || '').toLowerCase() === String(currentAdminEmail || '').toLowerCase();
    if (!isOwnApp || currentAdminRole === 'CHIEF_ADMINISTRATOR') {
        const status = (app.status || '').toUpperCase();
        if (status === 'UNDER_REVIEW') {
            makeActionButton('Request Document Update', 'secondary-btn', openUpdateRequestModal);
            const rejectButton = makeActionButton('Reject', 'secondary-btn', openRejectModal);
            rejectButton.style.color = 'var(--danger)';
            rejectButton.style.borderColor = 'var(--danger)';
            makeActionButton('Approve & Send OTP', 'primary-btn', () => updateAppStatus('VERIFICATION_PENDING'));
            addCloseButton();
        } else if (status === 'VERIFICATION_PENDING') {
            const resendButton = makeActionButton('Resend Verification Code', 'secondary-btn', () => resendVerificationCode(app.id), 'fa-solid fa-rotate-right');
            resendButton.style.color = 'var(--primary)';
            resendButton.style.borderColor = 'var(--primary)';
            addCloseButton();
        } else if (status === 'NEEDS_CLARIFICATION') {
            const resendButton = makeActionButton('Resend Upload Link', 'secondary-btn', () => resendUploadLink(app.id), 'fa-solid fa-rotate-right');
            resendButton.style.color = 'var(--primary)';
            resendButton.style.borderColor = 'var(--primary)';
            addCloseButton();
        } else {
            addCloseButton();
        }
    } else {
        const restriction = makeElement('span', '', 'You cannot approve your own application.');
        restriction.style.color = 'var(--text-light)';
        restriction.style.marginRight = '15px';
        actions.appendChild(restriction);
        addCloseButton();
    }

    document.getElementById('modal-app-detail').classList.add('active');
}

async function updateAppStatus(newStatus, reason = '', docType = '') {
    if (!confirm(`Are you sure you want to change status to ${newStatus}?`)) return;

    document.getElementById('modal-app-detail').classList.remove('active');
    document.getElementById('modal-request-update').classList.remove('active');
    document.getElementById('modal-reject-reason').classList.remove('active');

    const applicantEmail = currentAppInModal ? (currentAppInModal.email || currentAppInModal['Applicant Email'] || currentAppInModal['Email'] || currentAppInModal['Email Address'] || currentAppInModal['Untitled Question'] || '') : '';
    const applicantName = currentAppInModal ? (currentAppInModal.name || ((currentAppInModal['First Name'] || '') + ' ' + (currentAppInModal['Last Name'] || '')).trim() || 'Applicant') : 'Applicant';

    try {
        const res = await sendBackendRequest({
            action: 'updateApplicationStatus',
            sessionToken: currentSessionToken,
            applicationId: currentAppInModal ? (currentAppInModal.id || currentAppInModal['Application ID']) : '',
            newStatus: newStatus,
            rejectionReason: reason,
            updateDocType: docType,
            applicantEmail: applicantEmail,
            applicantName: applicantName
        });

        if (res.success) {
            alert('Application updated successfully and email notification sent.');
            loadDashboardData();
        } else {
            alert('Failed to update: ' + (res.message || 'Unknown error.'));
        }
    } catch (e) {
        alert('Network or server error: ' + (e.message || 'Please check your connection.'));
    }
}

async function resendUploadLink(appId) {
    if (!confirm('Generate and send a new document upload link with a fresh 24-hour expiry?')) return;
    try {
        const res = await sendBackendRequest({
            action: 'resendUploadLink',
            sessionToken: currentSessionToken,
            applicationId: appId
        });
        if (res.success) {
            alert(res.message || 'New document upload link sent successfully (24-hour expiry).');
            loadDashboardData();
        } else {
            alert('Failed to resend link: ' + (res.message || 'Unknown error.'));
        }
    } catch (e) {
        alert('Network or server error: ' + (e.message || 'Please try again.'));
    }
}

async function resendVerificationCode(appId) {
    if (!confirm('Generate and send a new verification code with a fresh 24-hour expiry?')) return;
    try {
        const res = await sendBackendRequest({
            action: 'resendVerificationCode',
            sessionToken: currentSessionToken,
            applicationId: appId
        });
        if (res.success) {
            alert(res.message || 'New verification code sent successfully (24-hour expiry).');
            loadDashboardData();
        } else {
            alert('Failed to resend code: ' + (res.message || 'Unknown error.'));
        }
    } catch (e) {
        alert('Network or server error: ' + (e.message || 'Please try again.'));
    }
}

function openRejectModal() {
    document.getElementById('modal-app-detail').classList.remove('active');
    document.getElementById('rejection-reason-text').value = '';
    document.getElementById('modal-reject-reason').classList.add('active');
}

function handleSubmitReject() {
    const reason = document.getElementById('rejection-reason-text').value.trim();
    if (!reason) {
        alert('Please provide a reason for rejection.');
        return;
    }
    updateAppStatus('REJECTED', reason);
}

function openUpdateRequestModal() {
    document.getElementById('modal-app-detail').classList.remove('active');
    document.getElementById('update-doc-reason').value = '';

    const select = document.getElementById('update-doc-type');
    const membershipType = String(currentAppInModal?.type || '').trim().toUpperCase();
    const isCurrentStudent = membershipType.includes('STUDENT');
    const efroOption = Array.from(select.options).find(option => option.value === 'EFRO File');
    if (efroOption) {
        efroOption.disabled = !isCurrentStudent;
        efroOption.hidden = !isCurrentStudent;
    }
    if (!isCurrentStudent && select.value === 'EFRO File') {
        select.value = 'Passport Document';
    }

    document.getElementById('modal-request-update').classList.add('active');
}

function handleSubmitUpdateRequest() {
    const docType = document.getElementById('update-doc-type').value;
    const reason = document.getElementById('update-doc-reason').value.trim();
    if (!reason) {
        alert('Please provide instructions/reason.');
        return;
    }
    updateAppStatus('NEEDS_CLARIFICATION', reason, docType);
}

async function handleSyncEmails() {
    const btn = document.getElementById('btn-sync-emails');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing...';
    try {
        const res = await sendBackendRequest({
            action: 'processVerificationReplies',
            sessionToken: currentSessionToken
        });
        if (res.success) {
            alert(res.message);
            loadDashboardData();
        } else {
            alert('Sync failed: ' + res.message);
        }
    } catch (e) {
        alert('Network error.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-envelope-open-text"></i> Sync Email Replies';
    }
}

// ==========================================
// ADMINISTRATORS MANAGEMENT (CHIEF ONLY)
// ==========================================

async function loadAdministrators() {
    try {
        const res = await sendBackendRequest({
            action: 'getAdministrators',
            sessionToken: currentSessionToken
        });

        if (res.success) {
            cachedAdministrators = res.administrators || [];
            renderAdministrators();
        }
    } catch (e) {
        console.error('Failed to load admins', e);
    }
}

async function loadAdministratorAuditLog() {
    const tbody = document.getElementById('admin-audit-tbody');
    if (!tbody) return;
    try {
        const res = await sendBackendRequest({
            action: 'getAdministratorAuditLog',
            sessionToken: currentSessionToken
        });
        tbody.replaceChildren();
        if (!res.success || !Array.isArray(res.records) || !res.records.length) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 7;
            cell.textContent = res.message || 'No audit records found.';
            row.appendChild(cell);
            tbody.appendChild(row);
            return;
        }
        res.records.forEach(record => {
            const row = document.createElement('tr');
            [record.timestamp, record.administrator, record.role, record.action, record.target, record.outcome, record.details].forEach(value => {
                const cell = document.createElement('td');
                cell.textContent = value || '';
                row.appendChild(cell);
            });
            tbody.appendChild(row);
        });
    } catch (error) {
        tbody.replaceChildren();
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 7;
        cell.textContent = 'Unable to load administrator audit records.';
        row.appendChild(cell);
        tbody.appendChild(row);
    }
}

function renderAdministrators() {
    const tbody = document.getElementById('admins-tbody');
    tbody.replaceChildren();

    let activeMembershipAdmins = 0;
    let activeFinancialAdmins = 0;

    if (cachedAdministrators.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.style.textAlign = 'center';
        cell.textContent = 'No administrators found.';
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }

    cachedAdministrators.forEach(admin => {
        const tr = document.createElement('tr');
        const isActive = admin.status === 'ACTIVE';

        if (admin.role === 'MEMBERSHIP_CO_ADMINISTRATOR' && isActive) activeMembershipAdmins++;
        if (admin.role === 'FINANCIAL_CO_ADMINISTRATOR' && isActive) activeFinancialAdmins++;
        if (admin.role === 'CO_ADMINISTRATOR' && isActive) {
            activeMembershipAdmins++;
            activeFinancialAdmins++;
        }

        const actionCell = document.createElement('td');
        if (admin.role !== 'CHIEF_ADMINISTRATOR') {
            const button = document.createElement('button');
            button.className = isActive ? 'secondary-btn' : 'primary-btn';
            button.style.padding = '5px 10px';
            button.textContent = isActive ? 'Deactivate' : 'Reactivate';
            if (isActive) {
                button.style.color = 'var(--danger)';
                button.style.borderColor = 'var(--danger)';
                button.addEventListener('click', () => deactivateAdmin(admin.email));
            } else {
                button.addEventListener('click', () => reactivateAdmin(admin.email));
            }
            actionCell.appendChild(button);
        }

        [admin.name, admin.email].forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = value || '';
            tr.appendChild(cell);
        });

        const roleCell = document.createElement('td');
        const role = String(admin.role || '');
        const roleBadge = document.createElement('span');
        roleBadge.className = `badge ${role === 'CHIEF_ADMINISTRATOR' ? 'chief' : 'co-admin'}`;
        roleBadge.textContent = role.replaceAll('_', ' ');
        roleCell.appendChild(roleBadge);
        if (role !== 'CHIEF_ADMINISTRATOR') {
            const roleSelect = document.createElement('select');
            roleSelect.className = 'admin-select';
            roleSelect.setAttribute('aria-label', 'Administrator role');
            [['MEMBERSHIP_CO_ADMINISTRATOR', 'Membership'], ['FINANCIAL_CO_ADMINISTRATOR', 'Financial']].forEach(([value, label]) => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                roleSelect.appendChild(option);
            });
            roleSelect.value = role === 'FINANCIAL_CO_ADMINISTRATOR' ? role : 'MEMBERSHIP_CO_ADMINISTRATOR';
            const saveRoleButton = document.createElement('button');
            saveRoleButton.className = 'secondary-btn';
            saveRoleButton.textContent = 'Save role';
            saveRoleButton.addEventListener('click', () => updateAdminRole(admin.email, roleSelect.value));
            roleCell.append(roleSelect, saveRoleButton);
        }
        tr.appendChild(roleCell);

        const statusCell = document.createElement('td');
        const statusBadge = document.createElement('span');
        statusBadge.style.color = isActive ? 'green' : 'red';
        statusBadge.style.fontWeight = 'bold';
        statusBadge.textContent = isActive ? 'ACTIVE' : 'DEACTIVATED';
        statusCell.appendChild(statusBadge);
        tr.appendChild(statusCell);

        const dateCell = document.createElement('td');
        dateCell.textContent = admin.addedDate || '';
        tr.appendChild(dateCell);
        tr.appendChild(actionCell);
        tbody.appendChild(tr);
    });

    // Add counter below table
    const tableContainer = tbody.parentElement.parentElement;
    let counterInfo = document.getElementById('co-admin-counter');
    if (!counterInfo) {
        counterInfo = document.createElement('div');
        counterInfo.id = 'co-admin-counter';
        counterInfo.style.marginTop = '15px';
        counterInfo.style.fontSize = '16px';
        tableContainer.appendChild(counterInfo);
    }

    counterInfo.replaceChildren();
    const countLabel = document.createElement('strong');
    countLabel.textContent = `Active Membership Co-Administrators: ${activeMembershipAdmins} / 2 · Active Financial Co-Administrators: ${activeFinancialAdmins} / 2`;
    counterInfo.appendChild(countLabel);

    const addBtn = document.getElementById('btn-add-admin-modal');
    addBtn.disabled = activeMembershipAdmins >= 2 && activeFinancialAdmins >= 2;
    addBtn.style.opacity = addBtn.disabled ? '0.5' : '1';
    addBtn.title = addBtn.disabled ? 'Both administrator role limits have been reached.' : '';
}

async function handleAddAdmin() {
    const name = document.getElementById('new-admin-name').value.trim();
    const newEmail = document.getElementById('new-admin-email').value.trim();
    const role = document.getElementById('new-admin-role').value;
    const errorEl = document.getElementById('add-admin-error');

    if (!name || !newEmail) {
        errorEl.textContent = 'Please fill all fields.';
        return;
    }

    document.getElementById('btn-submit-add-admin').disabled = true;
    errorEl.textContent = 'Adding...';

    try {
        const res = await sendBackendRequest({
            action: 'addAdministrator',
            sessionToken: currentSessionToken,
            newName: name,
            newEmail: newEmail,
            role
        });

        if (res.success) {
            document.getElementById('modal-add-admin').classList.remove('active');
            document.getElementById('new-admin-name').value = '';
            document.getElementById('new-admin-email').value = '';
            document.getElementById('new-admin-role').value = 'MEMBERSHIP_CO_ADMINISTRATOR';
            loadAdministrators();
            alert('Administrator added successfully. They will receive an email shortly.');
        } else {
            errorEl.textContent = res.message || 'Failed to add administrator.';
        }
    } catch (e) {
        errorEl.textContent = 'Network error.';
    } finally {
        document.getElementById('btn-submit-add-admin').disabled = false;
    }
}

async function updateAdminRole(targetEmail, role) {
    try {
        const res = await sendBackendRequest({
            action: 'changeAdministratorRole',
            sessionToken: currentSessionToken,
            targetEmail,
            role
        });
        if (res.success) loadAdministrators();
        else alert(res.message || 'Unable to update administrator role.');
    } catch (e) {
        alert('Unable to update administrator role. Please sign in again if your session expired.');
    }
}

async function deactivateAdmin(targetEmail) {
    if (!confirm(`Are you sure you want to deactivate ${targetEmail}?`)) return;

    try {
        const res = await sendBackendRequest({
            action: 'deactivateAdministrator',
            sessionToken: currentSessionToken,
            targetEmail: targetEmail
        });

        if (res.success) {
            loadAdministrators();
        } else {
            alert('Failed to deactivate: ' + res.message);
        }
    } catch (e) {
        alert('Network error.');
    }
}

async function reactivateAdmin(targetEmail) {
    if (!confirm(`Are you sure you want to reactivate ${targetEmail}?`)) return;

    try {
        const res = await sendBackendRequest({
            action: 'reactivateAdministrator',
            sessionToken: currentSessionToken,
            targetEmail: targetEmail
        });

        if (res.success) {
            loadAdministrators();
        } else {
            alert('Failed to reactivate: ' + res.message);
        }
    } catch (e) {
        alert('Network error.');
    }
}
