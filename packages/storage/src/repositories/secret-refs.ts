import { asc, eq } from "drizzle-orm";
import type { SecretRef } from "@autoappz/contracts";
import type { PlatformDb } from "../database.ts";
import { secretRefs } from "../schema.ts";

/** Metadata only. Ciphertext lives outside the database (see @autoappz/secrets). */
export class SecretRefsRepository {
  constructor(private readonly db: PlatformDb) {}

  list(): SecretRef[] {
    return this.db.select().from(secretRefs).orderBy(asc(secretRefs.createdAt)).all().map(toRef);
  }

  get(id: string): SecretRef | undefined {
    const row = this.db.select().from(secretRefs).where(eq(secretRefs.id, id)).get();
    return row ? toRef(row) : undefined;
  }

  insert(ref: SecretRef): void {
    this.db
      .insert(secretRefs)
      .values({
        id: ref.id,
        kind: ref.kind,
        provider: ref.provider ?? null,
        label: ref.label,
        lastFour: ref.lastFour ?? null,
        createdAt: ref.createdAt,
        rotatedAt: ref.rotatedAt ?? null,
      })
      .run();
  }

  update(ref: SecretRef): void {
    this.db
      .update(secretRefs)
      .set({
        kind: ref.kind,
        provider: ref.provider ?? null,
        label: ref.label,
        lastFour: ref.lastFour ?? null,
        rotatedAt: ref.rotatedAt ?? null,
      })
      .where(eq(secretRefs.id, ref.id))
      .run();
  }

  delete(id: string): boolean {
    return this.db.delete(secretRefs).where(eq(secretRefs.id, id)).run().changes > 0;
  }
}

function toRef(row: typeof secretRefs.$inferSelect): SecretRef {
  const ref: SecretRef = {
    id: row.id,
    kind: row.kind as SecretRef["kind"],
    label: row.label,
    createdAt: row.createdAt,
  };
  if (row.provider !== null) ref.provider = row.provider;
  if (row.lastFour !== null) ref.lastFour = row.lastFour;
  if (row.rotatedAt !== null) ref.rotatedAt = row.rotatedAt;
  return ref;
}
