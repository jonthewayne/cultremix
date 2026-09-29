export function generateSecureNumericCode(length: number): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return (array[0] % 10 ** length).toString().padStart(length, "0");
}
