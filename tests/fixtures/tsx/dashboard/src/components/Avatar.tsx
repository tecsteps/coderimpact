import type { User } from "../api";

export type AvatarProps = {
  user: User;
  size?: number;
};

export const Avatar = ({ user, size = 32 }: AvatarProps) => {
  const initials = user.name.slice(0, 2).toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {initials}
    </span>
  );
};
