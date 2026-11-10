import { create, toJson, type JsonObject, type MessageInitShape } from "@bufbuild/protobuf";
import { DurationSchema } from "@bufbuild/protobuf/wkt";
import { UserVerificationRequirement } from "@zitadel/proto/zitadel/session/v2/challenge_pb.js";
import { SetSessionRequestSchema, SetSessionResponseSchema } from "@zitadel/proto/zitadel/session/v2/session_service_pb.js";
import { LoginSettingsSchema } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb.js";
import { GetLoginSettingsResponseSchema, GetPasswordComplexitySettingsResponseSchema } from "@zitadel/proto/zitadel/settings/v2/settings_service_pb.js";
import { AuthFactorSchema, AuthFactorState, PasskeySchema } from "@zitadel/proto/zitadel/user/v2/user_pb.js";
import {
  AddHumanUserResponseSchema, AddOTPEmailRequestSchema, AddOTPSMSRequestSchema,
  AuthenticationMethodType,
  GetUserByIDResponseSchema, ListAuthenticationFactorsResponseSchema, ListAuthenticationMethodTypesResponseSchema,
  SetPasswordRequestSchema, SetPhoneRequestSchema,
  VerifyPhoneRequestSchema,
} from "@zitadel/proto/zitadel/user/v2/user_service_pb.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/server/errors";
import type { getClients } from "@/server/zitadel/sdk";

type Clients = ReturnType<typeof getClients>;
const mocks = vi.hoisted(() => ({
  user: {
    listAuthenticationFactors: vi.fn<Clients["user"]["listAuthenticationFactors"]>(),
    listAuthenticationMethodTypes: vi.fn<Clients["user"]["listAuthenticationMethodTypes"]>(),
    getUserByID: vi.fn<Clients["user"]["getUserByID"]>(),
    addOTPEmail: vi.fn<Clients["user"]["addOTPEmail"]>(),
    addOTPSMS: vi.fn<Clients["user"]["addOTPSMS"]>(),
    setPhone: vi.fn<Clients["user"]["setPhone"]>(),
    verifyPhone: vi.fn<Clients["user"]["verifyPhone"]>(),
    setPassword: vi.fn<Clients["user"]["setPassword"]>(),
    addHumanUser: vi.fn<Clients["user"]["addHumanUser"]>(),
  },
  settings: {
    getLoginSettings: vi.fn<Clients["settings"]["getLoginSettings"]>(),
    getPasswordComplexitySettings: vi.fn<Clients["settings"]["getPasswordComplexitySettings"]>(),
  },
  session: { setSession: vi.fn<Clients["session"]["setSession"]>() },
}));
vi.mock("@/server/config", () => ({ getConfig: () => ({ appUrl: "https://login.example.com:8443/auth", organizationId: "org-id" }) }));
vi.mock("@/server/zitadel/sdk", () => ({ getClients: () => mocks }));
import { zitadel } from "@/server/zitadel/service";

const session = { sessionId: "session-id", sessionToken: "session-token" };
const states = [AuthFactorState.UNSPECIFIED, AuthFactorState.NOT_READY, AuthFactorState.READY, AuthFactorState.REMOVED];
const factorCases = ["otp", "otpEmail", "otpSms", "u2f"] as const;

function loginSettings(settings: MessageInitShape<typeof LoginSettingsSchema>) {
  mocks.settings.getLoginSettings.mockResolvedValue(create(GetLoginSettingsResponseSchema, { settings }));
}
function human(contact: MessageInitShape<typeof GetUserByIDResponseSchema>["user"] = {
  type: { case: "human", value: { email: { email: "user@example.com", isVerified: true }, phone: { phone: "+12025550123", isVerified: true } } },
}) {
  mocks.user.getUserByID.mockResolvedValue(create(GetUserByIDResponseSchema, { user: contact }));
}

beforeEach(() => {
  vi.resetAllMocks();
  loginSettings({});
  mocks.settings.getPasswordComplexitySettings.mockResolvedValue(create(GetPasswordComplexitySettingsResponseSchema, { settings: { minLength: 12n } }));
  mocks.user.listAuthenticationFactors.mockResolvedValue(create(ListAuthenticationFactorsResponseSchema));
  mocks.session.setSession.mockResolvedValue(create(SetSessionResponseSchema, { sessionToken: "updated-token" }));
  human();
});

describe("MFA policy SDK adaptation", () => {
  it("converts protobuf seconds and nanos to milliseconds without dropping fractions", async () => {
    loginSettings({
      secondFactorCheckLifetime: create(DurationSchema, { seconds: 30n, nanos: 250_000_000 }),
      multiFactorCheckLifetime: create(DurationSchema, { seconds: 0n, nanos: 500_000 }),
    });
    expect(await zitadel.policy()).toMatchObject({ secondFactorLifetimeMs: 30_250, multiFactorLifetimeMs: 0.5 });
  });

  it("preserves zero lifetimes instead of treating them as absent", async () => {
    loginSettings({ secondFactorCheckLifetime: {}, multiFactorCheckLifetime: {} });
    expect(await zitadel.policy()).toMatchObject({ secondFactorLifetimeMs: 0, multiFactorLifetimeMs: 0 });
  });

  it("leaves missing lifetimes undefined", async () => {
    const policy = await zitadel.policy();
    expect(policy.secondFactorLifetimeMs).toBeUndefined();
    expect(policy.multiFactorLifetimeMs).toBeUndefined();
  });
});

describe("READY authentication factors from the installed proto", () => {
  it("uses the actual AuthFactor oneof, which has no password or passkey case", () => {
    expect(AuthFactorSchema.oneofs.find(oneof => oneof.name === "type")?.fields.map(field => field.localName)).toEqual(["otp", "u2f", "otpSms", "otpEmail"]);
    expect(PasskeySchema.fields.find(field => field.localName === "state")?.enum).toBeDefined();
  });

  for (const type of factorCases) {
    it.each(states)(`includes ${type} only when state=%s is READY`, async state => {
      mocks.user.listAuthenticationFactors.mockResolvedValue(create(ListAuthenticationFactorsResponseSchema, {
        result: [create(AuthFactorSchema, { state, type: { case: type, value: {} } })],
      }));
      expect(await zitadel.methods("user-id")).toEqual(state === AuthFactorState.READY ? [type === "otp" ? "totp" : type] : []);
      expect(mocks.user.listAuthenticationFactors).toHaveBeenCalledWith({ userId: "user-id", states: [AuthFactorState.READY] });
    });
  }

  it("does not infer enrolled MFA from possible authentication method types or an empty oneof", async () => {
    mocks.user.listAuthenticationMethodTypes.mockResolvedValue(create(ListAuthenticationMethodTypesResponseSchema, {
      authMethodTypes: [AuthenticationMethodType.PASSWORD, AuthenticationMethodType.IDP, AuthenticationMethodType.TOTP, AuthenticationMethodType.PASSKEY],
    }));
    mocks.user.listAuthenticationFactors.mockResolvedValue(create(ListAuthenticationFactorsResponseSchema, { result: [{ state: AuthFactorState.READY }] }));
    expect(await zitadel.methods("user-id")).toEqual([]);
    expect(mocks.user.listAuthenticationMethodTypes).not.toHaveBeenCalled();
  });

  it.each(["listAuthenticationFactors"] as const)("propagates %s failures instead of guessing enrollment", async method => {
    mocks.user[method].mockRejectedValueOnce(new Error("upstream unavailable"));
    await expect(zitadel.methods("user-id")).rejects.toThrow("upstream unavailable");
  });
});

describe("MFA challenges and checks", () => {
  it.each([
    ["u2f", UserVerificationRequirement.DISCOURAGED],
  ] as const)("requests the correct user verification for %s", async (method, requirement) => {
    const result = await zitadel.challenge(session, method);
    const request = mocks.session.setSession.mock.calls[0][0];
    expect(request).toMatchObject({ ...session, challenges: { webAuthN: { domain: "login.example.com", userVerificationRequirement: requirement } } });
    expect(request.checks).toBeUndefined();
    expect(result.sessionToken).toBe("updated-token");
  });

  it("sends email OTP through the protobuf sendCode oneof", async () => {
    await zitadel.challenge(session, "otpEmail");
    const request = create(SetSessionRequestSchema, mocks.session.setSession.mock.calls[0][0]);
    expect(toJson(SetSessionRequestSchema, request)).toMatchObject({ challenges: { otpEmail: { sendCode: {} } } });
  });

  it("sends SMS OTP without returning the secret code", async () => {
    await zitadel.challenge(session, "otpSms");
    expect(mocks.session.setSession.mock.calls[0][0].challenges?.otpSms?.returnCode).toBe(false);
  });

  it.each(["u2f"] as const)("rejects numeric verification for %s before calling the SDK", async method => {
    await expect(zitadel.verifyFactor(session, method, "123456")).rejects.toBeInstanceOf(AuthError);
    expect(mocks.session.setSession).not.toHaveBeenCalled();
  });

  it.each(["totp", "otpEmail", "otpSms"] as const)("uses the correct protobuf check for %s", async method => {
    await zitadel.verifyFactor(session, method, "012345");
    expect(mocks.session.setSession.mock.calls[0][0].checks).toMatchObject({ [method]: { code: "012345" } });
  });

  it("passes WebAuthn assertions as JsonObject rather than numeric codes", async () => {
    const assertion: JsonObject = { id: "credential-id", type: "public-key", response: { signature: "signature", clientDataJSON: "client-data" } };
    await zitadel.verifyWebAuthn(session, assertion);
    expect(mocks.session.setSession.mock.calls[0][0].checks?.webAuthN?.credentialAssertionData).toEqual(assertion);
  });
});

describe("OTP enrollment and prerequisites", () => {
  it.each(["otpEmail", "otpSms"] as const)("enrolls %s only after reading a verified contact", async type => {
    await zitadel.enrollOtp("user-id", type);
    expect(mocks.user.getUserByID).toHaveBeenCalledWith({ userId: "user-id" });
    if (type === "otpEmail") {
      const request = create(AddOTPEmailRequestSchema, mocks.user.addOTPEmail.mock.calls[0][0]);
      expect(toJson(AddOTPEmailRequestSchema, request)).toEqual({ userId: "user-id" });
      expect(mocks.user.getUserByID.mock.invocationCallOrder[0]).toBeLessThan(mocks.user.addOTPEmail.mock.invocationCallOrder[0]);
      expect(mocks.user.addOTPSMS).not.toHaveBeenCalled();
    } else {
      const request = create(AddOTPSMSRequestSchema, mocks.user.addOTPSMS.mock.calls[0][0]);
      expect(toJson(AddOTPSMSRequestSchema, request)).toEqual({ userId: "user-id" });
      expect(mocks.user.getUserByID.mock.invocationCallOrder[0]).toBeLessThan(mocks.user.addOTPSMS.mock.invocationCallOrder[0]);
      expect(mocks.user.addOTPEmail).not.toHaveBeenCalled();
    }
  });

  for (const type of ["otpEmail", "otpSms"] as const) {
    it.each(["missing", "unverified", "default"])(`rejects ${type} with a %s contact, even if the other contact is verified`, async state => {
      const contact = state === "missing" ? undefined : state === "unverified" ? { isVerified: false } : {};
      human({ type: { case: "human", value: {
        email: type === "otpEmail" ? contact : { isVerified: true },
        phone: type === "otpSms" ? contact : { isVerified: true },
      } } });
      await expect(zitadel.enrollOtp("user-id", type)).rejects.toThrow(type === "otpEmail" ? "请先验证账号邮箱" : "请先添加并验证手机号码");
      expect(mocks.user.addOTPEmail).not.toHaveBeenCalled();
      expect(mocks.user.addOTPSMS).not.toHaveBeenCalled();
    });
  }

  it("does not enroll for a machine user", async () => {
    human({ type: { case: "machine", value: {} } });
    await expect(zitadel.enrollOtp("user-id", "otpEmail")).rejects.toBeInstanceOf(AuthError);
    expect(mocks.user.addOTPEmail).not.toHaveBeenCalled();
  });

  it("sets the enrollment phone using sendCode, not isVerified or returnCode", async () => {
    await zitadel.setEnrollmentPhone("user-id", "+12025550123");
    const request = create(SetPhoneRequestSchema, mocks.user.setPhone.mock.calls[0][0]);
    expect(toJson(SetPhoneRequestSchema, request)).toEqual({ userId: "user-id", phone: "+12025550123", sendCode: {} });
    expect(mocks.user.addOTPSMS).not.toHaveBeenCalled();
  });

  it("verifies the phone without implicitly enrolling SMS OTP", async () => {
    await zitadel.verifyEnrollmentPhone("user-id", "012345");
    const request = create(VerifyPhoneRequestSchema, mocks.user.verifyPhone.mock.calls[0][0]);
    expect(toJson(VerifyPhoneRequestSchema, request)).toEqual({ userId: "user-id", verificationCode: "012345" });
    expect(mocks.user.addOTPSMS).not.toHaveBeenCalled();
  });

  it("changes the password without a reset code and clears changeRequired", async () => {
    await zitadel.changePassword("user-id", "new-password");
    expect(mocks.user.setPassword).toHaveBeenCalledWith({ userId: "user-id", newPassword: { password: "new-password", changeRequired: false } });
    const request = create(SetPasswordRequestSchema, mocks.user.setPassword.mock.calls[0][0]);
    expect(request.verification.case).toBeUndefined();
    expect(request.newPassword?.changeRequired).toBe(false);
  });

  it("preserves registration username and automatic name fields", async () => {
    mocks.user.addHumanUser.mockResolvedValue(create(AddHumanUserResponseSchema, { userId: "user-id" }));
    await zitadel.register({ username: "  test-account  ", email: "user@example.com", password: "password", confirmPassword: "password" });
    expect(mocks.user.addHumanUser).toHaveBeenCalledWith(expect.objectContaining({
      username: "test-account", profile: { givenName: "test-account", familyName: "test-account", nickName: "test-account", displayName: "test-account", preferredLanguage: "zh" },
    }));
  });
});
