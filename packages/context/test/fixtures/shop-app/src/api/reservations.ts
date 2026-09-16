import { query } from "../lib/db";
import type { User } from "./users";

export type ReservationStatus = "pending" | "confirmed" | "cancelled";

export interface Reservation {
  readonly id: string;
  readonly user: User;
  readonly status: ReservationStatus;
  readonly priceCents: number;
  readonly startsAt: string;
}

export async function listReservations(userId: string): Promise<Reservation[]> {
  return query<Reservation>("select * from reservations where user_id = ?", [userId]);
}

export async function createReservation(userId: string, startsAt: string): Promise<Reservation> {
  const rows = await query<Reservation>("insert into reservations ... returning *", [userId, startsAt]);
  const created = rows[0];
  if (!created) throw new Error("insert failed");
  return created;
}

export async function cancelReservation(id: string): Promise<void> {
  await query("update reservations set status = 'cancelled' where id = ?", [id]);
}
