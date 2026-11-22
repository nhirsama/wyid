import { Loading } from "@/components/account/ui";
import "@/components/account/account.css";

export default function AccountLoading() {
  return <div className="account-ui"><main id="main-content" className="account-loading" aria-busy="true"><Loading text="正在读取账号门户…" /></main></div>;
}
