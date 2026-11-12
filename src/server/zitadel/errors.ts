import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorDetailSchema } from "@zitadel/proto/zitadel/message_pb.js";

type CallbackFailure = "request-handled" | "request-missing" | "organization-mismatch" | "session-invalid";

// ZITADEL's structured ErrorDetail IDs, not translated messages or the broad
// FailedPrecondition status. Unknown/new detail formats deliberately stay unknown.
const callbackFailures: Record<string, { code: Code; kind: CallbackFailure }> = {
  "COMMAND-Sx208nt": { code: Code.FailedPrecondition, kind: "request-handled" },
  "COMMAND-Sx202nt": { code: Code.FailedPrecondition, kind: "request-handled" },
  "COMMAND-SFwd2": { code: Code.FailedPrecondition, kind: "request-handled" },
  "COMMAND-jae5P": { code: Code.NotFound, kind: "request-missing" },
  "COMMAND-59ljd": { code: Code.FailedPrecondition, kind: "organization-mismatch" },
  "COMMAND-Hewfq": { code: Code.FailedPrecondition, kind: "session-invalid" },
  "COMMAND-Hkl3d": { code: Code.FailedPrecondition, kind: "session-invalid" },
  "COMMAND-Flk38": { code: Code.FailedPrecondition, kind: "session-invalid" },
};

export function classifyCallbackError(error: unknown): CallbackFailure | undefined {
  if (!(error instanceof ConnectError)) return undefined;
  for (const detail of error.findDetails(ErrorDetailSchema)) {
    const failure = Object.hasOwn(callbackFailures, detail.id) ? callbackFailures[detail.id] : undefined;
    if (failure?.code === error.code) return failure.kind;
  }
}
