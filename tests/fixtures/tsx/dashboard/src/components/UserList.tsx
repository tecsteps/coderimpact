import { Avatar } from "./Avatar";
import { formatName, type User } from "../api";

interface UserListProps {
  users: User[];
  onSelect: (user: User) => void;
}

export function sortByName(users: User[]): User[] {
  return [...users].sort((a, b) => a.name.localeCompare(b.name));
}

export function UserList({ users, onSelect }: UserListProps) {
  const sorted = sortByName(users);
  return (
    <ul>
      {sorted.map((u) => (
        <li key={u.id} onClick={() => onSelect(u)}>
          <Avatar user={u} size={24} />
          {formatName(u)}
        </li>
      ))}
    </ul>
  );
}
