/**
 * E2E Auth helpers — mirrors the backend testWorld identity helpers.
 *
 * Creates test organisations and employees via the same ConnectRPC endpoints
 * used by the production frontend, but called directly via fetch (no browser).
 */
import type { Page } from '@playwright/test';
import { TERMS_VERSION } from 'apis';

const API_BASE = process.env.E2E_API_URL || 'http://localhost:18080';

// Token localStorage keys — must match frontend/packages/apis/src/token.ts
const TOKEN_KEY = 'tech_office_access_token';
const TOKEN_EXPIRES_KEY = 'tech_office_token_expires_at';

export interface TestUser {
  id: string;
  email: string;
  token: string;
  expiresAt: number;
  orgId: string;
  orgSubdomain: string;
}

// ---------------------------------------------------------------------------
// RPC helper
// ---------------------------------------------------------------------------

async function rpc<T>(path: string, body: Record<string, unknown>, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
          ...headers,
          'Connection': 'close',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`RPC ${path} failed (${res.status}): ${text}`);
      }
      return res.json() as Promise<T>;
    } catch (err) {
      const isHttpError = err instanceof Error && err.message.startsWith('RPC ');
      if (!isHttpError && attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`RPC ${path} failed after ${maxRetries} retries`);
}

// ---------------------------------------------------------------------------
// Organisation + Owner creation
// ---------------------------------------------------------------------------

/**
 * Register a fresh organisation and return the owner as a TestUser.
 * Mirrors backend testWorld.withOwner().
 */
export async function createTestOrg(): Promise<TestUser> {
  const suffix = crypto.randomUUID().replace(/-/g, '');
  const email = `owner+${suffix}@test.invalid`;
  const password = 'Test1234!';
  const subdomain = `to${suffix.slice(0, 20)}`;

  // 1. Register org
  const orgResp = await rpc<{ organization: { id: string } }>(
    '/rpc.v1.OrganizationService/RegisterOrganizationWithAdminPassword',
    {
      companyName: `Test Org ${suffix.slice(0, 8)}`,
      subdomain,
      adminEmail: email,
      adminPassword: password,
      adminGivenName: 'Test',
      adminFamilyName: 'Owner',
      // Required since Feature 036: an account cannot be created without a
      // recorded acceptance of the current terms.
      acceptedTermsVersion: TERMS_VERSION,
    },
  );

  // 2. Login to get a JWT
  const loginResp = await rpc<{
    accessToken: string;
    expiresAt: string;
    user: { id: string };
  }>('/rpc.v1.IAMService/Login', { email, password });

  return {
    id: loginResp.user.id,
    email,
    token: loginResp.accessToken,
    expiresAt: Number(loginResp.expiresAt),
    orgId: orgResp.organization.id,
    orgSubdomain: subdomain,
  };
}

// ---------------------------------------------------------------------------
// Employee creation (org-managed account flow)
// ---------------------------------------------------------------------------

/**
 * Create a fresh employee in an existing org via CreateOrgAccount + LoginWithPIN + SetPIN.
 * This mirrors the backend testWorld.withEmployee() but uses only public API
 * endpoints (no direct DB access needed).
 */
export async function createTestEmployee(owner: TestUser): Promise<TestUser> {
  const suffix = crypto.randomUUID().replace(/-/g, '');
  const loginId = `emp${suffix.slice(0, 16)}`;

  // 1. Owner creates an org-managed account
  const acctResp = await rpc<{
    id: string;
    loginIdentifier: string;
    temporaryPin: string;
  }>(
    '/rpc.v1.IAMService/CreateOrgAccount',
    {
      loginIdentifier: loginId,
      displayName: `Employee ${suffix.slice(0, 8)}`,
      givenName: 'Test',
      familyName: 'Employee',
    },
    owner.token,
  );

  // 2. Login with the temporary PIN — will require PIN change
  const pinLoginResp = await rpc<{
    accessToken: string;
    expiresAt: string;
    pinChangeRequired: boolean;
    pinChangeToken: string;
  }>('/rpc.v1.IAMService/LoginWithPIN', {
    organizationSubdomain: owner.orgSubdomain,
    loginIdentifier: acctResp.loginIdentifier,
    pin: acctResp.temporaryPin,
  });

  // 3. Set a permanent PIN to get a full JWT
  if (pinLoginResp.pinChangeRequired) {
    const setPinResp = await rpc<{
      accessToken: string;
      expiresAt: string;
    }>('/rpc.v1.IAMService/SetPIN', {
      newPin: '123456',
      pinChangeToken: pinLoginResp.pinChangeToken,
    });

    return {
      id: acctResp.id,
      email: loginId, // org-managed accounts use loginIdentifier
      token: setPinResp.accessToken,
      expiresAt: Number(setPinResp.expiresAt),
      orgId: owner.orgId,
      orgSubdomain: owner.orgSubdomain,
    };
  }

  return {
    id: acctResp.id,
    email: loginId,
    token: pinLoginResp.accessToken,
    expiresAt: Number(pinLoginResp.expiresAt),
    orgId: owner.orgId,
    orgSubdomain: owner.orgSubdomain,
  };
}

// ---------------------------------------------------------------------------
// Browser auth injection
// ---------------------------------------------------------------------------

/**
 * Inject the auth token into the browser's localStorage so the app treats the
 * user as logged in. Call this BEFORE navigating to any authenticated route.
 */
export interface LoginOptions {
  /**
   * Leave the feature tour offerable. Only the tour's own specs want this — everything
   * else is testing a workspace surface, and a first-time person is offered the tour over
   * the top of it.
   */
  keepTour?: boolean;
}

export async function loginAs(
  page: Page,
  user: TestUser,
  options: LoginOptions = {},
): Promise<void> {
  // Feature 039: every freshly created test user is a first-time arrival, so the tour
  // offers itself on the workspace home — which is where most specs start. Dismissing it
  // server-side here is the same treatment the Maestro bootstrap gives it, and it keeps
  // the decision in one place instead of in every spec.
  if (!options.keepTour) {
    await rpc(
      '/rpc.v1.TourService/UpdateTourProgress',
      { status: 'TOUR_STATUS_DISMISSED', currentStop: 0 },
      user.token,
    ).catch(() => undefined);
  }

  await page.addInitScript(
    ({ token, expiresAt }) => {
      localStorage.setItem('tech_office_access_token', token);
      localStorage.setItem('tech_office_token_expires_at', String(expiresAt));
    },
    { token: user.token, expiresAt: user.expiresAt },
  );
}
