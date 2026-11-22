const BACKEND_URL = '/api/backend';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzZyI7gERGia6KDLpN_cp-S2OL4Tr7eOVL0vo9lWC3MILFJIIaVqjLs7jPG3Lpd_T_YIg/exec';
let updateToken = null;
let updateKind = null;
let requestedDocuments = [];
let requestedFields = [];

const views = {
    loading: document.getElementById('loading-view'),
    error: document.getElementById('error-view'),
    form: document.getElementById('form-view'),
    success: document.getElementById('success-view')
};

function showView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    Object.values(views).forEach(v => v.style.display = 'none');
    views[viewName].style.display = 'block';
    views[viewName].classList.add('active');
}

async function sendBackendRequest(payload) {
    try {
        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch (parseErr) {
            console.error("Non-JSON backend response from proxy:", text);
            throw new Error("Invalid response format from server.");
        }
        if (!result.success) throw new Error(result.message || "Request failed.");
        return result;
    } catch (proxyError) {
        // Direct resilient fallback to Apps Script URL if proxy is unreachable
        try {
            const fbResponse = await fetch(SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
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
                throw new Error(fbText || "Invalid response format from server.");
            }
            if (!fbResult.success) throw new Error(fbResult.message || "Request failed.");
            return fbResult;
        } catch (fbErr) {
            throw new Error(fbErr.message || 'Network error: Unable to connect to LSU backend.');
        }
    }
}

function fileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
        reader.readAsDataURL(file);
    });
}

function renderDocumentUpdate(info) {
    updateKind = 'documents';
    requestedDocuments = Array.isArray(info.documents) && info.documents.length
        ? info.documents
        : [{ docType: info.docType, reason: info.reason }];
    document.getElementById('update-scope-label').textContent =
        requestedDocuments.length === 1 ? 'Requested Document:' : 'Requested Documents:';
    const reasonBox = document.getElementById('reason-display');
    reasonBox.replaceChildren();
    requestedDocuments.forEach(request => {
        const item = document.createElement('p');
        const title = document.createElement('strong');
        title.textContent = `${request.docType}: `;
        item.append(title, document.createTextNode(request.reason || ''));
        reasonBox.appendChild(item);
    });

    const fields = document.getElementById('document-update-fields');
    fields.replaceChildren();
    requestedDocuments.forEach((request, index) => {
        const group = document.createElement('div');
        group.className = 'form-group';
        const label = document.createElement('label');
        label.htmlFor = `doc-upload-${index}`;
        label.textContent = `Upload corrected ${request.docType}`;
        const input = document.createElement('input');
        input.type = 'file';
        input.id = `doc-upload-${index}`;
        input.required = true;
        input.accept = request.docType === 'Identification Photo'
            ? 'image/jpeg,.jpg,.jpeg'
            : 'application/pdf,.pdf';
        const hint = document.createElement('small');
        hint.textContent = request.docType === 'Identification Photo'
            ? 'JPG/JPEG only, max 5 MB.'
            : 'PDF only, max 5 MB.';
        group.append(label, input, hint);
        fields.appendChild(group);
    });
    document.getElementById('membership-update-fields').replaceChildren();
    document.getElementById('btn-submit').innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Upload Requested Documents';
}

function renderMembershipUpdate(info) {
    updateKind = 'membership';
    requestedFields = Array.isArray(info.fields) ? info.fields : [];
    document.getElementById('update-scope-label').textContent = 'Requested Information:';
    const reasonBox = document.getElementById('reason-display');
    reasonBox.textContent = info.reason || 'Update only the fields listed below.';

    const fields = document.getElementById('membership-update-fields');
    fields.replaceChildren();
    requestedFields.forEach((field, index) => {
        const group = document.createElement('div');
        group.className = 'form-group';
        const label = document.createElement('label');
        label.htmlFor = `member-update-${index}`;
        label.textContent = field.label + (field.required ? ' *' : '');
        let input;
        if (field.type === 'select') {
            input = document.createElement('select');
            const blank = document.createElement('option');
            blank.value = '';
            blank.textContent = 'Select an option';
            input.appendChild(blank);
            (field.options || []).forEach(optionValue => {
                const option = document.createElement('option');
                option.value = optionValue;
                option.textContent = optionValue;
                input.appendChild(option);
            });
        } else {
            input = document.createElement('input');
            input.type = field.type === 'year' ? 'number' : field.type;
            if (field.type === 'year') {
                input.min = '1900';
                input.max = String(new Date().getFullYear() + 10);
                input.step = '1';
            }
        }
        input.id = `member-update-${index}`;
        input.dataset.fieldKey = field.key;
        input.required = Boolean(field.required);
        if (field.reason) {
            const reason = document.createElement('small');
            reason.className = 'field-reason';
            reason.textContent = `Requested correction: ${field.reason}`;
            group.append(label, input, reason);
        } else {
            group.append(label, input);
        }
        fields.appendChild(group);
    });
    document.getElementById('document-update-fields').replaceChildren();
    document.getElementById('btn-submit').innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Information for Review';
}

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    updateToken = params.get('token');
    
    if (!updateToken) {
        document.getElementById('error-message').textContent = "No update token provided in the URL.";
        showView('error');
        return;
    }

    try {
        let res;
        try {
            res = await sendBackendRequest({ action: 'getDocumentUpdateInfo', token: updateToken });
        } catch (documentError) {
            res = await sendBackendRequest({ action: 'getMembershipInformationUpdateInfo', token: updateToken });
        }
        document.getElementById('app-id-display').textContent = res.appId;
        if (res.kind === 'membership') renderMembershipUpdate(res);
        else renderDocumentUpdate(res);
        showView('form');
    } catch (err) {
        document.getElementById('error-message').textContent = err.message;
        showView('error');
    }
});

document.getElementById('update-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('upload-error');
    const btn = document.getElementById('btn-submit');
    errorEl.textContent = "";
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';
    try {
        if (updateKind === 'membership') {
            const values = {};
            document.querySelectorAll('#membership-update-fields [data-field-key]').forEach(input => {
                values[input.dataset.fieldKey] = input.value.trim();
            });
            await sendBackendRequest({
                action: 'submitMembershipInformationUpdate',
                token: updateToken,
                values
            });
            document.getElementById('success-view').querySelector('h3').textContent = 'Information Submitted for Review';
            document.getElementById('success-view').querySelectorAll('p')[0].textContent =
                'Your information has been securely submitted. It will not replace your existing membership information until an administrator reviews and approves it.';
        } else {
            const files = {};
            let totalBytes = 0;
            for (let index = 0; index < requestedDocuments.length; index++) {
                const request = requestedDocuments[index];
                const input = document.getElementById(`doc-upload-${index}`);
                const file = input.files && input.files[0];
                if (!file) throw new Error(`Please select the corrected ${request.docType}.`);
                if (file.size > 5 * 1024 * 1024) throw new Error(`${request.docType} exceeds the 5 MB limit.`);
                totalBytes += file.size;
                const isPhoto = request.docType === 'Identification Photo';
                const lowerName = file.name.toLowerCase();
                const isJpg = file.type.includes('image/jpeg') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg');
                const isPdf = file.type.includes('application/pdf') || lowerName.endsWith('.pdf');
                if (isPhoto && !isJpg) throw new Error('Identification Photo must be a JPG/JPEG image.');
                if (!isPhoto && !isPdf) throw new Error(`${request.docType} must be a PDF file.`);
                files[request.docType] = {
                    name: file.name,
                    type: file.type,
                    content: await fileAsBase64(file)
                };
            }
            if (totalBytes > 15 * 1024 * 1024) throw new Error('Total document size exceeds the 15 MB limit.');
            await sendBackendRequest({
                action: 'submitDocumentUpdate',
                token: updateToken,
                files
            });
            document.getElementById('success-view').querySelector('h3').textContent = 'Documents Received Successfully';
            document.getElementById('success-view').querySelectorAll('p')[0].textContent =
                'All requested corrected documents have been securely received and attached to your application.';
        }
        showView('success');
    } catch (err) {
        errorEl.textContent = err.message || 'Unable to submit the update.';
        btn.disabled = false;
        btn.innerHTML = updateKind === 'membership'
            ? '<i class="fa-solid fa-paper-plane"></i> Submit Information for Review'
            : '<i class="fa-solid fa-cloud-arrow-up"></i> Upload Requested Documents';
    }
});
