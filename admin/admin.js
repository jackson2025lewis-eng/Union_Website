const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby-5lgnRpg0hSmcdq_GTGNv43cHzKsCWZJLSeU10ofbFyccg1868xgj6B37KfS_plv7/exec';

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
            } catch (err) {}
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
    
    // Update Request Modal
    document.getElementById('btn-submit-update-request').addEventListener('click', handleSubmitUpdateRequest);

    // Reject Application Modal
    document.getElementById('btn-submit-reject').addEventListener('click', handleSubmitReject);

    // Sync Emails
    document.getElementById('btn-sync-emails').addEventListener('click', handleSyncEmails);

    // Stats Mode
    if(document.getElementById('stats-display-mode')) {
        document.getElementById('stats-display-mode').addEventListener('change', () => renderStats());
    }
}

// ==========================================
// LOGIN & AUTH
// ==========================================

async function sendBackendRequest(payload) {
    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        return result;
    } catch (error) {
        throw new Error('Network error or server is down.');
    }
}

async function handleCheckAccess() {
    const email = document.getElementById('admin-email').value.trim();
    const errorEl = document.getElementById('login-error');
    if (!email) {
        errorEl.textContent = 'Please enter an email address.';
        return;
    }

    errorEl.textContent = '';
    emailStep.style.display = 'none';
    loginLoading.style.display = 'block';

    try {
        const res = await sendBackendRequest({ action: 'checkAdministratorAccess', email });
        
        if (res.success) {
            // Authorized, now send OTP
            await sendBackendRequest({ action: 'sendAdministratorOTP', email });
            loginLoading.style.display = 'none';
            otpStep.style.display = 'block';
        } else {
            loginLoading.style.display = 'none';
            emailStep.style.display = 'block';
            errorEl.textContent = 'You are not authorized to access the Administrator Portal.';
        }
    } catch (err) {
        loginLoading.style.display = 'none';
        emailStep.style.display = 'block';
        errorEl.textContent = 'An error occurred connecting to the server.';
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
    
    // Update Role Illustration Badge in upper RH corner
    const roleBadgeText = document.getElementById('current-admin-role-display');
    const badgeContainer = document.getElementById('admin-role-badge');
    const isChief = (currentAdminRole === 'CHIEF_ADMINISTRATOR' || currentAdminRole === 'CHIEF_ADMIN');
    
    if (roleBadgeText) {
        roleBadgeText.textContent = isChief ? 'Chief Administrator' : 'Co-Administrator';
    }
    
    if (badgeContainer) {
        badgeContainer.className = 'admin-role-badge-wrapper ' + (isChief ? 'chief-badge' : 'coadmin-badge');
        const badgeIcon = badgeContainer.querySelector('i');
        if (badgeIcon) {
            badgeIcon.className = isChief ? 'fa-solid fa-shield-halved' : 'fa-solid fa-user-shield';
        }
    }

    if (isChief) {
        document.querySelectorAll('.chief-only').forEach(el => el.style.display = '');
    } else {
        document.querySelectorAll('.chief-only').forEach(el => el.style.display = 'none');
    }

    loadDashboardData();
}

async function loadDashboardData() {
    document.getElementById('apps-tbody').innerHTML = '<tr><td colspan="6" style="text-align: center;">Loading applications...</td></tr>';
    
    try {
        const res = await sendBackendRequest({ 
            action: 'getDashboardData', 
            sessionToken: currentSessionToken 
        });
        
        if (res.success) {
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
            }
        } else {
            alert('Error loading dashboard: ' + res.message);
        }
    } catch (err) {
        alert('Network error loading dashboard.');
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

    // Render University Cards
    let uniCardsHtml = '';
    for (const [initial, uData] of Object.entries(uniMap)) {
        const uTotal = uData.total || 0;
        const uMale = uData.male || 0;
        const uFemale = uData.female || 0;

        uniCardsHtml += `
            <div class="university-stat-card">
                <div class="uni-card-header">
                    <span class="uni-initials-badge">${initial}</span>
                    <span class="uni-total-badge">Total: <strong>${formatVal(uTotal, grandTotal)}</strong></span>
                </div>
                <div class="uni-gender-row">
                    <div class="uni-gender-pill">
                        <span><i class="fa-solid fa-mars" style="color: #2563eb;"></i> Male</span>
                        <strong>${formatVal(uMale, uTotal)}</strong>
                    </div>
                    <div class="uni-gender-pill">
                        <span><i class="fa-solid fa-venus" style="color: #db2777;"></i> Female</span>
                        <strong>${formatVal(uFemale, uTotal)}</strong>
                    </div>
                </div>
                <div class="uni-degrees-list">
                    <div class="uni-degree-item">
                        <div class="uni-degree-title">Bachelor Degree</div>
                        <div class="uni-degree-metrics">
                            <span>Total: <strong>${formatVal(uData.bachelor.total, uTotal)}</strong></span>
                            <span>M: <strong>${formatVal(uData.bachelor.male, uData.bachelor.total)}</strong></span>
                            <span>F: <strong>${formatVal(uData.bachelor.female, uData.bachelor.total)}</strong></span>
                        </div>
                    </div>
                    <div class="uni-degree-item">
                        <div class="uni-degree-title">Master's Degree</div>
                        <div class="uni-degree-metrics">
                            <span>Total: <strong>${formatVal(uData.master.total, uTotal)}</strong></span>
                            <span>M: <strong>${formatVal(uData.master.male, uData.master.total)}</strong></span>
                            <span>F: <strong>${formatVal(uData.master.female, uData.master.total)}</strong></span>
                        </div>
                    </div>
                    <div class="uni-degree-item">
                        <div class="uni-degree-title">PhD Degree</div>
                        <div class="uni-degree-metrics">
                            <span>Total: <strong>${formatVal(uData.phd.total, uTotal)}</strong></span>
                            <span>M: <strong>${formatVal(uData.phd.male, uData.phd.total)}</strong></span>
                            <span>F: <strong>${formatVal(uData.phd.female, uData.phd.total)}</strong></span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    container.innerHTML = `
        <!-- CATEGORY 1: UNIVERSITY STATISTICS -->
        <section class="stats-category-section">
            <div class="stats-category-header">
                <i class="fa-solid fa-building-columns"></i>
                <h3>University Statistics</h3>
            </div>
            <div class="university-cards-grid">
                ${uniCardsHtml}
            </div>
        </section>

        <!-- CATEGORY 2: CURRENT STUDENT STATISTICS -->
        <section class="stats-category-section">
            <div class="stats-category-header">
                <i class="fa-solid fa-user-graduate"></i>
                <h3>Current Student Statistics</h3>
            </div>
            <div class="metrics-grid">
                <div class="metric-card highlight">
                    <div class="metric-value">${formatVal(cs.total, grandTotal)}</div>
                    <div class="metric-label">Total Current Students</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${formatVal(cs.male, cs.total)}</div>
                    <div class="metric-label"><i class="fa-solid fa-mars" style="color: #2563eb;"></i> Male Students</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${formatVal(cs.female, cs.total)}</div>
                    <div class="metric-label"><i class="fa-solid fa-venus" style="color: #db2777;"></i> Female Students</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${formatVal(csBachelor, cs.total)}</div>
                    <div class="metric-label">Bachelor Candidates</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${formatVal(csMasters, cs.total)}</div>
                    <div class="metric-label">Master's Candidates</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${formatVal(csPhd, cs.total)}</div>
                    <div class="metric-label">PhD Candidates</div>
                </div>
            </div>
        </section>

        <!-- CATEGORY 3: ALUMNI STATISTICS -->
        <section class="stats-category-section">
            <div class="stats-category-header">
                <i class="fa-solid fa-graduation-cap"></i>
                <h3>Alumni Statistics</h3>
            </div>
            <div class="metrics-grid">
                <div class="metric-card highlight">
                    <div class="metric-value">${formatVal(al.total, grandTotal)}</div>
                    <div class="metric-label">Total Alumni</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${formatVal(al.male, al.total)}</div>
                    <div class="metric-label"><i class="fa-solid fa-mars" style="color: #2563eb;"></i> Male Alumni</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${formatVal(al.female, al.total)}</div>
                    <div class="metric-label"><i class="fa-solid fa-venus" style="color: #db2777;"></i> Female Alumni</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${formatVal(alBachelor, al.total)}</div>
                    <div class="metric-label">Bachelor Degrees</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${formatVal(alMasters, al.total)}</div>
                    <div class="metric-label">Master's Degrees</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${formatVal(alPhd, al.total)}</div>
                    <div class="metric-label">PhD Degrees</div>
                </div>
            </div>
        </section>

        <!-- CATEGORY 4: OVERALL DATABASE STATISTICS -->
        <section class="stats-category-section">
            <div class="stats-category-header">
                <i class="fa-solid fa-chart-pie"></i>
                <h3>Overall Database Statistics</h3>
            </div>
            <div class="metrics-grid">
                <div class="metric-card highlight">
                    <div class="metric-value">${mode === 'PERCENTAGE' ? '100%' : grandTotal.toLocaleString()}</div>
                    <div class="metric-label">Total Database Members</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${formatVal(grandMale, grandTotal)}</div>
                    <div class="metric-label"><i class="fa-solid fa-mars" style="color: #2563eb;"></i> Overall Male</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${formatVal(grandFemale, grandTotal)}</div>
                    <div class="metric-label"><i class="fa-solid fa-venus" style="color: #db2777;"></i> Overall Female</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${formatVal(grandBachelor, grandTotal)}</div>
                    <div class="metric-label">Overall Bachelor</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${formatVal(grandMasters, grandTotal)}</div>
                    <div class="metric-label">Overall Master's</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${formatVal(grandPhd, grandTotal)}</div>
                    <div class="metric-label">Overall PhD</div>
                </div>
            </div>
        </section>
    `;
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
    
    tbody.innerHTML = '';
    
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
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No applications found.</td></tr>';
        return;
    }

    filtered.forEach(app => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${app.id || 'N/A'}</td>
            <td>${app.name}</td>
            <td>${app.type}</td>
            <td><span class="status-badge ${getStatusClass(app.status)}">${app.status || 'UNKNOWN'}</span></td>
            <td>${app.date || ''}</td>
            <td><button class="secondary-btn" onclick="openAppDetail('${app.id}')">View</button></td>
        `;
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
    
    let contentHtml = `
        <div class="detail-grid">
            <div class="detail-item"><div class="detail-label">Application ID</div><div class="detail-value">${app.id}</div></div>
            <div class="detail-item"><div class="detail-label">Status</div><div class="detail-value"><span class="status-badge ${getStatusClass(app.status)}">${app.status}</span></div></div>
            <div class="detail-item"><div class="detail-label">Membership Type</div><div class="detail-value">${app.type}</div></div>
            <div class="detail-item"><div class="detail-label">Submission Date</div><div class="detail-value">${app.date}</div></div>
        </div>
        <h4>Personal Information</h4>
        <div class="detail-grid">
            <div class="detail-item"><div class="detail-label">Name</div><div class="detail-value">${app.name}</div></div>
            <div class="detail-item"><div class="detail-label">Gender</div><div class="detail-value">${app.gender || 'N/A'}</div></div>
            <div class="detail-item"><div class="detail-label">Date of Birth</div><div class="detail-value">${app.dob || 'N/A'}</div></div>
            <div class="detail-item"><div class="detail-label">Passport Number</div><div class="detail-value">${app.passportNo || 'N/A'}</div></div>
            <div class="detail-item"><div class="detail-label">Email</div><div class="detail-value">${app.email || 'N/A'}</div></div>
            <div class="detail-item"><div class="detail-label">Mobile Number</div><div class="detail-value">${app.mobile || 'N/A'}</div></div>
            <div class="detail-item"><div class="detail-label">WhatsApp Number</div><div class="detail-value">${app.whatsapp || 'N/A'}</div></div>
        </div>
        <h4>Academic Information</h4>
        <div class="detail-grid">
            <div class="detail-item"><div class="detail-label">University</div><div class="detail-value">${app.university || 'N/A'}</div></div>
            <div class="detail-item"><div class="detail-label">Degree Type</div><div class="detail-value">${app.degree || 'N/A'}</div></div>
            <div class="detail-item"><div class="detail-label">Study Period</div><div class="detail-value">${app.studyFrom} - ${app.studyTo}</div></div>
        </div>
        <h4>Documents</h4>
        <div>
    `;
    
    if (app.passportDocUrl) {
        contentHtml += `<a href="${app.passportDocUrl}" target="_blank" class="document-link"><i class="fa-solid fa-file-pdf"></i> Passport Document</a>`;
    }
    if (app.identificationPhotoUrl || app.passportPhotoUrl) {
        contentHtml += `<a href="${app.identificationPhotoUrl || app.passportPhotoUrl}" target="_blank" class="document-link"><i class="fa-solid fa-image"></i> Identification Photo</a>`;
    }
    if (app.efroUrl && app.type === 'CURRENT STUDENT') {
        contentHtml += `<a href="${app.efroUrl}" target="_blank" class="document-link"><i class="fa-solid fa-file-pdf"></i> EFRO File</a>`;
    }
    contentHtml += `</div>`;
    
    document.getElementById('app-detail-content').innerHTML = contentHtml;
    
    // Actions based on role and status
    let actionsHtml = `<button class="secondary-btn close-modal-btn">Close</button>`;
    
    const isOwnApp = (app.email.toLowerCase() === currentAdminEmail.toLowerCase());
    
    if (!isOwnApp || currentAdminRole === 'CHIEF_ADMINISTRATOR') {
        const s = (app.status || '').toUpperCase();
        
        if (s === 'UNDER_REVIEW') {
            actionsHtml = `
                <button class="secondary-btn" onclick="openUpdateRequestModal()">Request Document Update</button>
                <button class="secondary-btn" style="color: var(--danger); border-color: var(--danger);" onclick="openRejectModal()">Reject</button>
                <button class="primary-btn" onclick="updateAppStatus('VERIFICATION_PENDING')">Approve & Send OTP</button>
                <button class="secondary-btn close-modal-btn">Close</button>
            `;
        } else if (s === 'VERIFICATION_PENDING') {
            actionsHtml = `
                <button class="secondary-btn" style="color: var(--primary); border-color: var(--primary);" onclick="resendVerificationCode('${app.id}')"><i class="fa-solid fa-rotate-right"></i> Resend Verification Code</button>
                <button class="secondary-btn close-modal-btn">Close</button>
            `;
        } else if (s === 'NEEDS_CLARIFICATION') {
            actionsHtml = `
                <button class="secondary-btn" style="color: var(--primary); border-color: var(--primary);" onclick="resendUploadLink('${app.id}')"><i class="fa-solid fa-rotate-right"></i> Resend Upload Link</button>
                <button class="secondary-btn close-modal-btn">Close</button>
            `;
        }
    } else {
        actionsHtml = `<span style="color: var(--text-light); margin-right: 15px;">You cannot approve your own application.</span>` + actionsHtml;
    }
    
    document.getElementById('app-detail-actions').innerHTML = actionsHtml;
    
    document.querySelectorAll('#app-detail-actions .close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('modal-app-detail').classList.remove('active');
        });
    });

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
    if (currentAppInModal.type === 'ALUMNI') {
        Array.from(select.options).forEach(opt => {
            if (opt.value === 'EFRO File') opt.style.display = 'none';
        });
        if(select.value === 'EFRO File') select.value = 'Passport Document';
    } else {
        Array.from(select.options).forEach(opt => opt.style.display = '');
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

function renderAdministrators() {
    const tbody = document.getElementById('admins-tbody');
    tbody.innerHTML = '';
    
    let activeCoAdmins = 0;
    
    if (cachedAdministrators.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No administrators found.</td></tr>';
        return;
    }

    cachedAdministrators.forEach(admin => {
        const tr = document.createElement('tr');
        const isActive = admin.status === 'ACTIVE';
        
        if (admin.role === 'CO_ADMINISTRATOR' && isActive) {
            activeCoAdmins++;
        }
        
        let actionBtn = '';
        if (admin.role !== 'CHIEF_ADMINISTRATOR') {
            if (isActive) {
                actionBtn = `<button class="secondary-btn" style="color: var(--danger); border-color: var(--danger); padding: 5px 10px;" onclick="deactivateAdmin('${admin.email}')">Deactivate</button>`;
            } else {
                actionBtn = `<button class="primary-btn" style="padding: 5px 10px;" onclick="reactivateAdmin('${admin.email}')">Reactivate</button>`;
            }
        }

        tr.innerHTML = `
            <td>${admin.name}</td>
            <td>${admin.email}</td>
            <td><span class="badge ${admin.role === 'CHIEF_ADMINISTRATOR' ? 'chief' : 'co-admin'}">${admin.role.replace('_', ' ')}</span></td>
            <td>${isActive ? '<span style="color: green; font-weight: bold;">ACTIVE</span>' : '<span style="color: red; font-weight: bold;">DEACTIVATED</span>'}</td>
            <td>${admin.addedDate || ''}</td>
            <td>${actionBtn}</td>
        `;
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
    
    const countColor = activeCoAdmins >= 3 ? 'var(--error)' : 'var(--primary)';
    counterInfo.innerHTML = `<strong>Active Co-Administrators: <span style="color: ${countColor};">${activeCoAdmins} / 3</span></strong>`;
    
    const addBtn = document.getElementById('btn-add-admin-modal');
    if (activeCoAdmins >= 3) {
        addBtn.disabled = true;
        addBtn.style.opacity = '0.5';
        addBtn.title = 'Maximum of 3 active co-administrators reached.';
    } else {
        addBtn.disabled = false;
        addBtn.style.opacity = '1';
        addBtn.title = '';
    }
}

async function handleAddAdmin() {
    const name = document.getElementById('new-admin-name').value.trim();
    const newEmail = document.getElementById('new-admin-email').value.trim();
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
            newEmail: newEmail
        });
        
        if (res.success) {
            document.getElementById('modal-add-admin').classList.remove('active');
            document.getElementById('new-admin-name').value = '';
            document.getElementById('new-admin-email').value = '';
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
