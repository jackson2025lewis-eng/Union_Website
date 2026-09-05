document.addEventListener('DOMContentLoaded', () => {
    // --- State Management ---
    let currentView = 'email'; // email, otp, type, form
    let membershipType = null; // 'student' or 'alumni'
    let currentStepIndex = 0;
    let steps = []; // Will hold DOM elements of the steps for the chosen type
    let formData = {};

    // --- DOM Elements ---
    const viewEmail = document.getElementById('view-email');
    const viewOtp = document.getElementById('view-otp');
    const viewType = document.getElementById('view-type');
    const viewForm = document.getElementById('view-form');

    const emailForm = document.getElementById('email-form');
    const otpForm = document.getElementById('otp-form');
    
    const btnTypeStudent = document.getElementById('btn-type-student');
    const btnTypeAlumni = document.getElementById('btn-type-alumni');
    const btnBackType = document.querySelector('.btn-back-type');
    
    const formTitle = document.getElementById('form-title');
    const formWrapper = document.getElementById('form-wrapper');
    const progressIndicator = document.getElementById('progress-indicator');
    
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const btnSubmitFinal = document.getElementById('btn-submit-final');
    
    const stepTemplates = document.getElementById('step-templates');
    const sharedPrivacyReview = document.getElementById('shared-privacy-review');

    // --- Initialization ---
    generateYears();

    // --- Navigation Functions ---
    function showView(viewId) {
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active', 'hidden'));
        document.querySelectorAll('.view-section').forEach(el => {
            if (el.id === viewId) {
                el.classList.add('active');
            } else {
                el.classList.add('hidden');
            }
        });
    }

    const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby-5lgnRpg0hSmcdq_GTGNv43cHzKsCWZJLSeU10ofbFyccg1868xgj6B37KfS_plv7/exec';

    // Email Form Submit
    emailForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const emailInput = document.getElementById('reg-email');
        const emailError = document.getElementById('email-error');
        const submitBtn = emailForm.querySelector('button[type="submit"]');
        
        const turnstileResponse = document.querySelector('[name="cf-turnstile-response"]');
        const captchaError = document.getElementById('captcha-error');
        
        if (!emailInput.value) {
            emailError.textContent = 'Email address is required.';
            emailInput.parentElement.classList.add('has-error');
            return;
        }
        
        if (!turnstileResponse || !turnstileResponse.value) {
            captchaError.textContent = 'Please complete the CAPTCHA verification.';
            captchaError.parentElement.classList.add('has-error');
            return;
        }
        captchaError.parentElement.classList.remove('has-error');
        
        const originalBtnText = submitBtn.textContent;
        submitBtn.textContent = 'Sending verification code...';
        submitBtn.disabled = true;
        emailInput.parentElement.classList.remove('has-error');

        try {
            const response = await fetch(SCRIPT_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8'
                },
                body: JSON.stringify({
                    action: 'sendOTP',
                    email: emailInput.value
                })
            });
            
            const result = await response.json();
            
            if (result.success || result.status === 'success') {
                submitBtn.textContent = 'Verification code sent to your email.';
                formData.email = emailInput.value;
                document.getElementById('display-email').textContent = formData.email;
                
                setTimeout(() => {
                    showView('view-otp');
                    submitBtn.textContent = originalBtnText;
                    submitBtn.disabled = false;
                }, 1500);
            } else {
                throw new Error(result.message || 'Failed to send OTP.');
            }
        } catch (error) {
            emailError.textContent = error.message || 'An error occurred. Please try again.';
            emailInput.parentElement.classList.add('has-error');
            submitBtn.textContent = originalBtnText;
            submitBtn.disabled = false;
        }
    });

    // OTP Form Submit
    otpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const otpInput = document.getElementById('reg-otp');
        const otpError = document.getElementById('otp-error-msg');
        const submitBtn = otpForm.querySelector('button[type="submit"]');
        
        const originalBtnText = submitBtn.textContent;
        submitBtn.textContent = 'Verifying...';
        submitBtn.disabled = true;
        otpInput.parentElement.classList.remove('has-error');

        try {
            const response = await fetch(SCRIPT_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8'
                },
                body: JSON.stringify({
                    action: 'verifyOTP',
                    email: formData.email,
                    otp: otpInput.value
                })
            });
            
            const result = await response.json();
            
            if (result.success || result.status === 'success') {
                showView('view-type');
                submitBtn.textContent = originalBtnText;
                submitBtn.disabled = false;
            } else {
                throw new Error(result.message || 'Invalid OTP.');
            }
        } catch (error) {
            otpError.textContent = error.message || 'An error occurred during verification.';
            otpInput.parentElement.classList.add('has-error');
            submitBtn.textContent = originalBtnText;
            submitBtn.disabled = false;
        }
    });

    document.getElementById('btn-back-email').addEventListener('click', () => {
        showView('view-email');
    });

    // Type Selection
    btnTypeStudent.addEventListener('click', () => {
        initForm('student');
    });
    
    btnTypeAlumni.addEventListener('click', () => {
        initForm('alumni');
    });

    btnBackType.addEventListener('click', () => {
        showView('view-type');
    });

    // --- Form Engine ---
    function initForm(type) {
        membershipType = type;
        currentStepIndex = 0;
        
        // Set title
        formTitle.textContent = type === 'student' ? 'CURRENT STUDENT REGISTRATION' : 'ALUMNI REGISTRATION';
        
        // Clear wrapper
        formWrapper.innerHTML = '';
        
        // Extract steps for the selected type
        const typeSteps = Array.from(stepTemplates.querySelectorAll(`.step-content[data-type="${type}"]`));
        
        // Clone the shared privacy step
        const privacyStep = sharedPrivacyReview.cloneNode(true);
        privacyStep.removeAttribute('id'); // remove ID to avoid duplicates
        // Give it the next step number
        privacyStep.dataset.step = typeSteps.length + 1;
        privacyStep.dataset.type = type;
        
        steps = [...typeSteps.map(el => el.cloneNode(true)), privacyStep];
        
        // Append all steps to wrapper but hide them
        steps.forEach((step, index) => {
            if (index !== 0) step.classList.add('hidden');
            formWrapper.appendChild(step);
        });
        
        // Re-attach year generation for dynamically added selects
        generateYears();
        
        // Re-attach validation listeners for new DOM elements
        attachValidationListeners();

        updateProgressIndicator();
        updateButtons();
        
        showView('view-form');
    }

    function generateYears() {
        const currentYear = new Date().getFullYear();
        const startYear = 1970;
        
        document.querySelectorAll('.year-select').forEach(select => {
            // Keep the placeholder if it exists, clear other options
            const placeholder = select.querySelector('option[disabled]');
            select.innerHTML = '';
            if (placeholder) select.appendChild(placeholder);
            
            for (let y = currentYear; y >= startYear; y--) {
                const option = document.createElement('option');
                option.value = y;
                option.textContent = y;
                select.appendChild(option);
            }
        });
    }

    function updateProgressIndicator() {
        progressIndicator.innerHTML = '';
        
        steps.forEach((step, index) => {
            const stepDiv = document.createElement('div');
            stepDiv.className = 'progress-step';
            
            if (index < currentStepIndex) {
                stepDiv.classList.add('completed');
            } else if (index === currentStepIndex) {
                stepDiv.classList.add('active');
            }
            
            const dot = document.createElement('div');
            dot.className = 'step-dot';
            dot.textContent = index < currentStepIndex ? '' : index + 1;
            
            const label = document.createElement('div');
            label.className = 'step-label';
            label.textContent = step.dataset.label;
            
            stepDiv.appendChild(dot);
            stepDiv.appendChild(label);
            progressIndicator.appendChild(stepDiv);
        });
    }

    function updateButtons() {
        // Toggle Prev button
        btnPrev.classList.toggle('hidden', currentStepIndex === 0);
        
        // Toggle Next / Submit buttons
        if (currentStepIndex === steps.length - 1) {
            btnNext.classList.add('hidden');
            btnSubmitFinal.classList.remove('hidden');
            generateReview(); // Populate review data when on last step
        } else {
            btnNext.classList.remove('hidden');
            btnSubmitFinal.classList.add('hidden');
        }
    }

    // --- Validation ---
    function validateCurrentStep() {
        const currentStepEl = steps[currentStepIndex];
        const inputs = currentStepEl.querySelectorAll('input[required], select[required]');
        let isValid = true;
        
        // Clear previous errors
        currentStepEl.querySelectorAll('.form-group').forEach(group => group.classList.remove('has-error'));
        
        inputs.forEach(input => {
            if (!input.checkValidity()) {
                isValid = false;
                input.closest('.form-group').classList.add('has-error');
            } else {
                // Custom validations
                if (input.name === 'studyTo') {
                    const fromSelect = currentStepEl.querySelector('select[name="studyFrom"]');
                    if (fromSelect && fromSelect.value && input.value) {
                        if (parseInt(input.value) < parseInt(fromSelect.value)) {
                            isValid = false;
                            input.closest('.form-group').classList.add('has-error');
                            const errorMsg = currentStepEl.querySelector(`#${membershipType === 'student' ? 's' : 'a'}-duration-error`);
                            if (errorMsg) errorMsg.textContent = 'The end year cannot be earlier than the start year.';
                        }
                    }
                }
                
                if (input.name === 'efro' && input.files.length > 0) {
                    const file = input.files[0];
                    if (file.type !== 'application/pdf') {
                        isValid = false;
                        input.closest('.form-group').classList.add('has-error');
                    }
                }
                
                if (input.name === 'passportPhoto' && input.files.length > 0) {
                    const file = input.files[0];
                    if (file.type !== 'image/jpeg' && file.type !== 'image/jpg') {
                        isValid = false;
                        input.closest('.form-group').classList.add('has-error');
                    }
                }

                if (input.name === 'privacyConsent' && !input.checked) {
                    isValid = false;
                    input.closest('.form-group').classList.add('has-error');
                }
            }
        });
        
        return isValid;
    }

    function attachValidationListeners() {
        const formInputs = formWrapper.querySelectorAll('input, select');
        formInputs.forEach(input => {
            input.addEventListener('change', () => {
                if (input.checkValidity()) {
                    input.closest('.form-group').classList.remove('has-error');
                }
            });
            input.addEventListener('input', () => {
                if (input.checkValidity()) {
                    input.closest('.form-group').classList.remove('has-error');
                }
            });
        });
    }

    // --- Navigation Handlers ---
    btnNext.addEventListener('click', () => {
        if (validateCurrentStep()) {
            // Save data for review page
            collectFormData();
            
            steps[currentStepIndex].classList.add('hidden');
            currentStepIndex++;
            steps[currentStepIndex].classList.remove('hidden');
            
            updateProgressIndicator();
            updateButtons();
            
            // Scroll to top of card
            viewForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });

    btnPrev.addEventListener('click', () => {
        steps[currentStepIndex].classList.add('hidden');
        currentStepIndex--;
        steps[currentStepIndex].classList.remove('hidden');
        
        updateProgressIndicator();
        updateButtons();
        
        viewForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    function getBase64(file) {
        return new Promise((resolve, reject) => {
            if (!file) {
                resolve(null);
                return;
            }
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve({
                name: file.name,
                type: file.type,
                content: reader.result.split(',')[1]
            });
            reader.onerror = error => reject(error);
        });
    }

    btnSubmitFinal.addEventListener('click', async () => {
        if (validateCurrentStep()) {
            collectFormData();
            
            const submitBtn = btnSubmitFinal;
            const originalBtnText = submitBtn.textContent;
            submitBtn.textContent = 'Submitting...';
            submitBtn.disabled = true;

            try {
                // Get files
                let efroFileObj = null;
                let passportPhotoObj = null;
                
                const efroInput = formWrapper.querySelector('input[name="efro"]');
                if (efroInput && efroInput.files.length > 0) {
                    efroFileObj = await getBase64(efroInput.files[0]);
                }
                
                const passportInput = formWrapper.querySelector('input[name="passportPhoto"]');
                if (passportInput && passportInput.files.length > 0) {
                    passportPhotoObj = await getBase64(passportInput.files[0]);
                }

                const payload = {
                    action: 'submitApplication',
                    data: {
                        "Membership Type": membershipType === 'student' ? 'CURRENT STUDENT' : 'ALUMNI',
                        "First Name": formData.firstName || '',
                        "Middle Name": formData.middleName || '',
                        "Last Name": formData.lastName || '',
                        "Gender": formData.gender || '',
                        "Position / Role": formData.membershipStatusRole || formData.alumniPositionRole || '',
                        "WhatsApp Number": formData.whatsappNumber || '',
                        "Mobile Number": formData.mobileNumber || '',
                        "Passport Number": formData.passportNumber || '',
                        "College Registration Number": formData.collegeRegistrationNumber || '',
                        "University": formData.university || '',
                        "Degree Type": formData.degreeType || '',
                        "Study From": formData.studyFrom || '',
                        "Study To": formData.studyTo || '',
                        "Field of Studies": formData.fieldOfStudies || '',
                        "Mother Name": formData.motherName || '',
                        "Father Name": formData.fatherName || '',
                        "Parents Contact": formData.parentsContact || '',
                        "Graduation Date": formData.graduationDate || '',
                        "Privacy Consent": formData.privacyConsent ? 'Yes' : 'No',
                        "Email": formData.email // Added verified email implicitly if needed
                    },
                    efroFile: efroFileObj,
                    passportPhoto: passportPhotoObj
                };

                const response = await fetch(SCRIPT_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'text/plain;charset=utf-8'
                    },
                    body: JSON.stringify(payload)
                });
                
                const result = await response.json();
                
                if (result.success || result.status === 'success') {
                    // Show confirmation
                    formWrapper.innerHTML = `
                        <div class="card" style="text-align: center; padding: 40px; margin-top: 20px;">
                            <i class="fa-solid fa-circle-check" style="font-size: 4rem; color: #10b981; margin-bottom: 20px;"></i>
                            <h2 style="color: #10b981; margin-bottom: 15px;">Application Submitted!</h2>
                            <p style="font-size: 1.1rem; color: var(--text-main); line-height: 1.6;">
                                Your membership application has been successfully submitted and is currently under review. Please check your email for confirmation and further instructions.
                            </p>
                            <button class="btn-primary" style="margin-top: 30px;" onclick="window.location.href='../index.html'">Return to Home</button>
                        </div>
                    `;
                    // Hide the footer buttons
                    const nav = document.querySelector('.form-navigation');
                    if(nav) nav.style.display = 'none';
                    if(progressIndicator) progressIndicator.style.display = 'none';
                    if(formTitle) formTitle.style.display = 'none';
                    
                    // Scroll to top
                    viewForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                    throw new Error(result.message || 'Submission rejected by server.');
                }
            } catch (error) {
                alert('Error submitting application: ' + error.message);
                submitBtn.textContent = originalBtnText;
                submitBtn.disabled = false;
            }
        }
    });

    // --- Data Collection and Review ---
    function collectFormData() {
        const inputs = formWrapper.querySelectorAll('input:not([type="file"]):not([type="checkbox"]), select');
        inputs.forEach(input => {
            formData[input.name] = input.value;
        });
        
        // Handle files (just store names for review)
        const fileInputs = formWrapper.querySelectorAll('input[type="file"]');
        fileInputs.forEach(input => {
            if (input.files.length > 0) {
                formData[input.name] = input.files[0].name;
            }
        });

        const privacyConsent = formWrapper.querySelector('input[name="privacyConsent"]');
        if (privacyConsent) {
            formData['privacyConsent'] = privacyConsent.checked;
        }
    }

    function generateReview() {
        const reviewContainer = formWrapper.querySelector('#review-content');
        if (!reviewContainer) return;
        
        let html = '';
        
        // Personal
        html += `
        <div class="review-section">
            <h4>Personal Information</h4>
            <div class="review-item"><div class="review-label">First Name:</div><div class="review-value">${formData.firstName || ''}</div></div>
            ${formData.middleName ? `<div class="review-item"><div class="review-label">Middle Name:</div><div class="review-value">${formData.middleName}</div></div>` : ''}
            <div class="review-item"><div class="review-label">Last Name:</div><div class="review-value">${formData.lastName || ''}</div></div>
            <div class="review-item"><div class="review-label">Gender:</div><div class="review-value">${formData.gender || ''}</div></div>
        </div>
        `;
        
        // Membership or Organization
        if (membershipType === 'student') {
            html += `
            <div class="review-section">
                <h4>Membership Information</h4>
                <div class="review-item"><div class="review-label">Membership Status:</div><div class="review-value">${formData.membershipStatusRole || ''}</div></div>
                <div class="review-item"><div class="review-label">WhatsApp:</div><div class="review-value">${formData.whatsappNumber || ''}</div></div>
                <div class="review-item"><div class="review-label">Mobile:</div><div class="review-value">${formData.mobileNumber || ''}</div></div>
                <div class="review-item"><div class="review-label">Passport Number:</div><div class="review-value">${formData.passportNumber || ''}</div></div>
                <div class="review-item"><div class="review-label">College Reg No:</div><div class="review-value">${formData.collegeRegistrationNumber || ''}</div></div>
            </div>
            `;
        } else {
            html += `
            <div class="review-section">
                <h4>Organization Information</h4>
                <div class="review-item"><div class="review-label">Alumni Position Served:</div><div class="review-value">${formData.alumniPositionRole || ''}</div></div>
            </div>
            `;
        }
        
        // Academic
        html += `
        <div class="review-section">
            <h4>Academic Information</h4>
            <div class="review-item"><div class="review-label">University:</div><div class="review-value">${formData.university || ''}</div></div>
            ${formData.graduationDate ? `<div class="review-item"><div class="review-label">Graduation Date:</div><div class="review-value">${formData.graduationDate}</div></div>` : ''}
            <div class="review-item"><div class="review-label">Degree Type:</div><div class="review-value">${formData.degreeType || ''}</div></div>
            <div class="review-item"><div class="review-label">Duration:</div><div class="review-value">${formData.studyFrom || ''} – ${formData.studyTo || ''}</div></div>
            <div class="review-item"><div class="review-label">Field of Studies:</div><div class="review-value">${formData.fieldOfStudies || ''}</div></div>
        </div>
        `;

        if (membershipType === 'student') {
            html += `
            <div class="review-section">
                <h4>Parent / Family Information</h4>
                <div class="review-item"><div class="review-label">Mother's Name:</div><div class="review-value">${formData.motherName || ''}</div></div>
                <div class="review-item"><div class="review-label">Father's Name:</div><div class="review-value">${formData.fatherName || ''}</div></div>
                <div class="review-item"><div class="review-label">Parents' Contact:</div><div class="review-value">${formData.parentsContact || ''}</div></div>
            </div>
            `;
        }
        
        // Documents
        html += `
        <div class="review-section">
            <h4>Documents</h4>
            ${formData.efro ? `<div class="review-item"><div class="review-label">EFRO:</div><div class="review-value">Uploaded (${formData.efro})</div></div>` : ''}
            ${formData.passportPhoto ? `<div class="review-item"><div class="review-label">Passport Photograph:</div><div class="review-value">Uploaded (${formData.passportPhoto})</div></div>` : ''}
        </div>
        `;
        
        // Privacy
        html += `
        <div class="review-section">
            <h4>Privacy</h4>
            <div class="review-item"><div class="review-label">Consent:</div><div class="review-value" style="color: var(--success-color); font-weight: 600;">✓ Privacy notice accepted</div></div>
        </div>
        `;
        
        reviewContainer.innerHTML = html;
    }
});
