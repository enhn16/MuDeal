"use client";

import { useState } from "react";

export function ActorAvatar({
  name,
  profileImageUrl,
  isFollowed,
}: {
  name: string;
  profileImageUrl?: string | null;
  isFollowed?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (profileImageUrl && !failed) {
    return (
      <img
        src={profileImageUrl}
        alt={`${name} 프로필`}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`h-10 w-10 shrink-0 rounded-sm object-cover ${
          isFollowed ? "ring-2 ring-champagne-gold" : "border border-outline"
        }`}
      />
    );
  }

  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-sm text-sm font-bold ${
        isFollowed ? "bg-curtain-noir text-gold-soft" : "bg-surface-sunken text-primary"
      }`}
    >
      {name.slice(0, 1)}
    </span>
  );
}
