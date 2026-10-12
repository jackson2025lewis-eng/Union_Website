/**
 * ============================================================================
 * LSUO Pay Your Dues Portal - Backend Integration Controller
 * Complete connection to LSU Dues Payment Add-on Backend
 * ============================================================================
 */

(function () {
  'use strict';

  const BACKEND_URL = '/api/backend';
  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzZyI7gERGia6KDLpN_cp-S2OL4Tr7eOVL0vo9lWC3MILFJIIaVqjLs7jPG3Lpd_T_YIg/exec';

  // --------------------------------------------------------------------------
  // Backend Communication Helper
  // --------------------------------------------------------------------------
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
      } catch (e) {
        throw new Error('Invalid server response: ' + text);
      }
      if (!response.ok && !result.success) {
        throw new Error(result.message || 'Backend request failed.');
      }
      return result;
    } catch (err) {
      // Direct resilient fallback to Apps Script URL if running outside Vercel proxy
      try {
        const fbResponse = await fetch(SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
        const fbText = await fbResponse.text();
        return JSON.parse(fbText);
      } catch (fbErr) {
        return { success: false, message: 'Network error: Unable to connect to LSU backend.' };
      }
    }
  }

  // Helper: Extract valid email string
  function extractEmail(str) {
    if (!str) return '';
    const match = String(str).trim().match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    return match ? match[0].toLowerCase() : '';
  }

  // --------------------------------------------------------------------------
  // Application State
  // --------------------------------------------------------------------------
  const state = {
    memberSessionToken: sessionStorage.getItem('lsuDueMemberSessionToken') || null,
    payer: null, // { email, name, membershipId }
    paymentChoice: 'PAY_MY_DUES', // 'PAY_MY_DUES' | 'PAY_FOR_OTHER_MEMBERS'
    otherMemberCount: 1,
    verifiedMembers: [], // [ { email, name, membershipId, amount } ]
    selectedMethod: 'ONLINE / UPI', // 'ONLINE / UPI' | 'CASH'
    adminSessionToken: sessionStorage.getItem('lsuPaymentAdminSessionToken') || null,
    pendingPayments: [],
    currentRejectingPaymentId: null
  };

  document.addEventListener('DOMContentLoaded', () => {
    // ------------------------------------------------------------------------
    // Navigation & Mobile Sidebar Drawer
    // ------------------------------------------------------------------------
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    function toggleSidebar() {
      if (sidebar && sidebarOverlay) {
        sidebar.classList.toggle('open');
        sidebarOverlay.classList.toggle('active');
      }
    }

    if (hamburgerBtn) hamburgerBtn.addEventListener('click', toggleSidebar);
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', toggleSidebar);

    const chaptersDropdown = document.getElementById('chaptersDropdown');
    if (chaptersDropdown) {
      const btn = chaptersDropdown.querySelector('.nav-dropdown-btn');
      if (btn) {
        btn.addEventListener('click', () => {
          chaptersDropdown.classList.toggle('open');
        });
      }
    }

    // ------------------------------------------------------------------------
    // View Switcher (One step at a time)
    // ------------------------------------------------------------------------
    const allViews = document.querySelectorAll('.dues-view-section');

    function showView(viewId) {
      allViews.forEach((view) => {
        view.classList.remove('active');
        view.style.display = 'none';
      });

      const targetView = document.getElementById(viewId);
      if (targetView) {
        targetView.style.display = 'block';
        setTimeout(() => {
          targetView.classList.add('active');
        }, 10);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }

    function showError(elementId, message) {
      const el = document.getElementById(elementId);
      if (el) {
        el.textContent = message;
        el.style.display = 'block';
      }
    }

    function clearError(elementId) {
      const el = document.getElementById(elementId);
      if (el) {
        el.textContent = '';
        el.style.display = 'none';
      }
    }

    // ------------------------------------------------------------------------
    // Step 1: Member Login - Send OTP (Action: sendDueOTP)
    // ------------------------------------------------------------------------
    const inputMemberEmail = document.getElementById('dues-member-email');
    const btnSendOtp = document.getElementById('btn-dues-send-otp');
    const displayMemberEmail = document.getElementById('dues-display-member-email');

    if (btnSendOtp) {
      btnSendOtp.addEventListener('click', async () => {
        clearError('dues-email-error');
        const email = extractEmail(inputMemberEmail.value);
        if (!email) {
          showError('dues-email-error', 'Please enter a valid registered email address.');
          return;
        }

        btnSendOtp.disabled = true;
        const originalText = btnSendOtp.innerHTML;
        btnSendOtp.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending OTP...';

        const result = await sendBackendRequest({
          action: 'sendDueOTP',
          email: email
        });

        btnSendOtp.disabled = false;
        btnSendOtp.innerHTML = originalText;

        if (result && result.success) {
          if (displayMemberEmail) displayMemberEmail.textContent = email;
          showView('view-dues-otp');
        } else {
          showError('dues-email-error', result.message || 'Unable to send OTP. Please confirm you are a confirmed LSU member.');
        }
      });
    }

    // ------------------------------------------------------------------------
    // Step 1B: Member Login - Verify OTP (Action: verifyDueOTP)
    // ------------------------------------------------------------------------
    const inputMemberOtp = document.getElementById('dues-member-otp');
    const btnVerifyOtp = document.getElementById('btn-dues-verify-otp');
    const btnBackToEmail = document.getElementById('btn-dues-back-to-email');

    if (btnVerifyOtp) {
      btnVerifyOtp.addEventListener('click', async () => {
        clearError('dues-otp-error');
        const email = extractEmail(inputMemberEmail.value);
        const otp = String(inputMemberOtp.value || '').trim().toUpperCase();

        if (!otp || otp.length < 4) {
          showError('dues-otp-error', 'Please enter a valid OTP code (e.g. DUE527).');
          return;
        }

        btnVerifyOtp.disabled = true;
        const originalText = btnVerifyOtp.innerHTML;
        btnVerifyOtp.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';

        const result = await sendBackendRequest({
          action: 'verifyDueOTP',
          email: email,
          otp: otp
        });

        btnVerifyOtp.disabled = false;
        btnVerifyOtp.innerHTML = originalText;

        if (result && result.success && result.sessionToken) {
          state.memberSessionToken = result.sessionToken;
          sessionStorage.setItem('lsuDueMemberSessionToken', result.sessionToken);
          state.payer = result.member || { email: email, name: email, membershipId: 'LSU-MEMBER' };
          
          showView('view-dues-choice');
        } else {
          showError('dues-otp-error', result.message || 'Invalid or expired OTP code.');
        }
      });
    }

    if (btnBackToEmail) {
      btnBackToEmail.addEventListener('click', () => {
        showView('view-dues-email');
      });
    }

    // ------------------------------------------------------------------------
    // Step 2: Payment Choice (Pay My Dues vs Pay for Other Members)
    // ------------------------------------------------------------------------
    const btnPayMyDues = document.getElementById('btn-pay-my-dues');
    const btnPayOtherMembers = document.getElementById('btn-pay-other-members');
    const btnBackToOtp = document.getElementById('btn-dues-back-to-otp');

    if (btnPayMyDues) {
      btnPayMyDues.addEventListener('click', () => {
        state.paymentChoice = 'PAY_MY_DUES';
        
        // Setup self-amount view
        const selfName = document.getElementById('self-member-name');
        const selfEmail = document.getElementById('self-member-email');
        const selfId = document.getElementById('self-member-id');
        const selfAmountInput = document.getElementById('self-dues-amount-input');

        if (selfName && state.payer) selfName.textContent = state.payer.name;
        if (selfEmail && state.payer) selfEmail.textContent = state.payer.email;
        if (selfId && state.payer) selfId.textContent = state.payer.membershipId || 'Full Member';
        if (selfAmountInput && !selfAmountInput.value) selfAmountInput.value = '';

        showView('view-dues-self-amount');
      });
    }

    if (btnPayOtherMembers) {
      btnPayOtherMembers.addEventListener('click', () => {
        state.paymentChoice = 'PAY_FOR_OTHER_MEMBERS';
        showView('view-dues-others');
      });
    }

    if (btnBackToOtp) {
      btnBackToOtp.addEventListener('click', () => {
        showView('view-dues-otp');
      });
    }

    // ------------------------------------------------------------------------
    // Step 2B: Self Amount Submission
    // ------------------------------------------------------------------------
    const selfAmountInput = document.getElementById('self-dues-amount-input');
    const btnSelfContinue = document.getElementById('btn-self-continue-to-payment');
    const btnSelfBack = document.getElementById('btn-self-back-to-choice');

    if (btnSelfContinue) {
      btnSelfContinue.addEventListener('click', () => {
        clearError('self-amount-error');
        const amount = Number(selfAmountInput.value);
        if (!amount || isNaN(amount) || amount <= 0) {
          showError('self-amount-error', 'Please enter a valid payment amount greater than zero.');
          return;
        }

        state.verifiedMembers = [
          {
            email: state.payer.email,
            name: state.payer.name,
            membershipId: state.payer.membershipId || '',
            amount: amount
          }
        ];

        renderPaymentSummary();
        showView('view-dues-payment');
      });
    }

    if (btnSelfBack) {
      btnSelfBack.addEventListener('click', () => {
        showView('view-dues-choice');
      });
    }

    // ------------------------------------------------------------------------
    // Step 3: Pay for Other Members (Verification & Amount Entry)
    // ------------------------------------------------------------------------
    const btnCountOne = document.getElementById('btn-count-one');
    const btnCountTwo = document.getElementById('btn-count-two');
    const cardMember2 = document.getElementById('card-other-member-2');

    if (btnCountOne && btnCountTwo && cardMember2) {
      btnCountOne.addEventListener('click', () => {
        btnCountOne.classList.add('active');
        btnCountTwo.classList.remove('active');
        cardMember2.style.display = 'none';
        state.otherMemberCount = 1;
      });

      btnCountTwo.addEventListener('click', () => {
        btnCountTwo.classList.add('active');
        btnCountOne.classList.remove('active');
        cardMember2.style.display = 'block';
        state.otherMemberCount = 2;
      });
    }

    // Verified data cache for other members
    const otherMembersData = {
      1: null,
      2: null
    };

    async function verifyOtherMember(index) {
      clearError(`error-member-${index}`);
      clearError('dues-others-general-error');
      
      const emailInput = document.getElementById(`dues-other-email-${index}`);
      const btnVerify = document.getElementById(`btn-verify-member-${index}`);
      const badge = document.getElementById(`badge-member-${index}`);
      const nameEl = document.getElementById(`name-member-${index}`);
      const idEl = document.getElementById(`id-member-${index}`);

      const email = extractEmail(emailInput.value);
      if (!email) {
        showError(`error-member-${index}`, 'Please enter a registered member email address.');
        return false;
      }

      // Disallow payer email
      if (state.payer && email === extractEmail(state.payer.email)) {
        showError(`error-member-${index}`, 'Payer cannot be added under "Pay for Other Members". Use "Pay My Dues" instead.');
        return false;
      }

      // Disallow duplicate member email
      const otherIndex = index === 1 ? 2 : 1;
      const otherEmailInput = document.getElementById(`dues-other-email-${otherIndex}`);
      if (state.otherMemberCount === 2 && otherEmailInput && extractEmail(otherEmailInput.value) === email) {
        showError(`error-member-${index}`, 'Duplicate member emails are not allowed.');
        return false;
      }

      if (btnVerify) {
        btnVerify.disabled = true;
        btnVerify.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking...';
      }

      const result = await sendBackendRequest({
        action: 'getDuePaymentData',
        sessionToken: state.memberSessionToken,
        targetEmail: email
      });

      if (btnVerify) {
        btnVerify.disabled = false;
        btnVerify.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Verify';
      }

      if (result && result.success && result.member) {
        otherMembersData[index] = result.member;
        if (nameEl) nameEl.textContent = result.member.name;
        if (idEl) idEl.textContent = result.member.membershipId || 'Full Member';
        if (badge) badge.style.display = 'flex';
        return true;
      } else {
        otherMembersData[index] = null;
        if (badge) badge.style.display = 'none';
        showError(
          `error-member-${index}`,
          result.message || 'This member cannot be added because this email address is not associated with a registered full LSU member.'
        );
        return false;
      }
    }

    document.getElementById('btn-verify-member-1')?.addEventListener('click', () => verifyOtherMember(1));
    document.getElementById('btn-verify-member-2')?.addEventListener('click', () => verifyOtherMember(2));

    const btnDuesContinueToPayment = document.getElementById('btn-dues-continue-to-payment');
    const btnDuesBackToChoice = document.getElementById('btn-dues-back-to-choice');

    if (btnDuesContinueToPayment) {
      btnDuesContinueToPayment.addEventListener('click', async () => {
        clearError('dues-others-general-error');

        // Verify Member 1
        if (!otherMembersData[1]) {
          const ok1 = await verifyOtherMember(1);
          if (!ok1) return;
        }

        const amt1 = Number(document.getElementById('dues-other-amount-1').value);
        if (!amt1 || isNaN(amt1) || amt1 <= 0) {
          showError('dues-others-general-error', 'Please enter a valid amount for Member 1.');
          return;
        }

        const members = [
          {
            email: otherMembersData[1].email,
            name: otherMembersData[1].name,
            membershipId: otherMembersData[1].membershipId || '',
            amount: amt1
          }
        ];

        // If Two Persons
        if (state.otherMemberCount === 2) {
          if (!otherMembersData[2]) {
            const ok2 = await verifyOtherMember(2);
            if (!ok2) return;
          }

          const amt2 = Number(document.getElementById('dues-other-amount-2').value);
          if (!amt2 || isNaN(amt2) || amt2 <= 0) {
            showError('dues-others-general-error', 'Please enter a valid amount for Member 2.');
            return;
          }

          members.push({
            email: otherMembersData[2].email,
            name: otherMembersData[2].name,
            membershipId: otherMembersData[2].membershipId || '',
            amount: amt2
          });
        }

        state.verifiedMembers = members;
        renderPaymentSummary();
        showView('view-dues-payment');
      });
    }

    if (btnDuesBackToChoice) {
      btnDuesBackToChoice.addEventListener('click', () => {
        showView('view-dues-choice');
      });
    }

    // ------------------------------------------------------------------------
    // Step 4: Render Payment Summary & Update Totals
    // ------------------------------------------------------------------------
    function renderPaymentSummary() {
      const payerDisplay = document.getElementById('summary-payer-display');
      const membersContainer = document.getElementById('summary-members-container');
      const totalDisplay = document.getElementById('summary-total-display');
      const onlineTotalCallout = document.getElementById('online-total-callout');
      const cashTotalCallout = document.getElementById('cash-total-callout');

      if (payerDisplay && state.payer) {
        payerDisplay.textContent = `${state.payer.name} (${state.payer.email})${state.payer.membershipId ? ' - ' + state.payer.membershipId : ''}`;
      }

      let total = 0;
      if (membersContainer) {
        membersContainer.innerHTML = '';
        state.verifiedMembers.forEach((m) => {
          total += Number(m.amount) || 0;
          const row = document.createElement('div');
          row.className = 'dues-summary-member-row';
          row.innerHTML = `
            <div class="dues-summary-member-info">
              <span class="dues-summary-member-name">${m.name}</span>
              <span class="dues-summary-member-email">${m.email}${m.membershipId ? ' | ID: ' + m.membershipId : ''}</span>
            </div>
            <div class="dues-summary-member-amount">₹${Number(m.amount).toFixed(2)}</div>
          `;
          membersContainer.appendChild(row);
        });
      }

      const formattedTotal = `₹${total.toFixed(2)}`;
      if (totalDisplay) totalDisplay.textContent = formattedTotal;
      if (onlineTotalCallout) onlineTotalCallout.textContent = formattedTotal;
      if (cashTotalCallout) cashTotalCallout.textContent = formattedTotal;
    }

    // ------------------------------------------------------------------------
    // Step 5: Payment Method Tabs (Online / UPI vs Cash)
    // ------------------------------------------------------------------------
    const btnMethodOnline = document.getElementById('btn-method-online');
    const btnMethodCash = document.getElementById('btn-method-cash');
    const formOnlineSection = document.getElementById('form-online-upi-section');
    const formCashSection = document.getElementById('form-cash-section');
    const btnDuesBackFromPayment = document.getElementById('btn-dues-back-from-payment');
    const btnDuesBackFromCash = document.getElementById('btn-dues-back-from-cash');

    if (btnMethodOnline && btnMethodCash && formOnlineSection && formCashSection) {
      btnMethodOnline.addEventListener('click', () => {
        btnMethodOnline.classList.add('active');
        btnMethodCash.classList.remove('active');
        formOnlineSection.style.display = 'block';
        formCashSection.style.display = 'none';
        state.selectedMethod = 'ONLINE / UPI';
      });

      btnMethodCash.addEventListener('click', () => {
        btnMethodCash.classList.add('active');
        btnMethodOnline.classList.remove('active');
        formCashSection.style.display = 'block';
        formOnlineSection.style.display = 'none';
        state.selectedMethod = 'CASH';
      });
    }

    function handleBackFromPayment() {
      if (state.paymentChoice === 'PAY_FOR_OTHER_MEMBERS') {
        showView('view-dues-others');
      } else {
        showView('view-dues-self-amount');
      }
    }

    if (btnDuesBackFromPayment) btnDuesBackFromPayment.addEventListener('click', handleBackFromPayment);
    if (btnDuesBackFromCash) btnDuesBackFromCash.addEventListener('click', handleBackFromPayment);

    // ------------------------------------------------------------------------
    // Step 6: Submit Payment (Action: submitDuePayment)
    // ------------------------------------------------------------------------
    const btnSubmitOnline = document.getElementById('btn-submit-online-payment');
    const btnSubmitCash = document.getElementById('btn-submit-cash-payment');

    async function handlePaymentSubmission(method) {
      const errorElId = method === 'ONLINE / UPI' ? 'dues-online-submit-error' : 'dues-cash-submit-error';
      clearError(errorElId);

      const targetBtn = method === 'ONLINE / UPI' ? btnSubmitOnline : btnSubmitCash;

      if (!state.verifiedMembers || !state.verifiedMembers.length) {
        showError(errorElId, 'No member allocations selected. Please re-enter members.');
        return;
      }

      let totalAmount = 0;
      const membersPayload = state.verifiedMembers.map((m) => {
        const amt = Number(m.amount) || 0;
        totalAmount += amt;
        return {
          email: m.email,
          amount: amt
        };
      });

      if (totalAmount <= 0) {
        showError(errorElId, 'Payment amount must be greater than zero.');
        return;
      }

      let payload = {
        action: 'submitDuePayment',
        sessionToken: state.memberSessionToken,
        requestId: 'REQ-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        paymentChoice: state.paymentChoice,
        members: membersPayload,
        totalAmount: totalAmount,
        paymentMethod: method,
        confirmed: true
      };

      if (method === 'ONLINE / UPI') {
        const upiRef = String(document.getElementById('dues-upi-ref').value || '').trim();
        const paymentDate = document.getElementById('dues-online-date').value;
        const confirmChecked = document.getElementById('dues-online-confirm').checked;

        if (!upiRef) {
          showError(errorElId, 'Please enter your UPI Ref No. / Transaction ID / UTR.');
          return;
        }
        if (!paymentDate) {
          showError(errorElId, 'Please select the payment date.');
          return;
        }
        if (!confirmChecked) {
          showError(errorElId, 'Please check the confirmation box to proceed.');
          return;
        }

        payload.upiRefNo = upiRef;
        payload.paymentDate = paymentDate;
      } else {
        const cashDate = document.getElementById('dues-cash-date').value;
        const receiverName = String(document.getElementById('dues-cash-receiver-name').value || '').trim();
        const receiverRole = String(document.getElementById('dues-cash-receiver-role').value || '').trim();
        const confirmChecked = document.getElementById('dues-cash-confirm').checked;

        if (!cashDate) {
          showError(errorElId, 'Please select the cash payment date.');
          return;
        }
        if (!receiverName) {
          showError(errorElId, 'Please enter the name of the individual who received the cash.');
          return;
        }
        if (!receiverRole) {
          showError(errorElId, 'Please enter the role/position of the individual who received the cash.');
          return;
        }
        if (!confirmChecked) {
          showError(errorElId, 'Please check the confirmation box to proceed.');
          return;
        }

        payload.paymentDate = cashDate;
        payload.cashReceiverName = receiverName;
        payload.cashReceiverPosition = receiverRole;
      }

      if (targetBtn) {
        targetBtn.disabled = true;
        targetBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting Payment...';
      }

      const result = await sendBackendRequest(payload);

      if (targetBtn) {
        targetBtn.disabled = false;
        targetBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Payment';
      }

      if (result && result.success) {
        document.getElementById('success-payment-id').textContent = result.paymentId || 'PAY-2026-PENDING';
        document.getElementById('success-total-amount').textContent = `₹${totalAmount.toFixed(2)}`;
        showView('view-dues-success');
      } else {
        showError(errorElId, result.message || 'Payment submission failed. Please try again.');
      }
    }

    if (btnSubmitOnline) btnSubmitOnline.addEventListener('click', () => handlePaymentSubmission('ONLINE / UPI'));
    if (btnSubmitCash) btnSubmitCash.addEventListener('click', () => handlePaymentSubmission('CASH'));

    // Reset flow button
    document.getElementById('btn-dues-reset-flow')?.addEventListener('click', () => {
      // Clear member session and reset
      state.verifiedMembers = [];
      otherMembersData[1] = null;
      otherMembersData[2] = null;
      showView('view-dues-email');
    });

    // ------------------------------------------------------------------------
    // Administrator Portal (4 Clicks on Logo -> sendPaymentAdminOTP)
    // ------------------------------------------------------------------------
    const duesAppLogo = document.getElementById('duesAppLogo') || document.getElementById('duesLogoLink');
    let logoClickCount = 0;
    let logoClickTimer = null;

    if (duesAppLogo) {
      duesAppLogo.addEventListener('click', (e) => {
        e.preventDefault();
        logoClickCount++;
        clearTimeout(logoClickTimer);

        if (logoClickCount >= 4) {
          logoClickCount = 0;
          showView('view-dues-admin-login');
        } else {
          logoClickTimer = setTimeout(() => {
            logoClickCount = 0;
          }, 2000);
        }
      });
    }

    const inputAdminEmail = document.getElementById('dues-admin-email');
    const btnAdminSendOtp = document.getElementById('btn-dues-admin-send-otp');
    const inputAdminOtp = document.getElementById('dues-admin-otp');
    const btnAdminVerifyOtp = document.getElementById('btn-dues-admin-verify-otp');
    const btnAdminBackToLogin = document.getElementById('btn-dues-admin-back-to-login');
    const btnAdminLogout = document.getElementById('btn-dues-admin-logout');
    const btnRefreshPending = document.getElementById('btn-refresh-pending-payments');

    // Admin Send OTP (Action: sendPaymentAdminOTP)
    if (btnAdminSendOtp) {
      btnAdminSendOtp.addEventListener('click', async () => {
        clearError('dues-admin-email-error');
        const email = extractEmail(inputAdminEmail.value);
        if (!email) {
          showError('dues-admin-email-error', 'Please enter your administrator email address.');
          return;
        }

        btnAdminSendOtp.disabled = true;
        btnAdminSendOtp.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending OTP...';

        const result = await sendBackendRequest({
          action: 'sendPaymentAdminOTP',
          email: email
        });

        btnAdminSendOtp.disabled = false;
        btnAdminSendOtp.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send OTP';

        if (result && result.success) {
          showView('view-dues-admin-otp');
        } else {
          showError('dues-admin-email-error', result.message || 'You are not authorized to access the payment administration portal.');
        }
      });
    }

    // Admin Verify OTP (Action: verifyPaymentAdminOTP)
    if (btnAdminVerifyOtp) {
      btnAdminVerifyOtp.addEventListener('click', async () => {
        clearError('dues-admin-otp-error');
        const email = extractEmail(inputAdminEmail.value);
        const otp = String(inputAdminOtp.value || '').trim().toUpperCase();

        if (!otp || otp.length < 6) {
          showError('dues-admin-otp-error', 'Please enter a valid administrator OTP (e.g. FIN527LSU).');
          return;
        }

        btnAdminVerifyOtp.disabled = true;
        btnAdminVerifyOtp.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';

        const result = await sendBackendRequest({
          action: 'verifyPaymentAdminOTP',
          email: email,
          otp: otp
        });

        btnAdminVerifyOtp.disabled = false;
        btnAdminVerifyOtp.innerHTML = '<i class="fa-solid fa-lock-open"></i> Verify Access';

        if (result && result.success && result.sessionToken) {
          state.adminSessionToken = result.sessionToken;
          sessionStorage.setItem('lsuPaymentAdminSessionToken', result.sessionToken);
          showView('view-dues-admin-dashboard');
          loadPendingDuePayments();
        } else {
          showError('dues-admin-otp-error', result.message || 'Payment administrator code has expired or is invalid.');
        }
      });
    }

    if (btnAdminBackToLogin) {
      btnAdminBackToLogin.addEventListener('click', () => {
        showView('view-dues-admin-login');
      });
    }

    // Admin Logout (Action: logoutPaymentAdmin)
    if (btnAdminLogout) {
      btnAdminLogout.addEventListener('click', async () => {
        if (state.adminSessionToken) {
          await sendBackendRequest({
            action: 'logoutPaymentAdmin',
            sessionToken: state.adminSessionToken
          });
        }
        state.adminSessionToken = null;
        sessionStorage.removeItem('lsuPaymentAdminSessionToken');
        showView('view-dues-admin-login');
      });
    }

    // ------------------------------------------------------------------------
    // Admin Dashboard - Load Pending Payments (Action: getPendingDuePayments)
    // ------------------------------------------------------------------------
    async function loadPendingDuePayments() {
      const container = document.getElementById('admin-pending-payments-list');
      const alertEl = document.getElementById('admin-pending-alert');
      const errorEl = document.getElementById('admin-pending-error');

      if (alertEl) alertEl.style.display = 'none';
      if (errorEl) errorEl.style.display = 'none';

      if (!container) return;
      container.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top: 10px;">Loading pending dues payments...</p></div>';

      const result = await sendBackendRequest({
        action: 'getPendingDuePayments',
        sessionToken: state.adminSessionToken
      });

      if (result && result.success && Array.isArray(result.payments)) {
        state.pendingPayments = result.payments;
        renderPendingPaymentsList();
      } else {
        container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--error-color);"><i class="fa-solid fa-circle-exclamation"></i> ${result.message || 'Unable to load payments. Session may have expired.'}</div>`;
      }
    }

    if (btnRefreshPending) {
      btnRefreshPending.addEventListener('click', loadPendingDuePayments);
    }

    function renderPendingPaymentsList() {
      const container = document.getElementById('admin-pending-payments-list');
      if (!container) return;

      if (!state.pendingPayments || !state.pendingPayments.length) {
        container.innerHTML = `
          <div style="text-align: center; padding: 36px 20px; background: #f8fafc; border: 1px dashed var(--border-color); border-radius: var(--radius-md); color: var(--text-muted);">
            <i class="fa-solid fa-clipboard-check fa-2x" style="color: #16a34a; margin-bottom: 8px;"></i>
            <p style="margin: 0; font-weight: 600;">No pending dues payments found.</p>
            <span style="font-size: 0.85rem;">All submitted dues payments have been processed.</span>
          </div>
        `;
        return;
      }

      container.innerHTML = '';
      state.pendingPayments.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'dues-admin-payment-card';

        let methodDetails = '';
        if (p.paymentMethod === 'ONLINE / UPI') {
          methodDetails = `<div class="dues-admin-meta-item"><span class="key">UPI Ref No:</span><span class="val" style="font-family: monospace;">${p.upiRefNo || 'N/A'}</span></div>`;
        } else {
          methodDetails = `<div class="dues-admin-meta-item"><span class="key">Cash Receiver:</span><span class="val">${p.cashReceiverName || 'N/A'} (${p.cashReceiverPosition || 'Officer'})</span></div>`;
        }

        let allocationsHtml = '';
        if (Array.isArray(p.allocations) && p.allocations.length) {
          allocationsHtml = '<ul>' + p.allocations.map(a => `<li><strong>${a.name}</strong> (${a.email}) — <strong>₹${Number(a.amount).toFixed(2)}</strong></li>`).join('') + '</ul>';
        }

        card.innerHTML = `
          <div class="dues-admin-card-top">
            <div>
              <span class="dues-admin-payment-id">${p.paymentId}</span>
              <span style="font-size: 0.8rem; color: var(--text-muted); display: block;">Submitted: ${p.submittedDate || 'Recent'}</span>
            </div>
            <span class="dues-admin-status-pill pending">PENDING VERIFICATION</span>
          </div>

          <div class="dues-admin-meta-grid">
            <div class="dues-admin-meta-item"><span class="key">Payer:</span><span class="val">${p.payer} (${p.payerEmail})</span></div>
            <div class="dues-admin-meta-item"><span class="key">Payment Method:</span><span class="val">${p.paymentMethod}</span></div>
            <div class="dues-admin-meta-item"><span class="key">Payment Date:</span><span class="val">${p.paymentDate}</span></div>
            <div class="dues-admin-meta-item"><span class="key">Total Amount:</span><span class="val" style="color: var(--primary-color); font-size: 1.05rem;">₹${Number(p.totalAmount).toFixed(2)}</span></div>
            ${methodDetails}
          </div>

          <div class="dues-admin-allocations-box">
            <span style="font-weight: 600; color: var(--text-main);">Members Covered:</span>
            ${allocationsHtml}
          </div>

          <div class="dues-admin-action-row">
            <button type="button" class="dues-btn-primary dues-btn-danger btn-admin-reject" data-id="${p.paymentId}" style="padding: 8px 16px; font-size: 0.9rem;">
              <i class="fa-solid fa-xmark"></i> Reject
            </button>
            <button type="button" class="dues-btn-primary btn-admin-approve" data-id="${p.paymentId}" style="padding: 8px 18px; font-size: 0.9rem;">
              <i class="fa-solid fa-check"></i> Approve & Issue Receipt
            </button>
          </div>
        `;

        container.appendChild(card);
      });

      // Bind action buttons
      container.querySelectorAll('.btn-admin-approve').forEach((btn) => {
        btn.addEventListener('click', () => handleApprovePayment(btn.getAttribute('data-id'), btn));
      });

      container.querySelectorAll('.btn-admin-reject').forEach((btn) => {
        btn.addEventListener('click', () => openRejectionModal(btn.getAttribute('data-id')));
      });
    }

    // ------------------------------------------------------------------------
    // Step 10: Approve Payment (Action: approveDuePayment)
    // ------------------------------------------------------------------------
    async function handleApprovePayment(paymentId, btnEl) {
      if (!confirm(`Are you sure you want to approve payment ${paymentId} and issue receipts?`)) return;

      const alertEl = document.getElementById('admin-pending-alert');
      const errorEl = document.getElementById('admin-pending-error');
      if (alertEl) alertEl.style.display = 'none';
      if (errorEl) errorEl.style.display = 'none';

      if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Approving...';
      }

      const result = await sendBackendRequest({
        action: 'approveDuePayment',
        sessionToken: state.adminSessionToken,
        paymentId: paymentId
      });

      if (result && result.success) {
        if (alertEl) {
          alertEl.textContent = `Payment approved successfully. Receipt ID: ${result.receiptId || ''}`;
          alertEl.style.display = 'block';
        }
        loadPendingDuePayments();
      } else {
        if (errorEl) {
          errorEl.textContent = result.message || 'Unable to approve payment.';
          errorEl.style.display = 'block';
        }
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.innerHTML = '<i class="fa-solid fa-check"></i> Approve & Issue Receipt';
        }
      }
    }

    // ------------------------------------------------------------------------
    // Step 11: Reject Payment (Action: rejectDuePayment)
    // ------------------------------------------------------------------------
    const rejectionModal = document.getElementById('duesRejectionModal');
    const rejectionInput = document.getElementById('rejectionReasonInput');
    const btnConfirmRejection = document.getElementById('btnConfirmRejection');
    const btnCancelRejection = document.getElementById('btnCancelRejection');

    function openRejectionModal(paymentId) {
      state.currentRejectingPaymentId = paymentId;
      if (rejectionInput) rejectionInput.value = '';
      clearError('rejectionModalError');
      if (rejectionModal) rejectionModal.classList.add('active');
    }

    function closeRejectionModal() {
      state.currentRejectingPaymentId = null;
      if (rejectionModal) rejectionModal.classList.remove('active');
    }

    if (btnCancelRejection) btnCancelRejection.addEventListener('click', closeRejectionModal);

    if (btnConfirmRejection) {
      btnConfirmRejection.addEventListener('click', async () => {
        clearError('rejectionModalError');
        const reason = String(rejectionInput.value || '').trim();
        if (!reason) {
          showError('rejectionModalError', 'Please provide a reason for rejecting this payment.');
          return;
        }

        btnConfirmRejection.disabled = true;
        btnConfirmRejection.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Rejecting...';

        const result = await sendBackendRequest({
          action: 'rejectDuePayment',
          sessionToken: state.adminSessionToken,
          paymentId: state.currentRejectingPaymentId,
          rejectionReason: reason
        });

        btnConfirmRejection.disabled = false;
        btnConfirmRejection.innerHTML = 'Confirm Rejection';

        if (result && result.success) {
          closeRejectionModal();
          const alertEl = document.getElementById('admin-pending-alert');
          if (alertEl) {
            alertEl.textContent = `Payment ${state.currentRejectingPaymentId} has been rejected.`;
            alertEl.style.display = 'block';
          }
          loadPendingDuePayments();
        } else {
          showError('rejectionModalError', result.message || 'Unable to reject payment.');
        }
      });
    }

    // Default dates
    const today = new Date().toISOString().split('T')[0];
    document.querySelectorAll('input[type="date"]').forEach((picker) => {
      if (!picker.value) picker.value = today;
    });
  });
})();
