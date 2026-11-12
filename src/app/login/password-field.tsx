"use client";

import { useState } from "react";
import { CAPS_LOCK_MESSAGE, isCapsLockOn } from "@/lib/caps-lock";

export function PasswordField() {
  const [capsLock, setCapsLock] = useState(false);
  return (
    <>
      <label>
        パスワード{" "}
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          onKeyDown={(e) => setCapsLock(isCapsLockOn(e))}
          onKeyUp={(e) => setCapsLock(isCapsLockOn(e))}
          onBlur={() => setCapsLock(false)}
        />
      </label>
      {capsLock && <span data-testid="caps-lock-warning" role="status"> {CAPS_LOCK_MESSAGE}</span>}
    </>
  );
}
