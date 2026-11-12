"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/account/api";
import { AVATAR_HINT, avatarFileError } from "@/lib/account/avatar";
import type { Account } from "@/lib/account/types";
import { Avatar } from "./avatar";
import { Field, Panel, Submit, TaskNotice, useTask } from "./ui";

export function AvatarSettings({ account, onAccount }: { account: Account; onAccount: (value: Account) => void }) {
  const [selection, setSelection] = useState<{ file: File; preview: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const task = useTask();
  useEffect(() => () => { if (selection) URL.revokeObjectURL(selection.preview); }, [selection]);
  function reset() { setSelection(null); formRef.current?.reset(); }
  return <Panel title="头像" description="设置你的账号头像。">
    <TaskNotice task={task} />
    <form method="post" ref={formRef} className="form settings-form" onSubmit={event => {
      event.preventDefault();
      if (!selection) return;
      const form = new FormData();
      form.append("file", selection.file);
      task.run(async () => {
        const result = await api<{ account: Account }>("/me/avatar", { method: "POST", body: form });
        onAccount(result.account); reset();
      }, "头像已更新。");
    }}>
      <Avatar account={account} size={64} previewUrl={selection?.preview} />
      <Field label="头像图片" hint={AVATAR_HINT}><input className="avatar-file-input" type="file" name="file" accept="image/*" disabled={task.busy} onChange={event => {
        task.clear();
        const file = event.currentTarget.files?.[0];
        if (!file) { setSelection(null); return; }
        const error = avatarFileError(file);
        if (error) {
          event.currentTarget.value = ""; setSelection(null);
          task.run(async () => { throw new Error(error); });
          return;
        }
        setSelection({ file, preview: URL.createObjectURL(file) });
      }} /></Field>
      <div className="form-actions">
        {selection && <button className="small-button" type="button" disabled={task.busy} onClick={() => { task.clear(); reset(); }}>取消选择</button>}
        {account.avatarUrl && <button className="small-button" type="button" disabled={task.busy} onClick={() => task.run(async () => {
          const result = await api<{ account: Account }>("/me/avatar", { method: "DELETE", body: "{}" });
          onAccount(result.account); reset();
        }, "头像已移除。")}>移除头像</button>}
        <Submit busy={task.busy} disabled={!selection}>保存头像</Submit>
      </div>
    </form>
  </Panel>;
}
