const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby-5lgnRpg0hSmcdq_GTGNv43cHzKsCWZJLSeU10ofbFyccg1868xgj6B37KfS_plv7/exec';

// State
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
    if (currentAdminEmail && currentAdminRole) {
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

    // Logout
    document.getElementById('btn-logout').addEventListener('click', (e) => {
        e.preventDefault();
        sessionStorage.clear();
        window.location.reload();
    });

    // Navigation
    document.querySelectorAll('.admin-nav-link[data-target]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.admin-nav-link').forEach(l => l.classList.remove('active'));
            document.querySelectorAll('.dashboard-panel').forEach(p => p.classList.remove('active'));
            
            e.currentTarget.classList.add('active');
            document.getElementById(e.currentTarget.dataset.target).classList.add('active');
        });
    });

    // Refresh Buttons
    document.getElementById('btn-refresh-apps').addEventListener('click', loadDashboardData);
    document.getElementById('btn-refresh-stats').addEventListener('click', loadDashboardData);

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
            sessionStorage.setItem('adminEmail', email);
            sessionStorage.setItem('adminRole', res.role);
            sessionStorage.setItem('adminName', res.name);
            
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
    
    document.getElementById('current-admin-name').textContent = currentAdminName;
    const roleBadge = document.getElementById('current-admin-role');
    roleBadge.textContent = currentAdminRole.replace('_', ' ');
    if (currentAdminRole === 'CHIEF_ADMIN') {
        roleBadge.classList.add('chief');
        document.querySelectorAll('.chief-only').forEach(el => el.style.display = '');
    }

    loadDashboardData();
}

async function loadDashboardData() {
    document.getElementById('apps-tbody').innerHTML = '<tr><td colspan="6" style="text-align: center;">Loading applications...</td></tr>';
    
    try {
        const res = await sendBackendRequest({ 
            action: 'getAdminDashboardData', 
            email: currentAdminEmail, 
            role: currentAdminRole 
        });
        
        if (res.success) {
            cachedApplications = res.applications || [];
            renderStats(res.stats);
            renderApplications();
            
            if (currentAdminRole === 'CHIEF_ADMIN') {
                loadAdministrators();
            }
        } else {
            alert('Error loading dashboard: ' + res.message);
        }
    } catch (err) {
        alert('Network error loading dashboard.');
    }
}

function renderStats(stats) {
    if (!stats) return;
    const grid = document.getElementById('stats-grid');
    grid.innerHTML = `
        <div class="stat-card"><h3>${stats.total || 0}</h3><p>Total Applications</p></div>
        <div class="stat-card"><h3>${stats.underReview || 0}</h3><p>Under Review</p></div>
        <div class="stat-card"><h3>${stats.updateRequired || 0}</h3><p>Update Required</p></div>
        <div class="stat-card"><h3>${stats.verified || 0}</h3><p>Verified</p></div>
        <div class="stat-card"><h3>${stats.confirmed || 0}</h3><p>Confirmed Members</p></div>
    `;
}

function getStatusClass(status) {
    const s = (status || '').toUpperCase();
    if (s === 'UNDER_REVIEW' || s === 'UNDER REVIEW') return 'status-under-review';
    if (s === 'VERIFIED') return 'status-verified';
    if (s === 'CONFIRMED') return 'status-confirmed';
    if (s === 'REJECTED') return 'status-rejected';
    if (s.includes('UPDATE')) return 'status-update-required';
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
            if (normalizedFilter === 'DOCUMENT_UPDATE_REQUIRED') {
                 matchesStatus = normalizedAppStatus.includes('UPDATE');
            } else {
                 matchesStatus = normalizedAppStatus === normalizedFilter;
            }
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
    if (app.passportPhotoUrl) {
        contentHtml += `<a href="${app.passportPhotoUrl}" target="_blank" class="document-link"><i class="fa-solid fa-image"></i> Passport Photo</a>`;
    }
    if (app.efroUrl && app.type === 'CURRENT STUDENT') {
        contentHtml += `<a href="${app.efroUrl}" target="_blank" class="document-link"><i class="fa-solid fa-file-pdf"></i> EFRO File</a>`;
    }
    contentHtml += `</div>`;
    
    document.getElementById('app-detail-content').innerHTML = contentHtml;
    
    // Actions based on role and status
    let actionsHtml = `<button class="secondary-btn close-modal-btn">Close</button>`;
    
    const isOwnApp = (app.email.toLowerCase() === currentAdminEmail.toLowerCase());
    
    if (!isOwnApp || currentAdminRole === 'CHIEF_ADMIN') {
        const s = (app.status || '').toUpperCase();
        
        if (s.includes('REVIEW') || s.includes('UPDATE')) {
            actionsHtml = `
                <button class="secondary-btn" onclick="openUpdateRequestModal()">Request Document Update</button>
                <button class="secondary-btn" style="color: var(--danger); border-color: var(--danger);" onclick="updateAppStatus('REJECTED')">Reject</button>
                <button class="primary-btn" onclick="updateAppStatus('VERIFIED')">Verify Application</button>
                <button class="secondary-btn close-modal-btn">Close</button>
            `;
        } else if (s === 'VERIFIED') {
            actionsHtml = `
                <button class="primary-btn" onclick="updateAppStatus('CONFIRMED')">Confirm Membership</button>
                <button class="secondary-btn close-modal-btn">Close</button>
            `;
        }
        
        if (currentAdminRole === 'CHIEF_ADMIN') {
            actionsHtml = `<button class="secondary-btn" style="background: var(--danger); color: white;" onclick="deleteApplication('${app.id}')"><i class="fa-solid fa-trash"></i> Delete</button>` + actionsHtml;
        }
    } else {
        actionsHtml = `<span style="color: var(--text-light); margin-right: 15px;">You cannot approve your own application.</span>` + actionsHtml;
    }
    
    document.getElementById('app-detail-actions').innerHTML = actionsHtml;
    
    // Re-bind close buttons dynamically created
    document.querySelectorAll('#app-detail-actions .close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('modal-app-detail').classList.remove('active');
        });
    });

    document.getElementById('modal-app-detail').classList.add('active');
}

async function updateAppStatus(newStatus, notes = '') {
    if (!confirm(`Are you sure you want to change status to ${newStatus}?`)) return;
    
    document.getElementById('modal-app-detail').classList.remove('active');
    document.getElementById('modal-request-update').classList.remove('active');
    
    try {
        const res = await sendBackendRequest({
            action: 'updateApplicationStatus',
            email: currentAdminEmail,
            role: currentAdminRole,
            appId: currentAppInModal.id,
            newStatus: newStatus,
            notes: notes
        });
        
        if (res.success) {
            alert('Application updated successfully.');
            loadDashboardData();
        } else {
            alert('Failed to update: ' + res.message);
        }
    } catch (e) {
        alert('Network error.');
    }
}

function openUpdateRequestModal() {
    document.getElementById('modal-app-detail').classList.remove('active');
    document.getElementById('update-doc-reason').value = '';
    
    // Hide EFRO option if Alumni
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
    updateAppStatus('DOCUMENT UPDATE REQUIRED', `Document: ${docType}. Reason: ${reason}`);
}

async function deleteApplication(appId) {
    if (!confirm('WARNING: Are you sure you want to PERMANENTLY delete this application? This action cannot be undone.')) return;
    
    document.getElementById('modal-app-detail').classList.remove('active');
    
    try {
        const res = await sendBackendRequest({
            action: 'deleteApplication',
            email: currentAdminEmail,
            role: currentAdminRole,
            appId: appId
        });
        
        if (res.success) {
            alert('Application deleted successfully.');
            loadDashboardData();
        } else {
            alert('Failed to delete: ' + res.message);
        }
    } catch (e) {
        alert('Network error.');
    }
}

// ==========================================
// ADMINISTRATORS MANAGEMENT (CHIEF ONLY)
// ==========================================

async function loadAdministrators() {
    try {
        const res = await sendBackendRequest({
            action: 'getAdministrators',
            email: currentAdminEmail,
            role: currentAdminRole
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
    
    if (cachedAdministrators.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No administrators found.</td></tr>';
        return;
    }

    cachedAdministrators.forEach(admin => {
        const tr = document.createElement('tr');
        const isActive = admin.status === 'ACTIVE';
        
        let actionBtn = '';
        if (isActive && admin.email.toLowerCase() !== currentAdminEmail.toLowerCase()) {
            actionBtn = `<button class="secondary-btn" style="color: var(--danger); border-color: var(--danger); padding: 5px 10px;" onclick="deactivateAdmin('${admin.email}')">Deactivate</button>`;
        }

        tr.innerHTML = `
            <td>${admin.name}</td>
            <td>${admin.email}</td>
            <td><span class="badge ${admin.role === 'CHIEF_ADMIN' ? 'chief' : ''}">${admin.role.replace('_', ' ')}</span></td>
            <td>${isActive ? '<span style="color: green; font-weight: bold;">ACTIVE</span>' : '<span style="color: red; font-weight: bold;">INACTIVE</span>'}</td>
            <td>${admin.addedDate || ''}</td>
            <td>${actionBtn}</td>
        `;
        tbody.appendChild(tr);
    });
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
            email: currentAdminEmail,
            role: currentAdminRole,
            newName: name,
            newEmail: newEmail,
            newRole: role
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
            email: currentAdminEmail,
            role: currentAdminRole,
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
