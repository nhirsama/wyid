import type { ActionResult, AuthContext } from "./auth";
import { authenticate, passkeyUserId } from "./webauthn";
import { finishPasskey, startPasskey } from "@/server/actions";

export async function loginWithPasskey(context: AuthContext, chooseAccount = false): Promise<ActionResult> {
  try {
    let challenge = await startPasskey({ chooseAccount }, context);
    if (!challenge.ok || challenge.redirect) return challenge;
    if (!challenge.options) return { ok: false, message: "身份服务未返回通行密钥验证请求，请重试。" };

    if (challenge.discoverUser) {
      const account = await authenticate(challenge.options);
      challenge = await startPasskey({ userId: passkeyUserId(account) }, context);
      if (!challenge.ok || challenge.redirect) return challenge;
      if (!challenge.options || challenge.discoverUser) return { ok: false, message: "无法开始通行密钥登录，请重新选择账号。" };
    }

    // No intermediate "continue" click, no discovery for a remembered account,
    // and no locally invented authentication proof from the discovery response.
    return await finishPasskey(await authenticate(challenge.options), context);
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : "设备验证未完成，请重试。" };
  }
}
