import { useMutation } from "@tanstack/react-query";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { ApiError, login } from "../../lib/api";

interface AuthNoticeState {
  authNotice?: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const authNotice = (location.state as AuthNoticeState | null)?.authNotice;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const mutation = useMutation({
    mutationFn: () => login(username, password),
    onSuccess: () => navigate("/mfa"),
    onSettled: () => setPassword(""),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (username.trim().length === 0 || password.length === 0) {
      setFieldError("请输入学号和统一认证密码");
      return;
    }
    setFieldError(undefined);
    mutation.mutate();
  }

  const error = mutation.error instanceof ApiError ? mutation.error : undefined;

  return (
    <div className="auth-form-wrap">
      <div className="form-heading">
        <h2>登录</h2>
        <p>使用学校统一认证账号继续</p>
      </div>

      {authNotice ? <Alert variant="info">{authNotice}</Alert> : null}

      {error ? (
        <Alert>
          <p>{error.message}</p>
          <p className="request-id">请求编号：{error.requestId}</p>
        </Alert>
      ) : null}

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="field-group">
          <Label htmlFor="username">学号</Label>
          <Input
            id="username"
            name="username"
            autoComplete="username"
            inputMode="numeric"
            maxLength={64}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "login-field-error" : undefined}
            placeholder="请输入学号"
          />
        </div>
        <div className="field-group">
          <div className="field-label-row">
            <Label htmlFor="password">统一认证密码</Label>
            <span>密码不会被保存</span>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={256}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "login-field-error" : undefined}
            placeholder="请输入密码"
          />
        </div>
        {fieldError ? (
          <p className="field-error" id="login-field-error">
            {fieldError}
          </p>
        ) : null}
        <Button
          className="submit-button"
          size="lg"
          type="submit"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? (
            <>
              <LoaderCircle className="spin" aria-hidden="true" />
              正在连接统一认证
            </>
          ) : (
            <>
              继续
              <ArrowRight aria-hidden="true" />
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
