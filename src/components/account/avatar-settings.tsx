"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PencilSimple } from "@phosphor-icons/react";
import { api } from "@/lib/account/api";
import { AVATAR_HINT, avatarFileError } from "@/lib/account/avatar";
import type { Account } from "@/lib/account/types";
import { Avatar } from "./avatar";
import { Submit, TaskNotice, useTask } from "./ui";

export function AvatarSettings({ account, onAccount }: { account: Account; onAccount: (value: Account) => void }) {
  const [selection, setSelection] = useState<{ file: File; preview: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const task = useTask();
  useEffect(() => () => { if (selection) URL.revokeObjectURL(selection.preview); }, [selection]);
  function reset() { setSelection(null); formRef.current?.reset(); }
  return <section className="profile-avatar" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="profile-section-title">头像</h3>
    <form method="post" ref={formRef} className="form" onSubmit={event => {
      event.preventDefault();
      if (!selection) return;
      const form = new FormData();
      form.append("file", selection.file);
      task.run(async () => {
        const result = await api<{ account: Account }>("/me/avatar", { method: "POST", body: form });
        onAccount(result.account); reset();
      }, "头像已更新。");
    }}>
      <button className="avatar-picker" type="button" aria-label="更换头像" aria-describedby={`${id}-hint`} disabled={task.busy} onClick={() => inputRef.current?.click()}>
        <Avatar account={account} size={192} previewUrl={selection?.preview} />
        <span className="avatar-edit-badge"><PencilSimple size={15} aria-hidden="true" />更换头像</span>
      </button>
      <input ref={inputRef} className="avatar-file-input" type="file" name="file" aria-label="选择头像图片" accept="image/*" hidden disabled={task.busy} onChange={event => {
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
      }} />
      <p id={`${id}-hint`} className="field-hint">{AVATAR_HINT}</p>
      <TaskNotice task={task} />
      {selection ? <div className="form-actions">
        <Submit busy={task.busy}>保存头像</Submit>
        <button className="small-button" type="button" disabled={task.busy} onClick={() => { task.clear(); reset(); }}>取消</button>
      </div> : account.avatarUrl && <button className="text-link" type="button" disabled={task.busy} onClick={() => task.run(async () => {
          const result = await api<{ account: Account }>("/me/avatar", { method: "DELETE", body: "{}" });
          onAccount(result.account); reset();
        }, "头像已移除。")}>移除头像</button>}
    </form>
  </section>;
}
