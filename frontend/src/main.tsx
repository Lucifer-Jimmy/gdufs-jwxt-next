import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

function DevelopmentGate() {
  return (
    <main>
      <section aria-labelledby="page-title">
        <p>GDUFS JWXT Next</p>
        <h1 id="page-title">正在进行运行环境验证</h1>
        <p>认证与学业查询将在安全基线通过后开放。</p>
      </section>
    </main>
  );
}

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Missing application root");
}

createRoot(root).render(
  <StrictMode>
    <DevelopmentGate />
  </StrictMode>,
);
