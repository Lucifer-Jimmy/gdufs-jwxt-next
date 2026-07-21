import { LockKeyhole, ShieldCheck } from "lucide-react";
import { Outlet } from "react-router-dom";

export function AuthLayout() {
  return (
    <main className="auth-shell">
      <header className="auth-header">
        <a className="brand" href="/" aria-label="GDUFS JWXT Next 首页">
          <span className="brand-mark" aria-hidden="true">
            G
          </span>
          <span>JWXT Next</span>
        </a>
        <div className="privacy-note">
          <ShieldCheck aria-hidden="true" />
          不保存个人数据
        </div>
      </header>

      <div className="auth-stage">
        <section className="auth-context" aria-labelledby="context-title">
          <div className="context-icon" aria-hidden="true">
            <LockKeyhole />
          </div>
          <h1 id="context-title">回到你的学业全貌</h1>
          <p>
            通过学校统一认证安全登录。成绩与个人信息仅在当前页面使用，退出或关闭页面后不会保留。
          </p>
          <dl className="trust-list">
            <div>
              <dt>数据来源</dt>
              <dd>学校教务系统实时查询</dd>
            </div>
            <div>
              <dt>产品边界</dt>
              <dd>只读，不修改教务数据</dd>
            </div>
          </dl>
        </section>

        <section className="auth-panel" aria-label="身份认证">
          <Outlet />
        </section>
      </div>

      <footer className="auth-footer">
        <p>个人开发维护，不代表广东外语外贸大学或学校教务部门。</p>
        <p>请仅在自己的设备上登录。</p>
      </footer>
    </main>
  );
}
