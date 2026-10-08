// Permanent (monthly) customer service — subscription requests + ledger.
// Only SuperAdmin-verified customers may request; the backend enforces this
// (403 when verification_status != 'approved').
import { b2cGet, b2cPost } from '../../api/b2cClient';

export type Cycle = '15' | '30';

export interface PermanentRequest {
  id: string;
  customer_id: string;
  cycle: string;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  daily_quantity_l?: number | null;
  rejection_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LedgerEntry {
  id: string;
  entry_type: string;
  amount: number;
  ref?: string | null;
  created_at?: string | null;
}

export interface Ledger {
  entries: LedgerEntry[];
  balance: number;
}

/** Latest subscription request, or { status: 'none' } when there is none. */
export function getPermanentStatus(): Promise<PermanentRequest | { status: 'none' }> {
  return b2cGet<PermanentRequest | { status: 'none' }>('/api/v1/permanent/status');
}

/** Request a 15- or 30-day permanent subscription. */
export function requestPermanent(
  cycle: Cycle,
  daily_quantity_l: number,
  start_date: string,
): Promise<PermanentRequest> {
  return b2cPost<PermanentRequest>('/api/v1/permanent/request', {
    cycle,
    daily_quantity_l,
    start_date,
  });
}

/** Monthly ledger entries newest-first plus the signed balance. */
export function getLedger(): Promise<Ledger> {
  return b2cGet<Ledger>('/api/v1/permanent/ledger');
}
