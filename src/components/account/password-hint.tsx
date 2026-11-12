import type { PasswordPolicy } from "@/lib/account/types";
import { passwordHint } from "@/lib/auth";

export function PasswordHint({ policy }: { policy: PasswordPolicy | null }) {
  return policy && <p className="field-hint">{passwordHint({ minLength: policy.minLength, uppercase: policy.hasUppercase, lowercase: policy.hasLowercase, number: policy.hasNumber, symbol: policy.hasSymbol })}</p>;
}
