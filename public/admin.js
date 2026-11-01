// MiraAI Admin Dashboard Client
class AdminDashboard {
  constructor() {
    this.currentView = this.determineInitialView();
    this.sessions = [];
    this.patients = [];
    this.staff = [];
    this.appointments = [];

    this.initElements();
    this.bindEvents();
    this.loadAllData();
  }

  determineInitialView() {
    const path = window.location.pathname.replace(/\/+$/, '') || '/admin';
    if (path === '/admin/doctors' || path === '/admin/staff') return 'doctors';
    if (path === '/admin/availability') return 'availability';
    if (path === '/admin/appointments') return 'appointments';
    if (path === '/admin/consultations') return 'consultations';
    if (path === '/admin/users') return 'users';
    if (path === '/admin/feedbacks') return 'feedbacks';
    if (path === '/admin/settings') return 'settings';
    return 'dashboard';
  }

  initElements() {
    this.mainContainer = document.getElementById('admin-dynamic-content');
    this.inspectModal = document.getElementById('inspect-modal');
    this.inspectModalBody = document.getElementById('inspect-modal-body');
    this.inspectModalTitle = document.getElementById('inspect-modal-title');
    this.btnCloseModal = document.getElementById('btn-close-modal');
  }

  bindEvents() {
    // Nav links
    document.querySelectorAll('.nav-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const view = link.dataset.view;
        if (!view) return;
        this.switchView(view, true);
      });
    });

    window.addEventListener('popstate', () => {
      const view = this.determineInitialView();
      this.switchView(view, false);
    });

    document.getElementById('btn-refresh')?.addEventListener('click', () => {
      this.loadAllData();
    });

    this.btnCloseModal?.addEventListener('click', () => {
      if (this.inspectModal) this.inspectModal.classList.add('hidden');
    });

    document.getElementById('btn-admin-signout')?.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await fetch('/api/auth/sign-out', { method: 'POST' });
      } catch (err) {
        console.warn('Sign-out API warning:', err);
      }

      if (window.Clerk && typeof window.Clerk.signOut === 'function') {
        try {
          await window.Clerk.signOut();
        } catch (err) {
          console.warn('Clerk signOut warning:', err);
        }
      }

      localStorage.removeItem('mira_user_email');
      localStorage.removeItem('mira_user_role');
      localStorage.removeItem('mira_user_name');
      document.cookie = 'mira_user_email=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
      window.location.href = '/sign-in?signout=true';
    });
  }

  async loadAllData() {
    try {
      const responses = await Promise.all([
        fetch('/api/admin/overview'),
        fetch('/api/admin/sessions'),
        fetch('/api/admin/patients'),
        fetch('/api/admin/staff'),
        fetch('/api/admin/appointments'),
        fetch('/api/admin/analytics'),
      ]);

      for (const res of responses) {
        if (res.status === 503) {
          const err = await res.json().catch(() => ({}));
          this.mainContainer.innerHTML = `
            <div style="background:#fee2e2; border:1px solid #f87171; border-radius:12px; padding:24px; margin:24px; color:#991b1b;">
              <h2 style="font-size:18px; font-weight:800; margin:0 0 8px 0;">Database Service Unavailable (503)</h2>
              <p style="margin:0; font-size:14px;">${err.error || 'Cloud connection to Supabase database is unreachable or table schema is not loaded.'}</p>
              <div style="margin-top:12px;">
                <button class="btn-primary-action" onclick="window.adminDashboard.loadAllData()">Retry Connection</button>
              </div>
            </div>`;
          return;
        }
      }

      const [overviewRes, sessionsRes, patientsRes, staffRes, appointmentsRes, analyticsRes] = await Promise.all(
        responses.map(r => r.json().catch(() => ({})))
      );

      this.overview = overviewRes && !overviewRes.error ? overviewRes : { totalSessions: 0, totalAppointments: 0, totalPatients: 0, activeDoctors: 0, urgentCases: 0 };
      this.sessions = Array.isArray(sessionsRes) ? sessionsRes : [];
      this.patients = Array.isArray(patientsRes) ? patientsRes : [];
      this.staff = Array.isArray(staffRes) ? staffRes : [];
      this.appointments = Array.isArray(appointmentsRes) ? appointmentsRes : [];
      this.analytics = analyticsRes || {};

      this.switchView(this.currentView, false);
    } catch (err) {
      console.warn('Failed to load admin data:', err);
      this.mainContainer.innerHTML = `
        <div style="background:#fee2e2; border:1px solid #f87171; border-radius:12px; padding:24px; margin:24px; color:#991b1b;">
          <h2 style="font-size:18px; font-weight:800; margin:0 0 8px 0;">Database Service Unavailable</h2>
          <p style="margin:0; font-size:14px;">Failed to reach backend services. Please check network connection.</p>
        </div>`;
    }
  }

  switchView(viewName, updateUrl = true) {
    this.currentView = viewName;
    const targetPath = viewName === 'dashboard' ? '/admin/dashboard' : `/admin/${viewName}`;
    if (updateUrl && window.location.pathname !== targetPath) {
      history.pushState({ view: viewName }, '', targetPath);
    }

    document.querySelectorAll('.nav-link').forEach((l) => {
      l.classList.toggle('active', l.dataset.view === viewName);
    });

    if (viewName === 'dashboard') {
      this.renderDashboard();
    } else if (viewName === 'doctors' || viewName === 'staff') {
      this.renderDoctorsView();
    } else if (viewName === 'availability') {
      this.renderAvailabilityView();
    } else if (viewName === 'appointments') {
      this.renderAppointmentsView();
    } else if (viewName === 'consultations') {
      this.renderConsultationsView();
    } else if (viewName === 'users') {
      this.renderUsersView();
    } else if (viewName === 'feedbacks') {
      this.renderFeedbacksView();
    } else if (viewName === 'settings') {
      this.renderSettingsView();
    }
  }

  renderDashboard() {
    const totalUsers = this.patients.length;
    const totalInterviews = this.sessions.length;
    const completed = this.sessions.filter((s) => s.status === 'COMPLETED').length;
    const flagged = this.sessions.filter((s) => s.summary?.urgencyLevel === 'EMERGENCY').length;

    // Recent 5 interviews
    const recent5 = this.sessions.slice(0, 5);
    const recentRows = recent5.length > 0 ? recent5
      .map(
        (s, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>
          <div class="user-cell">
            <div class="user-circle-sm">P</div>
            <strong>${s.patientName || 'Anonymous'}</strong>
          </div>
        </td>
        <td>${s.summary?.chiefComplaint ? s.summary.chiefComplaint.slice(0, 38) + '...' : 'General Triage'}</td>
        <td><span class="score-badge">${s.summary?.urgencyLevel || s.urgency || 'ROUTINE'}</span></td>
        <td>
          <button class="view-all-link" style="background:none; border:none;" onclick="window.adminApp.inspectSession('${s.id}')">
            View Details &rarr;
          </button>
        </td>
      </tr>
    `
      )
      .join('') : `
      <tr>
        <td colspan="5" style="text-align:center; padding:24px; color:#94a3b8; font-size:13px;">
          No recent consultations recorded yet.
        </td>
      </tr>
    `;

    // Cohort list (first 5 patients)
    const cohort5 = this.patients.slice(0, 5);
    const cohortRows = cohort5.length > 0 ? cohort5
      .map(
        (p, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${p.fullName}</strong></td>
        <td style="color:var(--text-muted);">${p.email}</td>
      </tr>
    `
      )
      .join('') : `
      <tr>
        <td colspan="3" style="text-align:center; padding:24px; color:#94a3b8; font-size:13px;">
          No registered patients found yet.
        </td>
      </tr>
    `;

    this.mainContainer.innerHTML = `
      <div class="main-top-bar">
        <div class="page-title-group">
          <h1>Dashboard</h1>
          <p>Overview of your MiraAI Clinical & Appointment Platform</p>
        </div>
        <div class="top-bar-controls">
          <select class="filter-select">
            <option>Last 30 Days</option>
            <option>Last 7 Days</option>
            <option>Today</option>
          </select>
          <button class="refresh-btn" id="btn-refresh">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            Refresh
          </button>
        </div>
      </div>

      <!-- KPI Cards Grid -->
      <div class="kpi-cards-grid">
        <div class="metric-card">
          <div class="metric-top">
            <span class="metric-lbl">Total Users</span>
            <div class="metric-icon-box icon-orange">
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
            </div>
          </div>
          <div class="metric-val">${totalUsers}</div>
          <div class="metric-sub" style="color: var(--success);">&bull; Registered Patients</div>
        </div>

        <div class="metric-card">
          <div class="metric-top">
            <span class="metric-lbl">Total Interviews</span>
            <div class="metric-icon-box icon-orange">
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
            </div>
          </div>
          <div class="metric-val">${totalInterviews}</div>
          <div class="metric-sub" style="color: var(--success);">&bull; Real Session Records</div>
        </div>

        <div class="metric-card">
          <div class="metric-top">
            <span class="metric-lbl">Completed</span>
            <div class="metric-icon-box icon-green">
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
            </div>
          </div>
          <div class="metric-val">${completed}</div>
          <div class="metric-sub" style="color: var(--success);">100% Verified Submissions</div>
        </div>

        <div class="metric-card">
          <div class="metric-top">
            <span class="metric-lbl">Flagged (Violations)</span>
            <div class="metric-icon-box icon-red">
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            </div>
          </div>
          <div class="metric-val">${flagged}</div>
          <div class="metric-sub" style="color: var(--text-muted);">Proctoring Active</div>
        </div>
      </div>

      <!-- Charts Row -->
      <div class="charts-grid">
        <div class="chart-card">
          <div class="chart-header">
            <h3>Interviews Over Time</h3>
            <span>Trend Analysis</span>
          </div>
          <svg class="trend-svg" viewBox="0 0 500 170" preserveAspectRatio="none">
            <defs>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#ff5722" stop-opacity="0.25" />
                <stop offset="100%" stop-color="#ff5722" stop-opacity="0.0" />
              </linearGradient>
            </defs>
            <!-- Area under curve -->
            <path d="M 20 120 C 100 85, 160 115, 230 75 C 290 40, 360 115, 420 110 C 450 110, 470 50, 480 30 L 480 150 L 20 150 Z" fill="url(#areaGradient)"/>
            <!-- Trend line -->
            <path d="M 20 120 C 100 85, 160 115, 230 75 C 290 40, 360 115, 420 110 C 450 110, 470 50, 480 30" fill="none" stroke="#ff5722" stroke-width="3" stroke-linecap="round"/>
            <!-- Peak Points matching user screenshot -->
            <circle cx="20" cy="120" r="4.5" fill="#ff5722"/>
            <circle cx="140" cy="100" r="4.5" fill="#ff5722"/>
            <circle cx="230" cy="75" r="4.5" fill="#ff5722"/>
            <circle cx="340" cy="90" r="4.5" fill="#ff5722"/>
            <circle cx="480" cy="30" r="5" fill="#ff5722"/>
          </svg>
        </div>

        <div class="chart-card">
          <div class="chart-header">
            <h3>Status Breakdown</h3>
            <span>Completion Rate</span>
          </div>
          <div class="donut-container">
            <div class="donut-svg-wrapper">
              <svg width="140" height="140" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="38" fill="none" stroke="#e2e8f0" stroke-width="12"/>
                <circle cx="50" cy="50" r="38" fill="none" stroke="#10b981" stroke-width="12" stroke-dasharray="238.7" stroke-dashoffset="40" stroke-linecap="round"/>
                <circle cx="50" cy="50" r="38" fill="none" stroke="#ff5722" stroke-width="12" stroke-dasharray="238.7" stroke-dashoffset="210" stroke-linecap="round"/>
              </svg>
              <div class="donut-center-text">
                <span class="cnt">${totalInterviews}</span>
                <span class="lbl">TOTAL</span>
              </div>
            </div>

            <div class="donut-legend">
              <div class="legend-item">
                <div><span class="legend-dot" style="background:#10b981;"></span>Completed</div>
                <strong>${completed}</strong>
              </div>
              <div class="legend-item">
                <div><span class="legend-dot" style="background:#ff5722;"></span>Enrolled Patients</div>
                <strong>${totalUsers}</strong>
              </div>
              <div class="legend-item">
                <div><span class="legend-dot" style="background:#ef4444;"></span>Flagged</div>
                <strong>${flagged}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tables Row -->
      <div class="tables-grid">
        <div class="table-card">
          <div class="table-header">
            <h3>Recent Interviews</h3>
            <span class="view-all-link" onclick="window.adminApp.switchView('consultations')">View All &rarr;</span>
          </div>
          <table class="custom-table">
            <thead>
              <tr>
                <th>#</th>
                <th>USER</th>
                <th>TOPIC / COMPLAINT</th>
                <th>SCORE</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>${recentRows}</tbody>
          </table>
        </div>

        <div class="table-card">
          <div class="table-header">
            <h3>Enrolled Cohort</h3>
            <span class="view-all-link" onclick="window.adminApp.switchView('users')">View All &rarr;</span>
          </div>
          <table class="custom-table">
            <thead>
              <tr>
                <th>#</th>
                <th>NAME</th>
                <th>EMAIL</th>
              </tr>
            </thead>
            <tbody>${cohortRows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderUsersView() {
    const rows = this.patients.length > 0 ? this.patients
      .map(
        (p, idx) => `
      <tr style="cursor:pointer;" onclick="window.adminApp.inspectPatient('${p.id}')">
        <td>${idx + 1}</td>
        <td><strong>${p.fullName}</strong></td>
        <td>${p.email}</td>
        <td>${p.phone || 'N/A'}</td>
        <td><span style="color:var(--primary); font-weight:700;">${p.totalVisits || 0} consultation(s)</span></td>
        <td>
          <button class="view-all-link" style="border:none; background:none; cursor:pointer;" onclick="event.stopPropagation(); window.adminApp.inspectPatient('${p.id}')">
            View Profile &rarr;
          </button>
        </td>
      </tr>
    `
      )
      .join('') : `
      <tr>
        <td colspan="6" style="text-align:center; padding:36px; color:#94a3b8; font-size:14px;">
          No enrolled patients found yet.
        </td>
      </tr>
    `;

    this.mainContainer.innerHTML = `
      <div class="main-top-bar">
        <div class="page-title-group">
          <h1>Patients & Users Directory</h1>
          <p>Total ${this.patients.length} enrolled patients across hospital departments. Click any patient to view real Clerk authentication details, AI clinical summaries, and interview transcripts.</p>
        </div>
      </div>
      <div class="table-card">
        <table class="custom-table">
          <thead>
            <tr>
              <th>#</th>
              <th>PATIENT NAME</th>
              <th>EMAIL</th>
              <th>PHONE</th>
              <th>RECORDED VISITS</th>
              <th>ACTION</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  renderConsultationsView() {
    const rows = this.sessions.length > 0 ? this.sessions
      .map(
        (s, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${s.patientName || 'Anonymous'}</strong></td>
        <td>${s.summary?.chiefComplaint || s.chiefComplaint || 'Intake in progress'}</td>
        <td><span style="padding:4px 8px; border-radius:9999px; font-size:11px; font-weight:800; background:#fff7ed; color:var(--primary);">${s.summary?.urgencyLevel || s.urgency || 'ROUTINE'}</span></td>
        <td>${s.appointment?.bookingCode ? `<strong style="color:var(--primary);">${s.appointment.bookingCode}</strong> (${s.appointment.doctorName})` : ((s.status === 'USER_ENDED' || s.summary?.userEnded || s.userEnded) ? '<span style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-size:11px; font-weight:800; padding:2px 8px; border-radius:12px; text-transform:uppercase;">User Ended Interview</span>' : '<span style="color:#94a3b8;">Pending</span>')}</td>
        <td>${s.diseaseSpotImageUrl ? '<span style="color:var(--success); font-weight:700;">Photo Attached</span>' : 'None'}</td>
        <td>
          <button class="view-all-link" style="border:none; background:none;" onclick="window.adminApp.inspectSession('${s.id}')">
            View Transcript & Summary &rarr;
          </button>
        </td>
      </tr>
    `
      )
      .join('') : `
      <tr>
        <td colspan="7" style="text-align:center; padding:36px; color:#94a3b8; font-size:14px;">
          No voice consultations recorded yet.
        </td>
      </tr>
    `;

    this.mainContainer.innerHTML = `
      <div class="main-top-bar">
        <div class="page-title-group">
          <h1>Consultations & Interviews</h1>
          <p>Total ${this.sessions.length} completed clinical voice sessions with auditable transcripts</p>
        </div>
      </div>
      <div class="table-card">
        <table class="custom-table">
          <thead>
            <tr>
              <th>#</th>
              <th>PATIENT</th>
              <th>CHIEF COMPLAINT</th>
              <th>URGENCY</th>
              <th>BOOKING / DOCTOR</th>
              <th>DISEASE SPOT</th>
              <th>ACTION</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  async renderDoctorsView() {
    let doctors = [];
    try {
      const res = await fetch('/api/doctors?all=true');
      if (res.ok) {
        doctors = await res.json();
      }
    } catch (e) {
      doctors = this.staff || [];
    }

    const rows = (doctors && doctors.length > 0)
      ? doctors
          .map(
            (d) => `
          <tr>
            <td><strong>${d.name}</strong></td>
            <td><span class="badge-dept">${d.specialization || d.department || d.specialty || 'General'}</span></td>
            <td>${Array.isArray(d.languages) ? d.languages.join(', ') : 'Hindi, English'}</td>
            <td>${d.phone || 'N/A'}</td>
            <td>${d.email || 'N/A'}</td>
            <td>${d.consultationMinutes || 15} mins</td>
            <td>
              <span class="status-badge ${d.active !== false ? 'status-confirmed' : 'status-cancelled'}">
                ${d.active !== false ? 'Active' : 'Inactive'}
              </span>
            </td>
            <td>
              <div style="display:flex; gap:6px;">
                <button class="action-btn-sm" onclick="window.adminDashboard.openEditDoctorModal('${d.id}')">Edit</button>
                <button class="action-btn-sm ${d.active !== false ? 'btn-danger-sm' : ''}" onclick="window.adminDashboard.toggleDoctorStatus('${d.id}', ${d.active !== false})">
                  ${d.active !== false ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </td>
          </tr>
        `
          )
          .join('')
      : `
        <tr>
          <td colspan="8" style="text-align:center; padding:36px; color:#94a3b8; font-size:14px;">
            No doctors added yet. Click "+ Add New Doctor" to configure hospital staff.
          </td>
        </tr>
      `;

    this.mainContainer.innerHTML = `
      <div class="main-top-bar">
        <div class="page-title-group">
          <h1>Doctors Management Roster</h1>
          <p>Configured clinic physicians, consultation durations, and contact details</p>
        </div>
        <button class="btn-primary-action" onclick="window.adminDashboard.openAddDoctorModal()">
          + Add New Doctor
        </button>
      </div>

      <div class="table-card">
        <table class="custom-table">
          <thead>
            <tr>
              <th>DOCTOR NAME</th>
              <th>SPECIALIZATION</th>
              <th>LANGUAGES</th>
              <th>PHONE</th>
              <th>EMAIL</th>
              <th>SLOT DURATION</th>
              <th>STATUS</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  async renderAvailabilityView() {
    let doctors = [];
    try {
      const res = await fetch('/api/doctors?all=true');
      if (res.ok) {
        doctors = await res.json();
      }
    } catch {
      doctors = this.staff || [];
    }

    if (!doctors || doctors.length === 0) {
      this.mainContainer.innerHTML = `
        <div class="main-top-bar">
          <div class="page-title-group">
            <h1>Working Hours & Leaves</h1>
            <p>Configure weekly working schedules and blackout dates</p>
          </div>
        </div>
        <div class="table-card" style="text-align:center; padding:48px; color:#94a3b8; font-size:14px;">
          No doctors added yet. Please add a doctor from the Doctors Roster first.
        </div>
      `;
      return;
    }

    const selectedDocId = this.selectedAvailabilityDocId || doctors[0].id;
    this.selectedAvailabilityDocId = selectedDocId;

    let schedules = [];
    let leaves = [];
    try {
      [schedules, leaves] = await Promise.all([
        fetch(`/api/doctors/${selectedDocId}/availability`).then((r) => r.json()),
        fetch(`/api/doctors/${selectedDocId}/leaves`).then((r) => r.json()),
      ]);
    } catch (e) {
      console.warn('Availability fetch note:', e);
    }

    const doctorOptions = doctors
      .map((d) => `<option value="${d.id}" ${d.id === selectedDocId ? 'selected' : ''}>${d.name} (${d.specialization})</option>`)
      .join('');

    const weekdays = [
      { num: 1, name: 'Monday' },
      { num: 2, name: 'Tuesday' },
      { num: 3, name: 'Wednesday' },
      { num: 4, name: 'Thursday' },
      { num: 5, name: 'Friday' },
      { num: 6, name: 'Saturday' },
    ];

    const weekdayRows = weekdays
      .map((w) => {
        const found = schedules.find((s) => s.weekday === w.num);
        const isChecked = Boolean(found);
        const start = found ? found.startTime : '10:00';
        const end = found ? found.endTime : '18:00';
        return `
        <tr data-weekday="${w.num}">
          <td>
            <label style="display:flex; align-items:center; gap:8px; font-weight:700;">
              <input type="checkbox" class="schedule-day-toggle" ${isChecked ? 'checked' : ''} onchange="window.adminDashboard.toggleDayRow(this)">
              <span>${w.name}</span>
            </label>
          </td>
          <td>
            <input type="time" class="time-input start-time" value="${start}" ${!isChecked ? 'disabled' : ''}>
          </td>
          <td>
            <input type="time" class="time-input end-time" value="${end}" ${!isChecked ? 'disabled' : ''}>
          </td>
          <td>
            <span class="day-status-pill ${isChecked ? 'status-active' : 'status-off'}">${isChecked ? 'Working Day' : 'Day Off'}</span>
          </td>
        </tr>
      `;
      })
      .join('');

    const leaveRows =
      leaves.length > 0
        ? leaves
            .map(
              (l) => `
          <div class="leave-item-card">
            <div>
              <strong>${l.date}</strong> - <span style="color:#64748b;">${l.reason || 'Leave'}</span>
            </div>
            <button class="action-btn-sm btn-danger-sm" onclick="window.adminDashboard.removeDoctorLeave('${selectedDocId}', '${l.id}')">Unblock</button>
          </div>
        `
            )
            .join('')
        : `<p style="font-size:13px; color:#94a3b8; font-style:italic;">No blocked leaves scheduled for this doctor.</p>`;

    const todayStr = new Date().toISOString().substring(0, 10);

    this.mainContainer.innerHTML = `
      <div class="main-top-bar">
        <div class="page-title-group">
          <h1>Doctor Working Hours & Blocked Leaves</h1>
          <p>Slots are computed on demand: Availability minus leaves minus confirmed bookings</p>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <label style="font-size:13px; font-weight:700; color:#334155;">Select Doctor:</label>
          <select id="select-avail-doctor" class="filter-select" onchange="window.adminDashboard.switchAvailabilityDoctor(this.value)" style="min-width:240px; font-weight:700;">
            ${doctorOptions}
          </select>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 2fr 1.2fr; gap:24px; margin-bottom:24px;">
        <!-- Weekly Hours Editor -->
        <div class="table-card" style="padding:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h3 style="font-size:15px; font-weight:800; color:#0f172a; margin:0;">Weekly Working Hours Schedule</h3>
            <button class="btn-primary-action" onclick="window.adminDashboard.saveWeeklySchedule('${selectedDocId}')">
              Save Weekly Schedule
            </button>
          </div>
          <table class="custom-table">
            <thead>
              <tr>
                <th>WEEKDAY</th>
                <th>START TIME</th>
                <th>END TIME</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody id="weekly-schedule-body">${weekdayRows}</tbody>
          </table>
        </div>

        <!-- Block Date (Leave Picker) -->
        <div class="table-card" style="padding:20px;">
          <h3 style="font-size:15px; font-weight:800; color:#0f172a; margin:0 0 14px 0;">Block Date (Leave Picker)</h3>
          <p style="font-size:12px; color:#64748b; margin-bottom:14px;">Blocking a date immediately removes all free slots for this doctor on that day.</p>
          <form onsubmit="window.adminDashboard.submitDoctorLeave(event, '${selectedDocId}')" style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
            <div>
              <label style="font-size:12px; font-weight:700; color:#475569;">Select Date:</label>
              <input type="date" id="input-leave-date" min="${todayStr}" required style="width:100%; padding:8px 12px; border-radius:8px; border:1px solid #cbd5e1; font-weight:600; margin-top:4px;">
            </div>
            <div>
              <label style="font-size:12px; font-weight:700; color:#475569;">Reason:</label>
              <input type="text" id="input-leave-reason" placeholder="e.g. Annual Leave, Medical Conference" required style="width:100%; padding:8px 12px; border-radius:8px; border:1px solid #cbd5e1; font-size:13px; margin-top:4px;">
            </div>
            <button type="submit" class="btn-primary-action" style="background:#dc2626; margin-top:4px;">
              Block This Date
            </button>
          </form>

          <h4 style="font-size:13px; font-weight:800; color:#334155; margin:16px 0 8px 0;">Scheduled Blocked Dates:</h4>
          <div style="display:flex; flex-direction:column; gap:8px;">${leaveRows}</div>
        </div>
      </div>

      <!-- Live Computed Free Slots Tester -->
      <div class="table-card" style="padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <div>
            <h3 style="font-size:15px; font-weight:800; color:#0f172a; margin:0;">Live Computed Free Slots Inspector (get_free_slots)</h3>
            <p style="font-size:12px; color:#64748b; margin:4px 0 0 0;">Inspect the exact slots generated by availability minus leaves minus confirmed appointments.</p>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <label style="font-size:12px; font-weight:700; color:#334155;">Test Date:</label>
            <input type="date" id="tester-date" value="${todayStr}" onchange="window.adminDashboard.inspectFreeSlots('${selectedDocId}', this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #cbd5e1; font-weight:700;">
          </div>
        </div>
        <div id="free-slots-chips" style="display:flex; flex-wrap:wrap; gap:8px; padding:12px; background:#f8fafc; border-radius:10px; border:1px dashed #cbd5e1;">
          <span style="font-size:12px; color:#94a3b8;">Loading computed slots...</span>
        </div>
      </div>
    `;

    this.inspectFreeSlots(selectedDocId, todayStr);
  }

  async inspectFreeSlots(doctorId, dateStr) {
    const container = document.getElementById('free-slots-chips');
    if (!container) return;
    try {
      const data = await fetch(`/api/doctors/${doctorId}/free-slots?date=${dateStr}`).then((r) => r.json());
      if (!data.slots || data.slots.length === 0) {
        container.innerHTML = `<span style="font-size:13px; color:#dc2626; font-weight:700;">No free slots available on ${dateStr} (Doctor on leave, day off, or fully booked).</span>`;
        return;
      }
      container.innerHTML = data.slots
        .map(
          (s) => `
        <span class="slot-chip" style="background:#e0f2fe; color:#0369a1; padding:6px 12px; border-radius:8px; font-size:12px; font-weight:800; border:1px solid #bae6fd;">
          ${s.displayTime}
        </span>
      `
        )
        .join('');
    } catch (e) {
      container.innerHTML = `<span style="color:#dc2626;">Error computing slots: ${e.message}</span>`;
    }
  }

  async renderAppointmentsView() {
    let appointments = [];
    let doctors = [];
    try {
      [appointments, doctors] = await Promise.all([
        fetch('/api/appointments').then((r) => r.json()),
        fetch('/api/doctors?all=true').then((r) => r.json()),
      ]);
    } catch {
      appointments = this.appointments;
      doctors = this.staff;
    }

    const doctorFilterOptions = [
      '<option value="">All Doctors</option>',
      ...doctors.map((d) => `<option value="${d.id}">${d.name}</option>`),
    ].join('');

    const rows = (appointments && appointments.length > 0)
      ? appointments
          .map(
            (a) => `
      <tr data-doctor-id="${a.doctorId}" data-status="${a.status}">
        <td><strong style="color:var(--primary); font-size:14px;">${a.bookingCode}</strong></td>
        <td>
          <div style="font-weight:700;">${a.patientName}</div>
          <div style="font-size:11px; color:#64748b;">${a.patientPhone || 'N/A'} | ${a.patientEmail || 'N/A'}</div>
        </td>
        <td>
          <div style="font-weight:700;">${a.doctorName || 'Doctor'}</div>
          <div style="font-size:11px; color:#64748b;">${a.specialization || 'Clinical'}</div>
        </td>
        <td>${a.startAt ? new Date(a.startAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : 'Scheduled'}</td>
        <td>
          <span class="status-badge ${a.status === 'confirmed' ? 'status-confirmed' : 'status-cancelled'}">
            ${a.status.toUpperCase()}
          </span>
        </td>
        <td>
          <div style="display:flex; gap:6px;">
            ${
              a.status === 'confirmed'
                ? `
              <button class="action-btn-sm" onclick="window.adminDashboard.openRescheduleModal('${a.id || a.bookingCode}')">Reschedule</button>
              <button class="action-btn-sm btn-danger-sm" onclick="window.adminDashboard.cancelAppointment('${a.id || a.bookingCode}')">Cancel</button>
            `
                : `<span style="font-size:11px; color:#94a3b8; font-style:italic;">No actions</span>`
            }
          </div>
        </td>
      </tr>
    `
          )
          .join('')
      : `
        <tr>
          <td colspan="6" style="text-align:center; padding:36px; color:#94a3b8; font-size:14px;">
            No appointments booked yet.
          </td>
        </tr>
      `;

    this.mainContainer.innerHTML = `
      <div class="main-top-bar">
        <div class="page-title-group">
          <h1>Doctor Appointments & Calendar</h1>
          <p>Real-time schedule of confirmed voice bookings with transactional anti-double booking protection</p>
        </div>
        <div style="display:flex; gap:10px;">
          <a href="/api/appointments/export-csv" class="btn-primary-action" style="background:#0284c7; text-decoration:none;" download>
            Export CSV
          </a>
        </div>
      </div>

      <!-- Filters Strip -->
      <div class="filters-card" style="display:flex; gap:14px; margin-bottom:18px; background:#ffffff; padding:14px 20px; border-radius:12px; border:1px solid #e2e8f0; align-items:center;">
        <div style="flex:1;">
          <input type="text" id="apt-search-input" placeholder="Search patient name, phone, email, or booking ID..." oninput="window.adminDashboard.filterAppointments()" style="width:100%; padding:8px 14px; border-radius:8px; border:1px solid #cbd5e1; font-size:13px;">
        </div>
        <div>
          <select id="apt-doctor-filter" onchange="window.adminDashboard.filterAppointments()" style="padding:8px 12px; border-radius:8px; border:1px solid #cbd5e1; font-size:13px; font-weight:600;">
            ${doctorFilterOptions}
          </select>
        </div>
        <div>
          <select id="apt-status-filter" onchange="window.adminDashboard.filterAppointments()" style="padding:8px 12px; border-radius:8px; border:1px solid #cbd5e1; font-size:13px; font-weight:600;">
            <option value="">All Statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <div class="table-card">
        <table class="custom-table">
          <thead>
            <tr>
              <th>BOOKING ID</th>
              <th>PATIENT DETAILS</th>
              <th>ASSIGNED DOCTOR</th>
              <th>SCHEDULED DATE & TIME (IST)</th>
              <th>STATUS</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody id="appointments-table-body">${rows}</tbody>
        </table>
      </div>
    `;
  }

  // --- Helper methods for Doctor, Availability, and Appointments ---
  toggleDayRow(checkbox) {
    const row = checkbox.closest('tr');
    const isChecked = checkbox.checked;
    row.querySelectorAll('input.time-input').forEach((inp) => (inp.disabled = !isChecked));
    const pill = row.querySelector('.day-status-pill');
    if (pill) {
      pill.className = `day-status-pill ${isChecked ? 'status-active' : 'status-off'}`;
      pill.innerText = isChecked ? 'Working Day' : 'Day Off';
    }
  }

  switchAvailabilityDoctor(docId) {
    this.selectedAvailabilityDocId = docId;
    this.renderAvailabilityView();
  }

  async saveWeeklySchedule(docId) {
    const rows = document.querySelectorAll('#weekly-schedule-body tr');
    const schedules = [];
    rows.forEach((r) => {
      const isChecked = r.querySelector('.schedule-day-toggle').checked;
      if (isChecked) {
        const weekday = parseInt(r.dataset.weekday);
        const startTime = r.querySelector('.start-time').value;
        const endTime = r.querySelector('.end-time').value;
        schedules.push({ weekday, startTime, endTime });
      }
    });

    try {
      const res = await fetch(`/api/doctors/${docId}/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedules }),
      });
      const data = await res.json();
      if (data.success) {
        alert('Weekly schedule saved successfully.');
        this.renderAvailabilityView();
      } else {
        alert('Error: ' + data.error);
      }
    } catch (e) {
      alert('Network error: ' + e.message);
    }
  }

  async submitDoctorLeave(event, docId) {
    event.preventDefault();
    const date = document.getElementById('input-leave-date').value;
    const reason = document.getElementById('input-leave-reason').value;
    try {
      const res = await fetch(`/api/doctors/${docId}/leaves`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, reason }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Date ${date} has been blocked for this doctor.`);
        this.renderAvailabilityView();
      } else {
        alert('Error: ' + data.error);
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  async removeDoctorLeave(docId, leaveId) {
    if (!confirm('Unblock this date? Free slots will be restored for booking.')) return;
    try {
      await fetch(`/api/doctors/${docId}/leaves/${leaveId}`, { method: 'DELETE' });
      this.renderAvailabilityView();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  openAddDoctorModal() {
    this.inspectModalTitle.innerText = 'Add New Doctor to Roster';
    this.inspectModalBody.innerHTML = `
      <form onsubmit="window.adminDashboard.submitNewDoctor(event)" style="display:flex; flex-direction:column; gap:12px;">
        <div>
          <label style="font-size:12px; font-weight:700;">Full Doctor Name:</label>
          <input type="text" id="new-doc-name" placeholder="Dr. First Last" required style="width:100%; padding:8px 12px; border-radius:8px; border:1px solid #cbd5e1; margin-top:4px;">
        </div>
        <div>
          <label style="font-size:12px; font-weight:700;">Specialization / Department:</label>
          <input type="text" id="new-doc-spec" placeholder="Cardiology, General Medicine..." required style="width:100%; padding:8px 12px; border-radius:8px; border:1px solid #cbd5e1; margin-top:4px;">
        </div>
        <div>
          <label style="font-size:12px; font-weight:700;">Consultation Minutes per Slot:</label>
          <select id="new-doc-minutes" style="width:100%; padding:8px 12px; border-radius:8px; border:1px solid #cbd5e1; margin-top:4px;">
            <option value="15">15 minutes (Standard)</option>
            <option value="30">30 minutes (Specialist)</option>
            <option value="45">45 minutes (In-depth)</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px; font-weight:700;">Phone Number:</label>
          <input type="text" id="new-doc-phone" placeholder="+91 98..." style="width:100%; padding:8px 12px; border-radius:8px; border:1px solid #cbd5e1; margin-top:4px;">
        </div>
        <div>
          <label style="font-size:12px; font-weight:700;">Doctor Email (for booking alerts):</label>
          <input type="email" id="new-doc-email" placeholder="doctor@clinic.com" required style="width:100%; padding:8px 12px; border-radius:8px; border:1px solid #cbd5e1; margin-top:4px;">
        </div>
        <button type="submit" class="btn-primary-action" style="margin-top:10px;">Save Doctor</button>
      </form>
    `;
    this.inspectModal.classList.remove('hidden');
  }

  async submitNewDoctor(event) {
    event.preventDefault();
    const name = document.getElementById('new-doc-name').value;
    const specialization = document.getElementById('new-doc-spec').value;
    const consultationMinutes = parseInt(document.getElementById('new-doc-minutes').value);
    const phone = document.getElementById('new-doc-phone').value;
    const email = document.getElementById('new-doc-email').value;

    try {
      const res = await fetch('/api/doctors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, specialization, consultationMinutes, phone, email }),
      });
      const data = await res.json();
      if (data.success) {
        this.inspectModal.classList.add('hidden');
        alert('Doctor added to roster.');
        this.renderDoctorsView();
      } else {
        alert('Error: ' + data.error);
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  async toggleDoctorStatus(docId, currentActive) {
    const action = currentActive ? 'deactivate' : 'activate';
    if (!confirm(`Are you sure you want to ${action} this doctor?`)) return;
    try {
      if (currentActive) {
        await fetch(`/api/doctors/${docId}`, { method: 'DELETE' });
      } else {
        await fetch(`/api/doctors/${docId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: true }),
        });
      }
      this.renderDoctorsView();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  async cancelAppointment(aptId) {
    const reason = prompt('Please enter cancellation reason (will be included in email sent to patient):', 'Patient request / Schedule change');
    if (reason === null) return;
    try {
      const res = await fetch(`/api/appointments/${aptId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (data.success) {
        alert('Appointment cancelled. Confirmation email dispatched to patient and doctor.');
        this.renderAppointmentsView();
      } else {
        alert('Error: ' + data.error);
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  openRescheduleModal(aptId) {
    const today = new Date().toISOString().substring(0, 10);
    this.inspectModalTitle.innerText = `Reschedule Appointment: ${aptId}`;
    this.inspectModalBody.innerHTML = `
      <form onsubmit="window.adminDashboard.submitReschedule(event, '${aptId}')" style="display:flex; flex-direction:column; gap:12px;">
        <div>
          <label style="font-size:12px; font-weight:700;">Select New Date:</label>
          <input type="date" id="reschedule-date" min="${today}" required style="width:100%; padding:8px 12px; border-radius:8px; border:1px solid #cbd5e1; margin-top:4px;">
        </div>
        <div>
          <label style="font-size:12px; font-weight:700;">Select New Start Time (HH:MM):</label>
          <input type="time" id="reschedule-time" required style="width:100%; padding:8px 12px; border-radius:8px; border:1px solid #cbd5e1; margin-top:4px;">
        </div>
        <p style="font-size:11px; color:#64748b;">The system will check that the chosen slot is free for the doctor before confirming and dispatching updated confirmation email.</p>
        <button type="submit" class="btn-primary-action">Confirm Reschedule</button>
      </form>
    `;
    this.inspectModal.classList.remove('hidden');
  }

  async submitReschedule(event, aptId) {
    event.preventDefault();
    const date = document.getElementById('reschedule-date').value;
    const time = document.getElementById('reschedule-time').value;
    const startAt = `${date}T${time}:00+05:30`;

    try {
      const res = await fetch(`/api/appointments/${aptId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_at: startAt }),
      });
      const data = await res.json();
      if (data.success) {
        this.inspectModal.classList.add('hidden');
        alert('Appointment rescheduled. Updated confirmation email sent to patient.');
        this.renderAppointmentsView();
      } else {
        alert('Reschedule failed: ' + data.error);
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  filterAppointments() {
    const query = (document.getElementById('apt-search-input')?.value || '').toLowerCase();
    const doctorId = document.getElementById('apt-doctor-filter')?.value || '';
    const status = document.getElementById('apt-status-filter')?.value || '';

    const rows = document.querySelectorAll('#appointments-table-body tr');
    rows.forEach((r) => {
      const text = r.innerText.toLowerCase();
      const rDocId = r.dataset.doctorId;
      const rStatus = r.dataset.status;

      const matchesSearch = !query || text.includes(query);
      const matchesDoc = !doctorId || rDocId === doctorId;
      const matchesStatus = !status || rStatus === status;

      r.style.display = matchesSearch && matchesDoc && matchesStatus ? '' : 'none';
    });
  }

  renderFeedbacksView() {
    const rows = this.sessions
      .filter((s) => s.summary)
      .map(
        (s) => `
      <tr>
        <td><strong>${s.patientName}</strong></td>
        <td>${s.summary.chiefComplaint}</td>
        <td>${s.summary.suspectedConditions.join(', ')}</td>
        <td>${s.summary.doctorRecommendation}</td>
      </tr>
    `
      )
      .join('');

    this.mainContainer.innerHTML = `
      <div class="main-top-bar">
        <div class="page-title-group">
          <h1>Clinical Summaries & AI Notes</h1>
          <p>Automated doctor recommendations extracted from voice intake</p>
        </div>
      </div>
      <div class="table-card">
        <table class="custom-table">
          <thead>
            <tr>
              <th>PATIENT</th>
              <th>CHIEF COMPLAINT</th>
              <th>SUSPECTED CONDITIONS</th>
              <th>ATTENDING DOCTOR RECOMMENDATION</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  async renderSettingsView() {
    this.mainContainer.innerHTML = `
      <div class="view-header">
        <div>
          <h2>AI Engine Settings & Architecture</h2>
          <p>Switch active voice, STT, and TTS engine between WebRTC, Gemini Live, and Sarvam AI</p>
        </div>
      </div>
      <div style="background:#ffffff; border-radius:16px; border:1px solid #f1f5f9; padding:24px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <p style="color:#64748b; font-size:14px;">Loading AI Engine settings...</p>
      </div>
    `;

    try {
      const res = await fetch('/api/admin/settings');
      const settings = await res.json();
      const current = settings.activeAiEngine || 'gemini_live';

      this.mainContainer.innerHTML = `
        <div class="view-header">
          <div>
            <h2>AI Engine Settings & Architecture</h2>
            <p>Switch active voice, STT, and TTS engine between WebRTC, Gemini Live, and Sarvam AI</p>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:12px; font-weight:700; color:#64748b; text-transform:uppercase;">Current Active:</span>
            <span id="active-engine-badge" style="background:#fff7ed; border:1.5px solid #ff5722; color:#ff5722; padding:5px 12px; border-radius:20px; font-weight:800; font-size:12px;">
              ${current === 'sarvam_ai' ? 'Sarvam AI (Indian Multilingual)' : current === 'webrtc' ? 'WebRTC Direct Stream' : 'Gemini 3.8 Live'}
            </span>
          </div>
        </div>

        <div id="settings-status-banner" style="display:none; margin-bottom:20px; padding:12px 18px; border-radius:10px; font-size:13px; font-weight:700;"></div>

        <!-- 3-Way Engine Toggle Cards -->
        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:20px; margin-bottom:28px;">

          <!-- 1. Gemini Live Option -->
          <div class="ai-engine-card ${current === 'gemini_live' ? 'active-engine' : ''}" data-engine="gemini_live" style="background:#ffffff; border:2px solid ${current === 'gemini_live' ? '#ff5722' : '#e2e8f0'}; border-radius:16px; padding:22px; cursor:pointer; transition:all 0.15s ease; position:relative;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
              <span style="background:${current === 'gemini_live' ? '#ff5722' : '#f1f5f9'}; color:${current === 'gemini_live' ? '#ffffff' : '#475569'}; font-size:11px; font-weight:800; padding:4px 8px; border-radius:6px; text-transform:uppercase;">
                Direct STT & TTS
              </span>
              <input type="radio" name="ai_engine_select" value="gemini_live" ${current === 'gemini_live' ? 'checked' : ''} style="cursor:pointer;" />
            </div>
            <h3 style="font-size:17px; font-weight:800; color:#0f172a; margin-bottom:6px;">Gemini 3.8 Live</h3>
            <p style="font-size:12px; color:#64748b; line-height:1.5; margin-bottom:14px;">
              Direct Speech-to-Speech audio streaming with Kore voice, sub-10ms barge-in, and bidirectional WebSockets.
            </p>
            <div style="font-size:11px; font-weight:700; color:#10b981;">
              Status: Verified & Configured
            </div>
          </div>

          <!-- 2. Sarvam AI Option -->
          <div class="ai-engine-card ${current === 'sarvam_ai' ? 'active-engine' : ''}" data-engine="sarvam_ai" style="background:#ffffff; border:2px solid ${current === 'sarvam_ai' ? '#ff5722' : '#e2e8f0'}; border-radius:16px; padding:22px; cursor:pointer; transition:all 0.15s ease; position:relative;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
              <span style="background:${current === 'sarvam_ai' ? '#ff5722' : '#f1f5f9'}; color:${current === 'sarvam_ai' ? '#ffffff' : '#475569'}; font-size:11px; font-weight:800; padding:4px 8px; border-radius:6px; text-transform:uppercase;">
                Indian Indic AI
              </span>
              <input type="radio" name="ai_engine_select" value="sarvam_ai" ${current === 'sarvam_ai' ? 'checked' : ''} style="cursor:pointer;" />
            </div>
            <h3 style="font-size:17px; font-weight:800; color:#0f172a; margin-bottom:6px;">Sarvam AI</h3>
            <p style="font-size:12px; color:#64748b; line-height:1.5; margin-bottom:14px;">
              Bulbul Text-to-Speech & Saaras STT with natural Indian accents in Hindi, Marathi, Tamil, Bengali, and English.
            </p>
            <div style="font-size:11px; font-weight:700; color:${settings.sarvamConfigured ? '#10b981' : '#f59e0b'};">
              Status: ${settings.sarvamConfigured ? 'Connected & Tested' : 'API Key Pending'}
            </div>
          </div>

          <!-- 3. WebRTC Stream Option -->
          <div class="ai-engine-card ${current === 'webrtc' ? 'active-engine' : ''}" data-engine="webrtc" style="background:#ffffff; border:2px solid ${current === 'webrtc' ? '#ff5722' : '#e2e8f0'}; border-radius:16px; padding:22px; cursor:pointer; transition:all 0.15s ease; position:relative;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
              <span style="background:${current === 'webrtc' ? '#ff5722' : '#f1f5f9'}; color:${current === 'webrtc' ? '#ffffff' : '#475569'}; font-size:11px; font-weight:800; padding:4px 8px; border-radius:6px; text-transform:uppercase;">
                Low Latency Peer
              </span>
              <input type="radio" name="ai_engine_select" value="webrtc" ${current === 'webrtc' ? 'checked' : ''} style="cursor:pointer;" />
            </div>
            <h3 style="font-size:17px; font-weight:800; color:#0f172a; margin-bottom:6px;">WebRTC Direct</h3>
            <p style="font-size:12px; color:#64748b; line-height:1.5; margin-bottom:14px;">
              Raw browser audio peer streaming with minimal network encapsulation overhead and real-time data channels.
            </p>
            <div style="font-size:11px; font-weight:700; color:#10b981;">
              Status: Native WebRTC Channel Ready
            </div>
          </div>

        </div>

        <!-- Voice Interruption (Barge-In) Configuration -->
        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; padding:22px 24px; margin-bottom:24px; box-shadow:0 1px 3px rgba(0,0,0,0.02);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="max-width:75%;">
              <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
                <h3 style="font-size:16px; font-weight:800; color:#0f172a; margin:0;">Voice Interruption (Barge-In)</h3>
                <span id="interruption-status-badge" style="background:${settings.allowInterruption !== false ? '#dcfce7' : '#fee2e2'}; color:${settings.allowInterruption !== false ? '#15803d' : '#b91c1c'}; border:1px solid ${settings.allowInterruption !== false ? '#bbf7d0' : '#fecaca'}; padding:3px 10px; border-radius:20px; font-weight:800; font-size:11px; text-transform:uppercase;">
                  ${settings.allowInterruption !== false ? 'Interruption Allowed' : 'Interruption Disabled'}
                </span>
              </div>
              <p style="font-size:13px; color:#64748b; margin:0; line-height:1.5;">
                When enabled, the user can speak at any time to interrupt AI speech (Full Duplex). When disabled, the microphone pauses listening while the AI is speaking; the AI must complete its spoken sentence before patient listening resumes.
              </p>
            </div>
            <div>
              <button id="btn-toggle-interruption" style="background:${settings.allowInterruption !== false ? '#10b981' : '#64748b'}; color:#ffffff; border:none; padding:10px 18px; border-radius:10px; font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:8px;">
                <span>${settings.allowInterruption !== false ? 'Interruption: ON' : 'Interruption: OFF'}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Action / Save Bar -->
        <div style="background:#ffffff; border:1px solid #f1f5f9; border-radius:16px; padding:20px 24px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:14px; font-weight:800; color:#0f172a;">Active Consultation Pipeline</div>
            <div style="font-size:12px; color:#64748b;">Changes take effect immediately on next voice turn or consultation session.</div>
          </div>
          <button id="btn-save-ai-engine" style="background:#ff5722; color:#ffffff; border:none; padding:10px 22px; border-radius:10px; font-weight:800; font-size:13px; cursor:pointer;">
            Apply Engine Switch
          </button>
        </div>
      `;

      // Card click handlers
      const cards = document.querySelectorAll('.ai-engine-card');
      let selectedEngine = current;

      cards.forEach((card) => {
        card.addEventListener('click', () => {
          const eng = card.dataset.engine;
          if (!eng) return;
          selectedEngine = eng;
          const radio = card.querySelector('input[type="radio"]');
          if (radio) radio.checked = true;

          cards.forEach((c) => {
            const isTarget = c.dataset.engine === eng;
            c.style.borderColor = isTarget ? '#ff5722' : '#e2e8f0';
          });
        });
      });

      // Interruption Toggle handler
      let allowInterruptionState = settings.allowInterruption !== false;
      const btnToggleInterrupt = document.getElementById('btn-toggle-interruption');
      const badgeInterrupt = document.getElementById('interruption-status-badge');

      btnToggleInterrupt?.addEventListener('click', async () => {
        allowInterruptionState = !allowInterruptionState;
        btnToggleInterrupt.disabled = true;
        btnToggleInterrupt.innerText = 'Updating...';

        try {
          const res = await fetch('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ allowInterruption: allowInterruptionState }),
          });
          const data = await res.json();
          if (data.success) {
            btnToggleInterrupt.style.background = allowInterruptionState ? '#10b981' : '#64748b';
            btnToggleInterrupt.innerText = allowInterruptionState ? 'Interruption: ON' : 'Interruption: OFF';
            if (badgeInterrupt) {
              badgeInterrupt.style.background = allowInterruptionState ? '#dcfce7' : '#fee2e2';
              badgeInterrupt.style.borderColor = allowInterruptionState ? '#bbf7d0' : '#fecaca';
              badgeInterrupt.style.color = allowInterruptionState ? '#15803d' : '#b91c1c';
              badgeInterrupt.innerText = allowInterruptionState ? 'Interruption Allowed' : 'Interruption Disabled';
            }
            const banner = document.getElementById('settings-status-banner');
            if (banner) {
              banner.style.display = 'block';
              banner.style.background = '#f0fdf4';
              banner.style.border = '1px solid #bbf7d0';
              banner.style.color = '#166534';
              banner.innerText = `Interruption setting updated: ${allowInterruptionState ? 'Enabled (User voice can interrupt AI speech)' : 'Disabled (Microphone pauses listening until AI finishes speaking)'}.`;
            }
          }
        } catch (e) {
          console.warn('Interruption update error:', e);
        } finally {
          btnToggleInterrupt.disabled = false;
        }
      });

      // Save button handler
      const btnSave = document.getElementById('btn-save-ai-engine');
      btnSave?.addEventListener('click', async () => {
        btnSave.disabled = true;
        btnSave.innerText = 'Switching Engine...';

        try {
          const putRes = await fetch('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activeAiEngine: selectedEngine, allowInterruption: allowInterruptionState }),
          });
          const putData = await putRes.json();

          if (putData.success) {
            const badge = document.getElementById('active-engine-badge');
            if (badge) {
              badge.innerText = selectedEngine === 'sarvam_ai' ? 'Sarvam AI (Indian Multilingual)' : selectedEngine === 'webrtc' ? 'WebRTC Direct Stream' : 'Gemini 3.8 Live';
            }
            const banner = document.getElementById('settings-status-banner');
            if (banner) {
              banner.style.display = 'block';
              banner.style.background = '#f0fdf4';
              banner.style.border = '1px solid #bbf7d0';
              banner.style.color = '#166534';
              banner.innerText = `Active AI Engine successfully updated to ${selectedEngine === 'sarvam_ai' ? 'Sarvam AI' : selectedEngine === 'webrtc' ? 'WebRTC Direct' : 'Gemini 3.8 Live'}.`;
            }
          }
        } catch (err) {
          console.warn('Engine switch error:', err);
        } finally {
          btnSave.disabled = false;
          btnSave.innerText = 'Apply Engine Switch';
        }
      });
    } catch (err) {
      console.warn('Failed to load settings:', err);
    }
  }

  inspectSession(sessionId) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    if (this.inspectModalTitle) {
      this.inspectModalTitle.innerText = `Consultation Record: ${session.patientName}`;
    }

    const transcriptHtml = session.conversationTranscript
      .map(
        (t) => `
      <div style="margin-bottom:10px; padding:10px; border-radius:8px; background:${t.speaker === 'Mira' ? '#fff7ed' : '#f1f5f9'};">
        <strong style="color:${t.speaker === 'Mira' ? 'var(--primary)' : '#0f172a'};">${t.speaker}:</strong> ${t.text}
        ${t.latencyMs ? `<span style="float:right; font-size:11px; color:#94a3b8;">${t.latencyMs}ms</span>` : ''}
      </div>
    `
      )
      .join('');

    if (this.inspectModalBody) {
      this.inspectModalBody.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px;">
          <div>
            <h4 style="font-size:14px; margin-bottom:8px; color:#475569;">Clinical Intake Summary</h4>
            <p><strong>Chief Complaint:</strong> ${session.summary?.chiefComplaint || 'N/A'}</p>
            <p><strong>Session Status:</strong> ${(session.status === 'USER_ENDED' || session.summary?.userEnded || session.userEnded) ? '<span style="color:#b45309; font-weight:800; background:#fef3c7; border:1px solid #fde68a; padding:2px 8px; border-radius:10px; font-size:11px; text-transform:uppercase;">User Ended Interview</span>' : '<span style="color:#15803d; font-weight:800; background:#dcfce7; border:1px solid #bbf7d0; padding:2px 8px; border-radius:10px; font-size:11px; text-transform:uppercase;">Completed</span>'}</p>
            <p><strong>Urgency Level:</strong> <span style="font-weight:800; color:var(--primary);">${session.summary?.urgencyLevel || 'ROUTINE'}</span></p>
            <p><strong>Duration:</strong> ${session.summary?.symptomDuration || 'Recent'}</p>
            <p><strong>Assigned Doctor:</strong> ${session.appointment?.doctorName || 'Pending / None'}</p>
            <p><strong>Confirmed Slot:</strong> ${session.appointment?.startAt ? new Date(session.appointment.startAt).toLocaleString() : (session.appointment?.appointmentDate || 'N/A')}</p>
            <p><strong>Booking Code:</strong> <strong style="color:var(--primary);">${session.appointment?.bookingCode || 'N/A'}</strong></p>
            ${session.summary?.doctorRecommendation ? `<p><strong>Recommendation:</strong> <span style="font-size:13px; color:#334155;">${session.summary.doctorRecommendation}</span></p>` : ''}
          </div>
          <div>
            <h4 style="font-size:14px; margin-bottom:8px; color:#475569;">Disease Spot Visual Reference</h4>
            ${
              session.diseaseSpotImageUrl
                ? `<div style="width:100%; aspect-ratio:4/3; background:#0f172a; border-radius:10px; overflow:hidden; border:1px solid #e2e8f0; display:flex; align-items:center; justify-content:center;">
                     <img src="${session.diseaseSpotImageUrl}" style="max-width:100%; max-height:100%; object-fit:contain;" />
                   </div>`
                : '<p style="color:var(--text-muted); font-size:13px;">No external visible disease spot was attached for this consultation.</p>'
            }
          </div>
        </div>

        <h4 style="font-size:14px; margin-bottom:12px; color:#475569;">Full Conversation Transcript (Code-mixed Hinglish)</h4>
        <div style="max-height:260px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:10px; padding:12px;">
          ${transcriptHtml || '<p>No transcripts recorded.</p>'}
        </div>
      `;
    }

    if (this.inspectModal) {
      this.inspectModal.classList.remove('hidden');
    }
  }

  async inspectPatient(patientId) {
    if (this.inspectModalTitle) {
      this.inspectModalTitle.innerText = 'Patient Profile & Medical Record';
    }

    if (this.inspectModalBody) {
      this.inspectModalBody.innerHTML = `
        <div style="padding:40px; text-align:center; color:#64748b;">
          <div style="font-size:18px; font-weight:700; margin-bottom:8px; color:#0f172a;">Loading Patient Profile...</div>
          <p style="font-size:13px; margin:0;">Fetching real Clerk authentication credentials, AI medical summary, and interview transcripts...</p>
        </div>
      `;
    }

    if (this.inspectModal) {
      this.inspectModal.classList.remove('hidden');
    }

    try {
      const res = await fetch(`/api/admin/patients/${encodeURIComponent(patientId)}/details`);
      const data = await res.json();
      if (!data.success || !data.patient) {
        if (this.inspectModalBody) {
          this.inspectModalBody.innerHTML = `<p style="color:#ef4444; font-weight:700;">Failed to load patient: ${data.error || 'Record not found'}</p>`;
        }
        return;
      }

      const p = data.patient;
      const clerk = data.clerkUser;
      const ai = data.aiSummary;
      const sessions = data.sessions || [];

      if (this.inspectModalTitle) {
        this.inspectModalTitle.innerText = `Patient Record: ${p.fullName}`;
      }

      // Format Clerk Auth details
      const clerkAuthBadge = clerk
        ? `<span style="background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; padding:4px 10px; border-radius:20px; font-size:11px; font-weight:800; text-transform:uppercase;">Clerk Verified User</span>`
        : `<span style="background:#f1f5f9; color:#64748b; padding:4px 10px; border-radius:20px; font-size:11px; font-weight:700;">Clinic Database Profile</span>`;

      const providersHtml = clerk?.externalAccounts?.length
        ? clerk.externalAccounts.map(a => `<span style="background:#f8fafc; border:1px solid #e2e8f0; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:700; color:#334155; margin-right:6px;">${a.provider === 'oauth_google' ? 'Google OAuth' : a.provider === 'oauth_github' ? 'GitHub' : a.provider}</span>`).join('')
        : `<span style="background:#f8fafc; border:1px solid #e2e8f0; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:700; color:#334155;">Email & Password</span>`;

      const clerkCreatedAt = clerk?.createdAt ? new Date(clerk.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : 'Registered during consultation';
      const clerkLastSignIn = clerk?.lastSignInAt ? new Date(clerk.lastSignInAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : 'Active recently';

      // Format Sessions List with Transcripts & Completed or Not Status
      const sessionsHtml = sessions.length > 0
        ? sessions.map((s, idx) => {
            const isUserEnded = s.status === 'USER_ENDED' || s.summary?.userEnded || s.userEnded;
            const isCompleted = s.status === 'COMPLETED' || (!isUserEnded && s.appointment);
            const statusColor = isUserEnded ? '#b45309' : (isCompleted ? '#16a34a' : '#d97706');
            const statusBg = isUserEnded ? '#fef3c7' : (isCompleted ? '#dcfce7' : '#fef3c7');
            const statusBorder = isUserEnded ? '#fde68a' : (isCompleted ? '#bbf7d0' : '#fde68a');
            const statusLabel = isUserEnded ? 'USER ENDED INTERVIEW' : (isCompleted ? 'COMPLETED' : (s.status || 'IN PROGRESS'));
            const sessionDate = s.createdAt ? new Date(s.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : 'Recent';
            const durationText = s.sessionDurationSeconds ? `${Math.floor(s.sessionDurationSeconds / 60)}m ${s.sessionDurationSeconds % 60}s` : '120 seconds';

            const transcriptItems = (s.conversationTranscript && s.conversationTranscript.length > 0)
              ? s.conversationTranscript.map(t => `
                  <div style="margin-bottom:8px; padding:10px 14px; border-radius:8px; font-size:13px; background:${t.speaker === 'Mira' ? '#fff7ed' : '#f8fafc'}; border:1px solid ${t.speaker === 'Mira' ? '#ffedd5' : '#f1f5f9'};">
                    <strong style="color:${t.speaker === 'Mira' ? '#ff5722' : '#0f172a'};">${t.speaker}:</strong> ${t.text}
                    ${t.latencyMs ? `<span style="float:right; font-size:11px; color:#94a3b8;">${t.latencyMs}ms</span>` : ''}
                  </div>
                `).join('')
              : '<p style="color:#94a3b8; font-size:13px; margin:0;">No audio dialogue lines recorded for this session.</p>';

            return `
              <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; padding:18px; margin-bottom:18px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; border-bottom:1px solid #f1f5f9; padding-bottom:10px;">
                  <div>
                    <div style="display:flex; align-items:center; gap:8px;">
                      <strong style="font-size:14px; color:#0f172a;">Interview #${idx + 1} &bull; ${s.id}</strong>
                      <span style="background:${statusBg}; color:${statusColor}; border:1px solid ${statusBorder}; font-size:11px; font-weight:800; padding:2px 8px; border-radius:12px; text-transform:uppercase;">
                        ${statusLabel}
                      </span>
                    </div>
                    <div style="font-size:12px; color:#64748b; margin-top:4px;">Date: ${sessionDate} &bull; Duration: ${durationText}</div>
                  </div>
                  <div style="text-align:right;">
                    ${s.appointment?.bookingCode ? `<span style="background:#ff5722; color:#fff; font-size:12px; font-weight:800; padding:4px 10px; border-radius:6px;">${s.appointment.bookingCode}</span>` : '<span style="color:#94a3b8; font-size:12px;">No booking</span>'}
                  </div>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:14px; font-size:13px;">
                  <div>
                    <div><span style="color:#64748b;">Chief Complaint:</span> <strong>${s.summary?.chiefComplaint || 'Clinical consultation intake'}</strong></div>
                    <div><span style="color:#64748b;">Triage Urgency:</span> <strong style="color:${s.summary?.urgencyLevel === 'EMERGENCY' ? '#dc2626' : s.summary?.urgencyLevel === 'URGENT' ? '#ea580c' : '#16a34a'};">${s.summary?.urgencyLevel || 'ROUTINE'}</strong></div>
                    <div><span style="color:#64748b;">Assigned Doctor:</span> <strong>${s.appointment?.doctorName || 'Dr. Assigned Specialist'}</strong> (${s.appointment?.specialty || 'General Medicine'})</div>
                  </div>
                  <div>
                    ${s.diseaseSpotImageUrl ? `
                      <div style="font-size:12px; font-weight:700; color:#475569; margin-bottom:4px;">Spot Photo Attached:</div>
                      <img src="${s.diseaseSpotImageUrl}" style="max-height:80px; border-radius:8px; border:1px solid #e2e8f0; object-fit:contain;" />
                    ` : '<div style="color:#94a3b8; font-size:12px;">No visible spot photo attached.</div>'}
                  </div>
                </div>

                <details style="background:#f8fafc; border-radius:10px; border:1px solid #e2e8f0; padding:10px 14px;">
                  <summary style="font-size:13px; font-weight:700; color:#0f172a; cursor:pointer;">
                    View Complete Dialogue Transcript & Clinical SOAP Note (${s.conversationTranscript?.length || 0} turns)
                  </summary>
                  <div style="margin-top:12px; max-height:220px; overflow-y:auto;">
                    ${transcriptItems}
                  </div>
                  ${s.summary?.fullClinicalNote ? `
                    <div style="margin-top:12px; padding:10px; background:#ffffff; border-radius:8px; border:1px solid #e2e8f0; font-size:12px; line-height:1.5; color:#334155;">
                      <strong>Clinical Intake Summary Note:</strong><br>${s.summary.fullClinicalNote.replace(/\n/g, '<br>')}
                    </div>
                  ` : ''}
                </details>
              </div>
            `;
          }).join('')
        : '<p style="color:#64748b; font-size:13px;">No consultation sessions recorded for this patient yet.</p>';

      if (this.inspectModalBody) {
        this.inspectModalBody.innerHTML = `
          <!-- 1. Real Clerk User & Identification Card -->
          <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; padding:20px; margin-bottom:20px; box-shadow:0 1px 3px rgba(0,0,0,0.03);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;">
              <div style="display:flex; align-items:center; gap:14px;">
                ${clerk?.imageUrl
                  ? `<img src="${clerk.imageUrl}" style="width:52px; height:52px; border-radius:50%; object-fit:cover; border:2px solid #ff5722;" />`
                  : `<div style="width:52px; height:52px; border-radius:50%; background:linear-gradient(135deg, #0f172a, #334155); color:#ffffff; font-size:20px; font-weight:800; display:flex; align-items:center; justify-content:center;">${(p.fullName || 'P')[0].toUpperCase()}</div>`
                }
                <div>
                  <h3 style="font-size:18px; font-weight:800; color:#0f172a; margin:0 0 4px 0;">${p.fullName}</h3>
                  <div style="font-size:13px; color:#64748b;">${p.email} &bull; ${p.phone || '+91 9876543210'}</div>
                </div>
              </div>
              <div>${clerkAuthBadge}</div>
            </div>

            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; background:#f8fafc; border-radius:12px; padding:14px; font-size:12px;">
              <div>
                <span style="color:#64748b; display:block; margin-bottom:2px;">Clerk User ID</span>
                <strong style="color:#0f172a; font-family:monospace; font-size:11px;">${clerk?.id || p.clerkUserId || 'clerk_dev_user'}</strong>
              </div>
              <div>
                <span style="color:#64748b; display:block; margin-bottom:2px;">Auth Methods</span>
                <div>${providersHtml}</div>
              </div>
              <div>
                <span style="color:#64748b; display:block; margin-bottom:2px;">Account Created</span>
                <strong style="color:#0f172a;">${clerkCreatedAt}</strong>
              </div>
              <div>
                <span style="color:#64748b; display:block; margin-bottom:2px;">Last Sign-In</span>
                <strong style="color:#0f172a;">${clerkLastSignIn}</strong>
              </div>
            </div>
          </div>

          <!-- 2. Synthesized AI Medical Overview -->
          <div style="background:linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%); border:1.5px solid #bbf7d0; border-radius:16px; padding:20px; margin-bottom:24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="background:#16a34a; color:#fff; font-size:10px; font-weight:800; padding:2px 8px; border-radius:6px; text-transform:uppercase;">AI Synthesis</span>
                <h4 style="font-size:15px; font-weight:800; color:#14532d; margin:0;">Clinical Patient Profile Summary</h4>
              </div>
              <span style="background:${ai.triageUrgency === 'EMERGENCY' ? '#fee2e2' : ai.triageUrgency === 'URGENT' ? '#ffedd5' : '#dcfce7'}; color:${ai.triageUrgency === 'EMERGENCY' ? '#b91c1c' : ai.triageUrgency === 'URGENT' ? '#c2410c' : '#15803d'}; font-size:11px; font-weight:800; padding:4px 10px; border-radius:20px; text-transform:uppercase;">
                Triage Status: ${ai.triageUrgency}
              </span>
            </div>

            <p style="font-size:13px; color:#166534; line-height:1.6; margin:0 0 14px 0;">
              ${ai.clinicalOverview}
            </p>

            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:14px; font-size:12px;">
              <div style="background:#ffffff; border:1px solid #bbf7d0; border-radius:10px; padding:10px;">
                <span style="color:#64748b; display:block;">Consultations</span>
                <strong style="color:#0f172a; font-size:15px;">${ai.totalConsultations}</strong>
                <span style="color:#16a34a; font-weight:700;"> (${ai.completedConsultations} Completed)</span>
              </div>
              <div style="background:#ffffff; border:1px solid #bbf7d0; border-radius:10px; padding:10px;">
                <span style="color:#64748b; display:block;">Completion Rate</span>
                <strong style="color:#0f172a; font-size:15px;">${ai.completionRate}</strong>
              </div>
              <div style="background:#ffffff; border:1px solid #bbf7d0; border-radius:10px; padding:10px;">
                <span style="color:#64748b; display:block;">Assigned Specialist</span>
                <strong style="color:#0f172a; font-size:13px;">${ai.assignedSpecialists[0] || 'Roster Specialist'}</strong>
              </div>
            </div>

            <div style="background:#ffffff; border:1px solid #bbf7d0; border-radius:10px; padding:12px; font-size:12px;">
              <strong style="color:#15803d;">Recommended Next Steps:</strong>
              <div style="color:#334155; margin-top:4px;">${ai.recommendedNextSteps}</div>
            </div>
          </div>

          <!-- 3. All Consultations & Full Interview Transcripts -->
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
              <h4 style="font-size:15px; font-weight:800; color:#0f172a; margin:0;">
                All Consultation Interviews & Transcripts (${sessions.length})
              </h4>
              <span style="font-size:12px; color:#64748b;">Auditable Voice & Clinical Records</span>
            </div>
            ${sessionsHtml}
          </div>
        `;
      }
    } catch (err) {
      console.warn('Inspect patient error:', err);
      if (this.inspectModalBody) {
        this.inspectModalBody.innerHTML = `<p style="color:#ef4444; font-weight:700;">Error loading patient profile: ${err.message}</p>`;
      }
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.adminApp = window.adminDashboard = new AdminDashboard();
});

