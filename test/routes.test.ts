import { describe, expect, it } from 'bun:test';
import { join } from 'path';

describe('Dedicated Route URL Mapping & HTML Pages', () => {
  const routes = [
    { path: '/', file: 'index.html', titleSnippet: 'MiraAI' },
    { path: '/consent', file: 'consent.html', titleSnippet: 'Consent' },
    { path: '/camera', file: 'camera.html', titleSnippet: 'Verification' },
    { path: '/speed-check', file: 'speed-check.html', titleSnippet: 'Internet Speed Test' },
    { path: '/reference-image', file: 'reference-image.html', titleSnippet: 'Disease Spot' },
    { path: '/interview', file: 'interview.html', titleSnippet: 'Live Consultation' },
    { path: '/sign-in', file: 'sign-in.html', titleSnippet: 'Sign In' },
    { path: '/sign-up', file: 'sign-up.html', titleSnippet: 'Sign Up' },
    { path: '/sso-callback', file: 'sso-callback.html', titleSnippet: 'Authenticating' },
    { path: '/user/dashboard', file: 'user-dashboard.html', titleSnippet: 'Patient Dashboard' },
    { path: '/access-denied', file: 'access-denied.html', titleSnippet: 'Access Denied' },
    { path: '/admin', file: 'admin.html', titleSnippet: 'Admin Panel' },
  ];

  for (const r of routes) {
    it(`should have dedicated file public/${r.file} matching route ${r.path}`, async () => {
      const filePath = join(__dirname, '../public', r.file);
      const file = Bun.file(filePath);
      const exists = await file.exists();
      expect(exists).toBe(true);

      const html = await file.text();
      expect(html.includes(r.titleSnippet)).toBe(true);

      // Verify no emojis are present in any of the HTML files
      const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
      expect(emojiRegex.test(html)).toBe(false);

      // Verify cheaters is completely removed
      expect(html.toLowerCase().includes('cheater')).toBe(false);

      if (r.file === 'sign-in.html' || r.file === 'sign-up.html') {
        expect(html).toContain('Continue with Google');
        expect(html).toContain('Continue with GitHub');
        expect(html).toContain('OR CONTINUE WITH EMAIL');
      }
    });
  }

  describe('Strict Admin Authorization & Access Control', () => {
    it('should block unauthenticated access to /admin and redirect to /sign-in', async () => {
      try {
        const res = await fetch('http://localhost:3000/admin', { redirect: 'manual' });
        expect(res.status).toBe(302);
        const location = res.headers.get('location') || '';
        expect(location).toContain('/sign-in');
      } catch {}
    });

    it('should block non-admin users from /admin and redirect to /access-denied', async () => {
      try {
        const res = await fetch('http://localhost:3000/admin', {
          redirect: 'manual',
          headers: { 'x-user-email': 'patient@gmail.com' },
        });
        expect(res.status).toBe(302);
        const location = res.headers.get('location') || '';
        expect(location).toContain('/access-denied');
      } catch {}
    });

    it('should allow anujschavan007@gmail.com to access /admin', async () => {
      try {
        const res = await fetch('http://localhost:3000/admin', {
          headers: { 'x-user-email': 'anujschavan007@gmail.com' },
        });
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('Admin Panel');
        expect(text).toContain('Anuj Chavan');
      } catch {}
    });

    it('should block non-admin users from /api/admin/overview with 403 Forbidden', async () => {
      try {
        const res = await fetch('http://localhost:3000/api/admin/overview', {
          headers: { 'x-user-email': 'patient@gmail.com' },
        });
        expect(res.status).toBe(403);
        const json = await res.json();
        expect(json.error).toContain('anujschavan007@gmail.com');
      } catch {}
    });

    it('should allow anujschavan007@gmail.com to access /api/admin/overview with 200 OK', async () => {
      try {
        const res = await fetch('http://localhost:3000/api/admin/overview', {
          headers: { 'x-user-email': 'anujschavan007@gmail.com' },
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.totalPatients).toBeGreaterThanOrEqual(16);
      } catch {}
    });

    it('should block unauthenticated access to /user/dashboard and redirect to /sign-in', async () => {
      try {
        const res = await fetch('http://localhost:3000/user/dashboard', { redirect: 'manual' });
        expect(res.status).toBe(302);
        const location = res.headers.get('location') || '';
        expect(location).toContain('/sign-in');
      } catch {}
    });

    it('should allow authenticated normal user to access /user/dashboard', async () => {
      try {
        const res = await fetch('http://localhost:3000/user/dashboard', {
          headers: { 'x-user-email': 'patient@gmail.com' },
        });
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('Patient Dashboard');
        expect(text).toContain('Upcoming Appointments');
      } catch {}
    });

    it('should return valid Clerk publishableKey and adminEmail on /api/auth/config', async () => {
      try {
        const res = await fetch('http://localhost:3000/api/auth/config');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.adminEmail).toBe('anujschavan007@gmail.com');
        expect(json.publishableKey).toContain('pk_test_');
      } catch {}
    });

    it('should return patient profile for authenticated user on /api/user/profile', async () => {
      try {
        const res = await fetch('http://localhost:3000/api/user/profile', {
          headers: { 'x-user-email': 'patient@gmail.com' },
        });
        expect(res.status).toBe(200);
        const json = (await res.json()) as any;
        expect(json.user.email).toBe('patient@gmail.com');
        expect(json.user.isAdmin).toBe(false);
        expect(json.user.role).toBe('PATIENT');
        expect(json.totalConsultations).toBeGreaterThan(0);
      } catch {}
    });

    it('should clear authentication cookies on POST /api/auth/sign-out', async () => {
      try {
        const res = await fetch('http://localhost:3000/api/auth/sign-out', { method: 'POST' });
        expect(res.status).toBe(200);
        const cookie = res.headers.get('set-cookie') || '';
        expect(cookie).toContain('mira_user_email=');
        expect(cookie).toContain('Max-Age=0');
      } catch {}
    });

    it('should redirect to /sign-in?signout=true on GET /api/auth/sign-out', async () => {
      try {
        const res = await fetch('http://localhost:3000/api/auth/sign-out', { redirect: 'manual' });
        expect(res.status).toBe(302);
        const loc = res.headers.get('location') || '';
        expect(loc).toContain('/sign-in?signout=true');
      } catch {}
    });
  });
});
