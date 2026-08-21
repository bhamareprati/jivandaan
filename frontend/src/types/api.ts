/**
 * Types transcribed from docs/backend-contract.md.
 *
 * Nothing here is invented. If a field you need is missing, the contract is the
 * thing to change first -- then this file, then the component.
 */

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export const ROLES = ['donor', 'blood-bank', 'hospital', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const URGENCIES = ['low', 'medium', 'high', 'critical'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const REQUEST_STATUSES = [
  'pending',
  'under_review',
  'approved',
  'dispatched',
  'fulfilled',
  'rejected',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type VerificationStatus = 'pending' | 'verified' | 'rejected';
export type DonationStatus = 'available' | 'reserved' | 'used' | 'expired';

/* ------------------------------------------------------------- envelope */

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  [extra: string]: unknown;
}

export interface FieldError {
  field: string;
  message: string;
  code?: string;
  [extra: string]: unknown;
}

export interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
  meta?: PageMeta;
  errors?: FieldError[];
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

/* ---------------------------------------------------------------- users */

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

interface BaseAccount {
  id: string;
  _id?: string;
  name: string;
  email: string;
  contact?: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface DonorProfile extends BaseAccount {
  role: 'donor';
  dob: string;
  gender: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  bloodgroup: BloodGroup;
  profileImageUrl?: string;
  lastDonationDate: string | null;
  city?: string;
  state?: string;
  pincode?: string;
  location?: GeoPoint;
  age: number | null;
  nextEligibleDate: string | null;
  isEligible: boolean;
  daysUntilEligible: number;
}

export interface BankAccount extends BaseAccount {
  role: 'blood-bank';
  address: string;
  city: string;
  state: string;
  pincode: string;
  location?: GeoPoint;
  inventory: Record<BloodGroup, number>;
  lowStockThreshold: number;
  verificationStatus: VerificationStatus;
  licenseNumber?: string;
  verifiedAt?: string;
  rejectionReason?: string;
  isVerified: boolean;
  totalUnits: number;
}

export interface HospitalAccount extends BaseAccount {
  role: 'hospital';
  address: string;
  city: string;
  state: string;
  pincode: string;
  location?: GeoPoint;
  registrationNumber?: string;
  verificationStatus: VerificationStatus;
}

export type AnyAccount = DonorProfile | BankAccount | HospitalAccount | BaseAccount;

export interface AuthResult {
  token: string;
  role: Role;
  user: AnyAccount;
}

export interface Eligibility {
  eligible: boolean;
  nextEligibleDate: string | null;
  daysRemaining: number;
  lastDonationDate: string | null;
  intervalDays: number;
  progress: number; // 0..1 through the waiting window
  reason: string;
}

export interface SessionInfo {
  role: Role;
  user: AnyAccount;
  eligibility?: Eligibility;
}

/* ---------------------------------------------------------------- donor */

export interface ImpactStats {
  totalDonations: number;
  totalUnits: number;
  livesImpactedEstimate: number;
  firstDonation: string | null;
  lastDonation: string | null;
}

export interface DonorMe {
  profile: DonorProfile;
  eligibility: Eligibility;
  impact: ImpactStats;
  canDonateTo: BloodGroup[];
}

export interface Badge {
  id: string;
  label: string;
  at: number;
  earned: boolean;
  remaining: number;
}

export interface TimelineEntry {
  donationId: string;
  bloodGroup: BloodGroup;
  units: number;
  donationDate: string;
  expiryDate: string;
  status: DonationStatus;
  bankName: string | null;
  bankCity: string | null;
  isExpired: boolean;
}

export interface DonorPass {
  pass: {
    qrPayload: string;
    donorId: string;
    name: string;
    bloodgroup: BloodGroup;
    memberSince: string;
  };
  eligibility: Eligibility;
  impact: ImpactStats;
  badges: Badge[];
  timeline: TimelineEntry[];
}

export interface FeedItem {
  id: string;
  bloodGroup: BloodGroup;
  units: number;
  urgency: Urgency;
  status: RequestStatus;
  hospitalName: string | null;
  patientName: string | null;
  requiredBy: string | null;
  createdAt: string;
  bank: { id: string; name: string; city: string } | null;
  isExactMatch: boolean;
}

export interface FeedMeta extends PageMeta {
  donorBloodGroup: BloodGroup;
  servableGroups: BloodGroup[];
}

/* ----------------------------------------------------------- inventory */

export interface InventoryGroup {
  bloodGroup: BloodGroup;
  units: number;
  isLow: boolean;
  isEmpty: boolean;
  expiringSoon: number;
  canServe: BloodGroup[];
}

export interface LowStockGroup {
  bloodGroup: BloodGroup;
  units: number;
  threshold: number;
  shortfall: number;
  severity: 'critical' | 'warning';
}

export interface InventoryMatrix {
  bankId: string;
  bankName: string;
  verificationStatus: VerificationStatus;
  lowStockThreshold: number;
  expiryWindowDays: number;
  totalUnits: number;
  groups: InventoryGroup[];
  inventory: Record<BloodGroup, number>;
  lowStock: LowStockGroup[];
}

export interface ExpiryBatch {
  donationId: string;
  bloodGroup: BloodGroup;
  units: number;
  donationDate: string;
  expiryDate: string;
  daysToExpiry: number;
  donorName: string | null;
  severity: 'critical' | 'warning';
}

export interface ExpiryRadar {
  bankId: string;
  bankName: string;
  windowDays: number;
  shelfLifeDays: number;
  totalUnitsAtRisk: number;
  byGroup: { bloodGroup: BloodGroup; units: number; soonestDays: number }[];
  batches: ExpiryBatch[];
  lowStock: { bankId: string; threshold: number; groups: LowStockGroup[]; isDepleted: boolean };
}

export interface CheckinResult {
  donation: {
    _id: string;
    bloodGroup: BloodGroup;
    units: number;
    donationDate: string;
    expiryDate: string;
  };
  donor: {
    id: string;
    name: string;
    bloodgroup: BloodGroup;
    lastDonationDate: string;
    eligibility: Eligibility;
  };
  inventory: Record<BloodGroup, number>;
}

export interface BankSearchResult {
  id: string;
  name: string;
  contact: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  location: GeoPoint | null;
  distanceMeters: number | null;
  matchedBy: 'radius' | 'city';
  verificationStatus: VerificationStatus;
  lowStockThreshold: number;
  inventory: Record<BloodGroup, number>;
  totalUnits: number;
  unitsForRequestedGroup: number | null;
}

export interface BankSearchMeta extends PageMeta {
  searchMode: 'radius' | 'city';
  radiusMeters: number | null;
}

/* ------------------------------------------------------------ requests */

export interface StatusEvent {
  status: RequestStatus;
  changedBy?: string;
  changedByModel?: string;
  note?: string;
  at: string;
}

export interface BloodRequest {
  id: string;
  _id?: string;
  requester: string | { _id: string; name: string; contact?: string; email?: string; city?: string };
  requesterModel: 'donors' | 'hospitals';
  bloodBank:
    | string
    | null
    | { _id: string; name: string; city?: string; contact?: string; address?: string };
  bloodGroup: BloodGroup;
  units: number;
  urgency: Urgency;
  patientName?: string;
  hospitalName?: string;
  notes?: string;
  requiredBy?: string;
  status: RequestStatus;
  statusLabel: string;
  statusHistory: StatusEvent[];
  fulfilledAt?: string;
  rejectionReason?: string;
  isTerminal: boolean;
  stepIndex: number;
  createdAt: string;
  updatedAt: string;
  nextStatuses?: RequestStatus[];
}

export interface Stepper {
  steps: {
    status: RequestStatus;
    label: string;
    at: string | null;
    complete: boolean;
    current: boolean;
  }[];
  currentStatus: RequestStatus;
  currentLabel: string;
  currentIndex: number;
  isTerminal: boolean;
  derailed: boolean;
  derailedAs: RequestStatus | null;
  nextStatuses: RequestStatus[];
}

export interface SubstituteOption {
  bloodGroup: BloodGroup;
  unitsAvailable: number;
  isExactMatch: boolean;
  coversRequest: boolean;
}

export interface Substitutes {
  requestedGroup: BloodGroup;
  unitsRequested: number;
  exactAvailable: boolean;
  exactUnits: number;
  shortfall: number;
  totalCompatibleUnits: number;
  options: SubstituteOption[];
}

export interface RequestDetail {
  request: BloodRequest;
  stepper: Stepper;
  substitutes: Substitutes | null;
  notified?: { channel: string; donorsNotified: number; banksNotified: number } | null;
  consumed?: { donation: string; bloodGroup: BloodGroup; units: number }[] | null;
}

export interface MatchResult extends Partial<Substitutes> {
  requestedGroup: BloodGroup;
  compatibleDonorGroups: BloodGroup[];
  canDonateTo: BloodGroup[];
  bank?: { id: string; name: string };
  banksWithStock?: {
    id: string;
    name: string;
    city: string;
    matches: { bloodGroup: BloodGroup; units: number }[];
  }[];
}

/* --------------------------------------------------------------- admin */

export interface AdminMetrics {
  generatedAt: string;
  users: {
    donors: number;
    hospitals: number;
    banks: Partial<Record<VerificationStatus, number>>;
  };
  requests: {
    total: number;
    byStatus: Partial<Record<RequestStatus, number>>;
    byUrgency: Partial<Record<Urgency, number>>;
    byBloodGroup: { bloodGroup: BloodGroup; requests: number; units: number }[];
    fulfilmentRate: number;
    medianTimeToFulfilHours: number | null;
  };
  inventory: {
    totalUnits: number;
    byBloodGroup: Record<BloodGroup, number>;
    expiringWithinDays: number;
    unitsExpiringSoon: number;
    batchesExpired: number;
  };
  donations: {
    total: number;
    weeklyTrend: { year: number; week: number; label: string; donations: number; units: number }[];
  };
}

export interface PendingBank {
  id: string;
  name: string;
  email: string;
  contact: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  licenseNumber: string | null;
  location: GeoPoint | null;
  createdAt: string;
  waitingDays: number;
}

export interface AuditLogEntry {
  id: string;
  user: string;
  userModel: string;
  action: string;
  description: string;
  targetUser: string | null;
  targetModel: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface HealthInfo {
  status: string;
  version: string;
  env: string;
  uptimeSeconds: number;
  db: string;
  timestamp: string;
}
