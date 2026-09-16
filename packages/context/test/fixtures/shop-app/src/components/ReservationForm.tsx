import { useState } from "react";
import { createReservation, listReservations, type Reservation } from "../api/reservations";
import { formatDate, formatPrice } from "../lib/format";

export function ReservationForm({ userId }: { userId: string }) {
  const [items, setItems] = useState<Reservation[]>([]);
  const [startsAt, setStartsAt] = useState("");

  async function refresh() {
    setItems(await listReservations(userId));
  }

  async function submit() {
    await createReservation(userId, startsAt);
    await refresh();
  }

  return (
    <div className="reservation-list">
      <input value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
      <button className="btn-primary" onClick={() => void submit()}>
        Reserve
      </button>
      <ul>
        {items.map((r) => (
          <li key={r.id}>
            {formatDate(r.startsAt)} — {formatPrice(r.priceCents)} ({r.status})
          </li>
        ))}
      </ul>
    </div>
  );
}
