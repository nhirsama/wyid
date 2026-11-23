"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeSlash } from "@phosphor-icons/react";

export function CopyValue({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [revealed, setRevealed] = useState(!secret);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="copy-field">
      <div className="copy-field-label">
        <span>{label}</span>
        {copied && <small role="status">已复制</small>}
      </div>
      <div className="copy-field-value">
        <code>{revealed ? value : "••••••••••••••••••••••••"}</code>
        {secret && (
          <button
            type="button"
            className="icon-button"
            aria-label={revealed ? "隐藏密钥" : "显示密钥"}
            aria-pressed={revealed}
            onClick={() => setRevealed(current => !current)}
          >
            {revealed ? <EyeSlash size={17} /> : <Eye size={17} />}
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={`复制 ${label}`}
          title={copied ? "已复制" : "复制"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setError(false);
            } catch {
              setError(true);
            }
          }}
        >
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </div>
      {error && <small role="alert">复制失败，请选中文字手动复制。</small>}
    </div>
  );
}
