import { ShieldCheck } from "lucide-react";
import { Link, Outlet } from "react-router-dom";

export function AuthLayout() {
  return (
    <main className="auth-shell">
      <header className="auth-header">
        <Link className="brand" to="/" aria-label="GDUFS JWXT Next 首页">
          <span className="brand-mark" aria-hidden="true">
            G
          </span>
          <span>JWXT Next</span>
        </Link>
        <div className="privacy-note">
          <ShieldCheck aria-hidden="true" />
          不保存个人数据
        </div>
      </header>

      <div className="auth-stage">
        <section className="auth-panel" aria-label="身份认证">
          <Outlet />
        </section>
      </div>
    </main>
  );
}
