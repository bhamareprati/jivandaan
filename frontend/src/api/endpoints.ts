import { api } from './client';
import type {
  AdminMetrics,
  AuditLogEntry,
  AuthResult,
  BankSearchResult,
  BloodGroup,
  BloodRequest,
  CheckinResult,
  DonorMe,
  DonorPass,
  ExpiryRadar,
  FeedItem,
  HealthInfo,
  InventoryMatrix,
  MatchResult,
  PendingBank,
  RequestDetail,
  RequestStatus,
  Role,
  SessionInfo,
  Urgency,
} from '@/types/api';

/**
 * One function per route in docs/backend-contract.md, named after it.
 *
 * Nothing outside this file constructs a URL. If a call is missing here, it is
 * not in the contract -- add it to the contract first.
 */

/* --------------------------------------------------------------- system */

export const getHealth = () => api.get<HealthInfo>('/health');

/* ----------------------------------------------------------------- auth */

export interface LoginInput {
  email: string;
  password: string;
  role: Role;
}

export const login = (input: LoginInput) => api.post<AuthResult>('/auth/login', input);

export const register = (input: Record<string, unknown>) =>
  api.post<AuthResult>('/auth/register', input);

export const logout = () => api.post<null>('/auth/logout');

/** `quiet` so a signed-out visitor's 401 does not trigger the global sign-out. */
export const getSession = () => api.get<SessionInfo>('/auth/me', undefined, { quiet: true });

export const forgotPassword = (email: string, role: Role) =>
  api.post<{ resetToken?: string } | null>('/auth/forgot-password', { email, role });

export const resetPassword = (input: { token: string; role: Role; newPassword: string }) =>
  api.post<null>('/auth/reset-password', input);

/* ---------------------------------------------------------------- donor */

export const getDonorMe = () => api.get<DonorMe>('/donors/me');

export const updateDonorMe = (input: Record<string, unknown>) =>
  api.patch<{ profile: DonorMe['profile'] }>('/donors/me', input);

export const getDonorPass = () => api.get<DonorPass>('/donors/me/pass');

export interface FeedQuery {
  page?: number;
  limit?: number;
  city?: string;
  lat?: number;
  lng?: number;
  radius?: number;
  urgency?: Urgency;
}

export const getDonorFeed = (query: FeedQuery = {}) =>
  api.list<FeedItem>('/donors/feed', { limit: 20, ...query });

/* ----------------------------------------------------------------- bank */

export const getInventory = (bankId: string) =>
  api.get<InventoryMatrix>(`/banks/${bankId}/inventory`);

export const patchInventory = (
  bankId: string,
  inventory: Partial<Record<BloodGroup, number>>,
  reason?: string
) =>
  api.patch<{ inventory: Record<BloodGroup, number>; applied: Record<string, unknown> }>(
    `/banks/${bankId}/inventory`,
    { inventory, reason }
  );

export interface CheckinInput {
  passToken?: string;
  donorId?: string;
  units: number;
  donationDate?: string;
  notes?: string;
}

export const checkinDonor = (bankId: string, input: CheckinInput) =>
  api.post<CheckinResult>(`/banks/${bankId}/checkin`, input);

export const getExpiryRadar = (bankId: string, windowDays?: number) =>
  api.get<ExpiryRadar>(`/banks/${bankId}/expiry-radar`, { windowDays });

export const reconcileInventory = (bankId: string) =>
  api.post<{ inventory: Record<BloodGroup, number>; corrected: number }>(
    `/banks/${bankId}/reconcile`
  );

export interface BankSearchQuery {
  lat?: number;
  lng?: number;
  radius?: number;
  city?: string;
  pincode?: string;
  bloodGroup?: BloodGroup;
  minUnits?: number;
  page?: number;
  limit?: number;
}

export const searchBanks = (query: BankSearchQuery) =>
  api.list<BankSearchResult>('/banks', { limit: 50, ...query });

export const getBank = (bankId: string) =>
  api.get<{ bank: Record<string, unknown>; inventory: InventoryMatrix }>(`/banks/${bankId}`);

/* -------------------------------------------------------------- request */

export interface CreateRequestInput {
  bloodGroup: BloodGroup;
  units: number;
  urgency: Urgency;
  bloodBank?: string;
  patientName?: string;
  hospitalName?: string;
  notes?: string;
  requiredBy?: string;
}

export const createRequest = (input: CreateRequestInput) =>
  api.post<RequestDetail>('/requests', input);

export const getRequest = (id: string) => api.get<RequestDetail>(`/requests/${id}`);

export interface PatchStatusInput {
  status: RequestStatus;
  note?: string;
  reason?: string;
  fulfillFromGroup?: BloodGroup;
}

export const patchRequestStatus = (id: string, input: PatchStatusInput) =>
  api.patch<RequestDetail>(`/requests/${id}/status`, input);

export interface RequestListQuery {
  page?: number;
  limit?: number;
  urgency?: Urgency;
  status?: RequestStatus;
  bank?: string;
  bloodGroup?: BloodGroup;
  mine?: boolean;
}

export const listRequests = (query: RequestListQuery = {}) =>
  api.list<BloodRequest>('/requests', { limit: 50, ...query });

export const matchBloodGroup = (bloodGroup: BloodGroup, bankId?: string, units = 1) =>
  api.get<MatchResult>(`/requests/match/${encodeURIComponent(bloodGroup)}`, { bankId, units });

/* ---------------------------------------------------------------- admin */

export const getAdminMetrics = () => api.get<AdminMetrics>('/admin/metrics');

export const listPendingBanks = (page = 1, limit = 20) =>
  api.list<PendingBank>('/admin/banks/pending', { page, limit });

export const verifyBank = (bankId: string, action: 'approve' | 'reject', reason?: string) =>
  api.patch<{ bank: Record<string, unknown> }>(`/admin/banks/${bankId}/verify`, { action, reason });

export interface LogQuery {
  page?: number;
  limit?: number;
  user?: string;
  action?: string;
  from?: string;
  to?: string;
}

export const listAuditLogs = (query: LogQuery = {}) =>
  api.list<AuditLogEntry>('/admin/logs', { limit: 25, ...query });
