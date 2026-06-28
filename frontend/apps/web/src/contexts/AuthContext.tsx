'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  IAMUser,
  OrganizationMembership,
  exchangeToken,
  login as apiLogin,
  logout as apiLogout,
  getProfile,
  getUserOrganizations,
  switchOrganization as apiSwitchOrganization,
  SSOProviderType,
} from 'apis';

// ============================================================================
// Types
// ============================================================================

interface AuthContextType {
  user: IAMUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  currentOrg: OrganizationMembership | null;
  organizations: OrganizationMembership[];
  
  // Authentication methods
  login: (email: string, password: string) => Promise<void>;
  loginWithSSO: (provider: SSOProviderType, idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  
  // Organization management
  switchOrganization: (orgId: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

// ============================================================================
// Context
// ============================================================================

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<IAMUser | null>(null);
  const [currentOrg, setCurrentOrg] = useState<OrganizationMembership | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationMembership[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load user profile on mount if token exists
  const refreshProfile = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      setIsLoading(false);
      return;
    }

    try {
      const profile = await getProfile();
      setUser(profile.user);

      // Load organizations
      const orgs = await getUserOrganizations();
      setOrganizations(orgs);
      
      // Set current org (first one by default, or from localStorage)
      const savedOrgId = localStorage.getItem('current_org_id');
      const currentOrgData = savedOrgId 
        ? orgs.find(o => o.organizationId === savedOrgId)
        : orgs[0];
      
      setCurrentOrg(currentOrgData || null);
    } catch (error) {
      console.error('Failed to load profile:', error);
      // Clear invalid token
      localStorage.removeItem('auth_token');
      localStorage.removeItem('current_org_id');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  // Email/password login
  const login = useCallback(async (email: string, password: string) => {
    const response = await apiLogin(email, password);
    localStorage.setItem('auth_token', response.accessToken);
    setUser(response.user);

    // Load organizations after login
    const orgs = await getUserOrganizations();
    setOrganizations(orgs);
    setCurrentOrg(orgs[0] || null);
    if (orgs[0]) {
      localStorage.setItem('current_org_id', orgs[0].organizationId);
    }
  }, []);

  // SSO login
  const loginWithSSO = useCallback(async (provider: SSOProviderType, idToken: string) => {
    const response = await exchangeToken(provider, idToken);
    localStorage.setItem('auth_token', response.accessToken);
    setUser(response.user);

    // Load organizations after login
    const orgs = await getUserOrganizations();
    setOrganizations(orgs);
    setCurrentOrg(orgs[0] || null);
    if (orgs[0]) {
      localStorage.setItem('current_org_id', orgs[0].organizationId);
    }
  }, []);

  // Logout
  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('current_org_id');
      setUser(null);
      setCurrentOrg(null);
      setOrganizations([]);
    }
  }, []);

  // Switch organization
  const switchOrganization = useCallback(async (orgId: string) => {
    const response = await apiSwitchOrganization(orgId);
    
    // Update token with new org context
    localStorage.setItem('auth_token', response.accessToken);
    localStorage.setItem('current_org_id', orgId);
    
    // Update current org
    const newOrg = organizations.find(o => o.organizationId === orgId);
    setCurrentOrg(newOrg || null);
  }, [organizations]);

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    currentOrg,
    organizations,
    login,
    loginWithSSO,
    logout,
    switchOrganization,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ============================================================================
// Hook
// ============================================================================

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
