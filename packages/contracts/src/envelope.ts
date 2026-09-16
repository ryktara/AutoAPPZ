import { z } from "zod";
import { SerializedAppErrorSchema } from "./errors.ts";

/** Correlation identifiers carried by every message (docs/architecture/COMMAND-BUS.md). */
export const CorrelationIdsSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  agentRunId: z.string().min(1).optional(),
  toolCallId: z.string().min(1).optional(),
  processId: z.string().min(1).optional(),
});
export type CorrelationIds = z.infer<typeof CorrelationIdsSchema>;

export const RequestEnvelopeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ids: CorrelationIdsSchema,
  issuedAt: z.number().int().nonnegative(),
  input: z.unknown(),
});
export type RequestEnvelope = z.infer<typeof RequestEnvelopeSchema>;

export const ResponseEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({ id: z.string().min(1), ok: z.literal(true), value: z.unknown() }),
  z.object({ id: z.string().min(1), ok: z.literal(false), error: SerializedAppErrorSchema }),
]);
export type ResponseEnvelope = z.infer<typeof ResponseEnvelopeSchema>;

export const StreamMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    streamId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    kind: z.literal("chunk"),
    payload: z.unknown(),
  }),
  z.object({ streamId: z.string().min(1), seq: z.number().int().nonnegative(), kind: z.literal("end") }),
  z.object({
    streamId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    kind: z.literal("error"),
    error: SerializedAppErrorSchema,
  }),
]);
export type StreamMessage = z.infer<typeof StreamMessageSchema>;

export const EventMessageSchema = z.object({
  name: z.string().min(1),
  seq: z.number().int().nonnegative(),
  payload: z.unknown(),
});
export type EventMessage = z.infer<typeof EventMessageSchema>;

export const CancelMessageSchema = z.object({ id: z.string().min(1) });
export type CancelMessage = z.infer<typeof CancelMessageSchema>;

/** Every message on the wire, in either direction. */
export const WireMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("request"), request: RequestEnvelopeSchema }),
  z.object({ type: z.literal("response"), response: ResponseEnvelopeSchema }),
  z.object({ type: z.literal("stream"), message: StreamMessageSchema }),
  z.object({ type: z.literal("event"), event: EventMessageSchema }),
  z.object({ type: z.literal("cancel"), cancel: CancelMessageSchema }),
  z.object({ type: z.literal("subscribe"), name: z.string().min(1), token: z.string().min(1) }),
  z.object({ type: z.literal("unsubscribe"), name: z.string().min(1), token: z.string().min(1) }),
]);
export type WireMessage = z.infer<typeof WireMessageSchema>;
