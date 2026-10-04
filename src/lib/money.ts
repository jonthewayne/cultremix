// USD integer cents for display: 1234 -> "$12.34", -90 -> "−$0.90".
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}
