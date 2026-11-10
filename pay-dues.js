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
    payer: null, // { email, name, membershipId, position, category }
    paymentChoice: 'PAY_MY_DUES', // 'PAY_MY_DUES' | 'PAY_FOR_OTHER_MEMBERS' | 'EVENT_CONTRIBUTION'
    activeEventPaymentRequestId: null,
    currentEvent: null, // active event for contribution
    eventPaymentMode: 'BALANCE',
    eventOtherMembers: [null, null], // verified other members for event
    otherMemberCount: 1,
    verifiedMembers: [], // [ { email, name, membershipId, amount } ]
    selectedMethod: 'ONLINE / UPI', // 'ONLINE / UPI' | 'CASH'
    adminSessionToken: sessionStorage.getItem('lsuPaymentAdminSessionToken') || null,
    adminRole: sessionStorage.getItem('lsuPaymentAdminRole') || null,
    pendingPayments: [],
    currentRejectingPaymentId: null,
    adminEvents: [],
    eventAudits: []
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
    // Step 2: Payment Choice (Monthly Dues vs Event Contributions)
    // ------------------------------------------------------------------------
    const btnChoiceMonthlyDues = document.getElementById('btn-choice-monthly-dues');
    const btnChoiceEventContributions = document.getElementById('btn-choice-event-contributions');
    const duesSubSelection = document.getElementById('dues-sub-selection');
    const btnPayMyDues = document.getElementById('btn-pay-my-dues');
    const btnPayOtherMembers = document.getElementById('btn-pay-other-members');
    const btnBackToOtp = document.getElementById('btn-dues-back-to-otp');
    const btnEventBackToChoice = document.getElementById('btn-event-back-to-choice');
    const btnEventCancelSetup = document.getElementById('btn-event-cancel-setup');

    if (btnChoiceMonthlyDues && duesSubSelection) {
      btnChoiceMonthlyDues.addEventListener('click', () => {
        duesSubSelection.style.display = 'block';
        duesSubSelection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }

    if (btnChoiceEventContributions) {
      btnChoiceEventContributions.addEventListener('click', () => {
        loadMemberEvents();
        showView('view-event-contributions');
      });
    }

    if (btnEventBackToChoice) {
      btnEventBackToChoice.addEventListener('click', () => {
        showView('view-dues-choice');
      });
    }

    if (btnEventCancelSetup) {
      btnEventCancelSetup.addEventListener('click', () => {
        showView('view-event-contributions');
      });
    }

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
    // Member Event Contributions Controller
    // ------------------------------------------------------------------------
    async function loadMemberEvents() {
      const loadingEl = document.getElementById('member-events-loading');
      const listEl = document.getElementById('member-events-list');
      const alertEl = document.getElementById('member-events-alert');
      const errorEl = document.getElementById('member-events-error');
      const catBadge = document.getElementById('member-registered-category-badge');

      if (alertEl) { alertEl.style.display = 'none'; alertEl.textContent = ''; }
      if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
      if (loadingEl) loadingEl.style.display = 'block';
      if (listEl) { listEl.style.display = 'none'; listEl.replaceChildren(); }

      try {
        const result = await sendBackendRequest({
          action: 'getEvents',
          memberSessionToken: state.memberSessionToken
        });

        if (loadingEl) loadingEl.style.display = 'none';

        if (result && result.success) {
          const category = (result.member && result.member.category) || result.memberCategory ||
            (state.payer && state.payer.category) || 'MEMBER';
          if (catBadge) {
            catBadge.textContent = category === 'LEADER' ? 'Registered Leader / Executive' : 'Registered Member';
            catBadge.className = category === 'LEADER' ? 'dues-badge dues-badge-leader' : 'dues-badge dues-badge-member';
          }

          if (state.payer) {
            state.payer.category = category;
            state.payer.position = (result.member && result.member.position) || result.memberPosition || state.payer.position;
          }

          const events = Array.isArray(result.events) ? result.events : [];
          if (!events.length) {
            if (listEl) {
              listEl.style.display = 'block';
              listEl.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--text-muted); grid-column: 1 / -1;">No active event contributions scheduled at this time.</div>';
            }
            return;
          }

          if (listEl) {
            listEl.style.display = 'grid';
            events.forEach(evt => {
              const card = document.createElement('div');
              card.className = 'dues-event-card';

              const header = document.createElement('div');
              header.className = 'dues-event-card-header';
              const title = document.createElement('h3');
              title.className = 'dues-event-title';
              title.textContent = evt.title || 'Untitled Event';
              const badge = document.createElement('span');
              badge.className = 'dues-badge dues-badge-target';
              badge.textContent = `Target: ${evt.targetGroup || 'ALL'}`;
              header.append(title, badge);

              const desc = document.createElement('p');
              desc.className = 'dues-event-desc';
              desc.textContent = evt.description || 'No description provided.';

              const dateRow = document.createElement('div');
              dateRow.style.fontSize = '0.82rem';
              dateRow.style.color = 'var(--text-muted)';
              dateRow.style.marginBottom = '12px';
              dateRow.innerHTML = `<i class="fa-regular fa-calendar"></i> <strong>Date:</strong> ${evt.eventDate || 'TBD'}`;

              const feeRow = document.createElement('div');
              feeRow.className = 'dues-event-fees';
              const reqAmount = Number(evt.requiredAmount) || 0;
              feeRow.innerHTML = `<div><div class="fee-label">Event Contribution Total</div><div class="fee-amount">₹${reqAmount.toFixed(2)}</div></div>`;

              const balanceRow = document.createElement('div');
              balanceRow.className = 'dues-event-member-balance';
              balanceRow.innerHTML = `
                <span>Approved: <strong>₹${(Number(evt.myApprovedAmount) || 0).toFixed(2)}</strong></span>
                <span>Pending: <strong>₹${(Number(evt.myPendingAmount) || 0).toFixed(2)}</strong></span>
                <span>Balance: <strong>₹${(Number(evt.myRemainingBalance) || 0).toFixed(2)}</strong></span>
              `;

              const footer = document.createElement('div');
              footer.className = 'dues-event-card-footer';
              const actions = document.createElement('div');
              actions.className = 'dues-event-actions';

              if (evt.myRemainingBalance <= 0) {
                const paid = document.createElement('span');
                paid.className = 'dues-badge dues-badge-active';
                paid.textContent = 'Fully paid (approved)';
                footer.appendChild(paid);
              } else if (evt.myPendingAmount > 0) {
                const pending = document.createElement('span');
                pending.className = 'dues-badge dues-badge-target';
                pending.textContent = `₹${Number(evt.myPendingAmount).toFixed(2)} pending approval`;
                footer.appendChild(pending);
              }

              if (evt.status === 'ACTIVE') {
                if (evt.isEligible && Number(evt.myAvailableAmount) > 0) {
                  const balanceBtn = document.createElement('button');
                  balanceBtn.type = 'button';
                  balanceBtn.className = 'dues-btn-primary';
                  balanceBtn.style.padding = '8px 16px';
                  balanceBtn.textContent = 'Pay Balance';
                  balanceBtn.addEventListener('click', () => setupEventPayment(evt, 'BALANCE'));
                  actions.appendChild(balanceBtn);
                }

                const othersBtn = document.createElement('button');
                othersBtn.type = 'button';
                othersBtn.className = 'dues-btn-secondary';
                othersBtn.style.padding = '8px 16px';
                othersBtn.textContent = 'Pay for Others';
                othersBtn.addEventListener('click', () => setupEventPayment(evt, 'OTHERS'));
                actions.appendChild(othersBtn);
              } else {
                const closed = document.createElement('span');
                closed.className = 'dues-badge dues-badge-closed';
                closed.textContent = 'Contributions closed';
                footer.appendChild(closed);
              }

              card.append(header, actions, desc, dateRow, feeRow, balanceRow, footer);
              listEl.appendChild(card);
            });
          }
        } else {
          if (errorEl) {
            errorEl.textContent = result.message || 'Unable to load event contributions.';
            errorEl.style.display = 'block';
          }
        }
      } catch (err) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) {
          errorEl.textContent = err.message || 'Network error loading events.';
          errorEl.style.display = 'block';
        }
      }
    }

    function setupEventPayment(evt, mode = 'BALANCE') {
      state.currentEvent = evt;
      state.eventPaymentMode = mode;
      state.activeEventPaymentRequestId = null;
      state.eventOtherMembers = [null, null];

      const nameEl = document.getElementById('event-setup-event-name');
      const dateEl = document.getElementById('event-setup-event-date');
      const badgeEl = document.getElementById('event-setup-target-badge');
      const feeLabel = document.getElementById('event-self-fee-label');

      if (nameEl) nameEl.textContent = evt.title;
      if (dateEl) dateEl.innerHTML = `<i class="fa-regular fa-calendar"></i> Event Date: <strong>${evt.eventDate}</strong>`;
      if (badgeEl) badgeEl.textContent = `Target: ${evt.targetGroup}`;

      const available = Number(evt.myAvailableAmount) || 0;
      const remaining = Number(evt.myRemainingBalance) || 0;
      const approved = Number(evt.myApprovedAmount) || 0;
      const pending = Number(evt.myPendingAmount) || 0;
      if (feeLabel) feeLabel.textContent = `Available to pay now: ₹${available.toFixed(2)}`;
      const balanceValues = document.getElementById('event-self-balance-values');
      if (balanceValues) {
        balanceValues.textContent = `Event amount: ₹${(Number(evt.requiredAmount) || 0).toFixed(2)} | Approved: ₹${approved.toFixed(2)} | Pending: ₹${pending.toFixed(2)} | Remaining: ₹${remaining.toFixed(2)} | Available now: ₹${available.toFixed(2)}`;
      }
      const selfAmount = document.getElementById('event-self-amount');
      if (selfAmount) {
        selfAmount.value = '';
        selfAmount.max = available.toFixed(2);
      }
      const selfHint = document.getElementById('event-self-amount-hint');
      if (selfHint) selfHint.textContent = `Enter any amount up to ₹${available.toFixed(2)}. Pending installments reserve balance until they are approved or rejected.`;

      const radioSelf = document.getElementById('event-pay-self-only');
      const radioOthers = document.getElementById('event-pay-multi');
      const startWithOthers = mode === 'OTHERS';
      if (radioSelf) radioSelf.checked = !startWithOthers;
      if (radioOthers) radioOthers.checked = startWithOthers;

      const multiContainer = document.getElementById('event-multi-members-container');
      if (multiContainer) multiContainer.style.display = startWithOthers ? 'block' : 'none';
      const selfAmountContainer = document.getElementById('event-self-amount-container');
      if (selfAmountContainer) selfAmountContainer.style.display = startWithOthers ? 'none' : 'block';

      const email1Input = document.getElementById('event-other-email-1');
      const email2Input = document.getElementById('event-other-email-2');
      const amount1Input = document.getElementById('event-other-amount-1');
      const amount2Input = document.getElementById('event-other-amount-2');
      const amount1Container = document.getElementById('event-other-amount-container-1');
      const amount2Container = document.getElementById('event-other-amount-container-2');
      const res1 = document.getElementById('event-other-result-1');
      const res2 = document.getElementById('event-other-result-2');
      if (email1Input) email1Input.value = '';
      if (email2Input) email2Input.value = '';
      if (amount1Input) amount1Input.value = '';
      if (amount2Input) amount2Input.value = '';
      if (amount1Container) amount1Container.style.display = 'none';
      if (amount2Container) amount2Container.style.display = 'none';
      if (res1) { res1.textContent = ''; res1.style.display = 'none'; }
      if (res2) { res2.textContent = ''; res2.style.display = 'none'; }

      clearError('event-setup-error');
      updateEventPaymentTotals();
      showView('view-event-payment-setup');
    }

    function updateEventPaymentTotals() {
      if (!state.currentEvent) return;

      const isMulti = document.getElementById('event-pay-multi')?.checked;
      let total = 0;
      let count = 0;

      if (isMulti) {
        state.eventOtherMembers.forEach((m) => {
          if (m && m.amount > 0) {
            total += Number(m.amount) || 0;
            count++;
          }
        });
      } else {
        total = Number(document.getElementById('event-self-amount')?.value) || 0;
        count = total > 0 ? 1 : 0;
      }

      const countDisplay = document.getElementById('event-total-members-count');
      const amountDisplay = document.getElementById('event-total-amount-display');

      if (countDisplay) {
        countDisplay.textContent = isMulti
          ? `Paying for ${count} of up to 2 other members`
          : count ? 'Paying toward your own event balance' : 'Enter an installment amount';
      }
      if (amountDisplay) {
        amountDisplay.textContent = `₹${total.toFixed(2)}`;
      }
    }

    // Toggle radio in event payment setup
    document.querySelectorAll('input[name="event-payer-option"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const isMulti = document.getElementById('event-pay-multi')?.checked;
        const multiContainer = document.getElementById('event-multi-members-container');
        const selfAmountContainer = document.getElementById('event-self-amount-container');
        if (multiContainer) multiContainer.style.display = isMulti ? 'block' : 'none';
        if (selfAmountContainer) selfAmountContainer.style.display = isMulti ? 'none' : 'block';
        updateEventPaymentTotals();
      });
    });

    document.getElementById('event-self-amount')?.addEventListener('input', updateEventPaymentTotals);

    // Verification handlers for additional members in event
    async function verifyEventAdditionalMember(index) {
      const emailInput = document.getElementById(`event-other-email-${index}`);
      const resultDiv = document.getElementById(`event-other-result-${index}`);
      const verifyBtn = document.getElementById(`btn-verify-event-member-${index}`);
      const amountInput = document.getElementById(`event-other-amount-${index}`);
      const amountContainer = document.getElementById(`event-other-amount-container-${index}`);
      state.eventOtherMembers[index - 1] = null;
      if (amountInput) amountInput.value = '';
      if (amountContainer) amountContainer.style.display = 'none';
      updateEventPaymentTotals();

      const rawEmail = emailInput ? emailInput.value : '';
      const email = extractEmail(rawEmail);

      if (!email) {
        if (resultDiv) {
          resultDiv.style.display = 'block';
          resultDiv.style.color = 'var(--error-color)';
          resultDiv.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Please enter a valid registered email address.';
        }
        return;
      }

      if (state.payer && state.payer.email && email.toLowerCase() === state.payer.email.toLowerCase()) {
        if (resultDiv) {
          resultDiv.style.display = 'block';
          resultDiv.style.color = 'var(--error-color)';
          resultDiv.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> You are already included as the primary contributor.';
        }
        return;
      }

      const otherIndex = index === 1 ? 2 : 1;
      const otherMember = state.eventOtherMembers[otherIndex - 1];
      if (otherMember && otherMember.email && otherMember.email.toLowerCase() === email.toLowerCase()) {
        if (resultDiv) {
          resultDiv.style.display = 'block';
          resultDiv.style.color = 'var(--error-color)';
          resultDiv.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> This member has already been added in the other field.';
        }
        return;
      }

      if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      }

      try {
        const res = await sendBackendRequest({
          action: 'getEventMemberBalance',
          sessionToken: state.memberSessionToken,
          eventId: state.currentEvent.eventId,
          targetEmail: email
        });

        if (verifyBtn) {
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verify';
        }

        if (res && res.success && res.member && res.balance) {
          const member = res.member;
          state.eventOtherMembers[index - 1] = {
            email: member.email,
            name: member.name,
            membershipId: member.membershipId || '',
            position: member.position,
            category: member.category,
            amount: 0,
            balance: res.balance
          };

          const balanceHint = document.getElementById(`event-other-balance-hint-${index}`);
          if (amountInput) {
            amountInput.value = '';
            amountInput.max = Number(res.balance.availableAmount).toFixed(2);
          }
          if (amountContainer) amountContainer.style.display = res.balance.availableAmount > 0 ? 'block' : 'none';
          if (balanceHint) {
            balanceHint.textContent = `Event amount ₹${Number(res.balance.requiredAmount).toFixed(2)}; approved ₹${Number(res.balance.approvedAmount).toFixed(2)}; pending ₹${Number(res.balance.pendingAmount).toFixed(2)}; available now ₹${Number(res.balance.availableAmount).toFixed(2)}.`;
          }
          if (resultDiv) {
            resultDiv.style.display = 'block';
            resultDiv.style.color = res.balance.availableAmount > 0 ? '#15803d' : 'var(--error-color)';
            resultDiv.textContent = res.balance.availableAmount > 0
              ? `${member.name} (${member.position}) is verified. Balance remaining: ₹${Number(res.balance.remainingBalance).toFixed(2)}.`
              : `${member.name} has no available balance to pay for this event.`;
          }
          updateEventPaymentTotals();
        } else {
          state.eventOtherMembers[index - 1] = null;
          const amountContainer = document.getElementById(`event-other-amount-container-${index}`);
          if (amountContainer) amountContainer.style.display = 'none';
          if (resultDiv) {
            resultDiv.style.display = 'block';
            resultDiv.style.color = 'var(--error-color)';
            resultDiv.textContent = res.message || 'Member not found in verified registry.';
          }
          updateEventPaymentTotals();
        }
      } catch (err) {
        if (verifyBtn) {
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verify';
        }
        state.eventOtherMembers[index - 1] = null;
        if (resultDiv) {
          resultDiv.style.display = 'block';
          resultDiv.style.color = 'var(--error-color)';
          resultDiv.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Network error verifying member.';
        }
        updateEventPaymentTotals();
      }
    }

    const btnVerifyEvt1 = document.getElementById('btn-verify-event-member-1');
    const btnVerifyEvt2 = document.getElementById('btn-verify-event-member-2');
    if (btnVerifyEvt1) btnVerifyEvt1.addEventListener('click', () => verifyEventAdditionalMember(1));
    if (btnVerifyEvt2) btnVerifyEvt2.addEventListener('click', () => verifyEventAdditionalMember(2));
    [1, 2].forEach(index => {
      document.getElementById(`event-other-email-${index}`)?.addEventListener('input', () => {
        state.eventOtherMembers[index - 1] = null;
        const amountInput = document.getElementById(`event-other-amount-${index}`);
        const amountContainer = document.getElementById(`event-other-amount-container-${index}`);
        const resultDiv = document.getElementById(`event-other-result-${index}`);
        if (amountInput) amountInput.value = '';
        if (amountContainer) amountContainer.style.display = 'none';
        if (resultDiv) {
          resultDiv.textContent = '';
          resultDiv.style.display = 'none';
        }
        updateEventPaymentTotals();
      });
    });

    const btnProceedEventPayment = document.getElementById('btn-event-proceed-payment');
    if (btnProceedEventPayment) {
      btnProceedEventPayment.addEventListener('click', () => {
        clearError('event-setup-error');
        if (!state.currentEvent) {
          showError('event-setup-error', 'No event selected.');
          return;
        }

        const isMulti = document.getElementById('event-pay-multi')?.checked;
        const list = [];

        if (!isMulti) {
          const amount = Number(document.getElementById('event-self-amount')?.value);
          const available = Number(state.currentEvent.myAvailableAmount) || 0;
          if (!Number.isFinite(amount) || amount <= 0) {
            showError('event-setup-error', 'Enter a contribution amount greater than zero.');
            return;
          }
          if (amount > available) {
            showError('event-setup-error', `Your remaining balance is ₹${Number(state.currentEvent.myRemainingBalance || 0).toFixed(2)}; ₹${Number(state.currentEvent.myPendingAmount || 0).toFixed(2)} is pending approval. The exact maximum you can submit now is ₹${available.toFixed(2)}.`);
            return;
          }
          list.push({
            email: state.payer.email,
            name: state.payer.name,
            membershipId: state.payer.membershipId || '',
            amount
          });
        } else {
          const email1 = extractEmail(document.getElementById('event-other-email-1')?.value);
          const email2 = extractEmail(document.getElementById('event-other-email-2')?.value);

          if (email1 && !state.eventOtherMembers[0]) {
            showError('event-setup-error', 'Please verify Member 1 or clear the email field before proceeding.');
            return;
          }
          if (email2 && !state.eventOtherMembers[1]) {
            showError('event-setup-error', 'Please verify Member 2 or clear the email field before proceeding.');
            return;
          }
          if (!email1) {
            showError('event-setup-error', 'Enter the registered email address for at least one member. You may add one or two members.');
            return;
          }

          const emails = [email1, email2].filter(Boolean);
          for (let index = 0; index < emails.length; index++) {
            const member = state.eventOtherMembers[index];
            const inputAmount = Number(document.getElementById(`event-other-amount-${index + 1}`)?.value);
            if (!member || extractEmail(member.email) !== emails[index]) {
              showError('event-setup-error', `Verify the registered email for Member ${index + 1} before continuing.`);
              return;
            }
            if (!Number.isFinite(inputAmount) || inputAmount <= 0) {
              showError('event-setup-error', `Enter a contribution amount greater than zero for ${member.name}.`);
              return;
            }
            const available = Number(member.balance.availableAmount) || 0;
            if (inputAmount > available) {
              showError('event-setup-error', `${member.name}'s approved-payment balance is ₹${Number(member.balance.remainingBalance).toFixed(2)}; ₹${Number(member.balance.pendingAmount).toFixed(2)} is pending. The exact maximum you can submit now is ₹${available.toFixed(2)}.`);
              return;
            }
            list.push({ ...member, amount: inputAmount });
          }
        }

        state.paymentChoice = 'EVENT_CONTRIBUTION';
        state.verifiedMembers = list;

        renderPaymentSummary();
        showView('view-dues-payment');
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
        membersContainer.replaceChildren();
        state.verifiedMembers.forEach((m) => {
          total += Number(m.amount) || 0;
          const row = document.createElement('div');
          row.className = 'dues-summary-member-row';
          const info = document.createElement('div');
          info.className = 'dues-summary-member-info';
          const name = document.createElement('span');
          name.className = 'dues-summary-member-name';
          name.textContent = m.name || '';
          const email = document.createElement('span');
          email.className = 'dues-summary-member-email';
          email.textContent = `${m.email || ''}${m.membershipId ? ' | ID: ' + m.membershipId : ''}`;
          info.append(name, email);
          const amount = document.createElement('div');
          amount.className = 'dues-summary-member-amount';
          amount.textContent = `₹${(Number(m.amount) || 0).toFixed(2)}`;
          row.append(info, amount);
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
      if (state.paymentChoice === 'EVENT_CONTRIBUTION') {
        showView('view-event-payment-setup');
      } else if (state.paymentChoice === 'PAY_FOR_OTHER_MEMBERS') {
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

      let payload;
      if (state.paymentChoice === 'EVENT_CONTRIBUTION') {
        state.activeEventPaymentRequestId = state.activeEventPaymentRequestId ||
          `REQ-EVT-${window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
        payload = {
          action: 'submitContributionPayment',
          sessionToken: state.memberSessionToken,
          requestId: state.activeEventPaymentRequestId,
          eventId: state.currentEvent ? state.currentEvent.eventId : '',
          members: membersPayload,
          totalAmount: totalAmount,
          paymentMethod: method,
          confirmed: true
        };
      } else {
        payload = {
          action: 'submitDuePayment',
          sessionToken: state.memberSessionToken,
          requestId: 'REQ-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          paymentChoice: state.paymentChoice,
          members: membersPayload,
          totalAmount: totalAmount,
          paymentMethod: method,
          confirmed: true
        };
      }

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
        document.getElementById('success-total-amount').textContent = `₹${Number(result.totalAmount || totalAmount).toFixed(2)}`;
        const returnToEvents = document.getElementById('btn-return-event-contributions');
        if (returnToEvents) returnToEvents.style.display = state.paymentChoice === 'EVENT_CONTRIBUTION' ? 'block' : 'none';
        if (state.paymentChoice === 'EVENT_CONTRIBUTION') state.activeEventPaymentRequestId = null;
        showView('view-dues-success');
      } else {
        if (state.paymentChoice === 'EVENT_CONTRIBUTION' && result && result.success === false) {
          state.activeEventPaymentRequestId = null;
        }
        showError(errorElId, (result && result.message) || 'Payment submission failed. Please retry using the same payment details.');
      }
    }

    if (btnSubmitOnline) btnSubmitOnline.addEventListener('click', () => handlePaymentSubmission('ONLINE / UPI'));
    if (btnSubmitCash) btnSubmitCash.addEventListener('click', () => handlePaymentSubmission('CASH'));

    document.getElementById('btn-return-event-contributions')?.addEventListener('click', () => {
      showView('view-event-contributions');
      loadMemberEvents();
    });

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
          sessionStorage.setItem('lsuPaymentAdminRole', result.role || '');
          applyAdminRoleUI(result.role);
          showView('view-dues-admin-dashboard');
          loadPendingDuePayments();
          if (result.role === 'CHIEF_ADMINISTRATOR' &&
              new URLSearchParams(window.location.search).get('action') === 'add-coadmin') {
            openAddAdminModal();
          }
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
        sessionStorage.removeItem('lsuPaymentAdminRole');
        applyAdminRoleUI(null);
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
      container.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top: 10px;">Loading pending payments...</p></div>';

      const result = await sendBackendRequest({
        action: 'getPendingDuePayments',
        sessionToken: state.adminSessionToken
      });

      if (result && result.success && Array.isArray(result.payments)) {
        state.pendingPayments = result.payments;
        renderPendingPaymentsList();
      } else {
        const isExpired = Boolean(result && result.message && (result.message.includes('expired') || result.message.includes('Authorization denied')));
        const errorMessage = document.createElement('div');
        errorMessage.style.textAlign = 'center';
        errorMessage.style.padding = '24px 16px';
        errorMessage.style.color = 'var(--error-color)';
        const icon = document.createElement('i');
        icon.className = isExpired ? 'fa-solid fa-lock fa-2x' : 'fa-solid fa-circle-exclamation';
        icon.style.display = isExpired ? 'block' : 'inline-block';
        if (isExpired) icon.style.marginBottom = '8px';
        icon.setAttribute('aria-hidden', 'true');
        const text = document.createElement('p');
        text.style.margin = isExpired ? '4px 0 12px' : '4px 0';
        text.style.fontWeight = isExpired ? '600' : 'normal';
        text.textContent = isExpired ? 'Administrator session expired. Please sign in again.' : ` ${result.message || 'Unable to load payments. Session may have expired.'}`;
        errorMessage.append(icon, text);
        if (isExpired) {
          const btnRelogin = document.createElement('button');
          btnRelogin.type = 'button';
          btnRelogin.className = 'dues-btn-primary';
          btnRelogin.style.fontSize = '0.85rem';
          btnRelogin.style.padding = '6px 16px';
          btnRelogin.textContent = 'Sign In Again';
          btnRelogin.addEventListener('click', () => {
            sessionStorage.removeItem('lsuPaymentAdminSessionToken');
            sessionStorage.removeItem('lsuPaymentAdminRole');
            state.adminSessionToken = null;
            applyAdminRoleUI(null);
            showView('view-dues-admin-login');
          });
          errorMessage.appendChild(btnRelogin);
        }
        container.replaceChildren(errorMessage);
      }
    }

    if (btnRefreshPending) {
      btnRefreshPending.addEventListener('click', loadPendingDuePayments);
    }

    // Admin Dashboard Tabs
    const tabAdminPending = document.getElementById('tab-admin-pending');
    const tabAdminEvents = document.getElementById('tab-admin-events');
    const secAdminPending = document.getElementById('sec-admin-pending');
    const secAdminEvents = document.getElementById('sec-admin-events');

    if (tabAdminPending && tabAdminEvents && secAdminPending && secAdminEvents) {
      tabAdminPending.addEventListener('click', () => {
        tabAdminPending.classList.add('active');
        tabAdminEvents.classList.remove('active');
        secAdminPending.style.display = 'block';
        secAdminEvents.style.display = 'none';
      });

      tabAdminEvents.addEventListener('click', () => {
        tabAdminEvents.classList.add('active');
        tabAdminPending.classList.remove('active');
        secAdminPending.style.display = 'none';
        secAdminEvents.style.display = 'block';
        loadAdminEvents();
      });
    }

    const btnRefreshAdminEvents = document.getElementById('btn-refresh-admin-events');
    if (btnRefreshAdminEvents) {
      btnRefreshAdminEvents.addEventListener('click', loadAdminEvents);
    }

    // ------------------------------------------------------------------------
    // Admin Event Management Controller (Financial Admins / Chief Admin)
    // ------------------------------------------------------------------------
    async function loadAdminEvents() {
      const loadingEl = document.getElementById('admin-events-loading');
      const gridEl = document.getElementById('admin-events-grid');
      const alertEl = document.getElementById('admin-events-alert');
      const errorEl = document.getElementById('admin-events-error');

      if (alertEl) { alertEl.style.display = 'none'; alertEl.textContent = ''; }
      if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
      if (loadingEl) loadingEl.style.display = 'block';
      if (gridEl) { gridEl.style.display = 'none'; gridEl.replaceChildren(); }

      try {
        const result = await sendBackendRequest({
          action: 'getEvents',
          sessionToken: state.adminSessionToken
        });

        if (loadingEl) loadingEl.style.display = 'none';

        if (result && result.success) {
          state.adminEvents = Array.isArray(result.events) ? result.events : [];
          state.eventAudits = Array.isArray(result.audits) ? result.audits :
            (Array.isArray(result.eventAudits) ? result.eventAudits : []);

          if (!state.adminEvents.length) {
            if (gridEl) {
              gridEl.style.display = 'block';
              gridEl.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--text-muted); grid-column: 1 / -1;">No events created yet. Click \'Create Event\' above to create an event.</div>';
            }
            return;
          }

          if (gridEl) {
            gridEl.style.display = 'grid';
            state.adminEvents.forEach(evt => {
              const card = document.createElement('div');
              card.className = 'dues-event-card';

              const header = document.createElement('div');
              header.className = 'dues-event-card-header';
              const title = document.createElement('h3');
              title.className = 'dues-event-title';
              title.textContent = evt.title || 'Untitled';

              let statusBadgeClass = 'dues-badge-active';
              if (evt.status === 'CLOSED') statusBadgeClass = 'dues-badge-closed';
              if (evt.status === 'ARCHIVED') statusBadgeClass = 'dues-badge-archived';

              const badge = document.createElement('span');
              badge.className = `dues-badge ${statusBadgeClass}`;
              badge.textContent = evt.status || 'ACTIVE';
              header.append(title, badge);

              const desc = document.createElement('p');
              desc.className = 'dues-event-desc';
              desc.textContent = evt.description || 'No description provided.';

              const metaRow = document.createElement('div');
              metaRow.style.fontSize = '0.82rem';
              metaRow.style.color = 'var(--text-muted)';
              metaRow.style.marginBottom = '10px';
              metaRow.innerHTML = `<strong>ID:</strong> ${evt.eventId} | <i class="fa-regular fa-calendar"></i> ${evt.eventDate || 'N/A'} | <strong>Target:</strong> ${evt.targetGroup || 'ALL'}`;

              const feeRow = document.createElement('div');
              feeRow.className = 'dues-event-fees';
              feeRow.innerHTML = `
                <div>
                  <div class="fee-label">Member Fee</div>
                  <div class="fee-amount">₹${(Number(evt.memberAmount) || 0).toFixed(2)}</div>
                </div>
                <div>
                  <div class="fee-label">Leader Fee</div>
                  <div class="fee-amount">₹${(Number(evt.leaderAmount) || 0).toFixed(2)}</div>
                </div>
              `;

              const statsRow = document.createElement('div');
              statsRow.style.background = '#f8fafc';
              statsRow.style.border = '1px solid #e2e8f0';
              statsRow.style.borderRadius = '6px';
              statsRow.style.padding = '8px 12px';
              statsRow.style.marginBottom = '12px';
              statsRow.style.fontSize = '0.85rem';
              statsRow.style.display = 'flex';
              statsRow.style.justifyContent = 'space-between';
              statsRow.innerHTML = `
                <span><i class="fa-solid fa-users" style="color: var(--primary-color);"></i> <strong>${(Number(evt.verifiedContributors) || 0) + (Number(evt.pendingContributors) || 0)}</strong> contributors</span>
                <span style="color: #15803d; font-weight: 600;"><i class="fa-solid fa-coins"></i> Approved ₹${(Number(evt.totalCollected) || 0).toFixed(2)}</span>
                <span style="color: #b45309; font-weight: 600;"><i class="fa-solid fa-clock"></i> Pending ₹${(Number(evt.pendingAmount) || 0).toFixed(2)}</span>
              `;

              const footer = document.createElement('div');
              footer.className = 'dues-event-card-footer';

              const editBtn = document.createElement('button');
              editBtn.type = 'button';
              editBtn.className = 'dues-btn-secondary';
              editBtn.style.padding = '6px 12px';
              editBtn.style.fontSize = '0.85rem';
              editBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Edit';
              editBtn.addEventListener('click', () => openEditEventModal(evt));

              const auditBtn = document.createElement('button');
              auditBtn.type = 'button';
              auditBtn.className = 'dues-btn-secondary';
              auditBtn.style.padding = '6px 12px';
              auditBtn.style.fontSize = '0.85rem';
              auditBtn.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Audit';
              auditBtn.addEventListener('click', () => openEventAuditModal(evt.eventId));

              footer.append(editBtn, auditBtn);
              card.append(header, desc, metaRow, feeRow, statsRow, footer);
              gridEl.appendChild(card);
            });
          }
        } else {
          if (errorEl) {
            errorEl.textContent = result.message || 'Unable to load events.';
            errorEl.style.display = 'block';
          }
        }
      } catch (err) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) {
          errorEl.textContent = err.message || 'Network error loading events.';
          errorEl.style.display = 'block';
        }
      }
    }

    [1, 2].forEach(index => {
      document.getElementById(`event-other-amount-${index}`)?.addEventListener('input', event => {
        if (state.eventOtherMembers[index - 1]) {
          state.eventOtherMembers[index - 1].amount = Number(event.target.value) || 0;
        }
        updateEventPaymentTotals();
      });
    });

    // Create Event Modal
    const createEventModal = document.getElementById('duesCreateEventModal');
    const btnOpenCreateEvent = document.getElementById('btn-open-create-event');
    const btnCloseCreateEvent = document.getElementById('btnCloseCreateEvent');
    const btnCancelCreateEvent = document.getElementById('btnCancelCreateEvent');
    const btnSubmitCreateEvent = document.getElementById('btnSubmitCreateEvent');
    const selectCreateTarget = document.getElementById('create-event-target');
    const chkSameAmount = document.getElementById('create-all-same-amount');
    const fieldLeaderAmount = document.getElementById('create-field-leader-amount');
    const fieldMemberAmount = document.getElementById('create-field-member-amount');
    const createError = document.getElementById('create-event-error');

    function syncCreateAmountFields() {
      const target = selectCreateTarget ? selectCreateTarget.value : 'ALL';
      const toggleContainer = document.getElementById('create-all-amount-toggle');

      if (target === 'ALL') {
        if (toggleContainer) toggleContainer.style.display = 'block';
        if (fieldMemberAmount) fieldMemberAmount.style.display = 'block';
        const isSame = chkSameAmount ? chkSameAmount.checked : true;
        if (fieldLeaderAmount) fieldLeaderAmount.style.display = isSame ? 'none' : 'block';
      } else if (target === 'MEMBERS') {
        if (toggleContainer) toggleContainer.style.display = 'none';
        if (fieldMemberAmount) fieldMemberAmount.style.display = 'block';
        if (fieldLeaderAmount) fieldLeaderAmount.style.display = 'none';
      } else if (target === 'LEADERS') {
        if (toggleContainer) toggleContainer.style.display = 'none';
        if (fieldMemberAmount) fieldMemberAmount.style.display = 'none';
        if (fieldLeaderAmount) fieldLeaderAmount.style.display = 'block';
      }
    }

    if (selectCreateTarget) selectCreateTarget.addEventListener('change', syncCreateAmountFields);
    if (chkSameAmount) chkSameAmount.addEventListener('change', syncCreateAmountFields);

    function openCreateEventModal() {
      document.getElementById('create-event-title').value = '';
      document.getElementById('create-event-desc').value = '';
      document.getElementById('create-event-date').value = new Date().toISOString().split('T')[0];
      if (selectCreateTarget) selectCreateTarget.value = 'ALL';
      if (chkSameAmount) chkSameAmount.checked = true;
      document.getElementById('create-member-amount').value = '';
      document.getElementById('create-leader-amount').value = '';
      if (createError) { createError.textContent = ''; createError.style.display = 'none'; }
      syncCreateAmountFields();
      if (createEventModal) createEventModal.classList.add('active');
    }

    function closeCreateEventModal() {
      if (createEventModal) createEventModal.classList.remove('active');
    }

    if (btnOpenCreateEvent) btnOpenCreateEvent.addEventListener('click', openCreateEventModal);
    if (btnCloseCreateEvent) btnCloseCreateEvent.addEventListener('click', closeCreateEventModal);
    if (btnCancelCreateEvent) btnCancelCreateEvent.addEventListener('click', closeCreateEventModal);

    if (btnSubmitCreateEvent) {
      btnSubmitCreateEvent.addEventListener('click', async () => {
        if (createError) { createError.textContent = ''; createError.style.display = 'none'; }

        const title = String(document.getElementById('create-event-title').value || '').trim();
        const desc = String(document.getElementById('create-event-desc').value || '').trim();
        const date = document.getElementById('create-event-date').value;
        const target = selectCreateTarget ? selectCreateTarget.value : 'ALL';
        const memberAmt = Number(document.getElementById('create-member-amount').value) || 0;
        let leaderAmt = Number(document.getElementById('create-leader-amount').value) || 0;

        if (!title) {
          if (createError) { createError.textContent = 'Please enter an event title.'; createError.style.display = 'block'; }
          return;
        }
        if (!date) {
          if (createError) { createError.textContent = 'Please choose an event date.'; createError.style.display = 'block'; }
          return;
        }

        if (target === 'ALL') {
          const isSame = chkSameAmount ? chkSameAmount.checked : true;
          if (isSame) {
            leaderAmt = memberAmt;
          }
          if (memberAmt <= 0) {
            if (createError) { createError.textContent = 'Please enter a valid member contribution amount.'; createError.style.display = 'block'; }
            return;
          }
          if (!isSame && leaderAmt <= 0) {
            if (createError) { createError.textContent = 'Please enter a valid leader contribution amount.'; createError.style.display = 'block'; }
            return;
          }
        } else if (target === 'MEMBERS') {
          if (memberAmt <= 0) {
            if (createError) { createError.textContent = 'Please enter a valid member contribution amount.'; createError.style.display = 'block'; }
            return;
          }
          leaderAmt = 0;
        } else if (target === 'LEADERS') {
          if (leaderAmt <= 0) {
            if (createError) { createError.textContent = 'Please enter a valid leader contribution amount.'; createError.style.display = 'block'; }
            return;
          }
        }

        btnSubmitCreateEvent.disabled = true;
        btnSubmitCreateEvent.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';

        try {
          const result = await sendBackendRequest({
            action: 'createEvent',
            sessionToken: state.adminSessionToken,
            title: title,
            description: desc,
            eventDate: date,
            targetGroup: target,
            memberAmount: memberAmt,
            leaderAmount: leaderAmt
          });

          btnSubmitCreateEvent.disabled = false;
          btnSubmitCreateEvent.innerHTML = 'Create Event';

          if (result && result.success) {
            closeCreateEventModal();
            const alertEl = document.getElementById('admin-events-alert');
            if (alertEl) {
              alertEl.textContent = `Event "${title}" created successfully (${result.eventId || ''}).`;
              alertEl.style.display = 'block';
            }
            loadAdminEvents();
          } else {
            if (createError) {
              createError.textContent = result.message || 'Unable to create event.';
              createError.style.display = 'block';
            }
          }
        } catch (err) {
          btnSubmitCreateEvent.disabled = false;
          btnSubmitCreateEvent.innerHTML = 'Create Event';
          if (createError) {
            createError.textContent = err.message || 'Network error.';
            createError.style.display = 'block';
          }
        }
      });
    }

    // Edit Event Modal
    const editEventModal = document.getElementById('duesEditEventModal');
    const btnCloseEditEvent = document.getElementById('btnCloseEditEvent');
    const btnCancelEditEvent = document.getElementById('btnCancelEditEvent');
    const btnSubmitEditEvent = document.getElementById('btnSubmitEditEvent');
    const editError = document.getElementById('edit-event-error');

    function openEditEventModal(evt) {
      document.getElementById('edit-event-id').value = evt.eventId;
      document.getElementById('edit-event-title').value = evt.title || '';
      document.getElementById('edit-event-desc').value = evt.description || '';
      document.getElementById('edit-event-date').value = evt.eventDate || '';
      document.getElementById('edit-event-status').value = evt.status || 'ACTIVE';
      document.getElementById('edit-member-amount').value = evt.memberAmount || 0;
      document.getElementById('edit-leader-amount').value = evt.leaderAmount || 0;

      if (editError) { editError.textContent = ''; editError.style.display = 'none'; }
      if (editEventModal) editEventModal.classList.add('active');
    }

    function closeEditEventModal() {
      if (editEventModal) editEventModal.classList.remove('active');
    }

    if (btnCloseEditEvent) btnCloseEditEvent.addEventListener('click', closeEditEventModal);
    if (btnCancelEditEvent) btnCancelEditEvent.addEventListener('click', closeEditEventModal);

    if (btnSubmitEditEvent) {
      btnSubmitEditEvent.addEventListener('click', async () => {
        if (editError) { editError.textContent = ''; editError.style.display = 'none'; }

        const eventId = document.getElementById('edit-event-id').value;
        const title = String(document.getElementById('edit-event-title').value || '').trim();
        const desc = String(document.getElementById('edit-event-desc').value || '').trim();
        const date = document.getElementById('edit-event-date').value;
        const status = document.getElementById('edit-event-status').value;
        const memberAmt = Number(document.getElementById('edit-member-amount').value) || 0;
        const leaderAmt = Number(document.getElementById('edit-leader-amount').value) || 0;

        if (!title) {
          if (editError) { editError.textContent = 'Please enter an event title.'; editError.style.display = 'block'; }
          return;
        }
        if (!date) {
          if (editError) { editError.textContent = 'Please choose an event date.'; editError.style.display = 'block'; }
          return;
        }

        btnSubmitEditEvent.disabled = true;
        btnSubmitEditEvent.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

        try {
          const result = await sendBackendRequest({
            action: 'updateEvent',
            sessionToken: state.adminSessionToken,
            eventId: eventId,
            title: title,
            description: desc,
            eventDate: date,
            status: status,
            memberAmount: memberAmt,
            leaderAmount: leaderAmt
          });

          btnSubmitEditEvent.disabled = false;
          btnSubmitEditEvent.innerHTML = 'Save Changes';

          if (result && result.success) {
            closeEditEventModal();
            const alertEl = document.getElementById('admin-events-alert');
            if (alertEl) {
              alertEl.textContent = `Event ${eventId} updated successfully.`;
              alertEl.style.display = 'block';
            }
            loadAdminEvents();
          } else {
            if (editError) {
              editError.textContent = result.message || 'Unable to update event.';
              editError.style.display = 'block';
            }
          }
        } catch (err) {
          btnSubmitEditEvent.disabled = false;
          btnSubmitEditEvent.innerHTML = 'Save Changes';
          if (editError) {
            editError.textContent = err.message || 'Network error.';
            editError.style.display = 'block';
          }
        }
      });
    }

    // Event Audit Modal
    const eventAuditModal = document.getElementById('duesEventAuditModal');
    const btnCloseEventAudit = document.getElementById('btnCloseEventAudit');
    const btnCloseEventAudit2 = document.getElementById('btnCloseEventAudit2');

    function openEventAuditModal(eventId) {
      const tbody = document.getElementById('event-audit-tbody');
      if (tbody) {
        tbody.replaceChildren();
        const audits = state.eventAudits ? state.eventAudits.filter(a => !eventId || a.eventId === eventId) : [];
        if (audits.length) {
          audits.forEach(a => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #f1f5f9';

            const tdTime = document.createElement('td');
            tdTime.style.padding = '8px 10px';
            tdTime.textContent = a.timestamp || '';

            const tdAdmin = document.createElement('td');
            tdAdmin.style.padding = '8px 10px';
            tdAdmin.textContent = a.administrator || '';

            const tdAction = document.createElement('td');
            tdAction.style.padding = '8px 10px';
            tdAction.style.fontWeight = '600';
            tdAction.textContent = a.action || '';

            const tdChanges = document.createElement('td');
            tdChanges.style.padding = '8px 10px';
            tdChanges.textContent = `Member: ₹${a.previousMemberAmount || 0} → ₹${a.newMemberAmount || 0} | Leader: ₹${a.previousLeaderAmount || 0} → ₹${a.newLeaderAmount || 0}`;

            const tdDetails = document.createElement('td');
            tdDetails.style.padding = '8px 10px';
            tdDetails.textContent = a.details || '';

            tr.append(tdTime, tdAdmin, tdAction, tdChanges, tdDetails);
            tbody.appendChild(tr);
          });
        } else {
          const emptyRow = document.createElement('tr');
          const emptyCell = document.createElement('td');
          emptyCell.colSpan = 5;
          emptyCell.style.textAlign = 'center';
          emptyCell.style.padding = '16px';
          emptyCell.style.color = 'var(--text-muted)';
          emptyCell.textContent = 'No audit records found for this event.';
          emptyRow.appendChild(emptyCell);
          tbody.appendChild(emptyRow);
        }
      }

      if (eventAuditModal) eventAuditModal.classList.add('active');
    }

    function closeEventAuditModal() {
      if (eventAuditModal) eventAuditModal.classList.remove('active');
    }

    if (btnCloseEventAudit) btnCloseEventAudit.addEventListener('click', closeEventAuditModal);
    if (btnCloseEventAudit2) btnCloseEventAudit2.addEventListener('click', closeEventAuditModal);

    function renderPendingPaymentsList() {
      const container = document.getElementById('admin-pending-payments-list');
      if (!container) return;

      if (!state.pendingPayments || !state.pendingPayments.length) {
        container.innerHTML = `
          <div style="text-align: center; padding: 36px 20px; background: #f8fafc; border: 1px dashed var(--border-color); border-radius: var(--radius-md); color: var(--text-muted);">
            <i class="fa-solid fa-clipboard-check fa-2x" style="color: #16a34a; margin-bottom: 8px;"></i>
            <p style="margin: 0; font-weight: 600;">No pending payments or contributions found.</p>
            <span style="font-size: 0.85rem;">There are no monthly dues or event contribution payments awaiting review.</span>
          </div>
        `;
        return;
      }

      container.replaceChildren();
      state.pendingPayments.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'dues-admin-payment-card';

        const makeElement = (tag, className, text) => {
          const element = document.createElement(tag);
          if (className) element.className = className;
          if (text !== undefined) element.textContent = String(text);
          return element;
        };
        const addMeta = (grid, label, value) => {
          const item = makeElement('div', 'dues-admin-meta-item');
          item.appendChild(makeElement('span', 'key', label));
          item.appendChild(makeElement('span', 'val', value || 'N/A'));
          grid.appendChild(item);
        };

        const cardTop = makeElement('div', 'dues-admin-card-top');
        const idContainer = makeElement('div');
        idContainer.appendChild(makeElement('span', 'dues-admin-payment-id', p.paymentId || ''));
        const submitted = makeElement('span', '');
        submitted.style.fontSize = '0.8rem';
        submitted.style.color = 'var(--text-muted)';
        submitted.style.display = 'block';
        submitted.textContent = `Submitted: ${p.submittedDate || 'Recent'}`;
        idContainer.appendChild(submitted);
        cardTop.append(idContainer, makeElement('span', 'dues-admin-status-pill pending', 'PENDING VERIFICATION'));
        card.appendChild(cardTop);

        const metaGrid = makeElement('div', 'dues-admin-meta-grid');
        addMeta(metaGrid, 'Payer:', `${p.payer || ''} (${p.payerEmail || ''})`);
        addMeta(metaGrid, 'Allocation Type:', p.paymentType === 'CONTRIBUTION'
          ? `Event Contribution${p.eventTitle ? ` — ${p.eventTitle}` : ''}`
          : 'Monthly Dues');
        addMeta(metaGrid, 'Payment Method:', p.paymentMethod || '');
        addMeta(metaGrid, 'Payment Date:', p.paymentDate || '');
        const total = makeElement('div', 'dues-admin-meta-item');
        total.appendChild(makeElement('span', 'key', 'Total Amount:'));
        const totalValue = makeElement('span', 'val', `₹${(Number(p.totalAmount) || 0).toFixed(2)}`);
        totalValue.style.color = 'var(--primary-color)';
        totalValue.style.fontSize = '1.05rem';
        total.appendChild(totalValue);
        metaGrid.appendChild(total);

        if (p.paymentMethod === 'ONLINE / UPI') {
          const item = makeElement('div', 'dues-admin-meta-item');
          item.appendChild(makeElement('span', 'key', 'UPI Ref No:'));
          const ref = makeElement('span', 'val', p.upiRefNo || 'N/A');
          ref.style.fontFamily = 'monospace';
          item.appendChild(ref);
          metaGrid.appendChild(item);
        } else {
          addMeta(metaGrid, 'Cash Receiver:', `${p.cashReceiverName || 'N/A'} (${p.cashReceiverPosition || 'Officer'})`);
        }
        card.appendChild(metaGrid);

        const allocationBox = makeElement('div', 'dues-admin-allocations-box');
        const allocationTitle = makeElement('span', '');
        allocationTitle.style.fontWeight = '600';
        allocationTitle.style.color = 'var(--text-main)';
        allocationTitle.textContent = 'Members Covered:';
        allocationBox.appendChild(allocationTitle);
        if (Array.isArray(p.allocations) && p.allocations.length) {
          const list = document.createElement('ul');
          p.allocations.forEach(allocation => {
            const item = document.createElement('li');
            item.appendChild(makeElement('strong', '', allocation.name || ''));
            item.appendChild(document.createTextNode(` (${allocation.email || ''}) — `));
            item.appendChild(makeElement('strong', '', `₹${(Number(allocation.amount) || 0).toFixed(2)}`));
            list.appendChild(item);
          });
          allocationBox.appendChild(list);
        }
        card.appendChild(allocationBox);

        const actionRow = makeElement('div', 'dues-admin-action-row');
        const rejectButton = makeElement('button', 'dues-btn-primary dues-btn-danger btn-admin-reject', '');
        rejectButton.type = 'button';
        rejectButton.style.padding = '8px 16px';
        rejectButton.style.fontSize = '0.9rem';
        const rejectIcon = makeElement('i', 'fa-solid fa-xmark');
        rejectIcon.setAttribute('aria-hidden', 'true');
        rejectButton.append(rejectIcon, document.createTextNode(' Reject'));
        rejectButton.addEventListener('click', () => openRejectionModal(p.paymentId));

        const approveButton = makeElement('button', 'dues-btn-primary btn-admin-approve', '');
        approveButton.type = 'button';
        approveButton.style.padding = '8px 18px';
        approveButton.style.fontSize = '0.9rem';
        const approveIcon = makeElement('i', 'fa-solid fa-check');
        approveIcon.setAttribute('aria-hidden', 'true');
        approveButton.append(approveIcon, document.createTextNode(' Approve & Issue Receipt'));
        approveButton.addEventListener('click', () => handleApprovePayment(p.paymentId, approveButton));
        actionRow.append(rejectButton, approveButton);
        card.appendChild(actionRow);

        container.appendChild(card);
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

    // ------------------------------------------------------------------------
    // Role-Based UI Display (Chief Admin Controls)
    // ------------------------------------------------------------------------
    function applyAdminRoleUI(role) {
      state.adminRole = role;
      const isChief = role === 'CHIEF_ADMINISTRATOR';
      const membershipLink = document.getElementById('btn-membership-admin');
      if (membershipLink) membershipLink.style.display = isChief ? '' : 'none';
      const addAdminBtn = document.getElementById('btn-dues-add-admin');
      if (addAdminBtn) addAdminBtn.style.display = isChief ? '' : 'none';
    }

    // ------------------------------------------------------------------------
    // Step 12: Add Co-Administrator Modal (Chief Administrator Only)
    // ------------------------------------------------------------------------
    const addAdminModal = document.getElementById('duesAddAdminModal');
    const btnOpenAddAdmin = document.getElementById('btn-dues-add-admin');
    const btnCloseAddAdmin = document.getElementById('btnCloseAddAdmin');
    const btnCancelAddAdmin = document.getElementById('btnCancelAddAdmin');
    const btnSubmitAddCoadmin = document.getElementById('btnSubmitAddCoadmin');
    const inputCoadminName = document.getElementById('new-coadmin-name');
    const inputCoadminEmail = document.getElementById('new-coadmin-email');
    const selectCoadminRole = document.getElementById('new-coadmin-role');
    const addCoadminError = document.getElementById('add-coadmin-error');
    const addCoadminSuccess = document.getElementById('add-coadmin-success');

    function openAddAdminModal() {
      if (inputCoadminName) inputCoadminName.value = '';
      if (inputCoadminEmail) inputCoadminEmail.value = '';
      if (selectCoadminRole) selectCoadminRole.value = 'FINANCIAL_CO_ADMINISTRATOR';
      if (addCoadminError) { addCoadminError.textContent = ''; addCoadminError.style.display = 'none'; }
      if (addCoadminSuccess) { addCoadminSuccess.textContent = ''; addCoadminSuccess.style.display = 'none'; }
      if (addAdminModal) addAdminModal.classList.add('active');
    }

    function closeAddAdminModal() {
      if (addAdminModal) addAdminModal.classList.remove('active');
    }

    if (btnOpenAddAdmin) btnOpenAddAdmin.addEventListener('click', openAddAdminModal);
    if (btnCloseAddAdmin) btnCloseAddAdmin.addEventListener('click', closeAddAdminModal);
    if (btnCancelAddAdmin) btnCancelAddAdmin.addEventListener('click', closeAddAdminModal);

    if (btnSubmitAddCoadmin) {
      btnSubmitAddCoadmin.addEventListener('click', async () => {
        if (addCoadminError) { addCoadminError.textContent = ''; addCoadminError.style.display = 'none'; }
        if (addCoadminSuccess) { addCoadminSuccess.textContent = ''; addCoadminSuccess.style.display = 'none'; }

        const name = String(inputCoadminName.value || '').trim();
        const email = String(inputCoadminEmail.value || '').trim();
        const role = selectCoadminRole ? selectCoadminRole.value : 'FINANCIAL_CO_ADMINISTRATOR';

        if (!name) {
          if (addCoadminError) { addCoadminError.textContent = 'Please enter the full name.'; addCoadminError.style.display = 'block'; }
          return;
        }
        if (!email || !email.includes('@')) {
          if (addCoadminError) { addCoadminError.textContent = 'Please enter a valid email address.'; addCoadminError.style.display = 'block'; }
          return;
        }

        btnSubmitAddCoadmin.disabled = true;
        btnSubmitAddCoadmin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authorizing...';

        try {
          const result = await sendBackendRequest({
            action: 'addAdministrator',
            sessionToken: state.adminSessionToken,
            newName: name,
            newEmail: email,
            role: role
          });

          btnSubmitAddCoadmin.disabled = false;
          btnSubmitAddCoadmin.innerHTML = 'Authorize Co-Admin';

          if (result && result.success) {
            if (addCoadminSuccess) {
              addCoadminSuccess.textContent = result.message || 'Co-Administrator authorized successfully. An authorization email has been sent.';
              addCoadminSuccess.style.display = 'block';
            }
            if (inputCoadminName) inputCoadminName.value = '';
            if (inputCoadminEmail) inputCoadminEmail.value = '';
          } else {
            if (addCoadminError) {
              const isExpired = Boolean(result && result.message && (result.message.includes('expired') || result.message.includes('Authorization denied')));
              addCoadminError.textContent = isExpired ? 'Administrator session expired. Please log in again.' : (result.message || 'Unable to add co-administrator.');
              addCoadminError.style.display = 'block';
            }
          }
        } catch (err) {
          btnSubmitAddCoadmin.disabled = false;
          btnSubmitAddCoadmin.innerHTML = 'Authorize Co-Admin';
          if (addCoadminError) {
            addCoadminError.textContent = err.message || 'Network error.';
            addCoadminError.style.display = 'block';
          }
        }
      });
    }

    // ------------------------------------------------------------------------
    // Step 13: Financial Report Modal (Real Database Records Only)
    // ------------------------------------------------------------------------
    const financialReportModal = document.getElementById('duesFinancialReportModal');
    const btnOpenFinancialReport = document.getElementById('btn-dues-financial-report');
    const btnCloseFinancialReport = document.getElementById('btnCloseFinancialReport');
    const btnCloseFinancialReport2 = document.getElementById('btnCloseFinancialReport2');
    const reportLoading = document.getElementById('financial-report-loading');
    const reportContent = document.getElementById('financial-report-content');

    function closeFinancialReportModal() {
      if (financialReportModal) financialReportModal.classList.remove('active');
    }

    if (btnCloseFinancialReport) btnCloseFinancialReport.addEventListener('click', closeFinancialReportModal);
    if (btnCloseFinancialReport2) btnCloseFinancialReport2.addEventListener('click', closeFinancialReportModal);

    async function loadFinancialReport() {
      if (financialReportModal) financialReportModal.classList.add('active');
      if (reportLoading) {
        reportLoading.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Calculating financial summary from verified records...';
        reportLoading.style.display = 'block';
      }
      if (reportContent) reportContent.style.display = 'none';

      try {
        const result = await sendBackendRequest({
          action: 'getFinancialReport',
          sessionToken: state.adminSessionToken
        });

        if (result && result.success && result.report) {
          const rep = result.report;
          document.getElementById('rep-total-collected').textContent = `₹${(Number(rep.totalMoneyCollected) || 0).toFixed(2)}`;
          document.getElementById('rep-verified-count').textContent = `${rep.verifiedCount || 0} verified transactions`;
          document.getElementById('rep-dues-collected').textContent = `₹${(Number(rep.totalDuesCollected) || 0).toFixed(2)}`;
          document.getElementById('rep-contributions-collected').textContent = rep.contributionsTracked === true
            ? `₹${(Number(rep.totalContributionsCollected) || 0).toFixed(2)}`
            : 'Not tracked';
          document.getElementById('rep-upi-total').textContent = `₹${(Number(rep.totalUpiCollected) || 0).toFixed(2)}`;
          document.getElementById('rep-cash-total').textContent = `₹${(Number(rep.totalCashCollected) || 0).toFixed(2)}`;
          document.getElementById('rep-pending-amount').textContent = `₹${(Number(rep.totalPendingAmount) || 0).toFixed(2)}`;
          document.getElementById('rep-pending-count').textContent = String(rep.pendingCount || 0);

          // Populate Event Contributions Breakdown table
          const repEventsTbody = document.getElementById('rep-events-tbody');
          if (repEventsTbody) {
            repEventsTbody.replaceChildren();
            if (Array.isArray(rep.eventBreakdown) && rep.eventBreakdown.length) {
              rep.eventBreakdown.forEach(evt => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid #f1f5f9';

                const tdId = document.createElement('td');
                tdId.style.padding = '8px 10px';
                tdId.style.fontWeight = '600';
                tdId.textContent = evt.eventId || '';

                const tdTitle = document.createElement('td');
                tdTitle.style.padding = '8px 10px';
                tdTitle.textContent = evt.title || '';

                const tdStatus = document.createElement('td');
                tdStatus.style.padding = '8px 10px';
                tdStatus.innerHTML = `<span class="dues-badge dues-badge-${(evt.status || 'active').toLowerCase()}">${evt.status || 'ACTIVE'}</span>`;

                const tdContributors = document.createElement('td');
                tdContributors.style.padding = '8px 10px';
                tdContributors.textContent = String(evt.contributorsCount || 0);

                const tdCollected = document.createElement('td');
                tdCollected.style.padding = '8px 10px';
                tdCollected.style.fontWeight = '600';
                tdCollected.style.color = '#15803d';
                tdCollected.textContent = `₹${(Number(evt.totalCollected) || 0).toFixed(2)}`;

                tr.append(tdId, tdTitle, tdStatus, tdContributors, tdCollected);
                repEventsTbody.appendChild(tr);
              });
            } else {
              const emptyRow = document.createElement('tr');
              const emptyCell = document.createElement('td');
              emptyCell.colSpan = 5;
              emptyCell.style.textAlign = 'center';
              emptyCell.style.padding = '12px';
              emptyCell.style.color = 'var(--text-muted)';
              emptyCell.textContent = 'No event contribution records.';
              emptyRow.appendChild(emptyCell);
              repEventsTbody.appendChild(emptyRow);
            }
          }

          const tbody = document.getElementById('rep-transactions-tbody');
          if (tbody) {
            tbody.replaceChildren();
            if (Array.isArray(rep.verifiedPayments) && rep.verifiedPayments.length) {
              rep.verifiedPayments.forEach(p => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid #f1f5f9';

                const tdId = document.createElement('td');
                tdId.style.padding = '8px 10px';
                tdId.style.fontWeight = '600';
                tdId.textContent = p.paymentId || '';

                const tdPayer = document.createElement('td');
                tdPayer.style.padding = '8px 10px';
                tdPayer.textContent = `${p.payer || ''} (${p.payerEmail || ''})`;

                const tdMethod = document.createElement('td');
                tdMethod.style.padding = '8px 10px';
                tdMethod.textContent = p.paymentMethod || '';

                const tdAmount = document.createElement('td');
                tdAmount.style.padding = '8px 10px';
                tdAmount.style.fontWeight = '600';
                tdAmount.style.color = '#15803d';
                tdAmount.textContent = `₹${(Number(p.totalAmount) || 0).toFixed(2)}`;

                const tdDate = document.createElement('td');
                tdDate.style.padding = '8px 10px';
                tdDate.style.color = 'var(--text-muted)';
                tdDate.textContent = p.approvedDate || p.paymentDate || '';

                tr.append(tdId, tdPayer, tdMethod, tdAmount, tdDate);
                tbody.appendChild(tr);
              });
            } else {
              const emptyRow = document.createElement('tr');
              const emptyCell = document.createElement('td');
              emptyCell.colSpan = 5;
              emptyCell.style.textAlign = 'center';
              emptyCell.style.padding = '16px';
              emptyCell.style.color = 'var(--text-muted)';
              emptyCell.textContent = 'No verified collections recorded yet.';
              emptyRow.appendChild(emptyCell);
              tbody.appendChild(emptyRow);
            }
          }

          if (reportLoading) reportLoading.style.display = 'none';
          if (reportContent) reportContent.style.display = 'block';
        } else {
          if (reportLoading) {
            const isExpired = Boolean(result && result.message && (result.message.includes('expired') || result.message.includes('Authorization denied')));
            const isMissingAction = Boolean(result && result.message && result.message.includes('Invalid action: getFinancialReport'));
            const errorBox = document.createElement('div');
            errorBox.style.padding = '20px 14px';
            errorBox.style.textAlign = 'center';
            if (isMissingAction) {
              const icon = document.createElement('i');
              icon.className = 'fa-solid fa-triangle-exclamation fa-2x';
              icon.style.color = '#f59e0b';
              icon.style.display = 'block';
              icon.style.marginBottom = '8px';
              const heading = document.createElement('strong');
              heading.style.color = '#b45309';
              heading.style.display = 'block';
              heading.textContent = 'Backend Update Pending in Google Apps Script';
              const p = document.createElement('p');
              p.style.fontSize = '0.85rem';
              p.style.color = 'var(--text-muted)';
              p.style.margin = '6px 0 0';
              p.textContent = 'The financial reporting endpoint is ready in code. Please ensure Code.gs / LSU_Dues_COMPLETE_Backend.gs is updated and deployed as a New Version in the Apps Script project editor to activate live reporting.';
              errorBox.append(icon, heading, p);
            } else if (isExpired) {
              const icon = document.createElement('i');
              icon.className = 'fa-solid fa-lock fa-2x';
              icon.style.color = 'var(--error-color)';
              icon.style.display = 'block';
              icon.style.marginBottom = '8px';
              const heading = document.createElement('strong');
              heading.style.color = 'var(--error-color)';
              heading.style.display = 'block';
              heading.textContent = 'Administrator Session Expired';
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'dues-btn-primary';
              btn.style.marginTop = '12px';
              btn.style.padding = '6px 16px';
              btn.style.fontSize = '0.85rem';
              btn.textContent = 'Log In Again';
              btn.addEventListener('click', () => {
                closeFinancialReportModal();
                sessionStorage.removeItem('lsuPaymentAdminSessionToken');
                sessionStorage.removeItem('lsuPaymentAdminRole');
                state.adminSessionToken = null;
                applyAdminRoleUI(null);
                showView('view-dues-admin-login');
              });
              errorBox.append(icon, heading, btn);
            } else {
              const icon = document.createElement('i');
              icon.className = 'fa-solid fa-circle-exclamation';
              icon.style.color = 'var(--error-color)';
              errorBox.append(icon, document.createTextNode(` ${result.message || 'Unable to load financial report.'}`));
            }
            reportLoading.replaceChildren(errorBox);
          }
        }
      } catch (err) {
        if (reportLoading) {
          const errorMessage = document.createElement('span');
          errorMessage.style.color = 'var(--error-color)';
          const icon = document.createElement('i');
          icon.className = 'fa-solid fa-circle-exclamation';
          icon.setAttribute('aria-hidden', 'true');
          errorMessage.append(icon, document.createTextNode(' Network error loading report.'));
          reportLoading.replaceChildren(errorMessage);
        }
      }
    }

    if (btnOpenFinancialReport) btnOpenFinancialReport.addEventListener('click', loadFinancialReport);

    // Default dates
    const savedToken = sessionStorage.getItem('lsuPaymentAdminSessionToken');
    const savedRole = sessionStorage.getItem('lsuPaymentAdminRole');
    if (savedToken) {
      applyAdminRoleUI(savedRole);
    }
    if (new URLSearchParams(window.location.search).get('admin') === 'finance') {
      showView('view-dues-admin-login');
    }
    const today = new Date().toISOString().split('T')[0];
    document.querySelectorAll('input[type="date"]').forEach((picker) => {
      if (!picker.value) picker.value = today;
    });
  });
})();
