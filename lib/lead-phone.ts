export const phoneValidationMessage =
  "Enter a phone number with 10 to 15 digits.";

export function isValidLeadPhone(value: string) {
  const phone = value.trim();
  return (
    phone.length <= 40 &&
    /^\+?[\d\s().-]+$/.test(phone) &&
    /^\d{10,15}$/.test(phone.replace(/\D/g, ""))
  );
}
