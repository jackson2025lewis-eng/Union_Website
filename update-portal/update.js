const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx65PRCECX0_xq-N9cpygnhG24rC0cYfW7V5PCYNMjEDmDSg9zuv3Mfy75QYeEtoLbfGw/exec';
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
        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch (parseErr) {
            console.error("Non-JSON backend response:", text);
            if (text.includes("<!DOCTYPE") || text.includes("<html")) {
                throw new Error("Unable to connect to Google Apps Script. Please verify the Web App deployment access settings.");
            }
            throw new Error(text || "Invalid response format from server.");
        }
        if (!result.success) throw new Error(result.message || "Request failed.");
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
        const isPhoto = (expectedDocType === 'Identification Photo' || expectedDocType === 'Passport Photo');
        if (isPhoto) {
            document.getElementById('file-hint').textContent = 'JPG/JPEG only, max 5MB.';
            document.getElementById('replacement-file').accept = 'image/jpeg, image/jpg, .jpg, .jpeg';
        } else {
            document.getElementById('file-hint').textContent = 'PDF only, max 5MB.';
            document.getElementById('replacement-file').accept = 'application/pdf, .pdf';
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
    
    const isPhoto = (expectedDocType === 'Identification Photo' || expectedDocType === 'Passport Photo');
    const isJpg = file.type.includes('image/jpeg') || file.type.includes('image/jpg') || file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg');
    const isPdf = file.type.includes('application/pdf') || file.name.toLowerCase().endsWith('.pdf');
    
    if (isPhoto && !isJpg) {
        errorEl.textContent = "Identification Photo must be a JPG/JPEG image.";
        return;
    } else if (!isPhoto && !isPdf) {
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
