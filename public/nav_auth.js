// Synchronizes top navigation bar across all pages with real authenticated session state
(function() {
  async function syncNavAuth() {
    const nav = document.getElementById('top-nav-actions') || document.querySelector('.nav-actions');
    if (!nav) return;

    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();

      if (data.authenticated && data.user) {
        const user = data.user;
        const initial = (user.fullName || user.email || 'U')[0].toUpperCase();
        const targetUrl = user.isAdmin ? '/admin/dashboard' : '/user/dashboard';
        const roleLabel = user.isAdmin ? 'ADMIN' : 'PATIENT';
        const nameLabel = user.isAdmin ? 'Anuj' : (user.fullName || user.email.split('@')[0]);

        nav.innerHTML = `
          <a href="${targetUrl}" class="user-profile-badge" style="text-decoration:none;">
            <div class="avatar-initial" style="background:${user.isAdmin ? 'var(--primary)' : '#2563eb'}; color:#ffffff; font-weight:800;">${initial}</div>
            <div class="user-info">
              <span class="user-name">${nameLabel}</span>
              <span class="user-role" style="${user.isAdmin ? '' : 'color:#2563eb;'}">${roleLabel}</span>
            </div>
          </a>
          <button id="btn-global-signout" class="btn-outline" style="padding:6px 12px; font-size:12px; cursor:pointer;">Sign Out</button>
        `;

        document.getElementById('btn-global-signout')?.addEventListener('click', async (e) => {
          e.preventDefault();
          try {
            await fetch('/api/auth/sign-out', { method: 'POST' });
          } catch (err) {}

          if (window.Clerk && typeof window.Clerk.signOut === 'function') {
            try {
              await window.Clerk.signOut();
            } catch (err) {}
          }

          localStorage.removeItem('mira_user_email');
          localStorage.removeItem('mira_user_role');
          localStorage.removeItem('mira_user_name');
          document.cookie = 'mira_user_email=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
          window.location.href = '/sign-in?signout=true';
        });
      } else {
        // Not authenticated: Show ONLY clean Sign In button, remove all default Sign Up buttons
        nav.innerHTML = `
          <a href="/sign-in" class="btn-outline" style="text-decoration:none; padding:7px 14px; font-size:13px;">Sign In</a>
        `;
      }
    } catch (e) {
      console.warn('[NavAuth] Auth sync warning:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncNavAuth);
  } else {
    syncNavAuth();
  }
})();
