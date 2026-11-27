"use client";

import { useState } from "react";

export function ActorAvatar({
  name,
  profileImageUrl,
  isFollowed,
  size = "md",
}: {
  name: string;
  profileImageUrl?: string | null;
  isFollowed?: boolean;
  size?: "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const dims = size === "lg" ? "h-16 w-16 rounded-md text-2xl" : "h-10 w-10 rounded-sm text-sm";

  if (profileImageUrl && !failed) {
    return (
      <img
        src={profileImageUrl}
        alt={`${name} 프로필`}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`shrink-0 object-cover ${dims} ${
          isFollowed ? "ring-2 ring-champagne-gold" : "border border-outline"
        }`}
      />
    );
  }

  return (
    <span
      className={`flex shrink-0 items-center justify-center font-bold ${dims} ${
        isFollowed || size === "lg" ? "bg-curtain-noir text-gold-soft" : "bg-surface-sunken text-primary"
      }`}
    >
      {name.slice(0, 1)}
    </span>
  );
}
