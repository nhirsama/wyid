"use client";

import { useEffect, useRef } from "react";
import type { AuthContext } from "@/lib/auth";
import { resumeLogin } from "@/server/actions";
import { Feedback, Notice, Submit, useAuthAction } from "@/components/ui/form";

export function ResumeLoginForm({ context }: { context: AuthContext }) {
  const action = useAuthAction();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    action.run(() => resumeLogin(context));
  }, [action, context]);
  return <form method="post" className="form" onSubmit={event => {
    event.preventDefault();
    action.run(() => resumeLogin(context));
  }}>
    <Notice>正在向账号服务确认已有登录状态…</Notice>
    <Feedback result={action.result} />
    <Submit pending={action.pending}>继续登录</Submit>
  </form>;
}
