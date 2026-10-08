// Profile + verification service — customer profile read/update and the
// mandatory SuperAdmin verification flow (CNIC + address documents).
import { b2cGet, b2cPut, b2cPost, b2cPostForm, type UploadFile } from '../../api/b2cClient';
import type {
  CustomerProfile,
  HomeFeed,
  VerificationStatus,
} from '../../types/customerModels';

export interface ProfileUpdateInput {
  first_name?: string;
  last_name?: string;
  phone?: string;
}

/** Full customer profile. */
export async function getProfile(): Promise<CustomerProfile> {
  return b2cGet<CustomerProfile>('/api/v1/profile/');
}

/** Update name/phone only (email, role, verification are protected). */
export async function updateProfile(input: ProfileUpdateInput): Promise<CustomerProfile> {
  return b2cPut<CustomerProfile>('/api/v1/profile/', input);
}

/** Personalized home feed (greeting, featured, dues, unread count). */
export async function getHomeFeed(): Promise<HomeFeed> {
  return b2cGet<HomeFeed>('/api/v1/home/feed/me');
}

/** Public explore feed (no auth required). */
export async function getPublicFeed(): Promise<HomeFeed> {
  return b2cGet<HomeFeed>('/api/v1/home/feed/');
}

export interface VerificationSubmitInput {
  full_name: string;
  phone: string;
  address: string;
  notes?: string;
}

/** Submit the verification application for SuperAdmin review. */
export async function submitVerification(
  input: VerificationSubmitInput,
): Promise<Record<string, unknown>> {
  return b2cPost<Record<string, unknown>>('/api/v1/verification/submit', input);
}

/** Current verification status. */
export async function getVerificationStatus(): Promise<VerificationStatus> {
  return b2cGet<VerificationStatus>('/api/v1/verification/status');
}

export type VerificationDocType = 'cnic_front' | 'cnic_back' | 'profile_photo';

/** Upload a verification document (CNIC front/back, profile photo). */
export async function uploadVerificationDocument(
  file: UploadFile,
  docType: VerificationDocType,
): Promise<{ path: string; doc_type: VerificationDocType }> {
  return b2cPostForm<{ path: string; doc_type: VerificationDocType }>(
    '/api/v1/verification/documents',
    { doc_type: docType },
    { file },
  );
}
