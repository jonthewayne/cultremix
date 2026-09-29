export function shouldUseConsoleEmailProvider(provider: string | undefined) {
  return provider !== "resend";
}

export function shouldUseConsoleSmsProvider(provider: string | undefined) {
  return provider !== "telnyx";
}
