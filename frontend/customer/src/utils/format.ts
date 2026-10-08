// Shared currency formatter for the customer app.
// Single source of truth: "Rs 1,250.00" (Pakistani separators, 2 decimals).
export function formatRs(value: number | null | undefined): string {
  const n = Number(value) || 0;
  return `Rs ${n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
