const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby-5lgnRpg0hSmcdq_GTGNv43cHzKsCWZJLSeU10ofbFyccg1868xgj6B37KfS_plv7/exec';
let updateToken = null;
let expectedDocType = null;

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
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!result.success) throw new Error(result.message);
        return result;
    } catch (error) {
        throw new Error(error.message || 'Network error.');
    }
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
        const res = await sendBackendRequest({ action: 'getDocumentUpdateInfo', token: updateToken });
        
        document.getElementById('app-id-display').textContent = res.appId;
        document.getElementById('doc-type-display').textContent = res.docType;
        document.getElementById('reason-display').textContent = res.reason;
        expectedDocType = res.docType;
        
        // Update file hint based on type
        if (expectedDocType === 'Passport Photo') {
            document.getElementById('file-hint').textContent = 'JPG/JPEG only, max 5MB.';
            document.getElementById('replacement-file').accept = 'image/jpeg, image/jpg';
        } else {
            document.getElementById('file-hint').textContent = 'PDF only, max 5MB.';
            document.getElementById('replacement-file').accept = 'application/pdf';
        }
        
        showView('form');
    } catch (err) {
        document.getElementById('error-message').textContent = err.message;
        showView('error');
    }
});

document.getElementById('update-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('replacement-file');
    const errorEl = document.getElementById('upload-error');
    const btn = document.getElementById('btn-submit');
    
    if (!fileInput.files || fileInput.files.length === 0) {
        errorEl.textContent = "Please select a file to upload.";
        return;
    }
    
    const file = fileInput.files[0];
    
    // Validate file
    if (file.size > 5 * 1024 * 1024) {
        errorEl.textContent = "File exceeds 5MB limit.";
        return;
    }
    
    if (expectedDocType === 'Passport Photo' && !file.type.includes('image/jpeg')) {
        errorEl.textContent = "Passport Photo must be a JPG/JPEG image.";
        return;
    } else if (expectedDocType !== 'Passport Photo' && !file.type.includes('application/pdf')) {
        errorEl.textContent = "Document must be a PDF file.";
        return;
    }

    errorEl.textContent = "";
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';
    
    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            const base64Data = event.target.result.split(',')[1];
            
            await sendBackendRequest({
                action: 'submitDocumentUpdate',
                token: updateToken,
                file: {
                    name: file.name,
                    type: file.type,
                    content: base64Data
                }
            });
            
            showView('success');
        } catch (err) {
            errorEl.textContent = err.message;
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Upload Replacement Document';
        }
    };
    reader.onerror = () => {
        errorEl.textContent = "Error reading file.";
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Upload Replacement Document';
    };
    reader.readAsDataURL(file);
});
