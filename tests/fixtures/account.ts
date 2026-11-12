import { create } from "@bufbuild/protobuf";
import { UserSchema } from "@zitadel/proto/zitadel/user/v2/user_pb.js";
import { SessionSchema } from "@zitadel/proto/zitadel/session/v2/session_pb.js";
import type { Identity } from "@/server/account/identity";

export function identityFixture(): Identity {
  return {
    organizationId: "org", ref: { userId: "user", sessionId: "session", sessionToken: "user-session-token" },
    state: {
      step: "complete", userId: "user", methods: [], needsEnrollment: false,
      user: create(UserSchema, { userId: "user", username: "test-user", details: { resourceOwner: "org" }, type: { case: "human", value: { profile: { givenName: "Given", familyName: "Family", displayName: "Test User", preferredLanguage: "zh-CN" }, email: { email: "test@example.com", isVerified: true } } } }),
      session: create(SessionSchema, { id: "session", factors: { user: { id: "user" }, password: { verifiedAt: { seconds: BigInt(Math.floor(Date.now() / 1000)) } } } }),
      policy: { password: true, registration: true, passwordReset: true, passkey: true, forceMfa: false, forceMfaLocalOnly: false, factors: ["totp", "u2f", "otpEmail", "otpSms"], userVerifiedKey: true, passwordPolicy: { minLength: 8, uppercase: true, lowercase: true, number: true, symbol: false }, identityProviders: [] },
    },
  };
}
