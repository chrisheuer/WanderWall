"use client";

import { useEffect, useState } from "react";

/** Visible countdown for the download tier's 3-day edit window. */
export function EditWindowCountdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const msLeft = new Date(expiresAt).getTime() - now;
  if (msLeft <= 0) {
    return (
      <p className="notice">
        The edit window for this download gallery has closed. Your last export remains
        downloadable; upgrading to hosting re-enables editing.
      </p>
    );
  }

  const hours = Math.floor(msLeft / 3_600_000);
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000);

  return (
    <p className="notice">
      Edit window: {days > 0 ? `${days}d ` : ""}
      {remHours}h {minutes}m left to edit and re-export this gallery. After that it becomes
      read-only — your export stays downloadable forever.
    </p>
  );
}
