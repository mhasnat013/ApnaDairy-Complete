// Complaint service — create, list, detail, follow-up messages, photo upload.
import { b2cGet, b2cPost, b2cPostForm, qs, type UploadFile } from '../../api/b2cClient';
import type { Complaint, ComplaintCategory, ComplaintStatus } from '../../types/customerModels';

export interface ComplaintInput {
  order_id?: string;
  category: ComplaintCategory;
  subject: string;
  description: string;
}

/** Customer's complaints, optionally filtered by status. */
export async function listComplaints(status?: ComplaintStatus): Promise<Complaint[]> {
  return b2cGet<Complaint[]>('/api/v1/complaints/' + qs({ status }));
}

/** Complaint detail with message thread. */
export async function getComplaint(complaintId: string): Promise<Complaint> {
  return b2cGet<Complaint>(`/api/v1/complaints/${encodeURIComponent(complaintId)}`);
}

/** File a complaint, optionally linked to an order, with optional photo. */
export async function createComplaint(
  input: ComplaintInput,
  photo?: UploadFile,
): Promise<Complaint> {
  if (input.subject.trim().length < 3) throw new Error('The subject must be at least 3 characters long.');
  if (input.description.trim().length < 10) throw new Error('The description must be at least 10 characters long.');
  return b2cPostForm<Complaint>(
    '/api/v1/complaints/',
    {
      order_id: input.order_id,
      category: input.category,
      subject: input.subject,
      description: input.description,
    },
    { photo },
  );
}

/** Add a follow-up message to a complaint thread. */
export async function postComplaintMessage(
  complaintId: string,
  text: string,
): Promise<Array<Record<string, unknown>>> {
  if (!text.trim()) throw new Error('The message cannot be empty.');
  return b2cPost<Array<Record<string, unknown>>>(
    `/api/v1/complaints/${encodeURIComponent(complaintId)}/messages`,
    { text },
  );
}
