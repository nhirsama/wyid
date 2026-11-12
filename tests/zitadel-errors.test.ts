import { create, toBinary } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorDetailSchema } from "@zitadel/proto/zitadel/message_pb.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyCallbackError } from "@/server/zitadel/errors";
import { actionError } from "@/server/errors";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe("structured ZITADEL callback errors", () => {
  it.each(["translated message", "Errors.User.MFA.NotReady", ""])("uses decoded details, never the error text: %s", message => {
    const error = new ConnectError(message, Code.FailedPrecondition);
    error.details = [{ type: ErrorDetailSchema.typeName, value: toBinary(ErrorDetailSchema, create(ErrorDetailSchema, { id: "COMMAND-Sx208nt", message })) }];
    expect(classifyCallbackError(error)).toBe("request-handled");
    expect(actionError(error)).toMatchObject({ ok: false, message: expect.stringContaining("授权请求已处理"), requestId: expect.any(String) });
  });

  it("does not classify an ID under an unexpected status", () => {
    const error = new ConnectError("message", Code.Unavailable, undefined, [{ desc: ErrorDetailSchema, value: { id: "COMMAND-Hkl3d" } }]);
    expect(classifyCallbackError(error)).toBeUndefined();
  });

  it.each([null, { code: 9 }, new Error("COMMAND-Hkl3d"), new ConnectError("COMMAND-Hkl3d", Code.FailedPrecondition)])("does not infer an error ID from unstructured data", error => {
    expect(classifyCallbackError(error)).toBeUndefined();
  });

  it("ignores malformed and unsupported detail messages", () => {
    const error = new ConnectError("message", Code.FailedPrecondition);
    error.details = [{ type: ErrorDetailSchema.typeName, value: new Uint8Array([255]) }, { type: "zitadel.error.v2.ErrorDetail", value: new Uint8Array() }];
    expect(classifyCallbackError(error)).toBeUndefined();
    expect(actionError(error)).toMatchObject({ ok: false, message: expect.stringContaining("前置条件"), requestId: expect.any(String) });
  });

  it("never logs or renders raw error text, credentials or unknown detail payloads", () => {
    const error = new ConnectError("secret-token raw-password", Code.FailedPrecondition, undefined, [{ desc: ErrorDetailSchema, value: { id: "unknown", message: "private intent-token" } }]);
    const result = actionError(error);
    const output = JSON.stringify([result, vi.mocked(console.error).mock.calls]);
    for (const secret of ["secret-token", "raw-password", "intent-token"]) expect(output).not.toContain(secret);
    expect(result.requestId).toEqual(expect.any(String));
  });
});
