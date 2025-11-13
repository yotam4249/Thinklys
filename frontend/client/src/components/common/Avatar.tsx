// src/components/common/Avatar.tsx
import React, { useEffect, useState } from "react";
import { presignGet } from "../../services/s3.service";
import type { Gender } from "../../types/user.type";

// local SVG imports
import maleAvatar from "../../assets/male.svg";
import femaleAvatar from "../../assets/female.svg";
import neutralAvatar from "../../assets/neutral.svg"; // optional

type Props = {
  url?: string | null;      // presigned GET url (if user uploaded)
  keyPath?: string | null;  // S3 key (for refreshing)
  gender?: Gender | null;   // used for default
  size?: number;
  alt?: string;
  className?: string;
};

export function Avatar({
  url,
  keyPath,
  gender,
  size = 40,
  alt = "avatar",
  className,
}: Props) {
  const [src, setSrc] = useState<string | null>(url ?? null);

  // refresh presigned URL if needed
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!url && keyPath) {
        try {
          const fresh = await presignGet(keyPath);
          if (mounted) setSrc(fresh);
        } catch {
          // ignore — we'll fall back to local avatar
        }
      } else {
        setSrc(url ?? null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [url, keyPath]);

  // choose fallback avatar based on gender
  let fallback = neutralAvatar;
  if (gender === "male") fallback = maleAvatar;
  else if (gender === "female") fallback = femaleAvatar;

  const displaySrc = src ?? fallback;

  return (
    <img
      src={displaySrc}
      alt={alt}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        backgroundColor: "#f5f5f5",
      }}
      className={className}
    />
  );
}
