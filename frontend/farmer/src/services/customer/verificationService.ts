// Customer KYC verification service — thin wrapper over the B2C backend.
// POST /verification/documents (multipart) stores into the customer-documents
// bucket; POST /verification/submit files the KYC submission for SuperAdmin.
import { b2cGet, b2cPost, b2cPostForm } from '../../api/b2cClient';

export type DocType = 'cnic_front' | 'cnic_back' | 'profile_photo';

export interface VerificationStatus {
  status: string;
  rejection_reason?: string | null;
  submitted_at?: string | null;
}

export interface DocumentUploadOut {
  path: string;
  doc_type: DocType;
}

export interface VerificationSubmitForm {
  full_name: string;
  phone: string;
  address: string;
  cnic_front_path?: string;
  cnic_back_path?: string;
  notes?: string;
}

/** Latest verification state; defaults to 'pending' before any submission. */
export function getVerificationStatus(): Promise<VerificationStatus> {
  return b2cGet<VerificationStatus>('/api/v1/verification/status');
}

/** Upload one KYC document; returns the storage path to send with submit. */
export function uploadDocument(
  uri: string,
  name: string,
  mimeType: string,
  docType: DocType,
): Promise<DocumentUploadOut> {
  return b2cPostForm<DocumentUploadOut>(
    '/api/v1/verification/documents',
    { doc_type: docType },
    { file: { uri, name, mimeType } },
  );
}

/** File the KYC submission for SuperAdmin review. */
export function submitVerification(
  form: VerificationSubmitForm,
): Promise<{ id: string }> {
  return b2cPost<{ id: string }>('/api/v1/verification/submit', form);
}
