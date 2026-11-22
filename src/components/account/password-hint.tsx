import type { PasswordPolicy } from "@/lib/account/types";
import { passwordHint } from "@/lib/auth";

export function passwordPolicyHint(policy: PasswordPolicy | null) {
  return policy ? `密码${passwordHint({ minLength: policy.minLength, uppercase: policy.hasUppercase, lowercase: policy.hasLowercase, number: policy.hasNumber, symbol: policy.hasSymbol })}。` : undefined;
}

export function PasswordHint({ policy }: { policy: PasswordPolicy | null }) {
  const hint = passwordPolicyHint(policy);
  return hint ? <p className="field-hint">{hint}</p> : null;
}
