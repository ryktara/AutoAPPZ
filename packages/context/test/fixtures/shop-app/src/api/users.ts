import { query } from "../lib/db";

export interface User {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export async function getUser(id: string): Promise<User | undefined> {
  const rows = await query<User>("select * from users where id = ?", [id]);
  return rows[0];
}

export async function listUsers(): Promise<User[]> {
  return query<User>("select * from users");
}
