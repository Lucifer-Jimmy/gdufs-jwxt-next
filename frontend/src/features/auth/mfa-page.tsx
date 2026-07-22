import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "../../components/ui/input-otp";
import { Label } from "../../components/ui/label";
import { Skeleton } from "../../components/ui/skeleton";
import {
  ApiError,
  getMfaStatus,
  isAuthErrorCode,
  sendMfaCode,
  verifyMfaCode,
} from "../../lib/api";

/** 与学校统一认证短信验证码位数一致（旧生产前端固定为 6 位数字）。 */
const CODE_LENGTH = 6;

function useCountdown(): [number, (seconds: number) => void] {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (remaining <= 0) {
      return;
    }
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1_000);
    return () => clearTimeout(timer);
  }, [remaining]);
  return [remaining, setRemaining];
}

function toApiError(error: unknown): ApiError | undefined {
  return error instanceof ApiError ? error : undefined;
}

export function MfaPage() {
  const navigate = useNavigate();
  const status = useQuery({
    queryKey: ["mfa-status"],
    queryFn: getMfaStatus,
    refetchOnWindowFocus: false,
  });

  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string>();
  const [countdown, setCountdown] = useCountdown();

  // 冷却时间以服务端返回值为准；页面恢复时同步剩余秒数。
  useEffect(() => {
    if (status.data) {
      setCountdown(status.data.retryAfterSeconds);
    }
  }, [status.data, setCountdown]);

  const send = useMutation({
    mutationFn: sendMfaCode,
    onSuccess: (data) => {
      setCode("");
      setCodeError(undefined);
      setCountdown(data.retryAfterSeconds);
    },
  });

  const verify = useMutation({
    mutationFn: (value: string) => verifyMfaCode(value),
    onSuccess: () => navigate("/overview", { replace: true }),
    onError: (error) => {
      if (error instanceof ApiError && error.code === "INVALID_MFA_CODE") {
        setCode("");
        setCodeError(error.message);
      }
    },
  });

  const statusError = toApiError(status.error);
  const sendError = toApiError(send.error);
  const verifyError = toApiError(verify.error);

  // 认证状态缺失或过期：回登录页并说明原因。
  useEffect(() => {
    if (
      (statusError && isAuthErrorCode(statusError.code)) ||
      (sendError && isAuthErrorCode(sendError.code))
    ) {
      void navigate("/", {
        replace: true,
        state: { authNotice: "验证流程已过期，请重新登录。" },
      });
    }
  }, [statusError, sendError, navigate]);

  useEffect(() => {
    if (verifyError && isAuthErrorCode(verifyError.code)) {
      void navigate("/", {
        replace: true,
        state: { authNotice: "验证流程已失效，请重新登录。" },
      });
    }
  }, [verifyError, navigate]);

  if (status.isPending) {
    return (
      <div className="auth-form-wrap" aria-label="正在加载验证信息">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-3 h-5 w-56" />
        <Skeleton className="mt-9 h-11 w-full" />
        <Skeleton className="mt-5 h-11 w-full" />
      </div>
    );
  }

  if (!status.data) {
    if (statusError && isAuthErrorCode(statusError.code)) {
      return null;
    }
    return (
      <div className="auth-form-wrap">
        <div className="form-heading">
          <h2>无法恢复验证流程</h2>
          <p>登录状态可能已过期</p>
        </div>
        <Alert>
          <p>{statusError?.message ?? "请返回并重新登录。"}</p>
          {statusError ? (
            <p className="request-id">请求编号：{statusError.requestId}</p>
          ) : null}
        </Alert>
        <Button asChild variant="outline" className="submit-button">
          <Link to="/">
            <ArrowLeft aria-hidden="true" />
            返回登录
          </Link>
        </Button>
      </div>
    );
  }

  const { maskedPhone, codeSent } = status.data;
  const busy = send.isPending || verify.isPending;
  const attemptsExhausted =
    verifyError?.code === "RATE_LIMITED" || sendError?.code === "RATE_LIMITED";

  function handleComplete(value: string) {
    setCode(value);
    setCodeError(undefined);
    verify.mutate(value);
  }

  function handleSend() {
    setCodeError(undefined);
    send.mutate();
  }

  return (
    <div className="auth-form-wrap">
      <div className="form-heading">
        <h2>验证手机号</h2>
        <p>验证码将发送至 {maskedPhone}</p>
      </div>

      {attemptsExhausted ? (
        <div>
          <Alert>
            <p>验证码尝试次数过多，验证流程已结束，请重新登录。</p>
            {(verifyError ?? sendError)?.requestId ? (
              <p className="request-id">
                请求编号：{(verifyError ?? sendError)?.requestId}
              </p>
            ) : null}
          </Alert>
          <Button asChild className="submit-button" size="lg">
            <Link to="/" replace>
              重新登录
            </Link>
          </Button>
        </div>
      ) : (
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (code.length === CODE_LENGTH && !busy) {
              setCodeError(undefined);
              verify.mutate(code);
            }
          }}
          noValidate
        >
          {sendError && !isAuthErrorCode(sendError.code) ? (
            <Alert>
              <p>{sendError.message}</p>
              <p className="request-id">请求编号：{sendError.requestId}</p>
            </Alert>
          ) : null}
          {verifyError &&
          !isAuthErrorCode(verifyError.code) &&
          verifyError.code !== "INVALID_MFA_CODE" ? (
            <Alert>
              <p>{verifyError.message}</p>
              <p className="request-id">请求编号：{verifyError.requestId}</p>
            </Alert>
          ) : null}

          {codeSent || send.isSuccess ? (
            <div className="field-group">
              <Label htmlFor="mfa-code">短信验证码</Label>
              <InputOTP
                id="mfa-code"
                maxLength={CODE_LENGTH}
                value={code}
                onChange={(value) => {
                  setCode(value);
                  setCodeError(undefined);
                }}
                onComplete={handleComplete}
                disabled={busy}
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-invalid={codeError ? true : undefined}
                aria-describedby={codeError ? "mfa-code-error" : undefined}
                containerClassName="w-full"
              >
                <InputOTPGroup className="grid w-full grid-cols-6 gap-2 sm:gap-2.5">
                  {Array.from({ length: CODE_LENGTH }, (_, index) => (
                    <InputOTPSlot key={index} index={index} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {codeError ? (
                <p className="field-error" id="mfa-code-error">
                  {codeError}
                </p>
              ) : null}
            </div>
          ) : null}

          {codeSent || send.isSuccess ? (
            <Button
              className="submit-button"
              size="lg"
              type="submit"
              disabled={busy || code.length !== CODE_LENGTH}
            >
              {verify.isPending ? (
                <>
                  <LoaderCircle className="spin" aria-hidden="true" />
                  正在校验验证码
                </>
              ) : (
                "完成验证"
              )}
            </Button>
          ) : (
            <Button
              className="submit-button"
              size="lg"
              type="button"
              onClick={handleSend}
              disabled={busy}
            >
              {send.isPending ? (
                <>
                  <LoaderCircle className="spin" aria-hidden="true" />
                  正在发送验证码
                </>
              ) : (
                "发送验证码"
              )}
            </Button>
          )}

          {codeSent || send.isSuccess ? (
            <div className="resend-row">
              <span>
                {countdown > 0 ? `${countdown} 秒后可重新发送` : "收不到验证码？"}
              </span>
              <Button
                variant="ghost"
                type="button"
                onClick={handleSend}
                disabled={busy || countdown > 0}
              >
                {send.isPending ? "正在发送" : "重新发送"}
              </Button>
            </div>
          ) : null}
        </form>
      )}

      {!attemptsExhausted && (
        <p className="form-footnote">
          <Link to="/" className="text-link">
            返回登录
          </Link>
          ，更换账号或重新发起验证。
        </p>
      )}
    </div>
  );
}
