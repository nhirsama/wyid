import type { LoginPolicy } from "../../src/lib/auth";
import { LoginForm, RegisterForm, ResetPasswordForm } from "../../src/components/auth/forms";
import { LoginPasswordChangeForm } from "../../src/components/auth/mfa-forms";

const policy: LoginPolicy = {
  password: true, registration: true, passwordReset: true, passkey: false,
  forceMfa: false, forceMfaLocalOnly: false, factors: [], userVerifiedKey: false,
  passwordPolicy: { minLength: 8, uppercase: false, lowercase: false, number: false, symbol: false },
  identityProviders: [],
};
const context = { authRequestId: "V2_security-fixture", userId: "fixture-user" };

export const passwordForms = [
  { name: "login", element: <LoginForm context={context} policy={policy} /> },
  { name: "registration", element: <RegisterForm context={context} policy={policy} /> },
  { name: "password-reset", element: <ResetPasswordForm context={context} policy={policy} /> },
  { name: "password-change", element: <LoginPasswordChangeForm context={context} policy={policy} /> },
];
