import ownerImage from "@/assets/images/owner.png";
import horseImage from "@/assets/images/horse.png";
import userImage from "@/assets/images/user.png";
import { ADMIN_AVATAR_URL } from "./avatarUrls";
import type { Role } from "./roles";

/** Default profile images when `customers.avatar_url` is not set. */
const ROLE_DEFAULT_AVATAR_URLS: Partial<Record<Role, string>> = {
  owner: ownerImage.src,
  admin: ADMIN_AVATAR_URL,
  moderator: horseImage.src,
  member: userImage.src,
};

/** 未ログイン時のチャット等で使う管理者デフォルト画像 URL（public 配信）。 */
export function getAdminDefaultAvatarUrl(): string {
  return "/avatars/admin.png";
}

/**
 * Returns the uploaded avatar URL when present; otherwise the role default image.
 */
export function resolveAvatarUrl(
  role: Role,
  avatarUrl: string | null | undefined,
): string | null {
  if (avatarUrl?.trim()) return avatarUrl;
  return ROLE_DEFAULT_AVATAR_URLS[role] ?? null;
}
