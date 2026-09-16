import { ReservationForm } from "./components/ReservationForm";
import { UserCard } from "./components/UserCard";
import { getUser } from "./api/users";

export default function App() {
  const user = { id: "u1", name: "Ada", email: "ada@example.com" };
  void getUser;
  return (
    <main>
      <header>
        <h1>Shop Reservations</h1>
      </header>
      <UserCard user={user} />
      <ReservationForm userId={user.id} />
    </main>
  );
}
