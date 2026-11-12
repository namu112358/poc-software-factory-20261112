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
      {/* 読み上げを確実にするため、role="status" の要素は最初から置き、中の文言だけを切り替える。 */}
      <span role="status">{capsLock && <span data-testid="caps-lock-warning"> {CAPS_LOCK_MESSAGE}</span>}</span>
    </>
  );
}
