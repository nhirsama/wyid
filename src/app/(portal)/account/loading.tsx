import { Loading } from "@/components/account/ui";
import "@/components/account/account.css";
import { PageBackdrop } from "@/components/page-backdrop";

export default function AccountLoading() {
  return <div className="account-ui"><PageBackdrop variant="portal" /><main id="main-content" className="account-loading" aria-busy="true"><Loading text="正在读取账号门户…" /></main></div>;
}
