import type { User } from "../api/users";

export function UserCard({ user }: { user: User }) {
  return (
    <div className="user-card">
      <strong>{user.name}</strong>
    </div>
  );
}
